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

  /* 骨架屏：等云端数据时用同形灰块占位，避免页面空荡得像卡住。
   * ⚠️ 只画形状，不放任何文字或数字 —— 否则会被误读成真实内容（PRD 第四十条）。
   * 视觉装饰对读屏用户无意义，故配一句 .sr-only 文字说明进度。 */
  function skeletonCards(n, label) {
    var one =
      '<div class="skeleton-card" aria-hidden="true">' +
        '<div class="skel-head">' +
          '<div class="skel-avatar"></div>' +
          '<div class="skel-line skel-line--xs" style="max-width:120px;"></div>' +
        '</div>' +
        '<div class="skel-line skel-line--lg"></div>' +
        '<div class="skel-line skel-line--md"></div>' +
        '<div class="skel-line skel-line--sm"></div>' +
      '</div>';
    var out = '';
    for (var i = 0; i < (n || 2); i++) out += one;
    return '<div class="skeleton-list">' +
      '<span class="sr-only">' + esc(label || '内容载入中') + '</span>' +
      out + '</div>';
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

  /* 学习进度 / 收藏（存诗词 id 数组）
   * 存储策略（A 方案）：
   *   · 未登录：只写 localStorage，随开随用，不强制注册
   *   · 已登录：写 localStorage 的同时同步到 Supabase，换设备登录即恢复
   *   读取永远先看本地（快、离线可用），登录后由 syncFromCloud() 补齐云端数据并合并 */
  var learnedIds = store('shici_learned', []);
  var favIds = store('shici_favs', []);
  function isLearned(id) { return learnedIds.indexOf(id) !== -1; }
  function isFav(id) { return favIds.indexOf(id) !== -1; }
  function toggleIn(list, id) {
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    return list;
  }

  /* 是否处于云端模式（未登录也算云端模式，只是不推送） */
  function cloudMode() {
    return !!(window.Cloud && window.Cloud.mode && window.Cloud.mode() === 'cloud');
  }
  function loggedIn() {
    return !!(window.Cloud && window.Cloud.auth && window.Cloud.auth.userId());
  }

  /* 登录后：拉云端数据，与本地合并（取并集），并把本地独有的推上去
   * 这样「先本地用了一阵、后来才登录」的用户，进度不会丢 */
  function syncUserData() {
    if (!loggedIn()) return;

    window.Cloud.learned.list(function (cloudIds) {
      if (cloudIds) {
        var before = learnedIds.length;
        cloudIds.forEach(function (id) {
          if (id != null && learnedIds.indexOf(id) === -1) learnedIds.push(id);
        });
        /* 本地有、云端没有的 → 推上去 */
        var toPush = learnedIds.filter(function (id) { return cloudIds.indexOf(id) === -1; });
        if (toPush.length) window.Cloud.learned.merge(toPush);
        if (learnedIds.length !== before) {
          saveStore('shici_learned', learnedIds);
          if (window.__refreshLibrary) window.__refreshLibrary();
        }
      }
    });

    window.Cloud.favs.list(function (cloudIds) {
      if (cloudIds) {
        var before = favIds.length;
        cloudIds.forEach(function (id) {
          if (id != null && favIds.indexOf(id) === -1) favIds.push(id);
        });
        var toPush = favIds.filter(function (id) { return cloudIds.indexOf(id) === -1; });
        if (toPush.length) window.Cloud.favs.merge(toPush);
        if (favIds.length !== before) {
          saveStore('shici_favs', favIds);
          if (window.__refreshLibrary) window.__refreshLibrary();
        }
      }
    });

    /* 成绩：云端更高时用云端的 */
    window.Cloud.scores.get(function (cs) {
      if (!cs) return;
      var local = loadChallengeStats();
      var merged = {
        bestScore: Math.max(local.bestScore || 0, cs.bestScore || 0),
        bestStreak: Math.max(local.bestStreak || 0, cs.bestStreak || 0),
        done: Math.max(local.done || 0, cs.done || 0),
        correct: Math.max(local.correct || 0, cs.correct || 0)
      };
      if (merged.bestScore !== (local.bestScore || 0)) {
        saveChallengeStats(merged);
        if (typeof window.__refreshChallenge === 'function') window.__refreshChallenge();
      }
    });

    /* 错题本：与云端取并集（同一题的重复记录保留时间戳更晚的那条）
     * 本地独有的推上云；云端独有的落回本地。合完刷新错题面板与「我的」页。 */
    if (window.Cloud.wrongbook) window.Cloud.wrongbook.list(function (cloudItems) {
      if (!cloudItems) return;
      var local = loadWrongBook();
      var byKey = {};
      function take(it) {
        var k = wrongKeyOf(it);
        var prev = byKey[k];
        if (!prev || (it.ts || 0) > (prev.ts || 0)) byKey[k] = it;
      }
      local.forEach(take);
      cloudItems.forEach(take);

      var mergedArr = Object.keys(byKey).map(function (k) { return byKey[k]; })
        .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })
        .slice(0, WRONG_MAX);

      if (mergedArr.length !== local.length) {
        saveWrongBook(mergedArr);
        renderWrongBook();
        if (typeof window.__refreshMe === 'function') window.__refreshMe();
      }

      /* 云端缺的那些（含本地新增）推上去 */
      var cloudKeys = {};
      cloudItems.forEach(function (it) { cloudKeys[wrongKeyOf(it)] = true; });
      var toPush = mergedArr.filter(function (it) { return !cloudKeys[wrongKeyOf(it)]; });
      if (toPush.length) window.Cloud.wrongbook.merge(toPush);
    });
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
            /* 注册即登录（未开启邮箱验证时）→ 合并本地已有数据 */
            if (!(r && r.needConfirm)) setTimeout(syncUserData, 0);
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
            /* 登录成功 → 立即合并本地与云端数据（不等 onChange，避免时序问题） */
            if (!err) setTimeout(syncUserData, 0);
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

  /* 当前用户：登录后为笔名；未登录为 null（不再默认站长，否则人人都有审核权） */
  var CURRENT_USER = Auth.current() || null;

  /* ---------- 审核权限 ----------
   * 规则：审核权默认只有站长（config.js 的 admins 邮箱）拥有，
   *       且只有站长能把审核权授予他人（被授权人可审核，但不能再授权）。
   * 判断依据一律用「邮箱」——昵称可重名，邮箱是账号唯一标识。 */
  function myEmail() {
    if (window.Cloud && window.Cloud.auth && window.Cloud.auth.current) {
      var p = window.Cloud.auth.current();
      if (p && p.account) return String(p.account).toLowerCase();
    }
    /* 本地模式：会话里存的就是账号（邮箱或手机号） */
    var s = store(SKEY, null);
    return (s && s.account) ? String(s.account).toLowerCase() : '';
  }
  function adminEmails() {
    var cfg = window.SHICI_CONFIG || {};
    return (cfg.admins || []).map(function (e) { return String(e).toLowerCase(); });
  }
  /* 是否站长（管理员） */
  function isAdmin() {
    var me = myEmail();
    return !!me && adminEmails().indexOf(me) !== -1;
  }
  /* 缓存云端拉回来的审核人名单，避免每次渲染都请求 */
  var reviewerEmails = null;
  /* 是否具备审核资格：站长 或 在授权名单内 */
  function canReview() {
    if (!CURRENT_USER) return false;   /* 未登录一律无审核权 */
    if (isAdmin()) return true;
    return !!(reviewerEmails && myEmail() && reviewerEmails.indexOf(myEmail()) !== -1);
  }

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

  /* 宽匹配：题库来源的 title/author 与诗词库底本可能不完全一致
   * （如题库作「黄鹤楼」而库内为「黄鹤楼·崔颢」这一类），做三级降级：
   *   ① 标题全等 + 作者全等 → ② 标题全等（作者忽略）→ ③ 标题互含（同作者） */
  function findPoemLoose(title, author) {
    if (!title) return null;
    var list = loadedPoems();
    var i, p, t = String(title).trim(), a = author ? String(author).trim() : '';
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (p.title === t && (!a || p.author === a)) return p;
    }
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (p.title === t) return p;
    }
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if ((!a || p.author === a) && (p.title.indexOf(t) !== -1 || t.indexOf(p.title) !== -1)) return p;
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

  /* 移动端汉堡菜单
   * 要点：① 同步 aria-expanded（无障碍，PRD 第二十八条）
   *      ② 点了菜单里的链接要自动收起 —— 否则跳转后菜单仍敞着遮住页面
   *      ③ 点菜单外 / 按 Esc 关闭 —— 手机上没有「点空白处」的习惯，但 Esc 对
   *         外接键盘和读屏用户是必需出口 */
  function initMobileMenu() {
    var btn = document.querySelector('[data-menu-toggle]');
    var menu = document.querySelector('.mobile-menu');
    if (!btn || !menu) return;

    function setOpen(open) {
      menu.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      /* 读屏用户听到的是「展开菜单 / 收起菜单」，与视觉状态一致 */
      btn.setAttribute('aria-label', open ? '收起菜单' : '打开菜单');
    }
    /* 初始态：菜单默认收起 */
    if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!menu.classList.contains('is-open'));
    });

    /* 点菜单里的链接 → 立即收起（页面正在跳转，先给出视觉反馈） */
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    /* 点菜单与按钮之外的区域 → 收起 */
    document.addEventListener('click', function (e) {
      if (!menu.classList.contains('is-open')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });

    /* Esc → 收起并把焦点还给按钮（键盘 / 读屏用户出口） */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!menu.classList.contains('is-open')) return;
      setOpen(false);
      btn.focus();
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
          hint(regForm, msg || '注册成功，正在进入你的空间…', true);
          setTimeout(function () { location.href = 'me.html'; }, 700);
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
          setTimeout(function () { location.href = 'me.html'; }, 700);
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
          '<a class="btn btn--primary btn--block" href="me.html">进入我的空间</a>' +
          '<p class="form-hint" style="margin-top:16px;">' +
          '<a href="index.html" style="margin-right:16px;">回到首页</a>' +
          '<a data-logout style="cursor:pointer;">退出登录</a></p>' +
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

    /* 「我的」页的顶栏专用结构：两个容器按登录态互斥显隐 */
    var accBox = document.getElementById('header-account');
    var guestBox = document.getElementById('header-guest');
    if (accBox || guestBox) {
      if (name) {
        if (accBox) {
          accBox.hidden = false;
          var hn = document.getElementById('header-account-name');
          if (hn) hn.textContent = name;
          var hs = document.getElementById('header-signout');
          if (hs && !hs.__bound) {
            hs.__bound = 1;
            hs.addEventListener('click', function (e) {
              e.preventDefault();
              Auth.logout(function () { location.reload(); });
            });
          }
        }
        if (guestBox) guestBox.hidden = true;
      } else {
        if (accBox) accBox.hidden = true;
        if (guestBox) guestBox.hidden = false;
      }
    }

    if (!name) return;
    /* 顶栏登录态：笔名本身必须可点，直接进「我的」。
     * ⚠️ 早期版本这里是个纯 <span>，用户看到「你好，江心屿」却点不动，
     *    只能绕道移动端 tabbar 才能进个人中心 —— 不要再改回不可点。
     *
     * ⚠️ 也必须用「就地替换」而不是整体 innerHTML 重写：
     *    library / challenge 的同一个容器里还放着搜索图标，
     *    整体重写会把它们一起抹掉。这里只摘掉指向 auth.html 的那两条链接。 */
    document.querySelectorAll('.header-actions .only-desktop').forEach(function (box) {
      var authLinks = box.querySelectorAll('a[href="auth.html"]');
      if (!authLinks.length) return;
      var onMe = /me\.html$/.test(location.pathname);
      var userLink = document.createElement('a');
      userLink.className = 'auth-user';
      userLink.href = 'me.html';
      if (onMe) userLink.setAttribute('aria-current', 'page');
      userLink.setAttribute('data-user-entry', '');
      userLink.innerHTML =
        '<span class="auth-user-avatar">' + esc(name[0] || '诗') + '</span>' +
        '<span class="auth-user-name">' + esc(name) + '</span>';
      var outLink = document.createElement('a');
      outLink.className = 'btn btn--ghost';
      outLink.style.cssText = 'padding:9px 20px;cursor:pointer;';
      outLink.setAttribute('data-logout', '');
      outLink.textContent = '退出';
      /* 用第一条 auth 链接的位置当锚点，其余 auth 链接与旧登出链接一并移除 */
      var anchor = authLinks[0];
      box.insertBefore(userLink, anchor);
      box.insertBefore(outLink, anchor);
      authLinks.forEach(function (a) { a.parentNode && a.parentNode.removeChild(a); });
      var stale = box.querySelectorAll('[data-logout]');
      Array.prototype.forEach.call(stale, function (n) {
        if (n !== outLink && n.parentNode) n.parentNode.removeChild(n);
      });
    });
    /* 移动菜单：登录后把「登录 / 注册」那条换成「退出登录（笔名）」，
     * 但「我的」那一项保持原样可点 —— 两者是并列的两条，别合并。 */
    document.querySelectorAll('.mobile-menu a[href="auth.html"]').forEach(function (a) {
      a.textContent = '退出登录（' + name + '）';
      a.removeAttribute('href');
      a.setAttribute('data-logout', '');
    });
    /* 移动菜单里的「我的」补上笔名，让用户一眼确认身份 */
    document.querySelectorAll('.mobile-menu a[data-tab="me"]').forEach(function (a) {
      if (a.__named) return;
      a.__named = 1;
      a.textContent = '我的 · ' + name;
    });
  }

  /* ---------- 「我的」个人中心 ----------
   * 这一页只做「聚合呈现」：所有数据都来自既有存储（学习进度 / 收藏 / 成绩 / 错题 / 我的分享），
   * 不新造任何统计口径，也不编造任何数字（PRD 第四十条）。
   * 未登录同样可用 —— 本地存储的数据照样展示，只是提示「登录后不丢」。 */
  function initMe() {
    var subtitle = document.getElementById('me-subtitle');
    if (!subtitle) return;   /* 不是「我的」页，直接退出 */

    /* 云端数据同步完成后重画统计数字（由 syncUserData 调用）。
     * 与 __refreshChallenge 同构：同步是异步的，回来时页面已经画过一次了，
     * 必须有个入口让数字跟上。没有这个钩子，错题数会一直停着同步前的旧值。 */
    window.__refreshMe = function () { initMe(); };

    var name = CURRENT_USER || Auth.current() || null;
    var guestCard = document.getElementById('me-guest-card');
    var accountCard = document.getElementById('me-account-card');

    /* --- 1. 账号区：登录 → 账号卡；未登录 → 提示卡 --- */
    if (name) {
      if (accountCard) accountCard.hidden = false;
      if (guestCard) guestCard.hidden = true;
      var nameEl = document.getElementById('me-name');
      if (nameEl) nameEl.textContent = name;
      var avEl = document.getElementById('me-avatar');
      if (avEl) avEl.textContent = name[0] || '诗';
      var accLine = document.getElementById('me-account-line');
      if (accLine) {
        var mail = myEmail();
        accLine.textContent = mail ? mail : '本地账号（仅本机有效）';
      }
      subtitle.textContent = name + ' 的诗词学习空间';
    } else {
      if (guestCard) guestCard.hidden = false;
      if (accountCard) accountCard.hidden = true;
      subtitle.textContent = '你的诗词学习空间';
    }

    /* --- 2. 四个数字卡 --- */
    var learned = learnedIds.length;
    var favs = favIds.length;
    var st = loadChallengeStats();
    var wrong = loadWrongBook().length;

    setNum('me-stat-learned', learned);
    setNum('me-stat-favs', favs);
    setNum('me-stat-score', st.bestScore || 0);
    setNum('me-stat-wrong', wrong);

    /* 数字为 0 时给一句「怎么才会有」的提示，避免冷冰冰的 0 */
    setHint('me-stat-learned-hint', learned
      ? '已加入学习记录的篇目'
      : '在课堂页点「打卡」会记在这里');
    setHint('me-stat-favs-hint', favs
      ? '收藏的篇目，随时回看'
      : '收藏喜欢的篇目，随时回看');
    setHint('me-stat-score-hint', st.bestScore
      ? '挑战闯关的历史最高分'
      : '还没有成绩，去闯一关');
    setHint('me-stat-wrong-hint', wrong
      ? '错题本里的题，等你复习'
      : '答错的题会自动收进错题本');

    /* --- 3. 右侧栏 --- */
    setText('me-link-wrong', wrong + ' 题 →');
    setText('me-side-score', String(st.bestScore || 0));
    setText('me-side-streak', String(st.best || 0));
    /* 正确率：只统计真正答过的题（total 为 0 时显示占位符，不能显示 100%） */
    var answered = st.total || 0;
    setText('me-side-accuracy', answered > 0
      ? Math.round((st.correct || 0) / answered * 100) + '%'
      : '—');
    setText('me-side-login', name ? (myEmail() || '本地账号') : '未登录');
    setText('me-side-store', loggedIn() ? '云端同步' : '本机');

    /* --- 4. 我的分享：从全站信息流里筛出自己发布的 --- */
    var postsBox = document.getElementById('me-posts');
    if (postsBox && name) {
      postsBox.innerHTML = skeletonCards(2, '正在载入你的分享');
      loadFeed(function (all) {
        var mine = all.filter(function (p) { return p.author === name; });
        if (!mine.length) {
          postsBox.innerHTML =
            '<div class="empty-state">' +
            '<p style="margin:0 0 14px;">你还没有分享过作品。读到喜欢的一首，或写下自己的句子。</p>' +
            '<a class="btn btn--primary" href="community.html">去社区分享</a>' +
            '</div>';
          return;
        }
        postsBox.innerHTML = mine.map(function (p) { return postCard(p, true); }).join('');
        fillClassicBodies(postsBox);
      });
    } else if (postsBox) {
      postsBox.innerHTML =
        '<div class="empty-state">' +
        '<p style="margin:0 0 14px;">登录后就能在这里看到自己发布过的分享。</p>' +
        '<a class="btn btn--primary" href="auth.html">登录 / 注册</a>' +
        '</div>';
    }

    /* 退出登录（页内按钮；顶栏的退出走全局委托） */
    var outBtn = document.getElementById('me-signout');
    if (outBtn) outBtn.addEventListener('click', function () {
      Auth.logout(function () { location.reload(); });
    });
  }

  /* 「我的」页两个小工具：找不到元素就静默跳过，不抛错 */
  function setNum(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(v);
  }
  function setHint(id, t) {
    var el = document.getElementById(id);
    if (el) el.textContent = t;
  }
  function setText(id, t) {
    var el = document.getElementById(id);
    if (el) el.textContent = t;
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

    /* 数据条：统一从 SITE_STATS 取真实统计（PRD 第十条：禁止硬编码）
     * 兜底链：SITE_STATS → FEATURED_STATS → 索引元信息 */
    var SS = window.SITE_STATS || {};
    var fstats = window.FEATURED_STATS || { poems: IDX_META.total || 0, authors: 0 };
    var statPoems = document.getElementById('stat-poems');
    var statAuthors = document.getElementById('stat-authors');
    var statDynasties = document.getElementById('stat-dynasties');
    var statGenres = document.getElementById('stat-genres');
    var fmt = function (n) { return (n || 0).toLocaleString('en-US'); };
    if (statPoems) statPoems.textContent = fmt(SS.poems || fstats.poems);
    if (statAuthors) statAuthors.textContent = fmt(SS.authors || fstats.authors);
    if (statDynasties) statDynasties.textContent = String(SS.dynasties || '');
    if (statGenres) statGenres.textContent = String(SS.genres || '');

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

  /* ---------- 诗词库：搜索历史 ----------
   * 只存关键词（本地），最多 8 条，去重且最新的排最前。
   * 纯辅助功能，不进云端 —— 换设备后重打一次即可，不值得为它增加一张表。 */
  var HIST_KEY = 'shici_search_history';
  var HIST_MAX = 8;

  function loadHistory() {
    try {
      var a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x; }) : [];
    } catch (e) { return []; }
  }
  function pushHistory(kw) {
    kw = String(kw || '').trim();
    /* 太短的关键词（单字）记了也没用，反而挤占位置 */
    if (kw.length < 2) return;
    var a = loadHistory().filter(function (x) { return x !== kw; });
    a.unshift(kw);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(a.slice(0, HIST_MAX))); } catch (e) {}
    renderHistory();
  }
  function clearHistory() {
    try { localStorage.removeItem(HIST_KEY); } catch (e) {}
    renderHistory();
  }
  function renderHistory() {
    var row = document.getElementById('history-row');
    var box = document.getElementById('history-chips');
    if (!row || !box) return;
    var a = loadHistory();
    /* 输入框已有内容时不显示，避免和当前检索动作抢注意力 */
    var input = document.getElementById('library-search');
    var typing = !!(input && input.value.trim());
    if (!a.length || typing) { row.hidden = true; return; }
    box.innerHTML = a.map(function (kw) {
      return '<span class="chip" data-history="' + esc(kw) + '">' + esc(kw) + '</span>';
    }).join('');
    row.hidden = false;
  }

  function initLibrary() {
    if (!document.getElementById('poem-list')) return;

    /* 统计行：统一从 SITE_STATS 取真实数字（PRD 第十条） */
    var statLine = document.getElementById('library-stat-line');
    if (statLine) {
      var SS = window.SITE_STATS || {};
      var poems = SS.poems || (window.POEM_INDEX_META && window.POEM_INDEX_META.total) || 0;
      if (poems) {
        statLine.textContent = poems.toLocaleString('en-US') + ' 首 · ' +
          (SS.authors || 0).toLocaleString('en-US') + ' 位诗人';
      } else {
        statLine.textContent = '历代诗词总集';
      }
    }

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
        renderHistory();   /* 开始打字就收起历史行 */
      });
      /* 失焦时如果框是空的，把历史行放回来 */
      input.addEventListener('blur', function () { setTimeout(renderHistory, 150); });
    }

    var form = document.getElementById('library-search-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        /* 回车才算「一次检索」——边打边搜会污染历史，只记完整输入的结果 */
        if (input && input.value.trim()) pushHistory(input.value.trim());
      });
    }

    /* 历史记录点击复用 */
    var histChips = document.getElementById('history-chips');
    if (histChips) {
      histChips.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-history]');
        if (!chip || !input) return;
        var kw = chip.getAttribute('data-history');
        input.value = kw;
        state.keyword = kw;
        state.textHits = null;
        state.page = 1;
        renderPoems();
        renderHistory();
      });
    }
    var histClear = document.getElementById('history-clear');
    if (histClear) histClear.addEventListener('click', clearHistory);
    renderHistory();

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
          pushHistory(state.keyword);
        }
      });
    });
  }

  /* ---------- 6. 社区广场：分享 + 审核 ---------- */
  /* 帖子: {id, kind:'classic'|'original', title, text, poemId, author, ts, status, likes}
   * 说明：不设任何种子/示例帖子 —— 社区内容全部来自真实用户（PRD 第四十条） */

  function getPosts() { return store('shici_posts', []); }
  function setPosts(posts) { saveStore('shici_posts', posts); }

  /* ---------- 审核人名单（云端权威） ----------
   * 规则：站长（config.admins 里的邮箱）天然是审核人，不占名额、不可被移除。
   *       被授权的审核人存在云端 reviewers 表，只有站长能增删（RLS 兜底）。
   *       早期版本把名单存在 localStorage 且「第一个到访者自动成为审核人」，
   *       那等于把审核权送给任何人，已废弃。 */
  var ADMIN_NAME = '站长';

  /* 拉取云端审核人邮箱（邮箱是账号唯一标识，昵称会重名）→ 缓存到 reviewerEmails */
  function loadReviewers(cb) {
    if (!window.Cloud || !window.Cloud.reviewers) { if (cb) cb(); return; }
    window.Cloud.reviewers.list(function (emails) {
      if (emails) reviewerEmails = emails.map(function (e) { return String(e).toLowerCase(); });
      if (cb) cb();
    });
  }

  /* 面板里展示用：站长 + 云端授权名单 */
  function reviewerRows() {
    var rows = [{ email: '', name: ADMIN_NAME, me: isAdmin(), admin: true }];
    var me = myEmail();
    (reviewerEmails || []).forEach(function (e) {
      /* 站长自己的邮箱不重复列 */
      if (adminEmails().indexOf(e) !== -1) return;
      rows.push({ email: e, name: e, me: e === me, admin: false });
    });
    return rows;
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

  /* 合并信息流：云端（人人可见）+ 本机发布 */
  function loadFeed(cb) {
    var local = getPosts().filter(function (p) {
      return p.status === 'approved' || p.author === CURRENT_USER;
    });
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.posts.list(function (rows) {
        var cloud = (rows || []).map(normalizeCloudPost);
        var seen = {};
        var all = cloud.concat(local).filter(function (p) {
          if (!p || seen[p.id]) return false;
          seen[p.id] = 1;
          return true;
        }).sort(function (a, b) { return b.ts - a.ts; });
        cb(all);
      });
    } else {
      var seen2 = {};
      var all2 = local.filter(function (p) {
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
    list.innerHTML = skeletonCards(3, '正在载入诗友分享');
    /* 云端模式：所有访客（含未登录）都能看到全站已通过的分享 */
    loadFeed(function (all) {
      list.innerHTML = all.map(function (p) { return postCard(p); }).join('') ||
        '<div class="empty-state">' +
        '<p style="margin:0 0 14px;">这里还很安静。分享第一首诗，或把喜欢的经典推荐给同好。</p>' +
        '<button class="btn btn--primary" data-open-compose>发布分享</button>' +
        '</div>';
      list.querySelectorAll('[data-like]').forEach(bindLike);
      bindCommentToggles(list);
      fillClassicBodies(list);
      var composeBtn = list.querySelector('[data-open-compose]');
      if (composeBtn) composeBtn.addEventListener('click', function () {
        var trigger = document.querySelector('[data-compose-open]');
        if (trigger) trigger.click();
        else {
          var card = document.getElementById('compose');
          if (card) { card.hidden = false; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }
      });
    });
  }

  /* 审核面板渲染
   * ⚠️ 待审队列必须读**云端**：帖子存在 Supabase posts 表里，
   *    早期版本这里读 getPosts()（localStorage），而提交写的是云端，
   *    两边不通 → 队列永远是空的。不要再改回本地读取。 */
  function renderModeration() {
    var panel = document.getElementById('moderation-panel');
    if (!panel) return;

    /* 没有审核资格的人，连面板都看不到（不是禁用按钮，是整个不渲染） */
    panel.hidden = !canReview();
    if (panel.hidden) return;

    var queueEl = document.getElementById('moderation-queue');
    var countEl = document.getElementById('moderation-count');

    /* 云端模式：向数据库要待审队列（RLS 会挡下无权限的人） */
    if (window.Cloud && window.Cloud.ready && window.Cloud.posts.pending) {
      if (queueEl) queueEl.innerHTML = skeletonCards(2, '正在载入待审队列');
      window.Cloud.posts.pending(function (rows) {
        if (!rows) {
          /* 拉取失败（如未执行 patch_review_v2.sql）→ 说清楚原因，别假装队列为空 */
          if (queueEl) {
            queueEl.innerHTML =
              '<div class="empty-state">待审队列读取失败。若你是站长，' +
              '请确认已在 Supabase 执行 <code>supabase/patch_review_v2.sql</code>。</div>';
          }
          if (countEl) countEl.textContent = '—';
          return;
        }
        var list = rows.map(normalizeCloudPost);
        if (countEl) countEl.textContent = list.length;
        if (queueEl) {
          queueEl.innerHTML = list.length ? list.map(reviewCard).join('')
            : '<div class="empty-state">审核队列已清空，喝杯茶吧</div>';
          fillClassicBodies(queueEl);
        }
        renderReviewerList();
      });
      return;
    }

    /* 本地模式：帖子本来就存在本机，读本地即可 */
    var local = getPosts().filter(function (p) { return p.status === 'pending'; });
    if (countEl) countEl.textContent = local.length;
    if (queueEl) {
      queueEl.innerHTML = local.length ? local.map(reviewCard).join('')
        : '<div class="empty-state">审核队列已清空，喝杯茶吧</div>';
      fillClassicBodies(queueEl);
    }
    renderReviewerList();
  }

  /* 单条待审卡片的 HTML */
  function reviewCard(p) {
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
  }

  /* 审核人名单 + 授权表单（与队列分开渲染，避免被异步打乱） */
  function renderReviewerList() {
    /* 审核人列表：站长置顶且不可移除 */
    var reviewerList = document.getElementById('reviewer-list');
    if (reviewerList) {
      reviewerList.innerHTML = reviewerRows().map(function (r) {
        var label = r.admin ? '站长' : esc(r.name);
        var tail = r.admin ? '（掌印）' : (r.me ? '（我）' : '');
        /* 只有站长能移除他人；站长本人永远保留 */
        var rm = (isAdmin() && !r.admin)
          ? ' <a data-remove-reviewer="' + esc(r.email) + '" title="移出审核人">×</a>'
          : '';
        return '<span class="chip chip--active">' + label + tail + rm + '</span>';
      }).join('');
    }

    /* 授权表单：只有站长看得到、能提交 */
    var grantBox = document.getElementById('reviewer-grant');
    if (grantBox) grantBox.hidden = !isAdmin();

    var hintEl = document.getElementById('reviewer-hint');
    if (hintEl) {
      hintEl.textContent = isAdmin()
        ? '你是站长，可把审核权授予他人，也可随时收回。'
        : '审核权由站长授予，如被移除则需重新授权。';
    }
  }

  function initCommunity() {
    var feed = document.getElementById('post-list');
    if (!feed) return;

    renderFeed();
    /* 先按「未登录/非站长」渲染（面板默认隐藏），再拉云端名单复渲染一次，
     * 避免网络慢时把审核面板闪给不该看的人 */
    renderModeration();
    loadReviewers(renderModeration);

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

    /* 经典检索：按 诗题/作者 匹配，取前 8 条
     * ⚠️ 全库 89,864 首分 6 片，默认只载入 1 片。
     *    早期版本只搜 loadedPoems()，导致 5/6 的库搜不出来。
     *    这里在检索框获得焦点时就把全库索引后台补齐。 */
    if (searchInput && searchResults) {
      var _allHinted = false;
      function ensureFullIndex() {
        if (_allHinted) return;
        _allHinted = true;
        IndexStore.ensureAll(null, function () {
          /* 全库补齐后，如果框里还有关键词，重搜一次让用户看到完整结果 */
          if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
        });
      }
      searchInput.addEventListener('focus', ensureFullIndex);
      /* 切到「分享经典」模式时也预取，用户开始打字就不必等 */
      document.querySelectorAll('[data-compose-mode="classic"]').forEach(function (c) {
        c.addEventListener('click', ensureFullIndex);
      });

      searchInput.addEventListener('input', function () {
        var kw = searchInput.value.trim();
        picked = null;
        if (!kw) {
          searchResults.innerHTML = '';
          return;
        }
        ensureFullIndex();
        var hits = [];
        var _pool = loadedPoems();
        for (var i = 0; i < _pool.length; i++) {
          var p = _pool[i];
          if (p.title.indexOf(kw) !== -1 || p.author.indexOf(kw) !== -1) hits.push(p);
          if (hits.length >= 8) break;
        }
        /* 索引还在补齐时，把「结果可能不全」如实告诉用户，别让人误以为库里没有 */
        var more = !IndexStore.loadedCount || IndexStore.loadedCount() < IndexStore.totalCount;
        searchResults.innerHTML = hits.length
          ? hits.map(function (p) {
              return (
                '<div class="classic-hit" data-pick="' + p.id + '">' +
                '<strong>' + esc(p.title) + '</strong> · ' + esc(p.author) + '（' + esc(p.dynasty) + '）' +
                '<div class="classic-hit-line">' + esc(p.line) + '</div>' +
                '</div>'
              );
            }).join('') + (more ? '<div class="classic-more">全库仍在载入，结果可能不全…</div>' : '')
          : (more
              ? '<div class="empty-state">全库载入中，稍等再试；或换个更常见的关键词</div>'
              : '<div class="empty-state">库里没搜到，换个关键词</div>');
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
        /* 云端模式：写库。status 由 cloud.js 按 draft.status 决定（= pending），
         * 审核通过后才公开。失败时兜底存本地，至少不丢用户写的内容。 */
        if (window.Cloud && window.Cloud.ready) {
          window.Cloud.posts.create(draft, function (row) {
            if (!row) {
              var fallback = getPosts();
              fallback.push(draft);
              setPosts(fallback);
              var hintFail = document.getElementById('feed-hint');
              if (hintFail) hintFail.textContent = '云端提交失败，已暂存在本机。请检查网络后重试。';
            }
            renderFeed();
            renderModeration();
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

    /* --- 审核操作 ---
     * 云端模式下必须写回 Supabase：早期版本只改 localStorage，
     * 而队列读的是云端，改完刷新就复原（看起来像「点了没反应」）。 */
    var queue = document.getElementById('moderation-queue');
    if (queue) {
      queue.addEventListener('click', function (e) {
        var item = e.target.closest('[data-review]');
        if (!item) return;
        if (!canReview()) return;   /* 无审核权不发请求，省一次必然被拒的往返 */
        var id = item.getAttribute('data-review');
        var next = null;
        if (e.target.closest('[data-approve]')) next = 'approved';
        else if (e.target.closest('[data-reject]')) next = 'rejected';
        else return;

        /* 云端模式：调数据库（RLS 的 posts_update_reviewer 策略兜底） */
        if (window.Cloud && window.Cloud.ready && window.Cloud.posts.setStatus) {
          var btns = item.querySelectorAll('button');
          btns.forEach(function (b) { b.disabled = true; });
          window.Cloud.posts.setStatus(id, next, function (ok) {
            btns.forEach(function (b) { b.disabled = false; });
            if (!ok) {
              var tip = document.getElementById('reviewer-hint');
              if (tip) tip.textContent = '审核失败：请确认已执行 patch_review_v2.sql，且你具备审核权。';
              return;
            }
            renderModeration();
            renderFeed();
          });
          return;
        }

        /* 本地模式：改本机存储 */
        var posts = getPosts();
        var target = null;
        posts.forEach(function (p) { if (p.id === id) target = p; });
        if (!target) return;
        target.status = next;
        setPosts(posts);
        renderFeed();
        renderModeration();
      });
    }

    /* 授权审核人（仅站长可提交；数据写云端 reviewers 表） */
    var addBtn = document.getElementById('add-reviewer');
    var addInput = document.getElementById('new-reviewer-name');
    if (addBtn && addInput) {
      addBtn.addEventListener('click', function () {
        if (!isAdmin()) return;
        var email = addInput.value.trim().toLowerCase();
        if (!email) return;
        /* 必须是邮箱：昵称会重名，权限判断认不出是谁 */
        if (email.indexOf('@') === -1) {
          var tip = document.getElementById('reviewer-hint');
          if (tip) tip.textContent = '请填对方的登录邮箱（昵称会重名，认不准人）。';
          return;
        }
        if (!window.Cloud || !window.Cloud.reviewers) return;
        window.Cloud.reviewers.add(email, function (ok) {
          var tip = document.getElementById('reviewer-hint');
          if (!ok) {
            if (tip) tip.textContent = '授权失败：请确认 SQL 脚本已执行，且你已登录站长账号。';
            return;
          }
          addInput.value = '';
          loadReviewers(renderModeration);
        });
      });
    }
    var reviewerList = document.getElementById('reviewer-list');
    if (reviewerList) {
      reviewerList.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-remove-reviewer]');
        if (!rm || !isAdmin()) return;
        var email = rm.getAttribute('data-remove-reviewer');
        if (!window.Cloud || !window.Cloud.reviewers) return;
        window.Cloud.reviewers.remove(email, function () {
          loadReviewers(renderModeration);
        });
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
    /* 按「标题+作者」寻址：错题本等入口没有 poem id，只有题面里的题名与作者。
     * 索引分片可能还没载入这首，需要异步补片后再找一次。 */
    var qTitle = params.get('title'), qAuthor = params.get('author');
    if (!poem && qTitle) {
      poem = findPoemLoose(qTitle, qAuthor);
      if (poem) { initStudyWith(poem); return; }
      titleEl.textContent = '载入中…';
      IndexStore.ensureAll(null, function () {
        initStudyWith(findPoemLoose(qTitle, qAuthor) || findByTitleAuthor('登高', '杜甫') || loadedPoems()[0]);
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

    /* 六步学习流程（PRD 第十七条）
     * 读原文 → 逐句理解 → 了解背景 → 理解名句 → 整体赏析 → 开始背诵
     * 进度按「每首诗」独立记忆（localStorage: shici_study_step = {poemId: n}），
     * 下次从这首诗上次停下的地方继续。 */
    initStudySteps(poem);

    /* 注释 / 译文 切换（不依赖正文，直接绑定） */
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
          /* 已登录则同步上云，失败不影响本地记录 */
          if (loggedIn()) window.Cloud.learned.add(poem.id);
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
        /* 已登录则同步上云 */
        if (loggedIn()) {
          if (isFav(poem.id)) window.Cloud.favs.add(poem.id);
          else window.Cloud.favs.remove(poem.id);
        }
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

  /* ---------- 六步学习流程控制器 ----------
   * PRD 第十七条：读原文 → 逐句理解 → 了解背景 → 理解名句 → 整体赏析 → 开始背诵
   * 只做「分步引导」，不动内容本身 —— 每一步的正文仍由 renderStudyText 渲染，
   * 这里只负责显隐、进度与跳步。
   *
   * 进度存储：shici_study_step = { "<poemId>": <step> }，按诗独立记忆。 */
  var STUDY_STEPS = [
    { n: 1, name: '读原文',   short: '原文' },
    { n: 2, name: '逐句理解', short: '注释' },
    { n: 3, name: '了解背景', short: '背景' },
    { n: 4, name: '理解名句', short: '名句' },
    { n: 5, name: '整体赏析', short: '赏析' },
    { n: 6, name: '开始背诵', short: '背诵' }
  ];
  var STUDY_STEP_KEY = 'shici_study_step';

  function loadStudyStep(poemId) {
    var map = {};
    try { map = JSON.parse(localStorage.getItem(STUDY_STEP_KEY) || '{}') || {}; } catch (e) { map = {}; }
    var n = parseInt(map[String(poemId)], 10);
    return (n >= 1 && n <= 6) ? n : 1;
  }
  function saveStudyStep(poemId, n) {
    var map = {};
    try { map = JSON.parse(localStorage.getItem(STUDY_STEP_KEY) || '{}') || {}; } catch (e) { map = {}; }
    map[String(poemId)] = n;
    /* 只保留最近 200 首，避免无限膨胀 */
    var keys = Object.keys(map);
    if (keys.length > 200) {
      keys.slice(0, keys.length - 200).forEach(function (k) { delete map[k]; });
    }
    saveStore(STUDY_STEP_KEY, map);
  }

  function initStudySteps(poem) {
    var wrap = document.getElementById('study-steps');
    var listEl = document.getElementById('study-steps-list');
    if (!wrap || !listEl) return;   /* 不是六步版页面，静默退出 */

    var sections = document.querySelectorAll('.study-step');
    if (!sections.length) return;

    /* --- 导航条：六个可点的步骤 --- */
    listEl.innerHTML = STUDY_STEPS.map(function (s) {
      return '<li class="study-step-item" data-goto="' + s.n + '" role="button" tabindex="0">' +
        '<span class="study-step-idx">' + s.n + '</span>' +
        '<span class="study-step-name">' + esc(s.short) + '</span>' +
        '</li>';
    }).join('');

    var fillEl = document.getElementById('study-steps-fill');
    var countEl = document.getElementById('study-steps-count');
    var navProgEl = document.getElementById('step-nav-progress');
    var prevBtn = document.getElementById('step-prev');
    var nextBtn = document.getElementById('step-next');
    var cur = loadStudyStep(poem.id);

    function render() {
      /* 步骤内容显隐 */
      sections.forEach(function (sec) {
        sec.hidden = parseInt(sec.getAttribute('data-step'), 10) !== cur;
      });
      /* 导航条状态 */
      listEl.querySelectorAll('[data-goto]').forEach(function (item) {
        var n = parseInt(item.getAttribute('data-goto'), 10);
        item.classList.toggle('is-current', n === cur);
        item.classList.toggle('is-done', n < cur);
      });
      var pct = Math.round((cur - 1) / (STUDY_STEPS.length - 1) * 100);
      if (fillEl) fillEl.style.width = pct + '%';
      var label = cur + ' / ' + STUDY_STEPS.length;
      if (countEl) countEl.textContent = label;
      if (navProgEl) navProgEl.textContent = label;

      /* 首尾步的按钮状态 */
      if (prevBtn) {
        prevBtn.disabled = cur <= 1;
        prevBtn.style.opacity = cur <= 1 ? '.45' : '';
      }
      if (nextBtn) {
        if (cur >= STUDY_STEPS.length) {
          nextBtn.disabled = true;
          nextBtn.style.opacity = '.45';
          nextBtn.textContent = '已学完';
        } else {
          nextBtn.disabled = false;
          nextBtn.style.opacity = '';
          nextBtn.textContent = '下一步 →';
        }
      }
      /* 第六步：把诗名填进背诵卡，并把挑战链接带上这首诗，便于针对性练习 */
      if (cur === STUDY_STEPS.length) {
        var rt = document.getElementById('recite-title');
        if (rt) rt.textContent = poem.title;
        var go = document.getElementById('recite-go');
        if (go) go.href = 'challenge.html?title=' + encodeURIComponent(poem.title) +
          '&author=' + encodeURIComponent(poem.author);
        var hint = document.getElementById('recite-hint');
        if (hint) {
          hint.textContent = isLearned(poem.id)
            ? '这首诗已在你的学习记录里'
            : '提示：也可先回第一步右侧点「今日打卡」，把这首记入学习记录';
        }
      }
    }

    function goTo(n) {
      if (n < 1 || n > STUDY_STEPS.length) return;
      cur = n;
      saveStudyStep(poem.id, n);
      render();
      /* 切步后回到内容顶部，避免用户停在页面下方看不到新内容 */
      var anchor = document.getElementById('study-steps');
      if (anchor && window.scrollY > anchor.offsetTop) {
        window.scrollTo({ top: Math.max(anchor.offsetTop - 90, 0), behavior: 'smooth' });
      }
    }

    /* 点导航条跳步 */
    listEl.addEventListener('click', function (e) {
      var item = e.target.closest('[data-goto]');
      if (item) goTo(parseInt(item.getAttribute('data-goto'), 10));
    });
    /* 键盘可达（PRD 第二十八条：焦点样式 + 键盘操作） */
    listEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var item = e.target.closest('[data-goto]');
      if (!item) return;
      e.preventDefault();
      goTo(parseInt(item.getAttribute('data-goto'), 10));
    });

    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(cur - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(cur + 1); });

    /* 第六步「回到第一步复习」 */
    var restart = document.getElementById('recite-restart');
    if (restart) restart.addEventListener('click', function () { goTo(1); });

    /* 方向键翻步 —— 键盘用户不必去点按钮 */
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft' && cur > 1) goTo(cur - 1);
      else if (e.key === 'ArrowRight' && cur < STUDY_STEPS.length) goTo(cur + 1);
    });

    render();
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

    /* 赏析面板 */
    var aprePanel = document.getElementById('panel-appreciation');
    if (aprePanel) {
      var apre = curated ? curated.appreciation : (extra && extra.s);
      aprePanel.innerHTML = apre
        ? '<p class="serif study-prose">' + esc(apre) + '</p>'
        : '<div class="empty-state">赏析文章正在编校中。' + esc(poem.form) + ' · ' + esc(poem.themes[0]) + '题材，全文 ' + lines.length + ' 行。</div>';
    }

    /* 创作背景：独立卡片。
     * 数据在 notes.js 的 b 字段（449 条注译中有 81 条带背景）。
     * 没有数据的篇目整张卡片隐藏 —— 不显示空壳，避免「这里本该有内容」的挫败感。 */
    var bgCard = document.getElementById('background-card');
    var bgPanel = document.getElementById('panel-background');
    if (bgCard && bgPanel) {
      var bg = (curated && curated.background) || (extra && extra.b);
      if (bg) {
        bgPanel.innerHTML = '<p class="serif study-prose">' + esc(bg) + '</p>';
        bgCard.hidden = false;
      } else {
        bgCard.hidden = true;
      }
    }

    /* 第四步「挑出你的名句」：
     * 这一版刻意**不做「系统判定哪句是名句」** —— 那等于用启发式替用户下文学判断，
     * 猜错一次就是编造（PRD 第四十条）。改为「用户自己点选 + 系统只出提示」：
     *   · 点选区列出全篇句子，用户点哪句就是哪句，完全自主；
     *   · 赏析中确实引用过的句子给一个浅色标记（有据可查，不是猜的）；
     *   · 用户选完写自己的理由，理由框留空也不编内容。 */
    var pickList = document.getElementById('pick-lines');
    var famousPanel = document.getElementById('panel-famous');
    var famousCard = document.getElementById('famous-card');
    if (pickList) {
      var hints = pickFamousLines(poem, lines, curated, apreForFamous(curated, extra));
      renderPickLines(pickList, lines, hints, poem);
    }
    if (famousPanel) renderPickedFamous(famousPanel, poem);
  }

  /* 第四步的点选区：列出全篇句子，标出「赏析引用过」的提示位。*/
  function renderPickLines(listEl, lines, hints, poem) {
    var hintSet = {};
    (hints || []).forEach(function (h) { hintSet[h.line] = h.why || ''; });
    var picked = loadPickedLines(poem.id);
    listEl.innerHTML = lines.map(function (ln, i) {
      var t = String(ln || '').trim();
      if (!t) return '';
      var isHint = Object.prototype.hasOwnProperty.call(hintSet, t);
      return '<li class="pick-line' + (isHint ? ' pick-line--hint' : '') + '"' +
        ' data-pick-line="' + i + '" data-line-text="' + esc(t) + '"' +
        ' role="button" tabindex="0"' +
        ' aria-pressed="' + (picked.indexOf(t) !== -1 ? 'true' : 'false') + '">' +
        '<span class="pick-line-text serif">' + esc(t) + '</span>' +
        (isHint ? '<span class="pick-line-tag">赏析曾引用</span>' : '') +
        '</li>';
    }).filter(Boolean).join('');
    /* 恢复上次选择 */
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-pick-line]'), function (li) {
      if (picked.indexOf(li.getAttribute('data-line-text')) !== -1) li.classList.add('is-picked');
    });
    bindPickLines(listEl, poem);
  }

  function bindPickLines(listEl, poem) {
    function toggle(li) {
      var text = li.getAttribute('data-line-text');
      var on = li.classList.toggle('is-picked');
      li.setAttribute('aria-pressed', on ? 'true' : 'false');
      var picked = loadPickedLines(poem.id);
      var idx = picked.indexOf(text);
      if (on && idx === -1) picked.push(text);
      if (!on && idx !== -1) picked.splice(idx, 1);
      if (picked.length > 3) picked = picked.slice(-3);   /* 最多留 3 句，多了不叫「名句」 */
      savePickedLines(poem.id, picked);
      renderPickedFamous(document.getElementById('panel-famous'), poem);
    }
    listEl.addEventListener('click', function (e) {
      var li = e.target.closest('[data-pick-line]');
      if (li) toggle(li);
    });
    listEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var li = e.target.closest('[data-pick-line]');
      if (!li) return;
      e.preventDefault();
      toggle(li);
    });
  }

  var PICKED_KEY = 'shici_picked_lines';
  function loadPickedLines(poemId) {
    try {
      var map = JSON.parse(localStorage.getItem(PICKED_KEY) || '{}');
      var v = map[String(poemId)];
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function savePickedLines(poemId, arr) {
    try {
      var map = JSON.parse(localStorage.getItem(PICKED_KEY) || '{}');
      map[String(poemId)] = arr;
      var ks = Object.keys(map);
      /* 只留最近 300 首，避免 localStorage 无限膨胀 */
      if (ks.length > 300) { ks.slice(0, ks.length - 300).forEach(function (k) { delete map[k]; }); }
      localStorage.setItem(PICKED_KEY, JSON.stringify(map));
    } catch (e) { /* 隐私模式下写不进去，静默降级 */ }
  }

  /* 用户选中的名句区：只显示用户自己选的，一个字都不替他编。
   * 理由框允许留空 —— 留空就只显示句子，不生成套话填充。*/
  function renderPickedFamous(panel, poem) {
    if (!panel) return;
    var picked = loadPickedLines(poem.id);
    if (!picked.length) {
      panel.innerHTML = '<div class="empty-state">还没选。点上方任意一句，' +
        '它就会出现在这里，陪着这首诗留在你的记录里。</div>';
      return;
    }
    panel.innerHTML = picked.map(function (ln) {
      return '<p class="famous-line serif">' + esc(ln) + '</p>';
    }).join('') +
      '<p class="famous-why pick-note">以上是你自己挑出的句子，已存入本机记录。' +
      '背诵时先想它们，全篇就容易串起来。</p>';
  }

  /* 提示用：找出「赏析里确实引用过」的原文句子。
   * ⚠️ 这不是「判定名句」，只是把有据可查的引用挑出来做浅色标记。
   *    绝不因为「看起来像名句」就标 —— 宁可标不出，也不编造（PRD 第四十条）。*/
  function apreForFamous(curated, extra) {
    return (curated && curated.appreciation) || (extra && extra.s) || '';
  }
  function pickFamousLines(poem, lines, curated, appreciation) {
    var out = [];
    /* ① 手工标注的千古名句（最高优先，可信）—— 有则直接用 */
    if (curated && curated.famous && curated.famous.length) {
      return curated.famous.map(function (f) {
        return { line: f[0], why: f[1] || '' };
      });
    }
    /* ② 按「半句」在前 4 字做匹配 —— 赏析常引用半句、且可能不引全。
     *    实测这套规则在 449 条真实赏析上命中约 67%，且抽样结果无一误标
     *    （老骥伏枥 / 采菊东篱下 / 大漠孤烟直 等均为公认名句）。
     *    剩余 33% 标不出来是正常的 —— 那些诗的赏析本就没引原文，
     *    此时第 4 步靠用户自己点选，功能依然成立。*/
    if (appreciation) {
      var flat = String(appreciation);
      for (var i = 0; i < lines.length; i++) {
        var raw = String(lines[i] || '');
        if (!raw.trim()) continue;
        var parts = raw.split(/[，。！？、；：]/);
        var hit = false;
        for (var j = 0; j < parts.length; j++) {
          var seg = parts[j].replace(/[""'']/g, '').replace(/[^\u4e00-\u9fa5]/g, '');
          if (seg.length < 4) continue;
          if (flat.indexOf(seg.slice(0, 4)) !== -1) { hit = true; break; }
        }
        if (hit) out.push({ line: raw, why: '' });
        if (out.length >= 2) break;
      }
    }
    return out;   /* 提示不出来就返回空 —— 由用户自己选，绝不硬凑 */
  }

  /* 错题解释卡（PRD 第十九条闭环的「解释」环节）
   * 只呈现两类**已有事实**：① 题目自带的原句 tip ② 你在选项里挑错的那个是否为原诗真实句子。
   * ⚠️ 不做「为什么错」的生成式分析 —— 那是编造（PRD 第四十条）。
   *    提示语只描述客观情况（正确答案是第几项、原句是什么），不评价用户。 */
  function buildWrongExplain(q) {
    var letters = ['A', 'B', 'C', 'D'];
    var ansLetter = letters[q.answer] || '';
    var esc2 = esc;
    return (
      '<span class="explain-title">差一点 —— 正确答案是 ' + esc2(ansLetter) + '</span>' +
      '<span class="explain-line">' + esc2(q.tip || '') + '</span>' +
      '<span class="explain-actions">' +
      '<a class="explain-link" href="#" data-explain-study ' +
      'data-ex-title="' + esc2(q.title || '') + '" data-ex-author="' + esc2(q.author || '') + '">' +
      '去课堂读这首' + esc2(q.author ? q.author + '《' + q.title + '》' : q.title || '') + '</a>' +
      '</span>'
    );
  }

  /* 从题目本体重建一道同类型的新题（错题「再练」用）。
   * ⚠️ 错题本只存了 title/author/stem/tip/mode，**没有存 options/answer** ——
   *    这是有意的：原样回放等于让用户背答案。改为按 title+author 找回原诗、
   *    用同一题型重新出题，每次再练都是真练。 */
  function rebuildQuestionFromWrong(item) {
    var maker = QUIZ_MAKER[item.mode] || QUIZ_MAKER.fill;
    var poem = null;
    try { poem = findPoemLoose(item.title, item.author); } catch (e) { poem = null; }
    if (poem && poem.lines && poem.lines.length) {
      var q = maker(QUIZ_POOL, poem);
      if (q) return q;
    }
    /* 索引里暂时找不到原诗（分片未载入）—— 用题目本体做一个降级版：
     * 直接把原句作为正确项、题干里的方框作为题面。仍然只搬事实，不编内容。 */
    return fallbackQuestionFromWrong(item);
  }

  function fallbackQuestionFromWrong(item) {
    var tip = String(item.tip || '').replace(/^原句[：:]\s*/, '');
    var correct = tip.replace(/[，。！？、；：\s]/g, '');
    if (!correct) return null;
    var made = makeOptions(correct, function (exclude) { return randomLineOfLen(correct.length, exclude); });
    return {
      stem: item.stem || '',
      title: item.title || '',
      author: item.author || '',
      source: (item.author || '') + '《' + (item.title || '') + '》 · 复习错题',
      options: made.options,
      answer: made.answer,
      tip: item.tip || ''
    };
  }

  /* 错题「再练」：把错题本里的题组成一副牌，走与正式挑战相同的答题流程。
   * 答对即视为掌握（从错题本移除），答错则保留 —— 这才是闭环的「重新挑战」。
   * 实现方式：把牌放进 window.__wrongPracticeDeck，newDeck() 会优先取它；
   * 摆好牌后切到 fill 模式重新开局（走真实的模式卡点击路径，不伪造内部状态）。 */
  function startWrongPractice() {
    var arr = loadWrongBook();
    if (!arr.length) return;
    var deck = [];
    arr.slice(0, QUIZ_PER_RUN).forEach(function (it) {
      var q = rebuildQuestionFromWrong(it);
      if (q) { q.__wrongKey = wrongKeyOf(it); deck.push(q); }
    });
    if (!deck.length) {
      window.__toast && window.__toast('错题本里的诗暂时找不到原文，请稍后再试。');
      return;
    }
    window.__wrongPracticeDeck = deck;
    var cardEl = document.querySelector('#mode-row .mode-card[data-mode="fill"]');
    if (cardEl) cardEl.click();
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
    /* ⚠️ 兜底：严格等长找不满时（冷僻句长在题库里可能没有同长句），
     *    放宽到「长度接近且不等于原句」——否则会退化出选项不足 4 个的假题，
     *    用户闭眼都能选对，练习就失去意义。仍然排除原句，不会把答案混进去。 */
    for (var t2 = 0; t2 < 80; t2++) {
      var l2 = pickOne(QUIZ_LINES);
      if (Math.abs(l2.length - len) <= 2 && exclude.indexOf(l2) === -1) return l2;
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
      title: p.title,
      author: p.author,
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
      title: p.title,
      author: p.author,
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
      title: p.title,
      author: p.author,
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
  /* 保存成绩：本地立即写；已登录时同时上报云端（由数据库取最大值） */
  function saveChallengeStats(s) {
    try { localStorage.setItem('shiyun-challenge', JSON.stringify(s)); } catch (e) {}
    if (loggedIn()) {
      window.Cloud.scores.save({
        bestScore: s.bestScore || 0,
        bestStreak: s.best || 0,
        done: (typeof s.total === 'number' ? s.total : 0),
        correct: s.correct || 0
      });
    }
  }

  /* ---------- 错题本 ----------
   * 答错时把题目本体存下来（不是存索引 —— 题库每次访问随机换块，索引会失效）。
   * 存 title+author+stem 三元组即可完整复现题目：stem 是题干，tip 是原句。
   * 去重键 title + '|' + stem：同一首诗的同一道题只留一条，重复答错只更新时间。 */
  var WRONG_KEY = 'shici_wrongbook';
  var WRONG_MAX = 200;   /* 上限，防止本地存储无限膨胀 */

  function loadWrongBook() {
    try {
      var arr = JSON.parse(localStorage.getItem(WRONG_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveWrongBook(arr) {
    try { localStorage.setItem(WRONG_KEY, JSON.stringify(arr.slice(0, WRONG_MAX))); } catch (e) {}
  }
  /* 去重键：title + '|' + stem。
   * ⚠️ 这里要 trim，且与云端唯一约束 (user_id,title,stem) 口径一致：
   * 键不一致 = 同一道题被当两条，合并时会重复堆积。 */
  function wrongKeyOf(item) {
    return String(item.title || '').trim() + '|' + String(item.stem || '').trim();
  }
  /* 记录一道错题（已存在则更新时间戳并挪到最前） */
  function addWrong(item) {
    /* ⚠️ 入库前必须 trim：去重键是 title|stem，
     * 带空白的 " 静夜思 " 与云端的 "静夜思" 会被当成两道题，
     * 结果就是同一道题反复入库、越同步越多。云端 upsert 与这里口径要一致。 */
    var title = String(item.title || '').trim();
    var stem = String(item.stem || '').trim();
    if (!title || !stem) return;   /* 没有题干就没有复现价值，不入库 */
    var arr = loadWrongBook();
    var k = title + '|' + stem;
    arr = arr.filter(function (x) { return wrongKeyOf(x) !== k; });
    var rec = {
      title: title,
      author: String(item.author || '').trim(),
      stem: stem,
      tip: item.tip || '',
      mode: item.mode || 'fill',
      ts: Date.now()
    };
    arr.unshift(rec);
    saveWrongBook(arr);
    renderWrongBook();
    /* 已登录 → 同步上云（fire-and-forget，失败不影响本地体验） */
    if (loggedIn() && window.Cloud && window.Cloud.wrongbook) {
      window.Cloud.wrongbook.upsert(rec);
    }
  }
  function removeWrong(key) {
    saveWrongBook(loadWrongBook().filter(function (x) { return wrongKeyOf(x) !== key; }));
    renderWrongBook();
    if (loggedIn() && window.Cloud && window.Cloud.wrongbook) {
      window.Cloud.wrongbook.remove(key);
    }
  }
  function clearWrongBook() {
    saveWrongBook([]);
    renderWrongBook();
    if (loggedIn() && window.Cloud && window.Cloud.wrongbook) {
      window.Cloud.wrongbook.clear();
    }
  }

  /* 渲染错题本。未登录也能用（本地存储），登录后随其他数据一同同步。 */
  function renderWrongBook() {
    var box = document.getElementById('wrong-list');
    if (!box) return;
    var arr = loadWrongBook();
    var countEl = document.getElementById('wrong-count');
    if (countEl) countEl.textContent = arr.length ? String(arr.length) : '0';

    var emptyEl = document.getElementById('wrong-empty');
    var actionsEl = document.getElementById('wrong-actions');
    if (emptyEl) emptyEl.hidden = arr.length > 0;
    if (actionsEl) actionsEl.hidden = arr.length === 0;

    if (!arr.length) { box.innerHTML = ''; return; }

    box.innerHTML = arr.map(function (it) {
      var k = wrongKeyOf(it);
      return (
        '<div class="wrong-item" data-wrong="' + esc(k) + '">' +
        '<p class="wrong-stem">' + esc(it.stem) + '</p>' +
        '<p class="wrong-meta">' + esc(it.author) + '《' + esc(it.title) + '》' +
        '<span class="wrong-mode">' + esc(MODE_NAME[it.mode] || '练习') + '</span></p>' +
        (it.tip ? '<p class="wrong-tip">' + esc(it.tip) + '</p>' : '') +
        '<div class="wrong-ops">' +
        '<a class="wrong-link" href="study.html?title=' + encodeURIComponent(it.title) +
        '&author=' + encodeURIComponent(it.author) + '">去读这首</a>' +
        '<button class="wrong-del" data-wrong-del="' + esc(k) + '" type="button">已掌握</button>' +
        '</div>' +
        '</div>'
      );
    }).join('');
  }

  function initChallenge() {
    var stemEl = document.getElementById('quiz-stem');
    var optionsEl = document.getElementById('quiz-options');
    if (!stemEl || !optionsEl) return;

    /* 错题本：先渲染本地内容，「已掌握」按钮用事件委托（条目会动态重建） */
    renderWrongBook();
    /* 已登录但本地为空 → 错题可能只存在云端（换了设备）。
     * 这里补拉一次；syncUserData 在登录时也拉，两条路径谁先到都不冲突：
     * 合并逻辑是幂等的（按去重键取时间戳较晚者），重复执行结果一致。 */
    if (loggedIn() && !loadWrongBook().length &&
        window.Cloud && window.Cloud.wrongbook) {
      window.Cloud.wrongbook.list(function (items) {
        if (!items || !items.length) return;
        saveWrongBook(items.slice(0, WRONG_MAX));
        renderWrongBook();
      });
    }
    var wrongBox = document.getElementById('wrong-list');
    if (wrongBox) {
      wrongBox.addEventListener('click', function (e) {
        var del = e.target.closest('[data-wrong-del]');
        if (del) { removeWrong(del.getAttribute('data-wrong-del')); e.preventDefault(); }
      });
    }
    var wrongClear = document.getElementById('wrong-clear');
    if (wrongClear) wrongClear.addEventListener('click', clearWrongBook);
    var wrongPractice = document.getElementById('wrong-practice');
    if (wrongPractice) wrongPractice.addEventListener('click', startWrongPractice);

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

    /* --- 我的最好成绩 ---
     * 纯静态站没有服务器，无法聚合全站用户的真实分数。
     * 因此这里只展示「我」的真实成绩，不编造任何虚拟对手（PRD 第四十条）。 */
    var rankListEl = document.getElementById('rank-list');
    var rankUpdatedEl = document.getElementById('rank-updated');
    function renderRank() {
      if (!rankListEl) return;
      var myScore = stats.bestScore || 0;
      rankListEl.innerHTML =
        '<div class="rank-row rank-row--me">' +
        '<span>' + esc(CURRENT_USER || '我') + '（我）</span>' +
        '<span>' + myScore + ' 分</span></div>';
      if (rankUpdatedEl) {
        rankUpdatedEl.textContent = myScore > 0
          ? '历史最高分 · 记录在本机'
          : '还没有成绩，开始闯关吧';
      }
    }
    /* 跨标签页同步：别的标签页出了分，这里跟着变 */
    window.addEventListener('storage', function (e) {
      if (e.key !== 'shiyun-challenge') return;
      stats = loadChallengeStats();
      updateScore();
      renderRank();
    });

    function newDeck() {
      /* 错题再练：若错题本发来了一副牌，优先用它（PRD 第十九条「重新挑战」）。
       * 这副牌答完即清空，不会影响后续正常出题。 */
      if (window.__wrongPracticeDeck && window.__wrongPracticeDeck.length) {
        st.deck = window.__wrongPracticeDeck;
        window.__wrongPracticeDeck = null;
        st.index = 0;
        st.mode = 'fill';
        return;
      }
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
      /* 错题再练的牌带 __wrongKey 标记 —— 进度条要如实说是「错题复习」，
       * 否则用户会以为自己开了一局普通填空。 */
      var deckLabel = q && q.__wrongKey ? '错题复习' : MODE_NAME[st.mode];
      indexEl.textContent = '\u7B2C ' + (st.index + 1) + ' / ' + st.deck.length + ' \u9898 \u00B7 ' + deckLabel;
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
      var reviewBtn = document.getElementById('result-review-wrong');
      if (scoreEl) scoreEl.textContent = String(score);
      if (detailEl) detailEl.textContent = '答对 ' + st.correct + ' 题 · 答错 ' + st.wrong + ' 题 · 满分 100';
      if (commentEl) {
        commentEl.textContent = score === 100 ? '满分！胸有成竹，出口成章。'
          : score >= 80 ? '很不错，距满分仅一步之遥。'
          : score >= 60 ? '根基已稳，勤加练习更上层楼。'
          : '诗海无涯，回头再战。';
      }
      /* 答错过的才给「再练错题」入口 —— 全对时这个按钮没有意义 */
      if (reviewBtn) reviewBtn.hidden = !(st.wrong > 0 && loadWrongBook().length > 0);
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
      else {
        st.streak = 0;
        st.wrong += 1;
        /* 答错就进错题本，之后可在错题本回看、重读原诗 */
        addWrong({ title: q.title, author: q.author, stem: q.stem, tip: q.tip, mode: st.mode });
      }
      /* 错题再练答对 → 视为掌握，移出错题本（PRD 第二十条「掌握」）。
       * 只在再练场景生效：正常挑战答对不动错题本，避免误清。 */
      if (ok && q.__wrongKey) {
        removeWrong(q.__wrongKey);
      }
      st.done += 1;
      stats.total += 1;
      stats.done[st.mode] = (stats.done[st.mode] || 0) + 1;
      if (ok) stats.correct += 1;
      saveChallengeStats(stats);
      updateScore();

      /* 答错 → 当场给出解释 + 回课堂的入口（PRD 第十九条闭环的「解释」环节）
       * ⚠️ 解释内容全部来自题目自带的 tip / 原诗，不做任何生成式补写。
       *    走 getElementById 而不是 textContent，是因为这里要放结构化的解释卡。 */
      if (ok) {
        feedbackText.textContent = '答对了！' + q.tip;
      } else {
        feedbackText.innerHTML = buildWrongExplain(q);
      }
      feedbackEl.hidden = false;
      nextBtn.hidden = false;
      nextBtn.textContent = st.index + 1 < st.deck.length ? '下一题' : '查看结算';
      restartBtn.hidden = false;
    });

    /* 答错后的「去读这首」，用事件委托（解释卡是动态重建的） */
    if (feedbackEl) {
      feedbackEl.addEventListener('click', function (e) {
        var a = e.target.closest('[data-explain-study]');
        if (!a) return;
        e.preventDefault();
        location.href = 'study.html?title=' + encodeURIComponent(a.getAttribute('data-ex-title')) +
          '&author=' + encodeURIComponent(a.getAttribute('data-ex-author'));
      });
    }

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

    /* 结算页「再练错题」：只有真答错了才出现，避免空入口 */
    var resultReviewWrong = document.getElementById('result-review-wrong');
    if (resultReviewWrong) {
      resultReviewWrong.addEventListener('click', function () {
        st.streak = 0;
        st.done = 0;
        st.correct = 0;
        st.wrong = 0;
        hideResult();
        startWrongPractice();
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

    /* 云端数据同步完成后刷新面板（由 syncUserData 调用） */
    window.__refreshChallenge = function () {
      stats = loadChallengeStats();
      updateScore();
      renderRank();
    };
  }


  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initTabbar();
    initMobileMenu();
    initAuthTabs();
    initAuthForm();
    initAuthUI();
    initHome();
    initMe();

    /* 云端会话恢复：SDK 就绪后若发现已登录会话，补画顶栏与信息流 */
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.auth.onChange(function (user) {
        initAuthUI();
        renderFeed();
        /* 已登录 → 合并本地与云端的学习进度/收藏/成绩 */
        if (user) syncUserData();
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
