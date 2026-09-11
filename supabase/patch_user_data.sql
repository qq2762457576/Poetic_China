-- ============================================================
-- 诗意中国 · 用户扩展数据表补丁（user_data）
--
-- 背景：有两类「当前登录用户自己的数据」还没有上云的落脚点：
--   1) 每日学习记录（本地键 shici_daily = { "YYYY-MM-DD": 当天新学篇数 }）
--      —— 它是「我的」页学习趋势图（Phase 2.3）的唯一数据源。
--         只存本地的话，换设备趋势图就归零了。
--   2) 自定义头像（本地键 shici_avatar，一条 96×96 的 data URI）
--      —— 社区里发帖、评论都带作者头像，换设备应保持一致。
--
-- 用法：
--   Supabase 后台 → SQL Editor → New query
--   → 整段粘贴 → Run（不要只选中一部分）
--
-- 说明：
--   - 幂等设计：重复执行不报错、不重复建表
--   - 函数用 create or replace，**已执行过旧版也可直接重跑**，只替换函数体
--   - 共 5 段，可分段单独执行
--
-- ⚠️ 为什么不做成「一列一个值」而是一行 JSON：
--   这两类数据都是「一人一份、整体读写、无需按字段查询」的附属数据，
--   拆成两张表除了让关联查询更啰嗦之外没有任何收益。
--   与 learned / favs / wrongbook 那些「一条一条、需要单独增删」的数据
--   本质不同，所以这里刻意不照抄它们的表结构。
--
-- ⚠️ 为什么头像存 data URI 而不是 Supabase Storage：
--   Storage 有单独的存储与流量配额，而头像只是一个 96×96 的小圆图
--   （jpeg 质量 0.8 后通常 5–15 KB）。个人站规模下，直接存一列文本
--   最省事也最省钱，且省掉了 bucket 策略、public URL、跨域等一整套配置。
--   真到了需要大图的那天再迁 Storage 也不迟（列名不变，值换 URL 即可）。
-- ============================================================


-- ============================================================
-- 第 1 段：建表
-- ============================================================

create table if not exists public.user_data (
  -- 一个用户一行：user_id 直接做主键，天然满足「一人一份」
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- 每日学习记录：{ "2026-09-11": 3, "2026-09-10": 1, ... }
  -- 用 jsonb 而非 json：需要按值做合并（下面 RPC 里会用到 || 与比较）
  daily      jsonb not null default '{}'::jsonb,
  -- 自定义头像的 data URI（image/jpeg;base64,...）；空串表示未设置，前端回退到首字头像
  avatar     text  not null default '',
  updated_at timestamptz not null default now()
);


-- ============================================================
-- 第 2 段：表级授权
-- 只给登录用户，游客（anon）一律无权限
-- ============================================================

grant usage on schema public to authenticated;
grant select, insert, update on public.user_data to authenticated;


-- ============================================================
-- 第 3 段：行级安全 RLS
-- 学习记录与头像都是私密数据，只允许本人读写
-- ============================================================

alter table public.user_data enable row level security;

drop policy if exists user_data_select_own on public.user_data;
create policy user_data_select_own on public.user_data
  for select to authenticated using ( auth.uid() = user_id );

drop policy if exists user_data_insert_own on public.user_data;
create policy user_data_insert_own on public.user_data
  for insert to authenticated with check ( auth.uid() = user_id );

drop policy if exists user_data_update_own on public.user_data;
create policy user_data_update_own on public.user_data
  for update to authenticated using ( auth.uid() = user_id )
                                with check ( auth.uid() = user_id );


-- ============================================================
-- 第 4 段：每日记录合并函数
--
-- 为什么合并要在数据库里做，而不是前端读出来算完再写回：
--   前端「读 → 合并 → 写」在换设备的场景下会丢数据 ——
--   两台设备的本地记录都是各自的，谁后写谁把对方覆盖掉。
--   在数据库里用 jsonb 的 || 合并、同键取较大值，一次往返完成，
--   不依赖客户端内存里的副本，也就不会被覆盖。
--
-- ⚠️ 为什么同键取「较大值」而不是相加或取最新：
--   daily 的值是「当天累计新学篇数」，是**累计量不是增量**。
--   两台设备同一天各自记了 2 篇和 3 篇，正确答案是 3 还是 5？
--   都有可能，但无法判定 —— 取较大值是保守且不会重复累加的选择
--   （相加会把同一批学习重复计入）。宁可少记，不可虚增。
-- ============================================================

create or replace function public.merge_user_daily(p_daily jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- 未登录显式拦截：不依赖 user_id NOT NULL 约束兜底
  if v_uid is null then
    return;
  end if;
  if p_daily is null then
    return;
  end if;

  insert into public.user_data (user_id, daily, updated_at)
  values (v_uid, p_daily, now())
  on conflict (user_id) do update set
    -- 合并：以已存的为基础，新值逐键覆盖；同键取较大值。
    -- ⚠️ 值统一走 nullif(...,'')::int 再 coalesce 到 0：
    --    jsonb 里若混进空串或非数字，裸 ::int 会直接抛异常把整次同步打断。
    --    这里宁可把脏值当 0，也不能让一条坏数据毁掉整份记录的合并。
    daily = (
      select coalesce(jsonb_object_agg(
               key,
               greatest(
                 coalesce(nullif(public.user_data.daily ->> key, '')::int, 0),
                 coalesce(nullif(value, '')::int, 0)
               )
             ), '{}'::jsonb)
      from jsonb_each_text(
        public.user_data.daily || excluded.daily
      )
    ),
    updated_at = now();
end;
$$;

grant execute on function public.merge_user_daily(jsonb) to authenticated;


-- ============================================================
-- 第 5 段：头像写入函数
-- 单独一个函数而不复用上面的 merge：头像要能被「清空」（设为空串），
-- 而 merge 的逻辑是「只增不减」，清空会在合并里被旧值盖回去。
-- ============================================================

create or replace function public.save_user_avatar(p_avatar text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  insert into public.user_data (user_id, avatar, updated_at)
  values (v_uid, coalesce(p_avatar, ''), now())
  on conflict (user_id) do update set
    avatar = coalesce(p_avatar, ''),
    updated_at = now();
end;
$$;

grant execute on function public.save_user_avatar(text) to authenticated;


-- ============================================================
-- 执行成功应看到：Success. No rows returned
-- 验证：Table Editor 里应出现 user_data 表，列为
--       user_id / daily / avatar / updated_at
--
-- ⚠️ 跑完这张表，前端才真正可用。不跑的表现是：
--   学习趋势与头像「在登录状态下同步静默失败」—— 本地照常记录、
--   页面上看不出任何报错，只有换设备时才发现没同步上。
-- ============================================================
