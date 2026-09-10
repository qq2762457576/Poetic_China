-- ============================================================
-- 诗意中国 · Supabase 数据库结构
-- 用法：Supabase 后台 → 左侧 SQL Editor → New query → 整段粘贴 → Run
-- 幂等设计：重复执行不会产生重复数据或报错
-- ============================================================

-- ---------- 1. 帖子表（唱诗词分享） ----------
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'original',   -- classic=分享经典 / original=原创
  title       text not null,
  body        text not null default '',           -- 原创正文；分享经典时留空，用 poem_id 取
  poem_id     integer,                            -- 分享经典时指向诗词库 id
  author      text not null,                      -- 笔名（展示用，冗余存储避免联表）
  user_id     uuid references auth.users(id) on delete set null,
  status      text not null default 'approved',   -- pending / approved / rejected
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_status_idx  on public.posts (status);

-- ---------- 2. 评论表 ----------
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
-- 3. 行级安全（RLS）—— 这一步决定"谁能看、谁能写"，必须执行
-- ============================================================
alter table public.posts    enable row level security;
alter table public.comments enable row level security;

-- 帖子：所有人（含未登录游客）可读已通过的内容
drop policy if exists "posts: 公开可读已通过" on public.posts;
create policy "posts: 公开可读已通过"
  on public.posts for select
  using ( status = 'approved' );

-- 帖子：登录用户可看到自己所有状态（含待审核、被驳回）
drop policy if exists "posts: 作者可读自己的" on public.posts;
create policy "posts: 作者可读自己的"
  on public.posts for select
  to authenticated
  using ( auth.uid() = user_id );

-- 帖子：登录用户可发帖
drop policy if exists "posts: 登录可发" on public.posts;
create policy "posts: 登录可发"
  on public.posts for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- 帖子：只能改自己的
drop policy if exists "posts: 作者可改" on public.posts;
create policy "posts: 作者可改"
  on public.posts for update
  to authenticated
  using ( auth.uid() = user_id );

-- 评论：所有人可读
drop policy if exists "comments: 公开可读" on public.comments;
create policy "comments: 公开可读"
  on public.comments for select
  using ( true );

-- 评论：登录用户可发表
drop policy if exists "comments: 登录可评" on public.comments;
create policy "comments: 登录可评"
  on public.comments for insert
  to authenticated
  with check ( auth.uid() = user_id );

-- 评论：只能删自己的
drop policy if exists "comments: 作者可删" on public.comments;
create policy "comments: 作者可删"
  on public.comments for delete
  to authenticated
  using ( auth.uid() = user_id );

-- ============================================================
-- 4. 点赞计数函数（原子自增，避免并发覆盖）
-- ============================================================
create or replace function public.increment_likes(post_id uuid)
returns void
language sql
as $$
  update public.posts set likes = likes + 1 where id = post_id;
$$;
