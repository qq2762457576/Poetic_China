-- ============================================================
-- 诗意中国 · 社区审核权限补丁（v2）
-- ------------------------------------------------------------
-- 用途：让「站长/被授权审核人」能通过网页审核**别人的**帖子。
--
-- 为什么需要这个补丁：
--   schema.sql 里的策略只允许「改自己的帖子」（posts_update_own）。
--   站长要审核的是**别人**发的帖子，因此旧策略下点击「通过 / 驳回」
--   会被数据库直接拒绝 —— 前端看起来像没反应。
--
-- 依赖：请先执行过 schema_user_data.sql（其中含 is_admin() 函数）
--
-- 用法：Supabase 后台 → SQL Editor → New query → 整段粘贴 → Run
--   执行成功应看到：Success. No rows returned
-- ============================================================


-- ------------------------------------------------------------
-- 第 1 段：确保 is_admin() 存在
--   本补丁依赖它。若你已执行 schema_user_data.sql，这里是幂等的重建。
--   ⚠️ 站长邮箱必须与 assets/js/config.js 的 admins 数组一致
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- 第 2 段：判断「我是否有审核权」
--   站长 或 在 reviewers 授权名单里。与前端 canReview() 口径一致。
--   同样 security definer —— 普通用户也要能查 reviewers 表来确认自己的权限，
--   但又不能因此读到完整名单的写权限。
-- ------------------------------------------------------------
create or replace function public.can_review()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.reviewers r
      where lower(r.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

grant execute on function public.can_review() to authenticated;


-- ------------------------------------------------------------
-- 第 3 段：给帖子表补「审核人可读」与「审核人可改」策略
--   原有策略保留（作者仍能改自己的），这里是**新增**授权，不是替换。
-- ------------------------------------------------------------

-- 审核人要能看到待审队列，就必须能读到 pending / rejected 的帖子。
-- 注意：只对具备审核权的人放开，普通用户依然只能读已通过的 + 自己的。
drop policy if exists posts_select_reviewer on public.posts;
create policy posts_select_reviewer
  on public.posts for select
  to authenticated
  using ( public.can_review() );

-- 审核人可改任意帖子的状态（通过 / 驳回）
drop policy if exists posts_update_reviewer on public.posts;
create policy posts_update_reviewer
  on public.posts for update
  to authenticated
  using ( public.can_review() )
  with check ( public.can_review() );


-- ------------------------------------------------------------
-- 第 4 段：reviewers 表策略检查
--   站长可增删；被授权人可读（用于前端确认自己有没有权限）
--   若 schema_user_data.sql 已建好，这里是幂等的重建。
-- ------------------------------------------------------------
alter table public.reviewers enable row level security;

drop policy if exists reviewers_select_all on public.reviewers;
create policy reviewers_select_all
  on public.reviewers for select
  to authenticated
  using ( true );

drop policy if exists reviewers_insert_admin on public.reviewers;
create policy reviewers_insert_admin
  on public.reviewers for insert
  to authenticated
  with check ( public.is_admin() );

drop policy if exists reviewers_delete_admin on public.reviewers;
create policy reviewers_delete_admin
  on public.reviewers for delete
  to authenticated
  using ( public.is_admin() );


-- ============================================================
-- 验证方法（执行完可在 SQL Editor 里跑）
-- ------------------------------------------------------------
-- ① 确认函数都在：
--   select public.is_admin() as i_am_admin,
--          public.can_review() as i_can_review;
--   （登录站长账号时 i_am_admin 应为 true）
--
-- ② 看待审队列：
--   select id, title, author, status, created_at
--   from public.posts where status = 'pending'
--   order by created_at desc;
--
-- ③ 看审核人名单：
--   select * from public.reviewers;
--
-- 执行成功应看到：Success. No rows returned
-- ============================================================
