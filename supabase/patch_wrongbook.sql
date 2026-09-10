-- ============================================================
-- 诗意中国 · 错题本上云补丁
--
-- 背景：错题本原先只存本地 localStorage（shici_wrongbook），
--       换设备 / 换浏览器就整本丢失。本补丁让它跟 learned / favs
--       一样「本地优先 + 登录后合并上云」。
--
-- 用法：
--   Supabase 后台 → SQL Editor → New query
--   → 整段粘贴 → Run（不要只选中一部分）
--
-- 说明：
--   - 幂等设计：重复执行不报错、不重复建表
--   - 共 4 段，可分段单独执行
--   - ⚠️ 必须先执行过 schema_user_data.sql（本补丁依赖 public.is_admin() 之外
--     无额外依赖，但 RLS 风格与其保持一致）
-- ============================================================


-- ============================================================
-- 第 1 段：建表
--
-- 为什么是「一题一行」而不是「一行存整个 JSON」：
--   与 learned / favs 同构，读写逻辑可复用同一套并集合并策略；
--   单条增删直接对应一条 SQL，不必先读整块 JSON 再写回（避免并发覆盖）。
--
-- 为什么存 title+author+stem 而不是题目 id：
--   题库每次访问随机换块（quizpool/p{0..3}.js），索引不稳定；
--   而「同一首诗的同一道题」由 title + stem 唯一确定，可完整复现题目。
--   去重因此用 (user_id, title, stem) 唯一约束 —— 不加 author 一起做键，
--   是因为同一首诗不可能跨作者；author 只作为展示字段。
-- ============================================================

create table if not exists public.wrongbook (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  author     text not null default '',
  stem       text not null,
  tip        text not null default '',
  mode       text not null default 'fill',
  -- 客户端记录的答错时刻（毫秒时间戳），用于「最近错题」排序
  wrong_ts   bigint not null default 0,
  created_at timestamptz not null default now(),
  -- 同一首诗的同一道题只留一条：重复答错走 upsert 更新时间，不产生新行
  unique (user_id, title, stem)
);

create index if not exists wrongbook_user_idx on public.wrongbook (user_id, wrong_ts desc);


-- ============================================================
-- 第 2 段：表级授权
-- ============================================================

grant usage on schema public to anon, authenticated;

-- 注意这里要 update：错题重复答错时是「更新已有行的时间戳」，不只是 insert
grant select, insert, update, delete on public.wrongbook to authenticated;


-- ============================================================
-- 第 3 段：行级安全 RLS
-- 错题本记录的是个人薄弱点，属于私密学习数据，只允许本人读写
-- ============================================================

alter table public.wrongbook enable row level security;

drop policy if exists wrongbook_select_own on public.wrongbook;
create policy wrongbook_select_own on public.wrongbook
  for select to authenticated using ( auth.uid() = user_id );

drop policy if exists wrongbook_insert_own on public.wrongbook;
create policy wrongbook_insert_own on public.wrongbook
  for insert to authenticated with check ( auth.uid() = user_id );

drop policy if exists wrongbook_update_own on public.wrongbook;
create policy wrongbook_update_own on public.wrongbook
  for update to authenticated using ( auth.uid() = user_id );

drop policy if exists wrongbook_delete_own on public.wrongbook;
create policy wrongbook_delete_own on public.wrongbook
  for delete to authenticated using ( auth.uid() = user_id );


-- ============================================================
-- 第 4 段：批量合并函数
--
-- 首次登录时要把本地攒的错题一次性推上去。若在客户端逐条 upsert，
-- 200 条就是 200 次请求；这里用一个函数收一个 jsonb 数组，
-- 一次往返完成，且由数据库端做去重。
--
-- 用 jsonb_to_recordset 而不是循环：纯 SQL、无自定义类型依赖。
-- ============================================================

create or replace function public.merge_wrongbook(p_items jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with src as (
    select
      coalesce(nullif(trim(x.title), ''), '') as title,
      coalesce(x.author, '')                  as author,
      coalesce(nullif(trim(x.stem), ''), '')  as stem,
      coalesce(x.tip, '')                     as tip,
      coalesce(nullif(x.mode, ''), 'fill')    as mode,
      coalesce(x.wrong_ts, 0)                 as wrong_ts
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(
      title text, author text, stem text, tip text, mode text, wrong_ts bigint
    )
  ),
  valid as (
    -- 标题与题干都为空的行没有复现价值，挡在入库前
    select * from src where title <> '' and stem <> ''
  ),
  ins as (
    insert into public.wrongbook (user_id, title, author, stem, tip, mode, wrong_ts)
    select auth.uid(), title, author, stem, tip, mode, wrong_ts from valid
    on conflict (user_id, title, stem) do update set
      -- 重复答错时保留更新的那次时间戳，其余字段以最新一次为准
      author   = excluded.author,
      tip      = excluded.tip,
      mode     = excluded.mode,
      wrong_ts = greatest(public.wrongbook.wrong_ts, excluded.wrong_ts)
    returning 1
  )
  select count(*)::integer from ins;
$$;

grant execute on function public.merge_wrongbook(jsonb) to authenticated;


-- ============================================================
-- 执行成功应看到：Success. No rows returned
-- 验证：Table Editor 里应出现 wrongbook 表（共 8 列）
-- ============================================================
