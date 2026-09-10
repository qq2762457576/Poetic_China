-- ============================================================
-- 诗意中国 · 用户数据表（v1.1）
--
-- 新增四张表：学习进度 / 收藏 / 挑战成绩 / 审核人名单
-- 配合前端「本地优先 + 登录后合并上云」策略（A 方案）：
--   · 未登录：数据存 localStorage，随开随用
--   · 登录后：本地数据一次性合并到云端，之后读写走云端
--   · 换设备：登录即恢复全部进度
--
-- 用法：
--   Supabase 后台 → SQL Editor → New query
--   → 整段粘贴 → Run（不要只选中一部分）
--
-- 说明：
--   - 幂等设计：重复执行不报错、不重复建表
--   - 全部标识符用英文，避免中文粘贴被转码
--   - 共 5 段，可分段单独执行
-- ============================================================


-- ============================================================
-- 第 1 段：建表
-- ============================================================

-- 学习进度（标记「已学」）
create table if not exists public.learned (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  poem_id    integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, poem_id)
);

create index if not exists learned_user_idx on public.learned (user_id, created_at desc);

-- 收藏
create table if not exists public.favs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  poem_id    integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, poem_id)
);

create index if not exists favs_user_idx on public.favs (user_id, created_at desc);

-- 挑战成绩（一人一行，存个人最好记录）
create table if not exists public.scores (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  best_score  integer not null default 0,
  best_streak integer not null default 0,
  total_done  integer not null default 0,
  total_right integer not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists scores_best_idx on public.scores (best_score desc);

-- 审核人授权名单（社区内容审核权）
-- 只有站长（管理员）能把审核权授予他人，被授权人也可参与审核，但不能再授权。
-- granted_by 记录是谁授权的，便于追溯。
create table if not exists public.reviewers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 统一按小写邮箱比对，杜绝 A@x.com / a@x.com 被当作两个人
create unique index if not exists reviewers_email_uniq on public.reviewers (lower(email));


-- ============================================================
-- 第 2 段：表级授权
-- ============================================================

grant usage on schema public to anon, authenticated;

grant select, insert, delete on public.learned to authenticated;
grant select, insert, delete on public.favs    to authenticated;
grant select, insert, update on public.scores  to authenticated;

-- 审核人名单：登录用户可读（前端要判断自己有没有审核权），写入由 RLS 收紧到管理员
grant select, insert, delete on public.reviewers to authenticated;


-- ============================================================
-- 第 3 段：管理员判定函数
-- 放在 RLS 策略之前 —— 策略里要引用它，先定义后使用
--
-- ⚠️ 要改站长邮箱，只改这里的列表即可（下面 reviewers 表的策略会自动生效）
-- 判断依据用「邮箱」而非昵称：昵称可重名，邮箱是账号唯一标识
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) in (
        lower('2762457576@qq.com')
      )
  );
$$;

grant execute on function public.is_admin() to authenticated;


-- ============================================================
-- 第 4 段：行级安全 RLS
-- 学习数据是私密的，只允许本人读写；游客（anon）一律无权限
-- ============================================================

alter table public.learned enable row level security;
alter table public.favs    enable row level security;
alter table public.scores  enable row level security;

-- 学习进度：只能读写自己的
drop policy if exists learned_select_own on public.learned;
create policy learned_select_own on public.learned
  for select to authenticated using ( auth.uid() = user_id );

drop policy if exists learned_insert_own on public.learned;
create policy learned_insert_own on public.learned
  for insert to authenticated with check ( auth.uid() = user_id );

drop policy if exists learned_delete_own on public.learned;
create policy learned_delete_own on public.learned
  for delete to authenticated using ( auth.uid() = user_id );

-- 收藏：只能读写自己的
drop policy if exists favs_select_own on public.favs;
create policy favs_select_own on public.favs
  for select to authenticated using ( auth.uid() = user_id );

drop policy if exists favs_insert_own on public.favs;
create policy favs_insert_own on public.favs
  for insert to authenticated with check ( auth.uid() = user_id );

drop policy if exists favs_delete_own on public.favs;
create policy favs_delete_own on public.favs
  for delete to authenticated using ( auth.uid() = user_id );

-- 成绩：只能读写自己的
drop policy if exists scores_select_own on public.scores;
create policy scores_select_own on public.scores
  for select to authenticated using ( auth.uid() = user_id );

drop policy if exists scores_insert_own on public.scores;
create policy scores_insert_own on public.scores
  for insert to authenticated with check ( auth.uid() = user_id );

drop policy if exists scores_update_own on public.scores;
create policy scores_update_own on public.scores
  for update to authenticated using ( auth.uid() = user_id );


-- 审核人名单：任何人都不能直接改，只有「管理员邮箱」对应的账号能增删
-- 管理员身份由 public.is_admin() 统一判断（见第 3 段），改邮箱白名单只需改函数一处
alter table public.reviewers enable row level security;

-- 所有登录用户可读（前端要用它判断当前账号是否具备审核资格）
drop policy if exists reviewers_select_all on public.reviewers;
create policy reviewers_select_all on public.reviewers
  for select to authenticated using ( true );

-- 只有管理员能添加审核人
drop policy if exists reviewers_insert_admin on public.reviewers;
create policy reviewers_insert_admin on public.reviewers
  for insert to authenticated with check ( public.is_admin() );

-- 只有管理员能移除审核人
drop policy if exists reviewers_delete_admin on public.reviewers;
create policy reviewers_delete_admin on public.reviewers
  for delete to authenticated using ( public.is_admin() );


-- ============================================================
-- 第 5 段：成绩 upsert 函数
-- 客户端只上报「本次成绩」，由数据库负责取最大值，避免覆盖掉更好的历史记录
-- ============================================================

create or replace function public.upsert_score(
  p_score  integer,
  p_streak integer,
  p_done   integer,
  p_right  integer
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.scores (user_id, best_score, best_streak, total_done, total_right, updated_at)
  values (
    auth.uid(),
    greatest(p_score, 0),
    greatest(p_streak, 0),
    greatest(p_done, 0),
    greatest(p_right, 0),
    now()
  )
  on conflict (user_id) do update set
    best_score  = greatest(public.scores.best_score,  excluded.best_score),
    best_streak = greatest(public.scores.best_streak, excluded.best_streak),
    total_done  = greatest(public.scores.total_done,  excluded.total_done),
    total_right = greatest(public.scores.total_right, excluded.total_right),
    updated_at  = now();
$$;

grant execute on function public.upsert_score(integer, integer, integer, integer) to authenticated;


-- ============================================================
-- 执行成功应看到：Success. No rows returned
-- 验证：Table Editor 里应出现 learned / favs / scores / reviewers 四张表
--
-- 站长账号：2762457576@qq.com
--   · 该邮箱注册/登录后，社区页右侧会自动出现「审核中心」面板
--   · 面板底部的「授权」输入框只对站长可见，填对方登录邮箱即可授予审核权
--   · 想换站长，改第 3 段 is_admin() 里的邮箱，重新 Run 第 3 段即可
-- ============================================================
