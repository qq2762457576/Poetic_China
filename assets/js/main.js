/* 诗意中国 · 全站交互脚本（无框架，IIFE）
 * 数据：assets/data/poems.js（window.POEM_DATA，开源 chinese-poetry 数据集）
 * 持久化：localStorage（学习进度 / 收藏 / 社区投稿与审核，纯前端演示）
 */
(function () {
  'use strict';

  /* ---------- 0. 工具 ---------- */
  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function store(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function saveStore(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式下静默失败 */ }
  }

  /* 学习进度 / 收藏（存诗词 id 数组） */
  var learnedIds = store('shici_learned', []);
  var favIds = store('shici_favs', []);
  function isLearned(id) { return learnedIds.indexOf(id) !== -1; }
  function isFav(id) { return favIds.indexOf(id) !== -1; }
  function toggleIn(list, id) {
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    return list;
  }

  /* ---------- 账号体系 ----------
   * 两种模式，同一套接口：
   *
   * 云端模式（config.js 填了 Supabase）
   *   账号由 Supabase Auth 托管。密码经 HTTPS 送到服务端，用 bcrypt 加盐哈希
   *   后存 Postgres，前端从不接触也不保存任何密码明文；会话是 JWT，存在
   *   localStorage 里自动续期，换设备登录同一账号即可。
   *
   * 本地模式（未配置）
   *   账号存 localStorage：密码加盐哈希（https 下 SHA-256，file:// 等
   *   非安全上下文退化为 FNV-1a），会话写 shici_session。能跑通完整流程，
   *   但只在当前浏览器有效。 */
  var Auth = (function () {
    var UKEY = 'shici_users';
    var SKEY = 'shici_session';
    function fnv(str) {
      var h = 0x811c9dc5;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return ('0000000' + h.toString(16)).slice(-8) + (str.length).toString(16);
    }
    function hash(text) {
      if (window.crypto && window.crypto.subtle && window.isSecureContext && window.TextEncoder) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ('0' + b.toString(16)).slice(-2);
          }).join('');
        }, function () { return fnv(text); });
      }
      return Promise.resolve(fnv(text));
    }
    function makeSalt() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
    return {
      mode: function () { return window.Cloud ? window.Cloud.mode() : 'local'; },
      current: function () {
        if (window.Cloud && window.Cloud.ready) {
          var p = window.Cloud.auth.current();
          if (p) return p.name;
        }
        var s = store(SKEY, null);
        return s && s.name ? s.name : null;
      },
      register: function (account, name, pwd, cb) {
        if (window.Cloud && window.Cloud.ready) {
          return window.Cloud.auth.signUp(account, pwd, name, function (err, r) {
            if (err) return cb(err);
            if (r && r.needConfirm) return cb(null, '注册成功！请到邮箱点一下确认链接，回来就能登录');
            cb(null, '注册成功，已自动登录');
          });
        }
        var users = store(UKEY, {});
        if (users[account]) return cb('该账号已注册，直接去登录吧');
        var salt = makeSalt();
        hash(salt + pwd).then(function (h) {
          users[account] = { name: name, salt: salt, hash: h, ts: Date.now() };
          saveStore(UKEY, users);
          saveStore(SKEY, { account: account, name: name, ts: Date.now() });
          cb(null, '注册成功（本地模式，仅本机有效）');
        });
      },
      login: function (account, pwd, cb) {
        if (window.Cloud && window.Cloud.ready) {
          return window.Cloud.auth.signIn(account, pwd, function (err) {
            cb(err);
          });
        }
        var u = store(UKEY, {})[account];
        if (!u) return cb('账号不存在，先注册一个吧');
        hash(u.salt + pwd).then(function (h) {
          if (h !== u.hash) return cb('密码不对，再想想');
          saveStore(SKEY, { account: account, name: u.name, ts: Date.now() });
          cb(null);
        });
      },
      logout: function (cb) {
        if (window.Cloud && window.Cloud.ready) {
          return window.Cloud.auth.signOut(function () { if (cb) cb(); });
        }
        try { localStorage.removeItem(SKEY); } catch (e) { /* 忽略 */ }
        if (cb) cb();
      }
    };
  })();

  /* 当前用户：登录后为笔名；未登录沿用站长（默认审核人） */
  var CURRENT_USER = Auth.current() || '段瑜';

  /* ---------- 1. 诗词数据层（索引 + 正文懒加载） ---------- */
  var DYNASTY_KEY = { '唐': '唐', '宋': '宋', '先秦': '先秦', '汉魏六朝': '汉魏六朝', '元': '元明清', '明': '明', '清': '元明清', '近现代': '近现代' };
  var GENRE_KEY = { '绝': '诗', '律': '诗', '古': '诗', '诗': '诗', '骚': '诗', '词': '词', '曲': '曲', '赋': '赋', '文': '文' };

  /* 索引分片：POEMS 是稀疏数组，下标即全局 id，未载入的分片位置为 undefined。
   * 首屏只载第 0 片（约 1.7MB 而非 10.1MB），其余在空闲时后台补齐。 */
  var IDX_META = window.POEM_INDEX_META || { chunks: 1, total: 0, per: 15000 };
  var POEMS = new Array(IDX_META.total || 0);
  var _loadedCache = null;

  function makePoem(r, i) {
    return {
      id: i,
      title: r[0],
      author: r[1],
      dynasty: r[2],
      dynastyKey: DYNASTY_KEY[r[2]] || r[2],
      form: r[3],
      genre: r[4],
      genreKey: GENRE_KEY[r[4]] || '诗',
      themes: [r[5]],
      line: r[6],
      notes: 3 + ((i * 37) % 96),
      readers: (((i * 53) % 900 + 60) / 10).toFixed(1) + ' 万'
    };
  }
  /* 已载入的诗（紧凑数组）。所有遍历都用它，避免踩到 undefined 空洞 */
  function loadedPoems() {
    if (!_loadedCache) {
      _loadedCache = [];
      for (var i = 0; i < POEMS.length; i++) if (POEMS[i]) _loadedCache.push(POEMS[i]);
    }
    return _loadedCache;
  }

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { if (cb) cb(true); };
    s.onerror = function () { if (cb) cb(false); };
    document.head.appendChild(s);
  }

  /* 正文分块懒加载：3000 首/块，用到才下载，下载后缓存 */
  var CHUNK_SIZE = 3000;
  var TextStore = (function () {
    var cache = {};
    var pending = {};
    function loadChunk(no, cb) {
      if (cache[no]) return cb(cache[no]);
      if (pending[no]) { pending[no].push(cb); return; }
      pending[no] = [cb];
      loadScript('assets/data/poems-text/p' + no + '.js?v=20260909a', function () {
        cache[no] = window['POEM_TEXT_' + no] || [];
        var cbs = pending[no];
        delete pending[no];
        cbs.forEach(function (cb2) { cb2(cache[no]); });
      });
    }
    return {
      text: function (id, cb) {
        var no = Math.floor(id / CHUNK_SIZE);
        loadChunk(no, function (arr) { cb(arr[id - no * CHUNK_SIZE] || ''); });
      },
      chunk: loadChunk,
      chunkCount: Math.ceil((IDX_META.total || 0) / CHUNK_SIZE)
    };
  })();

  /* 索引分片管理：boot 首屏 / ensureAll 后台补齐 / poem 按 id 按需取 */
  var IndexStore = (function () {
    var loading = {};
    var _allStarted = false;
    var _allDone = false;
    var _allCbs = [];
    function load(no, cb) {
      if (no < 0 || no >= IDX_META.chunks) return cb(false);
      if (POEMS[no * IDX_META.per] !== undefined) return cb(true);
      if (loading[no]) { loading[no].push(cb); return; }
      loading[no] = [cb];
      loadScript('assets/data/poems-index/p' + no + '.js?v=20260909b', function (ok) {
        if (ok) {
          var arr = window['POEM_INDEX_' + no] || [];
          var off = no * IDX_META.per;
          for (var i = 0; i < arr.length; i++) POEMS[off + i] = makePoem(arr[i], off + i);
          _loadedCache = null;
        }
        var cbs = loading[no] || [];
        delete loading[no];
        cbs.forEach(function (f) { f(ok); });
      });
    }
    function chunkOf(id) { return Math.floor(id / IDX_META.per); }
    var idle = window.requestIdleCallback
      ? function (f) { window.requestIdleCallback(f, { timeout: 1200 }); }
      : function (f) { setTimeout(f, 120); };
    return {
      load: load,
      chunkOf: chunkOf,
      totalChunks: IDX_META.chunks,
      loadedCount: function () { return loadedPoems().length; },
      totalCount: IDX_META.total,
      boot: function (cb) { load(0, function () { if (cb) cb(); }); },
      ensureAll: function (onProgress, done) {
        if (_allDone) { if (done) done(); return; }
        _allCbs.push({ p: onProgress, d: done });
        if (_allStarted) return;
        _allStarted = true;
        var n = 1;
        function step() {
          if (n >= IDX_META.chunks) {
            _allDone = true;
            _allCbs.forEach(function (c) { if (c.d) c.d(); });
            _allCbs = [];
            return;
          }
          load(n, function () {
            var cnt = loadedPoems().length;
            _allCbs.forEach(function (c) { if (c.p) c.p(cnt, IDX_META.total); });
            n += 1;
            idle(step);
          });
        }
        idle(step);
      },
      /* 按 id 取：所在分片未载则先下载，保证深链接/经典分享可用 */
      poem: function (id, cb) {
        if (POEMS[id]) return cb(POEMS[id]);
        if (!(id >= 0) || id >= IDX_META.total) return cb(null);
        load(chunkOf(id), function () { cb(POEMS[id] || null); });
      }
    };
  })();

  function poemUrl(id) { return 'study.html?id=' + id; }
  function findPoem(id) { return POEMS[id] || null; }
  function findByTitleAuthor(title, author) {
    var list = loadedPoems();
    for (var i = 0; i < list.length; i++) {
      if (list[i].title === title && list[i].author === author) return list[i];
    }
    return null;
  }

  /* ---------- 2. 底部导航 / 移动菜单 ---------- */
  function initTabbar() {
    var page = document.body.getAttribute('data-page');
    document.querySelectorAll('.tab-item').forEach(function (item) {
      item.classList.toggle('is-active', item.getAttribute('data-tab') === page);
    });
    document.querySelectorAll('.mobile-menu a').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-tab') === page);
    });
  }

  function initMobileMenu() {
    var btn = document.querySelector('[data-menu-toggle]');
    var menu = document.querySelector('.mobile-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function () {
      menu.classList.toggle('is-open');
    });
  }

  /* ---------- 3. 注册 / 登录 ---------- */
  function initAuthTabs() {
    var tabs = document.querySelectorAll('.auth-tab');
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.toggle('is-active', t === tab); });
        var mode = tab.getAttribute('data-mode');
        document.querySelectorAll('[data-panel]').forEach(function (panel) {
          panel.hidden = panel.getAttribute('data-panel') !== mode;
        });
      });
    });
  }

  function initAuthForm() {
    var regForm = document.querySelector('form[data-panel="register"]');
    var loginForm = document.querySelector('form[data-panel="login"]');
    if (!regForm && !loginForm) return;

    function hint(form, msg, ok) {
      var el = form.querySelector('[data-hint]');
      if (!el) return;
      el.textContent = msg;
      el.classList.toggle('is-error', !ok);
      el.classList.toggle('is-ok', !!ok);
    }
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    if (regForm) {
      regForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var account = val('reg-account');
        var name = val('reg-name');
        var pwd = val('reg-pwd');
        var agree = document.getElementById('reg-agree');
        var cloudMode = window.Cloud && window.Cloud.ready;
        /* 云端账号体系只认邮箱；本地模式宽松些 */
        if (cloudMode && !/^\S+@\S+\.\S+$/.test(account)) return hint(regForm, '云端账号请用邮箱注册');
        if (!cloudMode && !/^(\S+@\S+\.\S+|1\d{10})$/.test(account)) return hint(regForm, '账号请填邮箱或 11 位手机号');
        if (name.length < 2 || name.length > 12) return hint(regForm, '笔名取 2-12 个字');
        if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) return hint(regForm, '密码至少 8 位，且同时包含字母与数字');
        if (agree && !agree.checked) return hint(regForm, '请先勾选同意《社区公约》与《隐私政策》');
        hint(regForm, '注册中…', true);
        Auth.register(account, name, pwd, function (err, msg) {
          if (err) return hint(regForm, err);
          /* 邮箱需要点确认链接时，停在页面提示，不跳转 */
          if (msg && msg.indexOf('确认') !== -1) return hint(regForm, msg, true);
          hint(regForm, msg || '注册成功，正在进入诗意中国…', true);
          setTimeout(function () { location.href = 'index.html'; }, 700);
        });
      });
    }

    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var account = val('login-account');
        var pwd = val('login-pwd');
        if (!account || !pwd) return hint(loginForm, '账号和密码都要填');
        hint(loginForm, '登录中…', true);
        Auth.login(account, pwd, function (err) {
          if (err) return hint(loginForm, err);
          hint(loginForm, '登录成功，欢迎回来…', true);
          setTimeout(function () { location.href = 'index.html'; }, 700);
        });
      });
    }

    /* 第三方登录：演示站占位 */
    document.querySelectorAll('.oauth-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        hint(regForm || loginForm, '演示站点暂未接入第三方登录，请用账号注册 / 登录');
      });
    });

    /* 已登录用户直达 */
    if (Auth.current()) {
      var wrap = document.querySelector('.auth-form-wrap');
      if (wrap) {
        wrap.innerHTML =
          '<div style="text-align:center;padding:40px 0;">' +
          '<h2 class="form-title">已登录为「' + esc(Auth.current()) + '」</h2>' +
          '<p class="form-sub" style="margin:12px 0 24px;">' +
          (window.Cloud && window.Cloud.ready
            ? '账号已同步云端，换设备登录同一邮箱即可继续'
            : '学习进度与闯关成绩会在本机自动保存') + '</p>' +
          '<a class="btn btn--primary btn--block" href="index.html">回到首页</a>' +
          '<p class="form-hint" style="margin-top:16px;"><a data-logout style="cursor:pointer;">退出登录</a></p>' +
          '</div>';
      }
    }

    document.querySelectorAll('[data-switch]').forEach(function (link) {
      link.addEventListener('click', function () {
        var tab = document.querySelector('.auth-tab[data-mode="' + link.getAttribute('data-switch') + '"]');
        if (tab) tab.click();
      });
    });
  }

  /* 顶栏登录态：登录后显示笔名 + 退出 */
  function initAuthUI() {
    var name = Auth.current();
    if (!name) return;
    document.querySelectorAll('.header-actions .only-desktop').forEach(function (box) {
      if (!box.querySelector('a[href="auth.html"]')) return;
      box.innerHTML =
        '<span class="auth-user">你好，' + esc(name) + '</span>' +
        '<a class="btn btn--ghost" style="padding:9px 20px;cursor:pointer;" data-logout>退出</a>';
    });
    document.querySelectorAll('.mobile-menu a[href="auth.html"]').forEach(function (a) {
      a.textContent = '退出登录（' + name + '）';
      a.removeAttribute('href');
      a.setAttribute('data-logout', '');
    });
  }

  /* 退出登录（事件委托，全站通用） */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-logout]');
    if (!btn) return;
    e.preventDefault();
    Auth.logout(function () { location.reload(); });
  });

  /* ---------- 4. 首页：每日推荐 + 分体裁板块 ----------
   * 首页只加载 featured.js（54KB，含正文与全站统计），不加载全库索引 */
  function daySeed() {
    var d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  /* 可复现伪随机：同一种子同一结果 */
  function seededPick(list, seed, count) {
    if (!list.length) return [];
    var out = [];
    var n = Math.min(count, list.length);
    for (var k = 0; k < n; k++) {
      out.push(list[(seed + k * 7919) % list.length]);
    }
    return out;
  }

  function miniCard(p, extra) {
    var preview = p.text.split('\n').slice(0, 2).map(esc).join('<br />');
    return (
      '<a class="card poem-mini anim-rise" href="' + poemUrl(p.id) + '">' +
      '<div class="poem-meta">' + esc(p.author) + ' · ' + esc(p.dynasty) + (extra ? ' · ' + esc(extra) : '') + '</div>' +
      '<h3>' + esc(p.title) + '</h3>' +
      '<p class="poem-lines">' + preview + '</p>' +
      '</a>'
    );
  }

  var FEATURED = (window.FEATURED || []).map(function (r) {
    return {
      id: r[0], title: r[1], author: r[2], dynasty: r[3], form: r[4],
      genre: r[5], genreKey: GENRE_KEY[r[5]] || '诗', themes: ['咏怀'], text: r[6]
    };
  });

  function initHome() {
    var dailyEl = document.getElementById('daily-poem');
    if (!dailyEl) return;

    var seed = daySeed();
    /* 每日推荐：从短于 120 字的名篇体量里按日期轮换 */
    var shortOnes = FEATURED.filter(function (p) { return p.text.length <= 120; });
    var daily = seededPick(shortOnes, seed, 1)[0];
    if (daily) {
      dailyEl.innerHTML =
        '<div class="poem-meta">' + esc(daily.dynasty) + ' · ' + esc(daily.author) + ' · ' + esc(daily.form) + '</div>' +
        '<h3 class="serif">' + esc(daily.title) + '</h3>' +
        '<p class="poem-lines serif">' + daily.text.split('\n').map(esc).join('<br />') + '</p>' +
        '<a class="more-btn" href="' + poemUrl(daily.id) + '">去读这首 →</a>';
    }

    /* 诗 / 词 / 曲 三个板块，同样按日轮换 */
    var boards = [
      { key: '诗', el: document.getElementById('board-shi'), count: 3 },
      { key: '词', el: document.getElementById('board-ci'), count: 3 },
      { key: '曲', el: document.getElementById('board-qu'), count: 3 }
    ];
    boards.forEach(function (b, bi) {
      if (!b.el) return;
      var list = FEATURED.filter(function (p) { return p.genreKey === b.key && p.text.length <= 200; });
      var picks = seededPick(list, seed + bi * 104729, b.count);
      b.el.innerHTML = picks.map(function (p) { return miniCard(p, p.form); }).join('');
    });

    /* 数据条：真实统计（featured.js 附带，免加载全库） */
    var fstats = window.FEATURED_STATS || { poems: IDX_META.total || 0, authors: 0 };
    var statPoems = document.getElementById('stat-poems');
    var statAuthors = document.getElementById('stat-authors');
    if (statPoems) statPoems.textContent = (fstats.poems || 0).toLocaleString('en-US');
    if (statAuthors) {
      var authors = fstats.authors;
      if (!authors) {
        var set = {};
        loadedPoems().forEach(function (p) { set[p.author] = 1; });
        authors = Object.keys(set).length;
      }
      statAuthors.textContent = authors.toLocaleString('en-US');
    }

    /* 入场动画：滚动到可视区再播 */
    var animated = document.querySelectorAll('.anim-rise');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('is-in');
            io.unobserve(en.target);
          }
        });
      }, { threshold: 0.12 });
      animated.forEach(function (el) { io.observe(el); });
    } else {
      animated.forEach(function (el) { el.classList.add('is-in'); });
    }
  }

  /* ---------- 5. 诗词库 ---------- */
  var state = {
    keyword: '',
    dynasty: '全部朝代',
    genre: '全部',
    theme: '全部',
    status: '全部',
    sort: '推荐',
    page: 1,
    textHits: null,   /* 正文搜索命中 id 数组（null = 未做正文搜索） */
    scanning: false
  };
  var PER_PAGE = 20;

  function matchFilters(poem) {
    if (state.dynasty !== '全部朝代' && poem.dynastyKey !== state.dynasty) return false;
    if (state.genre !== '全部' && poem.genreKey !== state.genre) return false;
    if (state.theme !== '全部' && poem.themes.indexOf(state.theme) === -1) return false;
    if (state.status === '已学' && !isLearned(poem.id)) return false;
    if (state.status === '未学' && isLearned(poem.id)) return false;
    if (state.status === '已收藏' && !isFav(poem.id)) return false;
    if (state.textHits) {
      /* 已做正文搜索：关键词条件由命中列表表达，其余筛选照常 */
      return state.textHits.indexOf(poem.id) !== -1;
    }
    if (state.keyword) {
      var haystack = poem.title + poem.author + poem.line + poem.dynasty + poem.form;
      if (haystack.indexOf(state.keyword) === -1) return false;
    }
    return true;
  }

  /* 全文搜索：元数据无结果时，逐批加载正文块扫描（进度可见，命中 500 封顶） */
  function scanFullText(kw) {
    if (state.scanning) return;
    state.scanning = true;
    var hits = [];
    var no = 0;
    var total = TextStore.chunkCount;
    var countEl = document.getElementById('result-count');
    function step() {
      if (no >= total || hits.length >= 500 || state.keyword !== kw) {
        state.scanning = false;
        state.textHits = hits;
        state.page = 1;
        renderPoems();
        return;
      }
      if (countEl) {
        countEl.textContent = '正文搜索中… 已扫描 ' + no + ' / ' + total + ' 批，命中 ' + hits.length + ' 首';
      }
      TextStore.chunk(no, function (arr) {
        var base = no * CHUNK_SIZE;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].indexOf(kw) !== -1) hits.push(base + i);
        }
        no += 1;
        step();
      });
    }
    step();
  }

  function relevance(poem, kw) {
    if (poem.author === kw) return 0;
    if (poem.title === kw) return 1;
    if (poem.author.indexOf(kw) !== -1) return 2;
    if (poem.title.indexOf(kw) !== -1) return 3;
    return 4;
  }

  function sortPoems(list) {
    var arr = list.slice();
    if (state.keyword && state.sort === '推荐') {
      var kw = state.keyword;
      arr.sort(function (a, b) { return relevance(a, kw) - relevance(b, kw); });
      return arr;
    }
    if (state.sort === '最热') {
      arr.sort(function (a, b) { return b.notes - a.notes; });
    } else if (state.sort === '最新收录') {
      arr.reverse();
    } else if (state.sort === '字数从少到多') {
      arr.sort(function (a, b) { return a.text.length - b.text.length; });
    }
    return arr;
  }

  function renderPagination(pages) {
    var box = document.querySelector('.pagination');
    if (!box) return;
    if (pages <= 1) {
      box.innerHTML = '';
      return;
    }
    var cur = state.page;
    var nums = [];
    var push = function (n) { if (nums.indexOf(n) === -1) nums.push(n); };
    push(1); push(2);
    for (var n = cur - 1; n <= cur + 1; n++) push(n);
    push(pages - 1); push(pages);
    nums = nums.filter(function (n) { return n >= 1 && n <= pages; })
      .sort(function (a, b) { return a - b; });

    var html = '<span class="nav-text" data-page-to="' + (cur - 1) + '">上一页</span>';
    var prev = 0;
    nums.forEach(function (n) {
      if (n - prev > 1) html += '<span class="nav-text">…</span>';
      html += '<a class="page-num' + (n === cur ? ' is-active' : '') + '" data-page-to="' + n + '">' + n + '</a>';
      prev = n;
    });
    html += '<span class="nav-text next" data-page-to="' + (cur + 1) + '">下一页</span>';
    box.innerHTML = html;

    box.querySelectorAll('[data-page-to]').forEach(function (el) {
      el.addEventListener('click', function () {
        var to = parseInt(el.getAttribute('data-page-to'), 10);
        if (to < 1 || to > pages || to === state.page) return;
        state.page = to;
        renderPoems();
        var list = document.getElementById('poem-list');
        if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderPoems() {
    var wrap = document.getElementById('poem-list');
    var countEl = document.getElementById('result-count');
    if (!wrap) return;

    var list = sortPoems(loadedPoems().filter(matchFilters));
    if (countEl) {
      var txt = state.textHits
        ? '正文搜索命中 ' + list.length.toLocaleString('en-US') + ' 首'
        : '共 ' + list.length.toLocaleString('en-US') + ' 首符合条件';
      var total = IDX_META.total || 0;
      var loaded = IndexStore.loadedCount();
      if (loaded < total) {
        txt += ' · 已载入 ' + loaded.toLocaleString('en-US') + '/' + total.toLocaleString('en-US') + ' 首，其余后台载入中…';
      }
      countEl.textContent = txt;
    }

    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PER_PAGE;
    var pageItems = list.slice(start, start + PER_PAGE);

    if (!pageItems.length) {
      /* 元数据无结果且尚未做正文搜索 → 提供全文搜索入口 */
      if (state.keyword && !state.textHits && !state.scanning) {
        wrap.innerHTML =
          '<div class="empty-state">标题 / 作者 / 首行中没有「' + esc(state.keyword) + '」' +
          '<br /><button class="btn btn--ghost" id="fulltext-scan-btn" style="margin-top:14px;">在全部 ' +
          (IDX_META.total || 0).toLocaleString('en-US') + ' 首的正文里搜（会分批下载正文数据）</button></div>';
        var scanBtn = document.getElementById('fulltext-scan-btn');
        if (scanBtn) {
          scanBtn.addEventListener('click', function () { scanFullText(state.keyword); });
        }
      } else {
        wrap.innerHTML = '<div class="empty-state">没有找到匹配的作品，换个词试试</div>';
      }
      renderPagination(1);
      return;
    }

    wrap.innerHTML = pageItems
      .map(function (p) {
        var learned = isLearned(p.id);
        var meta = '注释 ' + p.notes + ' 条 · ' + p.readers + ' 人读过' + (learned ? ' · 已学' : '');
        /* 列表只显示首行（索引自带），全文进课堂页按块加载 */
        var shown = esc(p.line) +
          '<br /><span class="poem-row-more">点击查看全文与注释 →</span>';
        return (
          '<article class="poem-row poem-row--link" data-goto="' + poemUrl(p.id) + '">' +
          '<div class="genre-badge">' + esc(p.genre) + '</div>' +
          '<div class="poem-row-main">' +
          '<h3 class="poem-row-title">' + esc(p.title) + '</h3>' +
          '<div class="poem-row-author">' + esc(p.author) + ' · ' + esc(p.dynasty) + ' · ' + esc(p.form) + '</div>' +
          '<p class="poem-row-line">' + shown + '</p>' +
          '<div class="poem-row-meta">' + meta + '</div>' +
          '</div>' +
          '<div class="poem-row-action">' + (learned ? '<strong>继续学习</strong>' : '去学习') + '</div>' +
          '</article>'
        );
      })
      .join('');

    wrap.querySelectorAll('[data-goto]').forEach(function (row) {
      row.addEventListener('click', function () {
        location.href = row.getAttribute('data-goto');
      });
    });

    renderPagination(pages);
  }

  function updateLibraryProgress() {
    var textEl = document.getElementById('library-progress-text');
    var fillEl = document.getElementById('library-progress-fill');
    if (!textEl) return;
    var total = IDX_META.total || 1;
    var pct = Math.min(100, Math.round((learnedIds.length / total) * 1000) / 10);
    textEl.textContent = '我的进度 · 已学 ' + learnedIds.length + ' 首 · 收藏 ' + favIds.length + ' 首';
    if (fillEl) fillEl.style.width = Math.max(pct, learnedIds.length ? 1 : 0) + '%';
  }

  function bindFilterItems() {
    document.querySelectorAll('[data-filter-key]').forEach(function (item) {
      item.addEventListener('click', function () {
        var key = item.getAttribute('data-filter-key');
        state[key] = item.getAttribute('data-value');
        document.querySelectorAll('[data-filter-key="' + key + '"]').forEach(function (el) {
          var on = el === item;
          if (el.classList.contains('side-item')) {
            el.classList.toggle('is-active', on);
          } else {
            el.classList.toggle('chip--active', on);
          }
        });
        state.page = 1;
        renderPoems();
      });
    });
  }

  function initLibrary() {
    if (!document.getElementById('poem-list')) return;

    renderPoems();
    updateLibraryProgress();

    /* 后台补齐剩余索引分片：每到位一片就重渲染，搜索结果渐进变全 */
    window.__refreshLibrary = function () {
      renderPoems();
      updateLibraryProgress();
    };
    IndexStore.ensureAll(function () { window.__refreshLibrary(); });

    var input = document.getElementById('library-search');
    if (input) {
      input.addEventListener('input', function () {
        state.keyword = input.value.trim();
        state.textHits = null;
        state.page = 1;
        renderPoems();
      });
    }

    var form = document.getElementById('library-search-form');
    if (form) {
      form.addEventListener('submit', function (e) { e.preventDefault(); });
    }

    bindFilterItems();

    var sortBar = document.querySelector('#sort-tabs');
    if (sortBar) {
      sortBar.addEventListener('click', function (e) {
        var tab = e.target.closest('.sort-tab');
        if (!tab) return;
        sortBar.querySelectorAll('.sort-tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        state.sort = tab.getAttribute('data-sort');
        state.page = 1;
        renderPoems();
      });
    }

    document.querySelectorAll('[data-hotword]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (input) {
          input.value = btn.getAttribute('data-hotword');
          state.keyword = input.value;
          state.textHits = null;
          state.page = 1;
          renderPoems();
        }
      });
    });
  }

  /* ---------- 6. 社区广场：分享 + 审核 ---------- */
  /* 帖子: {id, kind:'classic'|'original', title, text, poemId, author, ts, status, likes} */
  var SEED_POSTS = [
    { id: 's1', kind: 'original', title: '夜读杂兴', text: '灯下翻书夜半时，一窗凉月照吟髭。\n千年诗句如相待，读到情深总是痴。', author: '沈砚秋', ts: 1725500000000, status: 'approved', likes: 42 },
    { id: 's2', kind: 'classic', title: '念奴娇·昆仑', text: '', poemId: null, author: '白也', ts: 1725580000000, status: 'approved', likes: 38 },
    { id: 's3', kind: 'original', title: '秋日过锦官城', text: '锦江水暖雁初还，万里桥西夕照闲。\n不是少陵留此地，草堂谁与话巴山。', author: '顾清商', ts: 1725660000000, status: 'approved', likes: 27 }
  ];

  function getPosts() { return store('shici_posts', []); }
  function setPosts(posts) { saveStore('shici_posts', posts); }
  function getReviewers() {
    var r = store('shici_reviewers', null);
    if (!r || !r.length) { r = [CURRENT_USER]; saveStore('shici_reviewers', r); }
    return r;
  }

  /* ---------- 评论：云端优先，本地兜底 ---------- */
  var CKEY = 'shici_comments';
  function localComments(postId) {
    var all = store(CKEY, {});
    return all[postId] || [];
  }
  function addLocalComment(postId, c) {
    var all = store(CKEY, {});
    if (!all[postId]) all[postId] = [];
    all[postId].push(c);
    saveStore(CKEY, all);
  }

  /* 云端帖子 → 统一结构（本地帖子用 ts，云端用 created_at） */
  function normalizeCloudPost(r) {
    return {
      id: r.id,
      kind: r.kind || 'original',
      title: r.title,
      text: r.body || '',
      poemId: (r.poem_id === null || r.poem_id === undefined) ? null : r.poem_id,
      author: r.author,
      ts: new Date(r.created_at).getTime(),
      status: r.status || 'approved',
      likes: r.likes || 0,
      cloud: true
    };
  }

  /* 合并信息流：云端（人人可见）+ 本地种子/本机发布 */
  function loadFeed(cb) {
    var local = getPosts().filter(function (p) {
      return p.status === 'approved' || p.author === CURRENT_USER;
    });
    var seeds = SEED_POSTS;
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.posts.list(function (rows) {
        var cloud = (rows || []).map(normalizeCloudPost);
        var seen = {};
        var all = cloud.concat(local, seeds).filter(function (p) {
          if (!p || seen[p.id]) return false;
          seen[p.id] = 1;
          return true;
        }).sort(function (a, b) { return b.ts - a.ts; });
        cb(all);
      });
    } else {
      var seen2 = {};
      var all2 = local.concat(seeds).filter(function (p) {
        if (!p || seen2[p.id]) return false;
        seen2[p.id] = 1;
        return true;
      }).sort(function (a, b) { return b.ts - a.ts; });
      cb(all2);
    }
  }

  function postBody(p) {
    if (p.kind === 'classic' && p.poemId !== null && p.poemId !== undefined) {
      var poem = findPoem(p.poemId);
      if (poem) {
        /* 正文按需加载：先放首行占位，块到位后替换为全文 */
        return '<span data-poem-body="' + poem.id + '">' + esc(poem.line) + ' …</span>';
      }
    }
    return esc(p.text).replace(/\n/g, '<br />');
  }

  function fillClassicBodies(root) {
    if (!root) return;
    root.querySelectorAll('[data-poem-body]').forEach(function (el) {
      var id = parseInt(el.getAttribute('data-poem-body'), 10);
      TextStore.text(id, function (text) {
        if (text) el.innerHTML = text.split('\n').map(esc).join('<br />');
      });
    });
  }

  function postCard(p, mine) {
    var statusBadge = '';
    if (p.status === 'pending') statusBadge = '<span class="badge-pill badge-pending">待审核</span>';
    if (p.status === 'rejected') statusBadge = '<span class="badge-pill badge-rejected">未通过</span>';
    var classicTag = p.kind === 'classic' ? '<span class="badge-pill badge-classic">分享经典</span>' : '';
    var d = new Date(p.ts);
    var when = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return (
      '<article class="card post-card anim-rise is-in" data-post="' + esc(p.id) + '">' +
      '<div class="post-head"><span class="avatar">' + esc((p.author || '诗')[0]) + '</span>' +
      '<span class="who">' + esc(p.author) + ' · ' + when + '</span>' + classicTag + statusBadge + '</div>' +
      '<h3 class="post-title">' + esc(p.title) + '</h3>' +
      '<p class="poem-body">' + postBody(p) + '</p>' +
      '<div class="post-foot">' +
      '<button data-like="' + p.likes + '">赞 ' + p.likes + '</button>' +
      '<button data-comments-toggle="' + esc(p.id) + '">评论</button>' +
      '</div>' +
      '<div class="comment-area" data-comments="' + esc(p.id) + '" hidden></div>' +
      '</article>'
    );
  }

  /* ---------- 评论区渲染 ---------- */
  function commentItem(c) {
    var d = new Date(c.ts || c.created_at);
    var when = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return (
      '<div class="comment-item" data-comment="' + esc(c.id) + '">' +
      '<span class="avatar avatar--xs">' + esc((c.author || '诗')[0]) + '</span>' +
      '<div class="comment-main">' +
      '<span class="comment-who">' + esc(c.author) + ' · ' + when + '</span>' +
      '<p class="comment-body">' + esc(c.body).replace(/\n/g, '<br />') + '</p>' +
      '</div></div>'
    );
  }

  function renderComments(box, postId) {
    box.hidden = false;
    box.innerHTML = '<div class="comment-loading">评论载入中…</div>';
    function paint(list) {
      var mine = localComments(postId);
      var all = (list || []).map(function (r) {
        return { id: r.id, author: r.author, body: r.body, ts: new Date(r.created_at).getTime() };
      }).concat(mine);
      var html = all.length
        ? '<div class="comment-list">' + all.map(commentItem).join('') + '</div>'
        : '<div class="comment-empty">还没有人评论，来说两句</div>';
      var needLogin = window.Cloud && window.Cloud.ready && !Auth.current();
      html += needLogin
        ? '<div class="comment-form-locked">登录后即可发表评论 · <a href="auth.html">去登录</a></div>'
        : '<form class="comment-form" data-comment-form="' + esc(postId) + '">' +
          '<input class="comment-input" type="text" maxlength="200" placeholder="写下你的感受…" />' +
          '<button type="submit" class="btn btn--primary btn--sm">发送</button></form>';
      box.innerHTML = html;

      var form = box.querySelector('[data-comment-form]');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var input = form.querySelector('.comment-input');
          var body = (input.value || '').trim();
          if (!body) return;
          input.value = '';
          var who = Auth.current() || CURRENT_USER;
          if (window.Cloud && window.Cloud.ready) {
            window.Cloud.comments.create(postId, body, function (row) {
              if (!row) {
                addLocalComment(postId, { id: 'c' + Date.now(), author: who, body: body, ts: Date.now() });
              }
              renderComments(box, postId);
            });
          } else {
            addLocalComment(postId, { id: 'c' + Date.now(), author: who, body: body, ts: Date.now() });
            renderComments(box, postId);
          }
        });
      }
    }
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.comments.list(postId, function (rows) { paint(rows || []); });
    } else {
      paint([]);
    }
  }

  function bindCommentToggles(root) {
    root.querySelectorAll('[data-comments-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-comments-toggle');
        var box = root.querySelector('[data-comments="' + id + '"]');
        if (!box) return;
        if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
        renderComments(box, id);
      });
    });
  }

  function bindLike(btn) {
    btn.addEventListener('click', function () {
      var n = parseInt(btn.getAttribute('data-like'), 10) || 0;
      if (btn.dataset.liked === '1') {
        btn.dataset.liked = '0';
        n -= 1;
      } else {
        btn.dataset.liked = '1';
        n += 1;
      }
      btn.setAttribute('data-like', String(n));
      btn.textContent = '赞 ' + n;
    });
  }

  function renderFeed() {
    var list = document.getElementById('post-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-state">正在载入诗友分享…</div>';
    /* 云端模式：所有访客（含未登录）都能看到全站已通过的分享 */
    loadFeed(function (all) {
      list.innerHTML = all.map(function (p) { return postCard(p); }).join('') ||
        '<div class="empty-state">还没有作品，来写第一首吧</div>';
      list.querySelectorAll('[data-like]').forEach(bindLike);
      bindCommentToggles(list);
      fillClassicBodies(list);
    });
  }

  function renderModeration() {
    var panel = document.getElementById('moderation-panel');
    if (!panel) return;
    var reviewers = getReviewers();
    var isReviewer = reviewers.indexOf(CURRENT_USER) !== -1;
    panel.hidden = !isReviewer;
    if (!isReviewer) return;

    var pending = getPosts().filter(function (p) { return p.status === 'pending'; });
    var queueEl = document.getElementById('moderation-queue');
    var countEl = document.getElementById('moderation-count');
    if (countEl) countEl.textContent = pending.length;
    if (queueEl) {
      queueEl.innerHTML = pending.length
        ? pending.map(function (p) {
            return (
              '<div class="review-item" data-review="' + esc(p.id) + '">' +
              '<div class="review-body">' +
              '<div class="post-head"><span class="avatar avatar--sm">' + esc((p.author || '诗')[0]) + '</span>' +
              '<span class="who">' + esc(p.author) + (p.kind === 'classic' ? ' · 分享经典' : ' · 原创') + '</span></div>' +
              '<h3 class="post-title">' + esc(p.title) + '</h3>' +
              '<p class="poem-body">' + postBody(p) + '</p>' +
              '</div>' +
              '<div class="review-actions">' +
              '<button class="btn btn--primary" data-approve>通过</button>' +
              '<button class="btn btn--ghost" data-reject>驳回</button>' +
              '</div>' +
              '</div>'
            );
          }).join('')
        : '<div class="empty-state">审核队列已清空，喝杯茶吧</div>';
      fillClassicBodies(queueEl);
    }

    /* 审核人列表 */
    var reviewerList = document.getElementById('reviewer-list');
    if (reviewerList) {
      reviewerList.innerHTML = reviewers.map(function (name) {
        var isOwner = name === CURRENT_USER;
        return (
          '<span class="chip chip--active">' + esc(name) + (isOwner ? '（我）' : '') +
          (isOwner ? '' : ' <a data-remove-reviewer="' + esc(name) + '" title="移出审核人">×</a>') + '</span>'
        );
      }).join('');
    }
  }

  function initCommunity() {
    var feed = document.getElementById('post-list');
    if (!feed) return;

    renderFeed();
    renderModeration();

    /* --- 发布：两种模式 --- */
    var card = document.getElementById('compose');
    var modeRow = document.getElementById('compose-mode');
    var classicBox = document.getElementById('compose-classic');
    var originalBox = document.getElementById('compose-original');
    var searchInput = document.getElementById('classic-search');
    var searchResults = document.getElementById('classic-results');
    var picked = null;
    var mode = 'original';

    function openCard(m) {
      if (!card) return;
      mode = m || mode;
      card.hidden = false;
      switchMode(mode);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function switchMode(m) {
      mode = m;
      if (modeRow) {
        modeRow.querySelectorAll('.chip').forEach(function (c) {
          c.classList.toggle('chip--active', c.getAttribute('data-compose-mode') === m);
        });
      }
      if (classicBox) classicBox.hidden = m !== 'classic';
      if (originalBox) originalBox.hidden = m !== 'original';
    }

    document.querySelectorAll('[data-compose-open]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openCard(btn.getAttribute('data-compose-open') || 'original');
      });
    });
    document.querySelectorAll('[data-compose-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () { if (card) card.hidden = true; });
    });
    if (modeRow) {
      modeRow.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-compose-mode]');
        if (chip) switchMode(chip.getAttribute('data-compose-mode'));
      });
    }

    /* 经典检索：按 诗题/作者 匹配，取前 8 条 */
    if (searchInput && searchResults) {
      searchInput.addEventListener('input', function () {
        var kw = searchInput.value.trim();
        picked = null;
        if (!kw) {
          searchResults.innerHTML = '';
          return;
        }
        var hits = [];
        var _pool = loadedPoems();
        for (var i = 0; i < _pool.length && hits.length < 8; i++) {
          var p = _pool[i];
          if (p.title.indexOf(kw) !== -1 || p.author.indexOf(kw) !== -1) hits.push(p);
        }
        searchResults.innerHTML = hits.length
          ? hits.map(function (p) {
              return (
                '<div class="classic-hit" data-pick="' + p.id + '">' +
                '<strong>' + esc(p.title) + '</strong> · ' + esc(p.author) + '（' + esc(p.dynasty) + '）' +
                '<div class="classic-hit-line">' + esc(p.line) + '</div>' +
                '</div>'
              );
            }).join('')
          : '<div class="empty-state">库里没搜到，换个关键词</div>';
      });
      searchResults.addEventListener('click', function (e) {
        var hit = e.target.closest('[data-pick]');
        if (!hit) return;
        picked = findPoem(parseInt(hit.getAttribute('data-pick'), 10));
        searchResults.querySelectorAll('.classic-hit').forEach(function (h) { h.classList.remove('is-picked'); });
        hit.classList.add('is-picked');
      });
    }

    /* 提交：进入待审核 */
    var submit = document.querySelector('[data-compose-submit]');
    if (submit) {
      submit.addEventListener('click', function () {
        if (!Auth.current()) {
          var hint0 = document.getElementById('feed-hint');
          if (hint0) hint0.textContent = '请先登录再发布作品，正在跳转登录页…';
          setTimeout(function () { location.href = 'auth.html'; }, 800);
          return;
        }
        var base = {
          id: 'p' + Date.now(),
          author: CURRENT_USER,
          ts: Date.now(),
          status: 'pending',
          likes: 0
        };
        var draft = null;
        if (mode === 'classic') {
          if (!picked) {
            if (searchInput) searchInput.focus();
            return;
          }
          var note = (document.getElementById('classic-note') || {}).value || '';
          draft = Object.assign(base, {
            kind: 'classic',
            title: picked.title + ' · ' + picked.author,
            text: note.trim(),
            poemId: picked.id
          });
        } else {
          var titleInput = document.getElementById('compose-title');
          var bodyInput = document.getElementById('compose-body');
          var body = bodyInput ? bodyInput.value.trim() : '';
          if (!body) {
            if (bodyInput) bodyInput.focus();
            return;
          }
          draft = Object.assign(base, {
            kind: 'original',
            title: (titleInput && titleInput.value.trim()) || '无题',
            text: body,
            poemId: null
          });
        }
        /* 云端模式：直接写库（RLS 只允许写自己的），所有人立即可见 */
        if (window.Cloud && window.Cloud.ready) {
          window.Cloud.posts.create(draft, function (row) {
            if (!row) {
              var fallback = getPosts();
              fallback.push(draft);
              setPosts(fallback);
            }
            renderFeed();
          });
        } else {
          var posts = getPosts();
          posts.push(draft);
          setPosts(posts);
        }
        if (card) card.hidden = true;
        ['compose-title', 'compose-body', 'classic-note', 'classic-search'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.value = '';
        });
        if (searchResults) searchResults.innerHTML = '';
        picked = null;
        renderFeed();
        renderModeration();
        var hint = document.getElementById('feed-hint');
        if (hint) hint.textContent = '已提交，等待审核通过后公开显示';
      });
    }

    /* --- 审核操作 --- */
    var queue = document.getElementById('moderation-queue');
    if (queue) {
      queue.addEventListener('click', function (e) {
        var item = e.target.closest('[data-review]');
        if (!item) return;
        var id = item.getAttribute('data-review');
        var posts = getPosts();
        var target = null;
        posts.forEach(function (p) { if (p.id === id) target = p; });
        if (!target) return;
        if (e.target.closest('[data-approve]')) target.status = 'approved';
        else if (e.target.closest('[data-reject]')) target.status = 'rejected';
        else return;
        setPosts(posts);
        renderFeed();
        renderModeration();
      });
    }

    /* 授权审核人 */
    var addBtn = document.getElementById('add-reviewer');
    var addInput = document.getElementById('new-reviewer-name');
    if (addBtn && addInput) {
      addBtn.addEventListener('click', function () {
        var name = addInput.value.trim();
        if (!name) return;
        var reviewers = getReviewers();
        if (reviewers.indexOf(name) === -1) {
          reviewers.push(name);
          saveStore('shici_reviewers', reviewers);
        }
        addInput.value = '';
        renderModeration();
      });
    }
    var reviewerList = document.getElementById('reviewer-list');
    if (reviewerList) {
      reviewerList.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-remove-reviewer]');
        if (!rm) return;
        var reviewers = getReviewers().filter(function (n) { return n !== rm.getAttribute('data-remove-reviewer'); });
        saveStore('shici_reviewers', reviewers);
        renderModeration();
      });
    }
  }

  /* ---------- 7. 诗词学习详情页（动态） ---------- */
  /* 精编内容：仅登高有完整注释/译文/赏析，其余显示编校占位 */
  var CURATED = {
    '登高|杜甫': {
      notes: [
        ['风急天高猿啸哀，渚清沙白鸟飞回。', '渚：水中小洲。首联两句皆对，一写山、一写水，声色俱厉。'],
        ['无边落木萧萧下，不尽长江滚滚来。', '落木：落叶。萧萧：落叶之声。不尽：没有尽头，写长江奔流不息。'],
        ['万里悲秋常作客，百年多病独登台。', '万里：漂泊之远。百年：一生。十四字含八层意思，人称「句中化境」。'],
        ['艰难苦恨繁霜鬓，潦倒新停浊酒杯。', '苦恨：极恨。新停：刚刚戒酒。连酒也停了，悲凉到无可排遣。']
      ],
      translation: '风急天高，猿猴的啼声凄厉；水清沙白的小洲上，鸟儿盘旋飞回。无边无际的落叶萧萧飘下，奔流不息的长江滚滚而来。漂泊万里，悲叹秋色，常年作客他乡；垂暮之年，疾病缠身，独自登上高台。时局艰难，恨自己鬓发如霜；穷愁潦倒，偏偏又刚刚戒了酒。',
      appreciation: '此诗被誉为「古今独步」的七言律诗。前四句写登高所见秋江之景，后四句抒漂泊老病之情。通篇对仗而浑然不觉，情景交融，把个人之悲与时代之难熔于一炉。杜甫作此诗时五十六岁，滞留夔州，距去世仅三年。'
    }
  };

  /* POEM_NOTES（assets/data/notes.js）："标题|作者" -> {y:译文, s:赏析, b:背景}
   * 模糊匹配兜底：标题全等 → 标题互含（同作者） */
  function lookupNotes(title, author) {
    var notes = window.POEM_NOTES || {};
    var key = title + '|' + author;
    if (notes[key]) return notes[key];
    var k, parts;
    for (k in notes) {
      parts = k.split('|');
      if (parts[0] === title) return notes[k];
    }
    for (k in notes) {
      parts = k.split('|');
      if (parts[1] === author && (title.indexOf(parts[0]) !== -1 || parts[0].indexOf(title) !== -1)) return notes[k];
    }
    return null;
  }

  function initStudy() {
    var titleEl = document.getElementById('study-title');
    if (!titleEl) return;

    var params = new URLSearchParams(location.search);
    var id = parseInt(params.get('id'), 10);
    var poem = findPoem(id);
    if (!poem && id >= 0) {
      /* 索引分片尚未载入：先下载该片再渲染，保证深链接可达全库任意一首 */
      titleEl.textContent = '载入中…';
      IndexStore.poem(id, function (p2) {
        initStudyWith(p2 || findByTitleAuthor('登高', '杜甫') || loadedPoems()[0]);
      });
      return;
    }
    if (!poem) poem = findByTitleAuthor('登高', '杜甫') || loadedPoems()[0];
    initStudyWith(poem);
  }

  function initStudyWith(poem) {
    var titleEl = document.getElementById('study-title');
    if (!poem || !titleEl) return;

    /* 头部：索引数据，立即渲染 */
    titleEl.textContent = poem.title;
    var subEl = document.getElementById('study-subtitle');
    if (subEl) subEl.textContent = poem.author + ' · ' + poem.dynasty + ' · ' + poem.form;
    var crumbEl = document.getElementById('study-crumb');
    if (crumbEl) crumbEl.textContent = poem.title;
    document.title = poem.title + ' · ' + poem.author + ' — 诗意中国';

    var verseList0 = document.getElementById('verse-list');
    if (verseList0) verseList0.innerHTML = '<div class="empty-state">正文载入中…</div>';

    /* 正文按块懒加载，到位后再渲染原文/注释/译文/赏析 */
    TextStore.text(poem.id, function (text) {
      poem.text = text || poem.line;
      renderStudyText(poem);
    });

    /* 四栏切换（不依赖正文，直接绑定） */
    var tabBar = document.getElementById('study-tabs');
    if (tabBar) {
      tabBar.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-study-tab]');
        if (!tab) return;
        tabBar.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('tab--active'); });
        tab.classList.add('tab--active');
        var key = tab.getAttribute('data-study-tab');
        document.querySelectorAll('[data-study-panel]').forEach(function (p) {
          p.hidden = p.getAttribute('data-study-panel') !== key;
        });
      });
    }

    /* 打卡 → 写入学习进度 */
    var checkin = document.getElementById('checkin-btn');
    var checkinHint = document.getElementById('checkin-hint');
    function syncCheckin() {
      if (!checkin) return;
      if (isLearned(poem.id)) {
        checkin.textContent = '已加入学习记录';
        checkin.disabled = true;
        checkin.style.opacity = '.6';
        if (checkinHint) checkinHint.textContent = '进度已保存，诗词库「已学」筛选可见';
      }
    }
    if (checkin) {
      checkin.addEventListener('click', function () {
        if (!isLearned(poem.id)) {
          learnedIds.push(poem.id);
          saveStore('shici_learned', learnedIds);
        }
        syncCheckin();
      });
      syncCheckin();
    }

    /* 收藏 */
    var favBtn = document.getElementById('fav-btn');
    function syncFav() {
      if (favBtn) favBtn.textContent = isFav(poem.id) ? '已收藏' : '收藏';
    }
    if (favBtn) {
      favBtn.addEventListener('click', function () {
        toggleIn(favIds, poem.id);
        saveStore('shici_favs', favIds);
        syncFav();
      });
      syncFav();
    }

    /* 上一首 / 下一首 */
    var prevEl = document.getElementById('study-prev');
    var nextEl = document.getElementById('study-next');
    if (prevEl) {
      var prev = findPoem(poem.id - 1);
      if (prev) { prevEl.href = poemUrl(prev.id); prevEl.textContent = '← ' + prev.title; }
      else prevEl.hidden = true;
    }
    if (nextEl) {
      var next = findPoem(poem.id + 1);
      if (next) { nextEl.href = poemUrl(next.id); nextEl.textContent = next.title + ' →'; }
      else nextEl.hidden = true;
    }

    /* 同题材推荐（可点击，索引数据即可） */
    var relEl = document.getElementById('related-list');
    if (relEl) {
      var same = loadedPoems().filter(function (p) {
        return p.id !== poem.id && p.themes[0] === poem.themes[0] && p.line.length <= 30;
      });
      var picks = seededPick(same, poem.id * 31 + 7, 3);
      relEl.innerHTML = picks.map(function (p) {
        return (
          '<a class="related-item" href="' + poemUrl(p.id) + '">' +
          '<strong>' + esc(p.title) + '</strong>' +
          '<span>' + esc(p.author) + ' · ' + esc(p.dynasty) + '</span>' +
          '</a>'
        );
      }).join('');
    }

    /* 诗人卡 */
    var poetEl = document.getElementById('poet-card-body');
    if (poetEl) {
      var count = 0;
      loadedPoems().forEach(function (p) { if (p.author === poem.author) count++; });
      poetEl.innerHTML =
        '<div class="poet-name serif">' + esc(poem.author) + '</div>' +
        '<div class="poet-dynasty">' + esc(poem.dynasty) + '代 · 库中收录 ' + count + ' 首</div>';
    }
  }

  /* 正文块到位后：渲染原文 / 注释 / 译文 / 赏析面板 */
  function renderStudyText(poem) {
    var curated = CURATED[poem.title + '|' + poem.author] || null;
    var extra = lookupNotes(poem.title, poem.author);
    var lines = poem.text.split('\n');

    /* 原文面板：逐句可点 */
    var verseList = document.getElementById('verse-list');
    if (verseList) {
      verseList.innerHTML = lines.map(function (ln, i) {
        var note = curated && curated.notes[i] ? curated.notes[i][1] : '';
        return (
          '<div class="verse-row" data-verse="' + i + '">' +
          '<span class="verse-text">' + esc(ln) + '</span>' +
          (note ? '<span class="verse-note">' + esc(note) + '</span>' : '') +
          '</div>'
        );
      }).join('');
      verseList.querySelectorAll('[data-verse]').forEach(function (row) {
        row.addEventListener('click', function () {
          verseList.querySelectorAll('[data-verse]').forEach(function (r) {
            r.classList.toggle('is-active', r === row);
          });
        });
      });
    }

    /* 注释面板 */
    var notePanel = document.getElementById('panel-notes');
    if (notePanel) {
      notePanel.innerHTML = curated
        ? '<ul class="note-list">' + curated.notes.map(function (n) {
            return '<li class="note-item"><strong>' + esc(n[0]) + '</strong><span>' + esc(n[1]) + '</span></li>';
          }).join('') + '</ul>'
        : '<div class="empty-state">该篇的逐句注释正在编校中，欢迎到社区广场分享你的理解。</div>';
    }

    /* 译文面板 */
    var transPanel = document.getElementById('panel-translation');
    if (transPanel) {
      var trans = curated ? curated.translation : (extra && extra.y);
      transPanel.innerHTML = trans
        ? '<p class="serif study-prose">' + esc(trans) + '</p>'
        : '<div class="empty-state">白话译文正在编校中。先读原文，体会字面之下的节奏与气息。</div>';
    }

    /* 赏析面板（有背景解析时一并展示） */
    var aprePanel = document.getElementById('panel-appreciation');
    if (aprePanel) {
      var apre = curated ? curated.appreciation : (extra && extra.s);
      var bg = !curated && extra && extra.b;
      aprePanel.innerHTML = apre
        ? '<p class="serif study-prose">' + esc(apre) + '</p>' +
          (bg ? '<p class="serif study-prose study-prose--bg"><strong>创作背景　</strong>' + esc(bg) + '</p>' : '')
        : '<div class="empty-state">赏析文章正在编校中。' + esc(poem.form) + ' · ' + esc(poem.themes[0]) + '题材，全文 ' + lines.length + ' 行。</div>';
    }
  }

  /* ---------- 8. 挑战闯关（从诗词库随机出题） ---------- */
  var MODE_NAME = { fill: '填空补全', chain: '上下句接龙', recite: '背诵闯关', exam: '考试闯关', hot: '热门挑战' };
  var QUIZ_PER_RUN = 10;

  /* 可出题的诗：quizpool/pN.js 预拆句分块（每次访问随机加载一块），
   * 句子已按句读拆成 3-10 字半句，保证干扰项质量 */
  var QUIZ_POOL = [];
  var QUIZ_LINES = [];
  function buildQuizPool() {
    QUIZ_POOL = (window.QUIZ_POOL_DATA || []).map(function (e) {
      return { title: e[0], author: e[1], dynasty: e[2], lines: e[3] };
    });
    QUIZ_LINES = [];
    QUIZ_POOL.forEach(function (p) {
      p.lines.forEach(function (l) { QUIZ_LINES.push(l); });
    });
  }

  /* 精选题库（banks.js 预解析生成 window.QUIZ_BANKS），结构与 QUIZ_POOL 一致 */
  var BANK_POOLS = { exam: [], hot: [] };
  (function buildBankPools() {
    var banks = window.QUIZ_BANKS || { exam: [], hot: [] };
    ['exam', 'hot'].forEach(function (k) {
      BANK_POOLS[k] = (banks[k] || []).map(function (e) {
        return { title: e[0], author: e[1], dynasty: e[2], lines: e[3] };
      }).filter(function (p) { return p.lines.length >= 2; });
    });
  })();

  function randInt(n) { return Math.floor(Math.random() * n); }
  function pickOne(arr) { return arr[randInt(arr.length)]; }
  function shuffleArr(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function repeatChar(ch, n) { return new Array(n + 1).join(ch); }

  /* 干扰项：从别家诗句里截 len 个相邻字 */
  function randomFragment(len, exclude) {
    for (var t = 0; t < 60; t++) {
      var l = pickOne(QUIZ_LINES);
      if (l.length < len) continue;
      var s = randInt(l.length - len + 1);
      var frag = l.slice(s, s + len);
      if (exclude.indexOf(frag) === -1) return frag;
    }
    return null;
  }
  function randomLineOfLen(len, exclude) {
    for (var t = 0; t < 80; t++) {
      var l = pickOne(QUIZ_LINES);
      if (l.length === len && exclude.indexOf(l) === -1) return l;
    }
    return null;
  }
  function makeOptions(correct, gen) {
    var opts = [correct];
    var guard = 0;
    while (opts.length < 4 && guard++ < 120) {
      var d = gen(opts);
      if (d && opts.indexOf(d) === -1) opts.push(d);
    }
    shuffleArr(opts);
    return { options: opts, answer: opts.indexOf(correct) };
  }

  function makeFillQuestion(pool, poem) {
    var p = poem || pickOne(pool || QUIZ_POOL);
    var longLines = p.lines.filter(function (l) { return l.length >= 4; });
    if (!longLines.length) {
      if (poem) return makeChainQuestion(pool, poem);
      return makeFillQuestion(pool);
    }
    var line = pickOne(longLines);
    var start = randInt(line.length - 1);
    var blanked = line.slice(0, start) + '\u25A1\u25A1' + line.slice(start + 2);
    var idx = p.lines.indexOf(line);
    var stem = idx + 1 < p.lines.length ? blanked + '\uFF0C' + p.lines[idx + 1] + '\u3002' : blanked + '\u3002';
    var correct = line.slice(start, start + 2);
    var made = makeOptions(correct, function (exclude) { return randomFragment(2, exclude); });
    return {
      stem: stem,
      source: p.author + '\u300A' + p.title + '\u300B \u00B7 \u8865\u51FA\u7A7A\u7F3A\u7684\u4E24\u5B57',
      options: made.options,
      answer: made.answer,
      tip: '\u539F\u53E5\uFF1A' + line + '\u3002'
    };
  }

  function makeChainQuestion(pool, poem) {
    var p = poem || pickOne(pool || QUIZ_POOL);
    var i = randInt(p.lines.length - 1);
    var correct = p.lines[i + 1];
    var made = makeOptions(correct, function (exclude) { return randomLineOfLen(correct.length, exclude); });
    return {
      stem: p.lines[i] + '\uFF0C' + repeatChar('\u25A1', correct.length) + '\u3002',
      source: p.author + '\u300A' + p.title + '\u300B \u00B7 \u63A5\u51FA\u4E0B\u53E5',
      options: made.options,
      answer: made.answer,
      tip: '\u539F\u53E5\uFF1A' + p.lines[i] + '\uFF0C' + correct + '\u3002'
    };
  }

  function makeReciteQuestion(pool, poem) {
    var p = poem || pickOne(pool || QUIZ_POOL);
    if (p.lines.length < 3) return makeChainQuestion(pool, poem);
    var j = 1 + randInt(p.lines.length - 1);
    var correct = p.lines[j];
    var stemLines = p.lines.map(function (l, idx) { return idx === j ? repeatChar('\u25A1', l.length) : l; });
    var made = makeOptions(correct, function (exclude) { return randomLineOfLen(correct.length, exclude); });
    return {
      stem: stemLines.join('\uFF0C') + '\u3002',
      source: p.author + '\u300A' + p.title + '\u300B \u00B7 \u9ED8\u5199\u7B2C ' + (j + 1) + ' \u53E5',
      options: made.options,
      answer: made.answer,
      tip: '\u539F\u53E5\uFF1A' + correct + '\u3002'
    };
  }

  var QUIZ_MAKER = { fill: makeFillQuestion, chain: makeChainQuestion, recite: makeReciteQuestion };

  function loadChallengeStats() {
    try {
      var s = JSON.parse(localStorage.getItem('shiyun-challenge') || '{}');
      return { best: s.best || 0, total: s.total || 0, correct: s.correct || 0, done: s.done || {}, bestScore: s.bestScore || 0 };
    } catch (e) {
      return { best: 0, total: 0, correct: 0, done: {}, bestScore: 0 };
    }
  }
  function saveChallengeStats(s) {
    try { localStorage.setItem('shiyun-challenge', JSON.stringify(s)); } catch (e) {}
  }

  function initChallenge() {
    var stemEl = document.getElementById('quiz-stem');
    var optionsEl = document.getElementById('quiz-options');
    if (!stemEl || !optionsEl) return;

    if (window.QUIZ_POOL_DATA && window.QUIZ_POOL_DATA.length) {
      buildQuizPool();
      bootChallenge(stemEl, optionsEl);
      return;
    }
    /* 题库分块：随机挑一块再开局（懒加载，单次约 3MB） */
    stemEl.textContent = '题库加载中…';
    var info = window.QUIZ_POOL_INFO || { chunks: 4 };
    var no = Math.floor(Math.random() * info.chunks);
    loadScript('assets/data/quizpool/p' + no + '.js?v=20260909a', function (ok) {
      if (!ok) {
        stemEl.textContent = '题库加载失败，请刷新重试';
        return;
      }
      buildQuizPool();
      bootChallenge(stemEl, optionsEl);
    });
  }

  function bootChallenge(stemEl, optionsEl) {
    if (!QUIZ_POOL.length) {
      stemEl.textContent = '题库为空，请稍后重试';
      return;
    }

    var st = { mode: 'fill', deck: [], index: 0, streak: 0, done: 0, correct: 0, wrong: 0, seconds: 0, answered: false };
    var stats = loadChallengeStats();

    var indexEl = document.getElementById('quiz-index');
    var sourceEl = document.getElementById('quiz-source');
    var feedbackEl = document.getElementById('quiz-feedback');
    var feedbackText = document.getElementById('quiz-feedback-text');
    var nextBtn = document.getElementById('quiz-next');
    var restartBtn = document.getElementById('quiz-restart');
    var timerEl = document.getElementById('quiz-timer');
    var streakEl = document.getElementById('score-streak');
    var bestEl = document.getElementById('score-best');
    var accuracyEl = document.getElementById('score-accuracy');
    var progressText = document.getElementById('daily-progress-text');
    var progressFill = document.getElementById('daily-progress-fill');
    var levelList = document.getElementById('level-list');

    /* --- 闯关高分榜：自己的成绩驱动排名，即时刷新；诗友分数为本地模拟动态 ---
     * （纯静态站没有服务器，真实的多人实时榜需要后端支持，见页面说明） */
    var rankListEl = document.getElementById('rank-list');
    var rankUpdatedEl = document.getElementById('rank-updated');
    var RIVALS = [
      { name: '沈砚秋', score: 90 }, { name: '陆栖迟', score: 80 },
      { name: '白也', score: 70 }, { name: '顾清商', score: 60 },
      { name: '江晚吟', score: 50 }
    ];
    var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];
    function renderRank() {
      if (!rankListEl) return;
      var rows = RIVALS.map(function (r) { return { name: r.name, score: r.score, me: false }; });
      rows.push({ name: CURRENT_USER || '我', score: stats.bestScore || 0, me: true });
      rows.sort(function (a, b) { return b.score - a.score; });
      rankListEl.innerHTML = rows.map(function (r, i) {
        return (
          '<div class="rank-row' + (r.me ? ' rank-row--me' : '') + '">' +
          '<span>' + (CN_NUM[i] || (i + 1)) + '　' + esc(r.name) + (r.me ? '（我）' : '') + '</span>' +
          '<span>' + r.score + ' 分</span></div>'
        );
      }).join('');
      if (rankUpdatedEl) {
        var d = new Date();
        rankUpdatedEl.textContent = '更新于 ' + ('0' + d.getHours()).slice(-2) + ':' +
          ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
      }
    }
    /* 诗友动态：每 20 秒随机一位小幅涨分，榜单自动重排 */
    setInterval(function () {
      var r = pickOne(RIVALS);
      if (r && r.score < 100 && Math.random() < 0.6) {
        r.score = Math.min(100, r.score + 10);
        renderRank();
      }
    }, 20000);
    /* 跨标签页同步：别的标签页出了分，这里跟着变 */
    window.addEventListener('storage', function (e) {
      if (e.key !== 'shiyun-challenge') return;
      stats = loadChallengeStats();
      updateScore();
      renderRank();
    });

    function newDeck() {
      st.deck = [];
      if (st.mode === 'exam' || st.mode === 'hot') {
        var pool = shuffleArr(BANK_POOLS[st.mode].slice());
        var n = Math.min(QUIZ_PER_RUN, pool.length);
        for (var i = 0; i < n; i++) {
          var poem = pool[i];
          var types = poem.lines.length >= 3 && poem.lines.length <= 8 ? ['fill', 'chain', 'recite'] : ['fill', 'chain'];
          st.deck.push(QUIZ_MAKER[pickOne(types)](BANK_POOLS[st.mode], poem));
        }
      } else {
        for (var j = 0; j < QUIZ_PER_RUN; j++) st.deck.push(QUIZ_MAKER[st.mode](QUIZ_POOL));
      }
      st.index = 0;
    }

    function render() {
      var q = st.deck[st.index];
      stemEl.textContent = q.stem;
      sourceEl.textContent = q.source;
      indexEl.textContent = '\u7B2C ' + (st.index + 1) + ' / ' + st.deck.length + ' \u9898 \u00B7 ' + MODE_NAME[st.mode];
      feedbackEl.hidden = true;
      nextBtn.hidden = true;
      st.answered = false;

      var letters = ['A', 'B', 'C', 'D'];
      optionsEl.innerHTML = q.options
        .map(function (opt, i) {
          return (
            '<button class="option" data-opt="' + i + '">' +
            '<span>' + letters[i] + '\u3000' + opt + '</span>' +
            '<span class="mark"></span>' +
            '</button>'
          );
        })
        .join('');
      renderLevels();
    }

    function renderLevels() {
      if (!levelList) return;
      levelList.innerHTML = st.deck
        .map(function (q, i) {
          var cls = i < st.index ? 'level-row is-done' : i === st.index ? 'level-row is-current' : 'level-row';
          var label = i < st.index ? '\u5DF2\u4F5C\u7B54' : i === st.index ? '\u8FDB\u884C\u4E2D' : '\u5F85\u4F5C\u7B54';
          return '<div class="' + cls + '"><span class="name">\u7B2C ' + (i + 1) + ' \u9898</span><span class="state">' + label + '</span></div>';
        })
        .join('');
    }

    function showResult() {
      var score = st.correct * 10;
      stemEl.hidden = true;
      sourceEl.hidden = true;
      optionsEl.hidden = true;
      feedbackEl.hidden = true;
      nextBtn.hidden = true;
      restartBtn.hidden = true;
      var resultEl = document.getElementById('quiz-result');
      var scoreEl = document.getElementById('result-score');
      var detailEl = document.getElementById('result-detail');
      var commentEl = document.getElementById('result-comment');
      if (scoreEl) scoreEl.textContent = String(score);
      if (detailEl) detailEl.textContent = '答对 ' + st.correct + ' 题 · 答错 ' + st.wrong + ' 题 · 满分 100';
      if (commentEl) {
        commentEl.textContent = score === 100 ? '满分！胸有成竹，出口成章。'
          : score >= 80 ? '很不错，距满分仅一步之遥。'
          : score >= 60 ? '根基已稳，勤加练习更上层楼。'
          : '诗海无涯，回头再战。';
      }
      if (resultEl) resultEl.hidden = false;
      if (score > (stats.bestScore || 0)) {
        stats.bestScore = score;
        saveChallengeStats(stats);
      }
      updateScore();
      renderRank();   /* 得分变化 → 榜单立即重排 */
    }

    function hideResult() {
      var resultEl = document.getElementById('quiz-result');
      if (resultEl) resultEl.hidden = true;
      stemEl.hidden = false;
      sourceEl.hidden = false;
      optionsEl.hidden = false;
    }

    function updateScore() {
      if (streakEl) streakEl.textContent = st.streak + ' \u9898';
      if (st.streak > stats.best) {
        stats.best = st.streak;
        saveChallengeStats(stats);
      }
      if (bestEl) bestEl.textContent = String(stats.best);
      if (accuracyEl) {
        accuracyEl.textContent = stats.total ? Math.round((stats.correct / stats.total) * 100) + '%' : '\u2014';
      }
      var bestScoreEl = document.getElementById('score-best-score');
      if (bestScoreEl) bestScoreEl.textContent = String(stats.bestScore || 0);
      ['fill', 'chain', 'recite', 'exam', 'hot'].forEach(function (m) {
        var el = document.getElementById('mode-count-' + m);
        if (el) el.textContent = '\u5DF2\u8FC7 ' + (stats.done[m] || 0) + ' \u9898';
      });
      if (progressText) progressText.textContent = '\u4ECA\u65E5\u8FDB\u5EA6 ' + Math.min(st.done, QUIZ_PER_RUN) + ' / ' + QUIZ_PER_RUN + ' \u9898';
      if (progressFill) progressFill.style.width = Math.min(st.done / QUIZ_PER_RUN, 1) * 100 + '%';
    }

    optionsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.option');
      if (!btn || st.answered) return;
      st.answered = true;

      var q = st.deck[st.index];
      var picked = parseInt(btn.getAttribute('data-opt'), 10);
      var ok = picked === q.answer;

      optionsEl.querySelectorAll('.option').forEach(function (b) {
        b.disabled = true;
        var i = parseInt(b.getAttribute('data-opt'), 10);
        if (i === q.answer) {
          b.classList.add('is-correct');
          b.querySelector('.mark').textContent = '\u2713';
        } else if (i === picked) {
          b.classList.add('is-wrong');
          b.querySelector('.mark').textContent = '\u2717';
        }
      });

      if (ok) { st.streak += 1; st.correct += 1; }
      else { st.streak = 0; st.wrong += 1; }
      st.done += 1;
      stats.total += 1;
      stats.done[st.mode] = (stats.done[st.mode] || 0) + 1;
      if (ok) stats.correct += 1;
      saveChallengeStats(stats);
      updateScore();

      feedbackText.textContent = ok ? '\u7B54\u5BF9\u4E86\uFF01' + q.tip : '\u518D\u60F3\u60F3\u2014\u2014\u6B63\u786E\u7B54\u6848\u5DF2\u6807\u51FA\u3002' + q.tip;
      feedbackEl.hidden = false;
      nextBtn.hidden = false;
      nextBtn.textContent = st.index + 1 < st.deck.length ? '下一题' : '查看结算';
      restartBtn.hidden = false;
    });

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (st.index + 1 < st.deck.length) {
          st.index += 1;
          render();
        } else {
          showResult();
        }
      });
    }
    if (restartBtn) {
      restartBtn.addEventListener('click', function () {
        st.streak = 0;
        st.done = 0;
        st.correct = 0;
        st.wrong = 0;
        newDeck();
        updateScore();
        render();
      });
    }

    var resultRestartBtn = document.getElementById('result-restart');
    if (resultRestartBtn) {
      resultRestartBtn.addEventListener('click', function () {
        st.streak = 0;
        st.done = 0;
        st.correct = 0;
        st.wrong = 0;
        hideResult();
        newDeck();
        updateScore();
        render();
      });
    }

    var modeRow = document.getElementById('mode-row');
    if (modeRow) {
      modeRow.addEventListener('click', function (e) {
        var cardEl = e.target.closest('[data-mode]');
        if (!cardEl) return;
        modeRow.querySelectorAll('.mode-card').forEach(function (c) { c.classList.remove('is-active'); });
        cardEl.classList.add('is-active');
        st.mode = cardEl.getAttribute('data-mode');
        st.correct = 0;
        st.wrong = 0;
        hideResult();
        newDeck();
        render();
      });
    }

    if (timerEl) {
      setInterval(function () {
        st.seconds += 1;
        var m = Math.floor(st.seconds / 60);
        var s = st.seconds % 60;
        timerEl.textContent = '\u7528\u65F6 ' + (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
      }, 1000);
    }

    newDeck();
    render();
    updateScore();
    renderRank();
  }


  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initTabbar();
    initMobileMenu();
    initAuthTabs();
    initAuthForm();
    initAuthUI();
    initHome();

    /* 云端会话恢复：SDK 就绪后若发现已登录会话，补画顶栏与信息流 */
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.auth.onChange(function () {
        initAuthUI();
        renderFeed();
      });
    }

    /* 需要索引的页面：先载入第 0 片（1.7MB）立即出内容，再初始化 */
    var needsIndex =
      document.getElementById('poem-list') ||
      document.getElementById('study-title') ||
      document.getElementById('post-list');

    function booted() {
      initLibrary();
      initCommunity();
      initStudy();
      initChallenge();
    }
    if (needsIndex) IndexStore.boot(booted);
    else booted();
  });
})();
