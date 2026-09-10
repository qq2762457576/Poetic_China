# 诗意中国 · Poetic China

> 读诗 · 学诗 · 写诗 —— 一个可检索、可学习、可背诵、可分享的中国古典诗词网站。

**在线访问**：https://qq2762457576.github.io/Poetic_China/

---

## 项目简介

「诗意中国」收录历代诗词 **89,864 首**、诗人 **5,428 位**，覆盖先秦至近现代。
网站提供全文检索、逐句注译、背诵闯关与社区分享四条主线，用户账号与学习数据托管在 Supabase，
换设备登录即可恢复全部进度。

纯静态站点，可部署在任意静态托管（GitHub Pages / Vercel / Netlify），无需自建服务器。

---

## 功能一览

| 板块 | 页面 | 说明 |
|---|---|---|
| 首页 | `index.html` | 每日按日期轮换推荐；诗词曲分板块精选；全站真实统计 |
| 诗词库 | `library.html` | 全文/正文检索、朝代·体裁·主题筛选、四种排序、分页浏览 |
| 诗词课堂 | `study.html?id=N` | 逐句注译（译文/赏析/创作背景）、打卡、收藏、上下首切换 |
| 挑战闯关 | `challenge.html` | 填空 / 接句 / 背诵三模式，六种难度，连击计分，跨标签页同步 |
| 社区广场 | `community.html` | 分享经典 + 原创投稿 + 审核队列 + 评论点赞 |
| 注册登录 | `auth.html` | Supabase Auth 托管，密码服务端 bcrypt 加密 |

**数据存储策略**（未登录也能用）：

- **未登录**：学习进度、收藏、成绩存浏览器 localStorage，打开即用，无需注册
- **已登录**：本地数据自动合并上云，此后实时同步，换设备登录即恢复

---

## 目录结构

```
index.html              首页
library.html            诗词库
study.html              诗词课堂
challenge.html          挑战闯关
community.html          社区广场
auth.html               注册 / 登录

assets/
  css/style.css         全局样式（设计令牌 + 组件 + 响应式）
  js/
    config.js           Supabase 配置（URL / anon key）
    cloud.js            云端数据层（账号 / 帖子 / 评论 / 学习数据）
    main.js             页面交互主逻辑
  data/
    site-stats.js       ★ 全站统一数据源（构建时生成，禁止手改）
    index-meta.js       索引元信息（分片数 / 总量）
    poems-index/p0-5.js 索引分片（15,000 首/片）
    poems-text/p0-29.js 正文分块（3,000 首/块，按需懒加载）
    featured.js         首页精选 + FEATURED_STATS
    notes.js            译文 / 赏析 / 创作背景（449 条）
    banks.js            考试与热门题库
    quizpool/p0-3.js    挑战题库分片
  img/                  图片资源

poetry-raw/             数据源与构建脚本（含原始 JSON）
  build_runtime.py      ★ 一键重建全部运行时数据
  other/famous_extra.json  新增名篇入口
  other/_alias.json     异名映射表

supabase/
  schema.sql            社区表结构（posts / comments）
  schema_user_data.sql  ★ 用户学习数据表（learned / favs / scores）
```

---

## 快速开始

### 1. 克隆并预览

```bash
git clone https://github.com/qq2762457576/Poetic_China.git
cd Poetic_China
```

站点是纯静态的，起一个本地服务即可（**不要直接双击 HTML**，`file://` 协议下部分功能受限）：

```bash
python -m http.server 8000
# 浏览器打开 http://127.0.0.1:8000
```

或用 VS Code 的 Live Server 插件。

### 2. 配置 Supabase（可选）

不配置也能运行——云端未就绪时全站自动退回本地模式，功能完整。

要启用账号与云端同步，在 `assets/js/config.js` 填入：

```js
window.SHICI_CONFIG = {
  supabaseUrl: 'https://<你的项目>.supabase.co',
  supabaseAnonKey: '<你的 anon / publishable key>'
};
```

然后到 Supabase 后台依次执行：

1. **SQL Editor** → 粘贴 `supabase/schema.sql` 全文 → Run（社区功能）
2. **SQL Editor** → 粘贴 `supabase/schema_user_data.sql` 全文 → Run（学习数据同步）

### 3. 关闭邮箱验证（重要）

Supabase 免费版内置邮件服务**每小时仅发送 3 封**，开启邮箱验证会导致第 4 位之后的用户无法注册。

**Authentication → Sign In / Providers → Email → 关闭 `Confirm email`**

同时确认 **Authentication → URL Configuration → Site URL** 填的是你的站点地址。

---

## 数据维护

新增名篇的完整流程：

```bash
# 1. 把新诗写入 poetry-raw/other/famous_extra.json
# 2. 重建全部运行时数据
python poetry-raw/build_runtime.py
# 3. 校验
node poetry-raw/test_runtime.js
# 4. 提交推送
git add -A && git commit -m "data: 新增名篇 XX" && git push
```

`build_runtime.py` 会一次性重建：索引分片、正文分块、题库分片、首页精选、
以及**统一数据源 `site-stats.js`**。所有页面统计数字都从 `SITE_STATS` 读取，**不要在 HTML 里硬编码**。

### 注译维护

译文/赏析/创作背景在 `assets/data/notes.js`，键为 `"标题|作者"`。
注意库内使用古籍底本标题（如「钱唐湖春行」而非「钱塘湖春行」），
异名对照见 `poetry-raw/other/_alias.json`。

---

## 设计系统

| 令牌 | 值 | 用途 |
|---|---|---|
| `--paper` | `#F3EEE4` | 宣纸底色 |
| `--card` | `#FBF8F1` | 卡片米白 |
| `--cinnabar` | `#9C3B2E` | 朱砂点缀 |
| 墨色阶 | `#221E1A` → `#A0968A` | 文字层级 |
| 边线 | `#E0D8C8` | 分隔与描边 |
| `--container` | `1440px` | 内容容器宽度 |
| `--tabbar-h` | `62px` | 移动端底部栏高度 |

字体：标题与古文用 Noto Serif SC，界面文字用 Noto Sans SC。
响应式断点：1180px（平板）、768px（手机，切换底部 Tab 栏）。

---

## 数据来源与致谢

诗词原文来自开源数据集 [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT 协议）：

- 简体唐诗来自其 `chinese-poetry-zhCN` 分支
- 宋词、元曲来自主仓
- 明代诗词、近现代诗词为手工整理

注译与赏析内容为手工编校，欢迎通过社区页指正。

---

## 技术栈

- **前端**：原生 HTML / CSS / JavaScript（IIFE，无框架、无构建步骤）
- **数据层**：分片懒加载（索引 6 片 + 正文 30 块）
- **后端**：Supabase（Postgres + Auth + Row Level Security）
- **托管**：GitHub Pages

---

## 说明

站点所有展示数据均为真实数据：

- 诗词、作者、朝代统计来自构建时对全库的实际统计（`site-stats.js`）
- 社区内容全部来自真实用户发布，无任何预置示例帖
- 排行榜只显示用户本人的真实成绩（纯静态站无法聚合他人分数，故不伪造榜单）

**不展示任何虚构的用户数、阅读量或社区规模。**
