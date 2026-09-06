# git

练习用的 Git 仓库；同时存放「诗韵中华」古诗词社区网站的静态站点源码。

**在线预览**：https://qq2762457576.github.io/git/

```bash
git clone <仓库地址>
cd git
```

## 常用命令备忘

```bash
git status              # 查看当前状态
git add .               # 暂存所有改动
git commit -m "说明"     # 提交
git push                # 推送到远程
git pull                # 拉取远程更新
git log --oneline       # 查看提交历史
```

---

# 诗韵中华 · 古诗词文化社区（静态站点）

纯 HTML + CSS + JS，零依赖、无需构建。直接双击 `index.html` 即可在浏览器打开。

## 目录结构

```
index.html          首页（每日动态推荐 + 诗/词/曲分板块 + 入场动效）
library.html        诗词库（全文检索 / 筛选 / 排序 / 分页，点击进详情）
community.html      社区广场（分享经典 + 原创投稿 + 审核中心）
study.html          诗词课堂（?id=N 动态加载任意诗词，打卡/收藏/上下首切换）
challenge.html      挑战闯关（填空 / 接句 / 背诵）
auth.html           注册 / 登录
assets/css/style.css  全局样式（水墨淡雅设计系统 + 动效 + 响应式）
assets/js/main.js     交互脚本（无框架）
assets/data/poems.js  诗词数据（89,743 首：全唐诗 57,389 + 全宋词 20,946
                      + 元曲 10,904 + 诗经楚辞 370 + 明代诗词 39 + 毛泽东诗词 27）
assets/img/           图片资源
```

## 功能说明

- **每日推荐**：按日期种子从库中轮换，诗 / 词 / 曲 三个板块每日更新
- **学习进度与收藏**：存于浏览器 localStorage，打卡、收藏刷新后仍在
- **内容审核**：社区来稿先入待审队列；默认审核人为站长（段瑜），可在社区页右侧授权其他用户
- **课堂页**：`study.html?id=N` 可打开库中任意一首；《登高》有完整注释/译文/赏析精编，其余篇目显示编校占位

## 诗词数据来源

诗词库使用开源数据集 [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT 协议）：
简体唐诗来自其简体分支 chinese-poetry-zhCN；宋词、元曲来自主仓；明代诗词与毛泽东诗词为手工整理（`poetry-raw/other/ming.json`、`mao.json`）。
原始分片与转换脚本在 `poetry-raw/`（已 gitignore），重新生成数据：

```bash
python poetry-raw/build_poems.py
```

## 本地预览

可以用 VS Code 的 Live Server 插件，或命令行起一个静态服务：

```bash
python -m http.server 8000
# 然后浏览器打开 http://127.0.0.1:8000
```

## 设计系统

- 宣纸底 `#F3EEE4` / 卡片米白 `#FBF8F1` / 朱砂 `#9C3B2E`
- 墨色阶 `#221E1A` → `#A0968A`，边线 `#E0D8C8`
- 标题与古文用 Noto Serif SC，界面文字用 Noto Sans SC
- 响应式断点：1180px（平板）、768px（手机，切换底部 Tab 栏）

## 说明

站点为**纯前端演示**：诗词原文为真实古籍数据（chinese-poetry 开源数据集，MIT），
学习进度、注释条数、用户、作品均为前端模拟，登录与发布不会真实提交或保存，
刷新页面即恢复初始状态。
