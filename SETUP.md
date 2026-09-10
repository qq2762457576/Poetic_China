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

## 3. 拿密钥并填进配置

1. 左侧 **Project Settings**（齿轮）→ **API**
2. 复制两个值：
   - **Project URL**：形如 `https://abcdefgh.supabase.co`
   - **anon public**：一长串 `eyJhbGci...`（这是公开密钥，本来就是给前端用的）
3. 打开 `assets/js/config.js`，填进去：

```js
window.SHICI_CONFIG = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIs...'
};
```

4. 保存 → 提交推送（我来做或你自己 `git push`）

> ⚠️ 绝对不要把 `service_role` 那个密钥填进来。它权限无限，一旦进前端等于把数据库钥匙挂在大门口。

## 4. 关闭邮箱验证（可选，但建议先关）

不然注册后要去邮箱点链接才能登录，测试时很烦。

左侧 **Authentication** → **Providers** → **Email** → 关掉 **Confirm email** → Save。

想保留验证也行，注册时页面会提示"请到邮箱点确认链接"，流程是通的。

## 5. 验证是否生效

打开网站进社区页，右下或信息流上方会显示当前模式。更直接的验证：

1. 注册一个账号 → 发一条分享
2. **换一个浏览器**（或用无痕窗口）打开社区页
3. 能看到刚才那条分享 = 云端通了

看不到的话，按 F12 看 Console 有没有红色报错，八成是密钥填错或 RLS 没执行。

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
