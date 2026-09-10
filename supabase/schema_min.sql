-- ============================================================
-- 诗意中国 · 最小版建表脚本（排查用 / 不想折腾 RLS 时用）
--
-- 只做两件事：建表 + 授权。不开启 RLS。
-- 效果：社区分享全员可见、评论可用、账号可注册登录，全部正常。
-- 代价：理论上知道接口地址的人可以直接调用 API 写数据。
--       个人作品站、无敏感数据，风险可接受；日后想收紧，
--       再去执行完整版 schema.sql 的第 3、4 段即可。
--
-- 如果完整版一直失败，先跑这个把功能跑通，再回头排查。
-- ============================================================

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'original',
  title       text not null,
  body        text not null default '',
  poem_id     integer,
  author      text not null,
  user_id     uuid references auth.users(id) on delete set null,
  status      text not null default 'approved',
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_status_idx  on public.posts (status);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author     text not null,
  user_id    uuid references auth.users(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_idx on public.comments (post_id, created_at);

grant usage on schema public to anon, authenticated;

grant select, insert, update       on public.posts    to anon, authenticated;
grant select, insert, delete       on public.comments to anon, authenticated;

create or replace function public.increment_likes(p_post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.posts set likes = likes + 1 where id = p_post_id;
$$;

grant execute on function public.increment_likes(uuid) to anon, authenticated;

-- 成功提示：Success. No rows returned
