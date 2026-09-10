-- ============================================================
-- 诗意中国 · Supabase 数据库结构（保守版 v2）
--
-- 用法：
--   Supabase 后台 → 左侧 SQL Editor → New query
--   → 整段粘贴 → 点 Run（不要只选中一部分）
--
-- 说明：
--   - 全部标识符用英文（避免中文在粘贴时被转码导致语法错误）
--   - 幂等设计：重复执行不会报错、不会重复建表
--   - 共 5 段，任何一段失败可单独复制出来执行定位问题
-- ============================================================


-- ============================================================
-- 第 0 段：扩展（失败不影响后续）
-- ============================================================
do $$
begin
  create extension if not exists pgcrypto;
exception when others then
  raise notice 'pgcrypto 不可用，已跳过（PostgreSQL 13+ 内置 gen_random_uuid，不影响）';
end $$;


-- ============================================================
-- 第 1 段：建表
-- ============================================================

-- 帖子表（唱诗词分享）
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'original',   -- classic / original
  title       text not null,
  body        text not null default '',
  poem_id     integer,
  author      text not null,
  user_id     uuid references auth.users(id) on delete set null,
  status      text not null default 'approved',   -- pending / approved / rejected
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_status_idx  on public.posts (status);

-- 评论表
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author     text not null,
  user_id    uuid references auth.users(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_idx on public.comments (post_id, created_at);


-- ============================================================
-- 第 2 段：表级授权（最容易漏的一步，漏了会 permission denied）
-- ============================================================

grant usage on schema public to anon, authenticated;

-- 游客可读已通过的帖子；登录用户可读写自己的
grant select                on public.posts to anon, authenticated;
grant insert, update        on public.posts to authenticated;

-- 评论：游客可读，登录用户可写可删自己的
grant select, insert, delete on public.comments to anon, authenticated;


-- ============================================================
-- 第 3 段：行级安全 RLS
-- ============================================================

alter table public.posts    enable row level security;
alter table public.comments enable row level security;

-- 帖子：所有人（含游客）可读已通过的
-- 清理早期版本遗留的中文名策略（已执行过旧版脚本的库不会产生重复策略）
drop policy if exists "posts: 公开可读已通过" on public.posts;
drop policy if exists "posts: 作者可读自己的" on public.posts;
drop policy if exists "posts: 登录可发"       on public.posts;
drop policy if exists "posts: 作者可改"       on public.posts;
drop policy if exists "comments: 公开可读"    on public.comments;
drop policy if exists "comments: 登录可评"    on public.comments;
drop policy if exists "comments: 作者可删"    on public.comments;

drop policy if exists posts_select_public on public.posts;
create policy posts_select_public
  on public.posts for select
  using ( status = 'approved' );

-- 帖子：登录用户可读自己所有状态（含待审核、被驳回）
drop policy if exists posts_select_own on public.posts;
create policy posts_select_own
  on public.posts for select
  to authenticated
  using ( auth.uid() = user_id );

-- 帖子：登录用户可发帖
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own
  on public.posts for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- 帖子：只能改自己的
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own
  on public.posts for update
  to authenticated
  using ( auth.uid() = user_id );

-- 评论：所有人可读
drop policy if exists comments_select_public on public.comments;
create policy comments_select_public
  on public.comments for select
  using ( true );

-- 评论：登录用户可发表
drop policy if exists comments_insert_auth on public.comments;
create policy comments_insert_auth
  on public.comments for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- 评论：只能删自己的
drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own
  on public.comments for delete
  to authenticated
  using ( auth.uid() = user_id );


-- ============================================================
-- 第 4 段：点赞函数
-- security definer：绕过 RLS 自增计数，否则游客点赞会被策略拦下
-- ============================================================

-- 必须先 drop 再 create：Postgres 禁止 CREATE OR REPLACE 修改已有函数的参数名
-- （早期版本参数名为 post_id，直接 replace 会报 cannot change name of input parameter）
drop function if exists public.increment_likes(uuid);

create function public.increment_likes(post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.posts set likes = likes + 1 where id = post_id;
$$;

grant execute on function public.increment_likes(uuid) to anon, authenticated;


-- ============================================================
-- 执行成功应看到：Success. No rows returned
-- 验证：左侧 Table Editor 里应出现 posts / comments 两张表
-- ============================================================
