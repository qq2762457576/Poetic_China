# 诗意中国 · 云端接入配置（Supabase）

不配置也能跑：默认「本地模式」，数据存浏览器，功能完整但只有自己看得见。
配置后自动切「云端模式」：分享人人可见、评论跨用户互通、账号多端同步。

整个过程约 10 分钟，只需要一个邮箱，免费。

---

## 1. 注册 Supabase 并建项目

1. 打开 https://supabase.com ，点右上角 **Start your project**，用 GitHub 账号登录最省事
2. 进后台点 **New project**，填：
   - Name：`poetic-china`（随意）
   - Database Password：**自己设一个并记牢**（后面不看它，但丢了只能重建库）
   - Region：选 **Singapore（新加坡）** 或 **Tokyo**——离国内近，延迟最低
   - 套餐选 **Free**
3. 点 Create，等约 2 分钟项目初始化完成

## 2. 建表（复制粘贴一次 SQL）

1. 左侧菜单点 **SQL Editor** → **New query**
2. 把项目里 `supabase/schema.sql` 的**全部内容**复制进去
3. 点右下角 **Run**，看到 `Success. No rows returned` 就成了

这段 SQL 建了三样东西：

| 对象 | 作用 |
|---|---|
| `posts` 表 | 唱诗词分享（标题、正文、作者、状态、点赞数） |
| `comments` 表 | 评论（关联帖子 + 关联用户） |
| RLS 策略 | **安全核心**：游客只能读已通过内容，只有登录用户能发帖/评论，且只能改自己的 |

> 特别注意：RLS 一定要执行成功。没有它，任何人拿到公开密钥就能删光你的数据。

### 建表失败的排查清单

新版 `schema.sql` 已修掉下面这几个坑（全英文标识符 + 显式授权 + 函数权限）。如果仍然报错，按顺序排查：

**① 只粘贴了一部分 / 选中部分再点 Run**
Supabase 有两个执行按钮，**Run** 执行全部，**Run selected** 只执行选中部分。用 **Run**，别用 Run selected。

**② 项目还在初始化**
新建项目要 1–2 分钟。后台顶部若还在转圈显示 `Setting up project`，等它变绿再执行。

**③ 报错 `permission denied for schema public` / `must be owner of table`**
说明你用的不是项目创建者账号，或连到了只读副本。确认是自己的 Project（左上角项目名）。

**④ 报错 `relation "auth.users" does not exist`**
极少数老项目没开 Auth。去 **Authentication** → 页面加载一次即可初始化。

**⑤ 实在跑不通 → 用最小版**
改用 `supabase/schema_min.sql`：只建表 + 授权，不开 RLS。功能完全相同（分享全员可见、评论、注册登录都正常），只是安全性弱一些——个人作品站、没有敏感数据，这个取舍是划算的。先把功能跑通，回头再补安全策略。

**⑥ 分段定位**
`schema.sql` 分成 5 段（扩展 / 建表 / 授权 / RLS / 函数）。哪一段报错，红字里会有 `LINE xxx`，对照行号就知道是哪段。把报错原文发我，我直接改。

## 3. 拿密钥并填进配置

**两条路径任选，都能拿到：**

> **界面改名提醒**：Supabase 新版把 **API** 菜单改成了 **Data API**，密钥则单独拆到 **API Keys**。按老教程找 "API" 会扑空。

**Project URL** — 左侧栏最底部 **Project Settings** → **Data API** → 页面顶部就是：
`https://abcdefgh.supabase.co`

**密钥** — 三个位置找，总有一个能看见：
1. 同一个 **Data API** 页面往下滚，找 **Project API keys** 区域
2. 左侧 **Project Settings** 下独立一项 **API Keys**
3. 页面右上角绿色 **Connect** 按钮 → **App frameworks** 标签 → 列出 `SUPABASE_ANON_KEY`

密钥两种格式都正常：新版 `sb_publishable_...`，旧版 `eyJhbGciOi...`（100 字符以上）。认准带 **anon** 或 **publishable** 字样的那条。

> 找不到时：**打开本项目根目录的 `debug.html`**，里面有截图级的位置说明，还能把值粘进去一键自检连通性，比肉眼找快。

3. 打开 `assets/js/config.js`，填进去：

```js
window.SHICI_CONFIG = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIs...'
};
```

4. 保存 → 提交推送（我来做或你自己 `git push`）

> ⚠️ 绝对不要把 `service_role` 那个密钥填进来。它权限无限，一旦进前端等于把数据库钥匙挂在大门口。

## 4. 邮箱验证：关掉还是保留

**它是什么**：注册后 Supabase 给这个邮箱发一封确认信，用户必须点开信里的链接，账号才激活、才能登录。不点也能注册成功，但登录会被拒绝。

**当前状态**：你的项目**默认是开启的**（服务端 `mailer_autoconfirm: false`）。

### 方案 A：关掉（推荐，个人站适用）

左侧 **Authentication** → **Sign In / Providers** → **Email** → 关掉 **Confirm email** → **Save**

关掉后注册完直接登录，不用收邮件。代价是别人可以拿任意邮箱注册（反正本站也不靠邮箱做敏感操作）。

**为什么推荐关**：Supabase 免费项目自带的邮件服务每小时只能发**个位数**封，且极易进垃圾箱。真开放给外人注册时，大部分人收不到信，等于注册功能失灵。要真正用邮箱验证，得自己配 SMTP（Authentication → Emails → SMTP Settings）。

### 方案 B：保留验证（必须先做这一步）

如果保留，**一定要设 Site URL**，否则用户点确认链接会跳到 `localhost:3000`，看起来像失败：

左侧 **Authentication** → **URL Configuration** → 填这两项：
- **Site URL**：`https://qq2762457576.github.io/Poetic_China/`
- **Redirect URLs**：加一行 `https://qq2762457576.github.io/Poetic_China/**`

前端已经做了处理：开启验证时注册页会停在原地提示"请到邮箱点确认链接"，不会跳转；用户点信里链接回来后自动完成登录。

## 5. 验证是否生效

打开网站进社区页，右下或信息流上方会显示当前模式。更直接的验证：

1. 注册一个账号 → 发一条分享
2. **换一个浏览器**（或用无痕窗口）打开社区页
3. 能看到刚才那条分享 = 云端通了

看不到的话，**先打开 `debug.html` 自检**——它会逐项告诉你卡在哪一步（URL 格式 / 密钥类型 / 表是否存在 / 权限 / 函数），比看控制台快。八成是密钥填错或 RLS 没执行。

## 6. 已建过旧版库的额外一步（可选）

如果你早期就执行过建表 SQL，库里可能还是旧版的中文名安全策略。重跑一次现在的 `schema.sql` 即可自动清理并换成新版（脚本幂等，重复执行不会报错、不会产生重复数据）。

只跑第 4 段（点赞函数）也可以，不改表结构：

```sql
-- 必须先 drop：Postgres 不允许 CREATE OR REPLACE 修改已有函数的参数名
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
```

> 不跑也行：前端已做兼容，旧库同样能点赞。但旧版函数没有 `security definer`，游客点赞可能被安全策略拦下。

**已知报错：`cannot change name of input parameter "post_id"`**
这是因为早期版本的函数参数名与你现在的脚本不一致，而 Postgres 禁止 `CREATE OR REPLACE` 改参数名。**先 `drop` 再 `create`** 即可（上面的写法已经包含了 drop）。

---

## 常见问题

**Q：账号密码存在哪？安全吗？**
密码由 Supabase Auth 托管，用 bcrypt 加盐哈希存在它的 Postgres 里，通过 HTTPS 传输。**前端代码从不接触密码明文，也不保存密码**。会话是 JWT，过期自动续期。

**Q：免费额度够用吗？**
够。免费版给 500MB 数据库 + 5GB 流量/月 + 5 万月活用户。个人诗词站远远用不完。

**Q：以后不想要云端了怎么办？**
把 `config.js` 里两个值清空，站点自动退回本地模式，不会报错。

**Q：能换成自己的域名吗？**
能，且建议。买了域名后告诉我，我加 `CNAME` 文件 + 配 DNS。有了独立域名，百度站长平台也能添加站点了（github.io 主域配额早被占满）。

---

## 文件对照表

| 文件 | 作用 |
|---|---|
| `assets/js/config.js` | 云端开关，你只需要改这一个文件 |
| `assets/js/cloud.js` | Supabase 封装（帖子/评论/账号三种接口），不用改 |
| `supabase/schema.sql` | 建表 + 安全策略，执行一次 |
| `assets/js/main.js` | 业务层，云端优先、本地兜底 |
