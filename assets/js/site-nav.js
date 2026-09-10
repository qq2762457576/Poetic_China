/* ============================================================
 * 导航组件 —— 顶栏 / 移动菜单 / tabbar / 页脚
 *
 * 为什么要有这个文件：
 *   这套站点的导航原本在 6 个 HTML 里各手抄一份（顶栏约 256 行 + 菜单 + tabbar + 页脚）。
 *   改一个导航项要同步改 6 个文件，漏改就会出现「页面之间导航不一致」——
 *   这是产品级站点最不该出现的低级问题。
 *   现在改为：页面只放一个占位元素，由本模块在运行时注入。
 *
 * 页面用法（放在 body 顶部）：
 *   <div data-nav="top"></div>      顶栏 + 移动菜单
 *   <div data-nav="tabbar"></div>   底部 tabbar
 *   <div data-nav="footer"></div>   页脚
 *
 * 页面可配置项（放在 <body> 的属性上，全部可选）：
 *   data-page="library"    当前页标识，用于高亮导航项（home/library/community/challenge/study/me）
 *   data-nav-search="1"    顶栏是否显示桌面端搜索图标（诗词库 / 挑战页需要）
 *   data-nav-account="me"  me 页专用：账号区用「笔名+退出 / 登录+注册」互斥双容器
 *
 * ⚠️ 本文件必须在 main.js 之前加载 —— main.js 的 initAuthUI() / initMobileMenu()
 *    依赖注入后的 DOM 已存在。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 主导航项（桌面顶栏） ---------- */
  var MAIN_NAV = [
    { id: 'home',      label: '首页',     href: 'index.html' },
    { id: 'library',   label: '诗词库',   href: 'library.html' },
    { id: 'community', label: '社区广场', href: 'community.html' },
    { id: 'challenge', label: '挑战闯关', href: 'challenge.html' },
    { id: 'study',     label: '诗词课堂', href: 'study.html' }
  ];

  /* ---------- 移动菜单（比顶栏多「我的」，且含登录/注册） ---------- */
  var MENU_NAV = [
    { id: 'home',      label: '首页',     href: 'index.html' },
    { id: 'library',   label: '诗词库',   href: 'library.html' },
    { id: 'community', label: '社区广场', href: 'community.html' },
    { id: 'challenge', label: '挑战闯关', href: 'challenge.html' },
    { id: 'study',     label: '诗词课堂', href: 'study.html' },
    { id: 'me',        label: '我的',     href: 'me.html' }
  ];

  /* ---------- 底部 tabbar（高频 5 项，社区有意不放，避免过挤） ---------- */
  var TABBAR = [
    { id: 'home', label: '首页', href: 'index.html',
      icon: '<path d="M4 10.5L12 4L20 10.5V19C20 19.55 19.55 20 19 20H5C4.45 20 4 19.55 4 19V10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' },
    { id: 'library', label: '诗词库', href: 'library.html',
      icon: '<path d="M5 4H19V20H5C4.45 20 4 19.55 4 19V5C4 4.45 4.45 4 5 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 8.5H16M8 12H16M8 15.5H12.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' },
    { id: 'challenge', label: '挑战', href: 'challenge.html',
      icon: '<path d="M7 4H17V10C17 13.31 14.31 16 11 16C7.69 16 5 13.31 5 10V4H7Z" stroke="currentColor" stroke-width="1.6"/><path d="M7 6H5M17 6H19M11 16V20M8 20H14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
    { id: 'class', label: '课堂', href: 'study.html',
      icon: '<path d="M3 7.5L12 4L21 7.5L12 11L3 7.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 10V15.5C7 15.5 9.5 17 12 17C14.5 17 17 15.5 17 15.5V10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
    { id: 'me', label: '我的', href: 'me.html',
      icon: '<circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 20C5 16.5 8.13 14 12 14C15.87 14 19 16.5 19 20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' }
  ];

  /* ---------- 页脚栏目 ---------- */
  var FOOTER_COLS = [
    { title: '读诗', links: [
      { label: '诗词库', href: 'library.html' },
      { label: '每日精选', href: 'index.html' }
    ] },
    { title: '学习', links: [
      { label: '诗词课堂', href: 'study.html' },
      { label: '挑战闯关', href: 'challenge.html' },
      { label: '我的进度', href: 'me.html' }
    ] },
    { title: '社区', links: [
      { label: '社区广场', href: 'community.html' },
      { label: '发表作品', href: 'community.html' }
    ] },
    { title: '关于', links: [
      { label: '隐私政策', href: 'privacy.html' },
      { label: '用户协议', href: 'terms.html' }
    ] }
  ];

  var SEARCH_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none">' +
    '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '</svg>';

  var MENU_ICON =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none">' +
    '<path d="M4 7H20M4 12H20M4 17H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '</svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 当前页标识：优先读 body[data-page]，回退到路径推断 */
  function currentPage() {
    var b = document.body;
    var explicit = b && b.getAttribute('data-page');
    if (explicit) return explicit;
    var p = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    if (p === '' || p === 'index') return 'home';
    if (p === 'study') return 'class';
    return p;
  }

  /* 高亮匹配：body 上的标识与导航项 id 存在命名差异（home/class） */
  function isActive(navId, cur) {
    if (navId === cur) return true;
    if (navId === 'home' && cur === 'home') return true;
    if (navId === 'study' && cur === 'class') return true;
    if (navId === 'me' && cur === 'me') return true;
    return false;
  }

  /* ---------- 顶栏 ---------- */
  function buildHeader(opts, cur) {
    var wantSearch = opts.search;

    var navHtml = MAIN_NAV.map(function (n) {
      var cls = isActive(n.id, cur) ? ' class="is-active"' : '';
      return '<a' + cls + ' href="' + n.href + '">' + esc(n.label) + '</a>';
    }).join('');

    /* 账号区：me 页用「互斥双容器」（登录态由 JS 切换显隐），
       其他页沿用「登录 + 免费注册」两条。 */
    var accountHtml;
    if (opts.account === 'me') {
      accountHtml =
        '<div class="only-desktop header-account" id="header-account">' +
        '<a class="account-name" id="header-account-name" href="me.html" aria-current="page"></a>' +
        '<a href="javascript:void(0)" class="account-signout" id="header-signout">退出</a>' +
        '</div>' +
        '<div class="only-desktop header-guest" id="header-guest" style="display:flex;align-items:center;gap:20px;">' +
        '<a href="auth.html">登录</a>' +
        '<a class="btn btn--primary" style="padding:11px 24px;" href="auth.html">免费注册</a>' +
        '</div>';
    } else {
      accountHtml =
        '<div class="only-desktop" style="display:flex;align-items:center;gap:20px;">' +
        (wantSearch
          ? '<a class="icon-btn" href="library.html" aria-label="搜索">' + SEARCH_ICON + '</a>'
          : '') +
        '<a href="auth.html">登录</a>' +
        '<a class="btn btn--primary" style="padding:11px 24px;" href="auth.html">免费注册</a>' +
        '</div>';
    }

    return '' +
      '<header class="site-header">' +
        '<div class="container">' +
          '<div class="header-inner">' +
            '<button class="icon-btn only-mobile" data-menu-toggle aria-label="打开菜单"' +
              ' aria-expanded="false" aria-controls="mobile-menu">' + MENU_ICON + '</button>' +
            '<a class="brand" href="index.html">' +
              '<span class="seal">诗</span>' +
              '<span class="brand-name">诗意中国</span>' +
            '</a>' +
            '<nav class="nav only-desktop">' + navHtml + '</nav>' +
            '<div class="header-actions">' +
              '<a class="icon-btn only-mobile" href="library.html" aria-label="搜索">' + SEARCH_ICON + '</a>' +
              accountHtml +
            '</div>' +
          '</div>' +
        '</div>' +
        buildMobileMenu(cur) +
        '<div class="divider"></div>' +
      '</header>';
  }

  function buildMobileMenu(cur) {
    var items = MENU_NAV.map(function (n) {
      var cls = isActive(n.id, cur) ? ' class="is-active"' : '';
      return '<a' + cls + ' data-tab="' + n.id + '" href="' + n.href + '">' + esc(n.label) + '</a>';
    }).join('');
    return '<nav class="mobile-menu" id="mobile-menu">' + items +
      '<a href="auth.html">登录 / 注册</a></nav>';
  }

  /* ---------- tabbar ---------- */
  function buildTabbar(cur) {
    var items = TABBAR.map(function (t) {
      var cls = isActive(t.id, cur) ? ' class="tab-item is-active"' : ' class="tab-item"';
      return '<a' + cls + ' data-tab="' + t.id + '" href="' + t.href + '">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none">' + t.icon + '</svg>' +
        '<span>' + esc(t.label) + '</span></a>';
    }).join('');
    return '<nav class="tabbar"><div class="tabbar-inner">' + items + '</div></nav>';
  }

  /* ---------- 页脚 ---------- */
  function buildFooter() {
    var cols = FOOTER_COLS.map(function (c) {
      var links = c.links.map(function (l) {
        return '<a href="' + l.href + '">' + esc(l.label) + '</a>';
      }).join('');
      return '<div class="footer-col"><h4>' + esc(c.title) + '</h4>' + links + '</div>';
    }).join('');

    return '' +
      '<footer class="site-footer">' +
        '<div class="container">' +
          '<div class="footer-top">' +
            '<div class="footer-brand">' +
              '<div class="brand"><span class="seal">诗</span>' +
              '<span class="brand-name" style="color:#F3EEE4;">诗意中国</span></div>' +
              '<p class="slogan">读诗 · 学诗 · 写诗，与同好共此一轮明月</p>' +
            '</div>' +
            cols +
          '</div>' +
          '<div class="footer-bottom">2026 诗意中国 · 诗词原文源自公开古籍与开源数据集' +
            '（chinese-poetry · MIT），注释与译文由社区共同编校</div>' +
        '</div>' +
      '</footer>';
  }

  /* ---------- 注入 ---------- */
  function mount() {
    var body = document.body;
    if (!body) return;
    var cur = currentPage();
    var opts = {
      search: body.getAttribute('data-nav-search') === '1',
      account: body.getAttribute('data-nav-account') || ''
    };

    document.querySelectorAll('[data-nav]').forEach(function (host) {
      var kind = host.getAttribute('data-nav');
      if (host.getAttribute('data-nav-done')) return;
      var html = '';
      if (kind === 'top') html = buildHeader(opts, cur);
      else if (kind === 'tabbar') html = buildTabbar(cur);
      else if (kind === 'footer') html = buildFooter();
      if (!html) return;
      host.innerHTML = html;
      host.setAttribute('data-nav-done', '1');
    });

    /* 页面标题兜底：未设 <title> 时保持原样，不做臆造 */
  }

  /* 暴露给调试与测试 */
  window.SiteNav = {
    mount: mount,
    buildHeader: buildHeader,
    buildTabbar: buildTabbar,
    buildFooter: buildFooter,
    buildMobileMenu: buildMobileMenu,
    isActive: isActive,
    currentPage: currentPage,
    MAIN_NAV: MAIN_NAV,
    MENU_NAV: MENU_NAV,
    TABBAR: TABBAR,
    FOOTER_COLS: FOOTER_COLS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
