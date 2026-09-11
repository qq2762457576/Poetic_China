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

  /* ---------- 每日学习记录（「我的」页学习趋势的数据来源） ----------
   * 结构：{ "YYYY-MM-DD": 当天新学的篇数 }
   *
   * ⚠️ 为什么必须单独存一份，而不是从 shici_learned 反推：
   *    shici_learned 是 id 数组，只有「学过哪些」，没有「什么时候学的」。
   *    没有时间维度就画不出趋势 —— 任何按日期分布都只能是编的。
   *    所以打卡那一刻必须落一条真实日期，这是趋势图唯一的数据来源。
   *
   * 只记「新学」不记重复打卡：同一首反复点是同一件事，不能虚增曲线。
   * 保留最近 DAILY_MAX 天，防止本地存储无限膨胀。 */
  var DAILY_KEY = 'shici_daily';
  var DAILY_MAX = 400;

  function loadDaily() {
    var d = store(DAILY_KEY, null);
    return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  }
  function saveDaily(map) {
    /* 超出上限时按日期倒序裁剪，保留最近的 */
    var keys = Object.keys(map).sort();
    if (keys.length > DAILY_MAX) {
      var trimmed = {};
      keys.slice(-DAILY_MAX).forEach(function (k) { trimmed[k] = map[k]; });
      map = trimmed;
    }
    saveStore(DAILY_KEY, map);
  }
  /* 本地日期键（不用 toISOString：那是 UTC，东八区晚上会记成前一天） */
  function dayKey(ts) {
    var d = ts ? new Date(ts) : new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  /* 记一笔「今天新学了 n 篇」 */
  function markDailyToday(n) {
    var map = loadDaily();
    var k = dayKey();
    map[k] = (map[k] || 0) + (n || 1);
    saveDaily(map);
    /* 已登录则把整份记录推上云（库内按日期取较大值合并）。
     * 推整份而不是只推今天这一天：合并是幂等的，推全量最省心，
     * 也顺带把之前离线时攒下的记录补上去。 */
    pushDailyToCloud();
  }
  /* 把本地每日记录推上云。失败静默 —— 本地记录照常可用。 */
  function pushDailyToCloud() {
    if (!loggedIn() || !window.Cloud || !window.Cloud.userData) return;
    window.Cloud.userData.saveDaily(loadDaily());
  }
  /* 取最近 days 天的序列（含今天，按日期正序），补零到满长度 —— 
   * 没学的那天就是 0，这是真实值，不是编的。 */
  function getDailySeries(days) {
    var map = loadDaily();
    var out = [];
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today.getTime() - i * 86400000);
      var k = dayKey(d.getTime());
      out.push({ date: k, count: map[k] || 0 });
    }
    return out;
  }
  /* 连续学习天数：从今天（或昨天）往前数，断一天即止。
   * 今天还没学不算断 —— 一天才刚开始，不能因为还没打卡就把连续归零。 */
  function dailyStreak(s) {
    var seq = s || getDailySeries(DAILY_MAX);
    var i = seq.length - 1;
    if (i >= 0 && seq[i].count === 0) i--;   /* 今天未学 → 从昨天起算 */
    var n = 0;
    for (; i >= 0; i--) {
      if (seq[i].count > 0) n++; else break;
    }
    return n;
  }

  /* ---------- 自定义头像 ----------
   * 存一条 96×96 的 JPEG data URI（约 5–15KB）。
   *
   * ⚠️ 为什么不用 Supabase Storage 存文件：
   *    Storage 有独立的存储与流量配额，而头像只是个小圆图。
   *    存成一列文本省掉了 bucket 策略、public URL、跨域一整套配置，
   *    个人站规模下这是最省事也最省钱的方案（SQL 注释里有同样说明）。
   *
   * ⚠️ 为什么在本地裁到 96×96 再存：
   *    用户可能选一张 5MB 的相机原图。不裁就存，本地存不下、
   *    上传也慢，而且 data URI 进 jsonb 会撑爆单行大小。 */
  var AVATAR_KEY = 'shici_avatar';
  var AVATAR_SIZE = 96;        /* 输出边长（正方形） */
  var AVATAR_MAX_CHARS = 200000;   /* data URI 上限，防超大图撑爆存储 */

  function loadAvatar() {
    var v = store(AVATAR_KEY, '');
    return (typeof v === 'string' && v.indexOf('data:image/') === 0) ? v : '';
  }
  function saveAvatar(dataUri) {
    try {
      if (dataUri) localStorage.setItem(AVATAR_KEY, JSON.stringify(dataUri));
      else localStorage.removeItem(AVATAR_KEY);
    } catch (e) { /* 隐私模式 / 超额：静默失败，回退首字头像 */ }
  }
  /* 把选中的图片文件裁成正方形并编码为 data URI。
   * 用 canvas 而不是原样读：见上面 AVATAR_SIZE 的说明。 */
  function fileToAvatar(file, cb) {
    if (!file) return cb(null);
    if (!/^image\//.test(file.type)) return cb(null, '请选择图片文件');
    /* 原图就超过 8MB 的直接拒：读进内存再裁代价太大，不如让用户先缩一下 */
    if (file.size > 8 * 1024 * 1024) return cb(null, '图片太大了，请选 8MB 以内的');

    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = AVATAR_SIZE;
          canvas.height = AVATAR_SIZE;
          var ctx = canvas.getContext('2d');
          /* 居中裁成正方形：取短边做基准，避免人像被拉扁 */
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2;
          var sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
          var uri = canvas.toDataURL('image/jpeg', 0.8);
          /* ⚠️ 三重校验，缺一不可：
           *   ① 必须是 data:image/ 开头 —— 浏览器在画布为空时可能返回
           *      "data:,"，它既非空串也不超长，光看后两条会放行，
           *      结果就是 <img src="data:,"> 一片空白，用户以为没反应。
           *   ② 非空
           *   ③ 不超上限，防超大图撑爆本地存储与 jsonb 单行 */
          var badPrefix = String(uri).indexOf('data:image/') !== 0;
          if (badPrefix || !uri || uri.length > AVATAR_MAX_CHARS) {
            return cb(null, '图片处理失败，请换一张试试');
          }
          cb(uri);
        } catch (e) {
          /* canvas 被污染（极少见）或浏览器不支持 → 如实失败，不塞半成品 */
          cb(null, '图片处理失败，请换一张试试');
        }
      };
      img.onerror = function () { cb(null, '这张图片读不出来，请换一张'); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null, '文件读取失败，请重试'); };
    reader.readAsDataURL(file);
  }
  /* 统一的头像输出口：当前登录用户有自定义头像就用图，否则回退首字。
   * ⚠️ 只对本人生效 —— 拿不到别人的头像数据，绝不为他人编造图片。 */
  function avatarHtml(author, cls) {
    var name = String(author || '');
    var ch = esc(name[0] || '诗');
    var mine = (name === (CURRENT_USER || Auth.current()));
    var uri = mine ? loadAvatar() : '';
    var klass = 'avatar' + (cls ? ' ' + cls : '');
    if (uri) {
      return '<span class="' + klass + ' avatar--img">' +
        '<img src="' + esc(uri) + '" alt="" />' +
        '</span>';
    }
    return '<span class="' + klass + '">' + ch + '</span>';
  }

  /* 「我的」页头像：有自定义图就换成图，否则保持首字 */
  function renderMeAvatar(name) {
    var avEl = document.getElementById('me-avatar');
    if (!avEl) return;
    var uri = loadAvatar();
    if (uri) {
      avEl.classList.add('avatar--img');
      avEl.innerHTML = '<img src="' + esc(uri) + '" alt="" />';
    } else {
      avEl.classList.remove('avatar--img');
      avEl.textContent = String(name || '诗')[0] || '诗';
    }
    /* 「移除头像」只在真的设过时才出现 —— 否则是个点了没反应的死按钮 */
    var rm = document.getElementById('me-avatar-remove');
    if (rm) rm.hidden = !uri;
  }

  /* 换 / 移除头像的交互绑定。
   * ⚠️ 每次 initMe() 都会重新调用（同步完成后会再画一次），
   *    所以用 __bound 标记防止重复绑监听 —— 否则一次点击会触发多次上传。 */
  function bindMeAvatar() {
    var btn = document.getElementById('me-avatar-btn');
    var input = document.getElementById('me-avatar-input');
    var rm = document.getElementById('me-avatar-remove');
    var tip = document.getElementById('me-avatar-tip');
    if (!btn || !input || btn.__bound) return;
    btn.__bound = 1;

    function setTip(t) { if (tip) tip.textContent = t || ''; }

    btn.addEventListener('click', function () {
      if (!(CURRENT_USER || Auth.current())) return;
      input.click();
    });

    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.value = '';   /* 清掉，否则选同一个文件不会再触发 change */
      if (!f) return;
      setTip('正在处理图片…');
      fileToAvatar(f, function (uri, err) {
        if (!uri) { setTip(err || '处理失败，请重试'); return; }
        saveAvatar(uri);
        renderMeAvatar(CURRENT_USER || Auth.current());
        setTip('头像已更新' + (loggedIn() ? '，正在同步到云端' : '（仅本机）'));
        if (window.__refreshNavAvatar) window.__refreshNavAvatar();
        if (loggedIn() && window.Cloud && window.Cloud.userData) {
          window.Cloud.userData.saveAvatar(uri, function (ok) {
            /* 同步失败要说出来 —— 否则用户以为换设备也生效了 */
            if (!ok) setTip('头像已存在本机，但同步到云端失败，请稍后重试');
          });
        }
      });
    });

    if (rm) rm.addEventListener('click', function () {
      saveAvatar('');
      renderMeAvatar(CURRENT_USER || Auth.current());
      setTip('已恢复为昵称首字头像');
      if (window.__refreshNavAvatar) window.__refreshNavAvatar();
      if (loggedIn() && window.Cloud && window.Cloud.userData) {
        window.Cloud.userData.saveAvatar('');
      }
    });
  }

  /* 是否处于云端模式（未登录也算云端模式，只是不推送） */
  function cloudMode() {
    return !!(window.Cloud && window.Cloud.mode && window.Cloud.mode() === 'cloud');
  }
  function loggedIn() {
    return !!(window.Cloud && window.Cloud.auth && window.Cloud.auth.userId());
  }

  /* ---------- 账号模式描述（Phase 2.8） ----------
   * 「站点跑在云端还是本地」这件事以前只在「我的」右栏有一行小字，用户基本发现不了。
   * 这里把它收敛成一个统一描述对象，所有展示位（顶栏徽标 / 我的页说明卡 / 右栏）
   * 都从这一处取文案，避免各处口径不一致、改了这里忘了那里。
   *
   * 三个状态必须严格区分，不能混为一谈：
   *   1. local          —— config.js 没配 Supabase，数据物理上只可能在本机
   *   2. cloud-guest    —— 云端可用，但当前没登录，此刻数据仍只写本机
   *   3. cloud-signed   —— 云端可用且已登录，数据双写并跨设备同步
   * ⚠️ 最常见也最危险的误标是把 2 说成「已同步」：用户会以为换设备能看到，
   *    实际没有。所以 cloud-guest 的文案必须明确写「尚未同步 / 登录后才会同步」。 */
  function accountModeInfo() {
    var isCloud = cloudMode();
    if (!isCloud) {
      return {
        key: 'local',
        badge: '本地模式',
        badgeShort: '本地',
        title: '本地模式',
        desc: '本站未连接云端。所有数据只保存在这台设备的浏览器里，' +
              '清理浏览器数据或换设备都会丢失。',
        store: '本机（仅这台设备）',
        sync: '不参与同步'
      };
    }
    if (!loggedIn()) {
      return {
        key: 'cloud-guest',
        badge: '未登录',
        badgeShort: '未登录',
        title: '云端可用 · 当前未登录',
        desc: '本站已连接云端，但你现在还没登录。此刻的学习记录仍然只写在这台设备上，' +
              '登录后才会自动合并上去，换设备才能接着学。',
        store: '本机（暂未上云）',
        sync: '登录后开启'
      };
    }
    return {
      key: 'cloud-signed',
      badge: '云端同步中',
      badgeShort: '云端',
      title: '云端模式 · 已登录',
      desc: '学习进度、收藏、错题与头像会同时写入本机和云端，' +
            '换设备登录同一账号即可接着学。',
      store: '本机 + 云端',
      sync: '已开启'
    };
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

    /* 每日学习记录 + 头像：从 user_data 取回，与本地合并后重画趋势图。
     * ⚠️ daily 是「当天累计篇数」而非增量，所以同一天取较大值、绝不相加 ——
     *    相加会把同一批学习重复计入。这个口径必须与库内 merge_user_daily
     *    的 greatest() 保持一致，两边不一致就会越同步数字越大。 */
    if (window.Cloud.userData) window.Cloud.userData.get(function (ud) {
      if (!ud) return;
      var changed = false;

      if (ud.daily) {
        var local = loadDaily();
        var mergedDaily = {};
        Object.keys(local).forEach(function (k) { mergedDaily[k] = local[k]; });
        Object.keys(ud.daily).forEach(function (k) {
          var remote = Number(ud.daily[k]) || 0;
          var cur = Number(mergedDaily[k]) || 0;
          if (remote > cur) { mergedDaily[k] = remote; changed = true; }
        });
        if (changed) {
          saveDaily(mergedDaily);
          if (typeof window.__refreshMe === 'function') window.__refreshMe();
        }
        /* 本地有云端没有的（含离线期间新记的）→ 回推一次，补齐 */
        var missing = Object.keys(local).some(function (k) {
          return !(k in ud.daily) || (Number(ud.daily[k]) || 0) < (Number(local[k]) || 0);
        });
        if (missing) pushDailyToCloud();
      }

      /* 头像：本地为空而云端有 → 落回本地（换设备场景）
       * 本地已有则不覆盖 —— 本地刚换的新头像不该被云端旧值盖掉 */
      if (ud.avatar && !loadAvatar()) {
        saveAvatar(ud.avatar);
        if (typeof window.__refreshMe === 'function') window.__refreshMe();
        if (window.__refreshNavAvatar) window.__refreshNavAvatar();
      }
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

  /* ⚠️ 懒加载数据分片的缓存键，必须与 index-meta.js 同批更新。
   * 原先三处各写各的（poems-text/index/quizpool 各一个日期），
   * 数据重建后忘了改 → 浏览器按旧 URL 命中旧缓存，
   * 表现为「文件里明明有这首诗，网站却搜不到」。
   * 数据一重建就改这一个常量。 */
  var DATA_V = '20260911r';

  /* 正文分块懒加载：3000 首/块，用到才下载，下载后缓存 */
  var CHUNK_SIZE = 3000;
  var TextStore = (function () {
    var cache = {};
    var pending = {};
    function loadChunk(no, cb) {
      if (cache[no]) return cb(cache[no]);
      if (pending[no]) { pending[no].push(cb); return; }
      pending[no] = [cb];
      loadScript('assets/data/poems-text/p' + no + '.js?v=' + DATA_V, function () {
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
      loadScript('assets/data/poems-index/p' + no + '.js?v=' + DATA_V, function (ok) {
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

    /* ---------- 密码找回（2.6） ----------
     * 三个面板切换：login/register 走 tab，reset/newpwd 靠这里。
     * 恢复流程：邮件链接回跳带 #type=recovery → SDK 建立临时会话并触发
     * PASSWORD_RECOVERY → 显示「设置新密码」面板。 */
    function showPanel(name) {
      document.querySelectorAll('[data-panel]').forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-panel') !== name;
      });
      document.querySelectorAll('.auth-tab').forEach(function (t) {
        t.classList.toggle('is-active', t.getAttribute('data-mode') === name);
      });
    }
    var gotoReset = document.getElementById('goto-reset');
    if (gotoReset) {
      gotoReset.addEventListener('click', function () { showPanel('reset'); });
    }
    var resetForm = document.querySelector('form[data-panel="reset"]');
    if (resetForm) {
      resetForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = val('reset-email');
        if (!/^\S+@\S+\.\S+$/.test(email)) return hint(resetForm, '请填写有效的邮箱地址');
        hint(resetForm, '发送中…', true);
        window.Cloud.auth.resetPassword(email, function (err) {
          if (err) return hint(resetForm, err);
          /* 隐私要点：不透露该邮箱是否已注册（Supabase 对未注册邮箱也返回成功） */
          hint(resetForm, '如果该邮箱注册过，重置邮件已发出，请到邮箱查收（留意垃圾邮件）', true);
        });
      });
    }
    var newPwdForm = document.querySelector('form[data-panel="newpwd"]');
    if (newPwdForm) {
      newPwdForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var p1 = val('new-pwd');
        var p2 = val('new-pwd2');
        if (p1.length < 8 || !/[a-zA-Z]/.test(p1) || !/\d/.test(p1)) return hint(newPwdForm, '密码至少 8 位，且同时包含字母与数字');
        if (p1 !== p2) return hint(newPwdForm, '两次输入的密码不一致');
        hint(newPwdForm, '保存中…', true);
        window.Cloud.auth.updatePassword(p1, function (err) {
          if (err) return hint(newPwdForm, err);
          hint(newPwdForm, '新密码已生效，正在进入你的空间…', true);
          setTimeout(function () { location.href = 'me.html'; }, 700);
        });
      });
    }
    /* 进入页面时就在找回流程中（点邮件链接回跳）→ 直接显示改密码面板 */
    if (window.Cloud && window.Cloud.auth && window.Cloud.auth.onRecovery) {
      var inRecovery = window.Cloud.auth.onRecovery(function () { showPanel('newpwd'); });
      if (inRecovery) showPanel('newpwd');
    }

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

  /* 顶栏账号模式徽标（Phase 2.8）
   * 注入到 .header-actions 里，和登录/退出按钮并排。位置上刻意放在账号区附近：
   * 用户看「我现在是谁」的时候，顺手就能看到「我的数据存在哪」。
   *
   * ⚠️ 幂等：initAuthUI 会被反复调用（换头像、同步回来都要重刷），
   *    所以这里用 data-mode-badge 找已存在的节点做「就地更新」而不是追加，
   *    否则每刷新一次就多一个徽标。 */
  function renderModeBadge() {
    var host = document.querySelector('.header-actions');
    if (!host) return;
    var info = accountModeInfo();

    var el = host.querySelector('[data-mode-badge]');
    if (!el) {
      el = document.createElement('span');
      el.setAttribute('data-mode-badge', '');
      /* 插到最前面，避免把登录按钮挤到搜索图标右侧 */
      host.insertBefore(el, host.firstChild);
    }
    el.className = 'mode-badge mode-badge--' + info.key;
    el.setAttribute('title', info.title + '：' + info.desc);
    el.setAttribute('aria-label', info.title + '。' + info.desc);
    /* 圆点 + 短文案：窄屏只留圆点（CSS 控制），宽屏显示全称 */
    el.innerHTML = '<span class="mode-badge-dot" aria-hidden="true"></span>' +
      '<span class="mode-badge-text">' + esc(info.badgeShort) + '</span>';
  }

  /* 顶栏登录态：登录后显示笔名 + 退出 */
  function initAuthUI() {
    var name = Auth.current();

    /* 换头像后要能就地刷新顶栏（否则头像换了、顶上还是旧字）。
     * 重跑 initAuthUI 即可：它是幂等的（用 __named / __bound 标记防重复）。 */
    window.__refreshNavAvatar = function () { initAuthUI(); };

    renderModeBadge();

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
        avatarHtml(name, 'auth-user-avatar') +
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
      renderMeAvatar(name);
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

      /* 未登录提示条按模式给文案。
       * ⚠️ 本地模式下绝不能写「自动合并上云」—— 没配 Supabase 时云根本不存在，
       *    登录后数据仍然只在本机。那是句空头承诺，用户按它做决策就会丢数据。 */
      var gTitle = document.getElementById('me-guest-title');
      var gDesc = document.getElementById('me-guest-desc');
      if (cloudMode()) {
        if (gTitle) gTitle.textContent = '登录后进度不丢';
        if (gDesc) gDesc.textContent =
          '现在标记的已学、收藏与成绩都只存在这台设备上。登录后会自动合并上云，换设备也能接着学。';
      } else {
        if (gTitle) gTitle.textContent = '进度只存在这台设备上';
        if (gDesc) gDesc.textContent =
          '本站当前运行在本地模式，没有连接云端 —— 即使注册登录，数据也仍然只保存在这台设备的浏览器里。' +
          '清理浏览器数据会一并清空，请注意。';
      }
    }
    bindMeAvatar();

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

    /* --- 3.2 数据存储说明（Phase 2.8）---
     * 三态文案全部来自 accountModeInfo()，与顶栏徽标同源。
     * ⚠️ 这里绝不能出现「已同步」字样，除非当前确实处于 cloud-signed：
     *    未登录时说成已同步，用户会真的以为换设备能看到，属于误导。 */
    var mi = accountModeInfo();
    var storeCard = document.getElementById('me-store-card');
    if (storeCard) {
      var badge = document.getElementById('me-mode-badge');
      if (badge) badge.className = 'mode-badge mode-badge--' + mi.key;
      setText('me-mode-badge-text', mi.badge);
      setText('me-store-title', mi.title);
      setText('me-store-desc', mi.desc);
      setText('me-store-where', mi.store);
      setText('me-store-sync', mi.sync);
      var cta = document.getElementById('me-store-cta');
      if (cta) cta.hidden = (mi.key !== 'cloud-guest');
    }
    setText('me-side-store', mi.store);

    /* --- 3.5 学习趋势：近 14 天每日学习篇数 ---
     * 数据全部来自 shici_daily（打卡时落的真实日期），没有记录就是空状态。
     * 反过来说：这里显示的每一根柱子，都对应那天真的点过一次打卡。 */
    renderMeTrend();

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

  /* ---------- 学习趋势图（「我的」页） ----------
   * 纯内联 SVG 柱状图，不引外部图表库（站点是静态页，多一个依赖就多一份挂掉的风险）。
   * 口径：横轴近 14 天、纵轴每天新学篇数；数值直接取自 shici_daily，不做任何估算。 */
  function renderMeTrend() {
    var box = document.getElementById('me-trend-chart');
    if (!box) return;   /* 不是「我的」页 */

    var DAYS = 14;
    var seq = getDailySeries(DAYS);
    var emptyEl = document.getElementById('me-trend-empty');
    var subEl = document.getElementById('me-trend-sub');

    var sum = seq.reduce(function (a, d) { return a + d.count; }, 0);
    setNum('me-trend-streak', dailyStreak(getDailySeries(DAILY_MAX)));
    setNum('me-trend-sum', sum);

    /* 一条记录都没有 → 显示空状态，不画图。
     * 注意判断的是「全部为 0」而不是「数组为空」：补零后的序列永远有 14 项。 */
    if (!sum && !seq.some(function (d) { return d.count > 0; })) {
      box.hidden = true;
      box.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (subEl) subEl.textContent = '最近 14 天的学习情况';
      return;
    }
    box.hidden = false;
    if (emptyEl) emptyEl.hidden = true;

    /* 柱高按最大值归一 —— 纵轴上限取真实峰值，不设虚高的固定刻度 */
    var max = Math.max.apply(null, seq.map(function (d) { return d.count; })) || 1;
    var W = 560, H = 120, PAD_B = 22, PAD_T = 8;
    var n = seq.length;
    var gap = 6;
    var bw = (W - gap * (n - 1)) / n;
    var plotH = H - PAD_B - PAD_T;
    /* 坐标一律取整：SVG 里的 34.42857142857143 既没必要也把 DOM 撑得难看。
     * 柱宽受浮点误差影响存在 ±1px 抖动，直接 round 掉。 */
    var r = function (v) { return Math.round(v * 100) / 100; };
    bw = r(bw);

    var todayKey = dayKey();
    var bars = seq.map(function (d, i) {
      var x = r(i * (bw + gap));
      var h = d.count > 0 ? Math.max(3, Math.round(d.count / max * plotH)) : 0;
      var y = PAD_T + plotH - h;
      var isToday = d.date === todayKey;
      var md = d.date.slice(5).replace('-', '/');   /* MM/DD，省宽度 */
      /* 柱子本身带 <title>，鼠标悬停即可看准确数值，不必再画坐标轴刻度 */
      return (
        '<g class="me-bar-group">' +
        '<title>' + esc(d.date) + '：' + d.count + ' 篇</title>' +
        (h > 0
          ? '<rect class="me-bar' + (isToday ? ' me-bar--today' : '') + '" x="' + x +
            '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="3"></rect>'
          : '<rect class="me-bar-slot" x="' + x + '" y="' + (PAD_T + plotH - 2) +
            '" width="' + bw + '" height="2" rx="1"></rect>') +
        /* 峰值柱上方标数字，其余靠悬停看，避免标签互相压字 */
        (d.count === max && d.count > 0
          ? '<text class="me-bar-num" x="' + r(x + bw / 2) + '" y="' + (y - 4) +
            '" text-anchor="middle">' + d.count + '</text>'
          : '') +
        /* 只标首、末两天，中间省略 —— 14 个日期全写会糊成一片 */
        ((i === 0 || i === n - 1)
          ? '<text class="me-bar-date" x="' + r(x + bw / 2) + '" y="' + (H - 6) +
            '" text-anchor="middle">' + md + '</text>'
          : '') +
        '</g>'
      );
    }).join('');

    /* ⚠️ 不能用 preserveAspectRatio="none"：图里有文字，横向拉伸会把字压扁变形。
     * 用默认的等比缩放 + CSS 控制高度，宽屏下 SVG 居中、两侧留白即可。 */
    box.innerHTML =
      '<svg class="me-trend-svg" viewBox="0 0 ' + W + ' ' + H + '" ' +
      'role="img" ' +
      'aria-label="最近 14 天每日学习篇数柱状图，合计 ' + sum + ' 篇">' +
      bars + '</svg>';

    if (subEl) {
      subEl.textContent = '最近 14 天新学 ' + sum + ' 篇 · 峰值 ' + max + ' 篇/天';
    }
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
      if (haystack.indexOf(state.keyword) === -1) {
        /* 异名兜底：库内用别称著录时，子串匹配会漏掉最著名的那首。
         * 典型：白居易《琵琶行》底本作《琵琶引》，只靠子串搜索，
         * 输入「琵琶行」命中的反而是唐人牛殳的同名作品。
         * 这里查异名表，让读者按通行名也能搜到。 */
        if (!aliasMatch(poem, state.keyword)) return false;
      }
    }
    return true;
  }

  /* 异名匹配：别名表里任一条的「别名」含关键词，且其「库内名」正是本条 → 命中 */
  function aliasMatch(poem, kw) {
    var map = window.POEM_ALIASES;
    if (!map || !kw) return false;
    var mine = poem.title + '|' + poem.author;
    for (var k in map) {
      if (k.indexOf(kw) === -1) continue;
      if (map[k] === mine) return true;
    }
    return false;
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
        /* ⚠️ 索引仍在后台补齐时，不能说「没有」—— 没搜到的可能只是
         * 还没载入的分片。如实告知进度，并给「等补齐」的按钮。 */
        var total = IDX_META.total || 0;
        var loaded = IndexStore.loadedCount();
        var stillLoading = loaded < total;
        var head = stillLoading
          ? '已载入的 ' + loaded.toLocaleString('en-US') + ' / ' + total.toLocaleString('en-US') +
            ' 首里没有「' + esc(state.keyword) + '」，其余分片还在载入'
          : '标题 / 作者 / 首行中没有「' + esc(state.keyword) + '」';
        wrap.innerHTML =
          '<div class="empty-state">' + head +
          '<br /><button class="btn btn--ghost" id="fulltext-scan-btn" style="margin-top:14px;">在全部 ' +
          total.toLocaleString('en-US') + ' 首的正文里搜（会分批下载正文数据）</button></div>';
        var scanBtn = document.getElementById('fulltext-scan-btn');
        if (scanBtn) {
          scanBtn.addEventListener('click', function () { scanFullText(state.keyword); });
        }
        /* 分片补齐后自动重搜，用户不必手动再输入一次 */
        if (stillLoading) {
          var kwNow = state.keyword;
          IndexStore.ensureAll(null, function () {
            if (state.keyword === kwNow) { state.page = 1; renderPoems(); }
          });
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
    /* ⚠️ ensureAll 是两参数签名 (onProgress, done)：前者每片调一次、
     * 后者全部完成才调。这里两个都要传 —— 只传第一个的话，
     * 末片到位后没有保证性的收尾重渲染（曾被误写成单参数）。 */
    IndexStore.ensureAll(function () { window.__refreshLibrary(); },
      function () { window.__refreshLibrary(); });

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
      '<div class="post-head">' + avatarHtml(p.author) +
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
      avatarHtml(c.author, 'avatar--xs') +
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
      '<div class="post-head">' + avatarHtml(p.author, 'avatar--sm') +
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
     * ⚠️ 全库 89,927 首分 6 片，默认只载入 1 片。
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

  /* 注译键的两种形态：
   *   ① "id:标题|作者" —— 同名多首经正文比对唯一定位后精确挂载（优先）
   *   ② "标题|作者"    —— 唯一的篇目，或同名多首中无法唯一定位的（走兜底）
   * 查法：先按 id 精确命中；未中再按标题全等；仍未中按同作者标题互含。
   * ⚠️ 第三级兜底对同名多首是「可能错挂」的 —— 保留它是因为大量标题带
   *    卷次/异体字的篇目靠它命中，禁用会让这些诗整块失去注译。 */
  function lookupNotes(title, author, id) {
    var notes = window.POEM_NOTES || {};
    /* ① 精确：id 命中（点开哪一首就给哪一首的注译） */
    var nid = (id === undefined || id === null) ? '' : String(id);
    if (nid) {
      var byId = notes[nid + ':' + title + '|' + author];
      if (byId) return byId;
    }
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

  /* ---------- 注译分片懒加载（性能：notes.js 3.05MB → 首屏仅索引 42KB） ----------
   * notes-index.js 给出「键 → 片号」的平行数组，据此只拉用到的那一片。
   * 与 TextStore 同构：cache 存已载片、pending 存同片的并发回调队列，
   * 避免同一片被并发请求重复下载。 */
  var NotesStore = (function () {
    var cache = {};      /* 片号 -> true（内容已并入 window.POEM_NOTES） */
    var pending = {};
    var KEYS = null, CHUNK = null;

    function idxOf(key) {
      if (!KEYS) {
        KEYS = window.POEM_NOTES_KEYS || [];
        CHUNK = window.POEM_NOTES_CHUNK || [];
      }
      var i = KEYS.indexOf(key);
      return i === -1 ? -1 : CHUNK[i];
    }
    function loadChunk(no, cb) {
      if (cache[no]) return cb(true);
      if (pending[no]) { pending[no].push(cb); return; }
      pending[no] = [cb];
      loadScript('assets/data/notes/p' + no + '.js?v=' + DATA_V, function (ok) {
        var got = window['POEM_NOTES_' + no];
        if (ok && got) {
          /* 并入全局表：lookupNotes 的遍历逻辑无需改动 */
          var N = window.POEM_NOTES || (window.POEM_NOTES = {});
          for (var k in got) if (got.hasOwnProperty(k)) N[k] = got[k];
          cache[no] = true;
        }
        var cbs = pending[no];
        delete pending[no];
        cbs.forEach(function (cb2) { cb2(!!cache[no]); });
      });
    }
    /* 加载某首诗的注译。候选键按精确度降序尝试，取第一个在索引里存在的：
     *   ① "id:标题|作者" —— 同名多首精确挂载的条目
     *   ② "标题|作者"    —— 唯一篇目
     *   ③ 标题全等的任一键 —— 同名多首中未精确挂载的（与 lookupNotes 兜底一致）
     * 都找不到 → 回调 false，由 lookupNotes 自己再兜底一遍。 */
    function ensure(title, author, id, cb) {
      var cands = [];
      if (id !== undefined && id !== null) cands.push(id + ':' + title + '|' + author);
      cands.push(title + '|' + author);
      var no = -1, i;
      for (i = 0; i < cands.length; i++) { no = idxOf(cands[i]); if (no !== -1) break; }
      if (no === -1) {
        /* 标题全等兜底：同名多首里只有其中一首被挂了注译时仍能加载到那一片。
         * 先调一次 idxOf 确保 KEYS/CHUNK 已从 window 初始化，再遍历。 */
        idxOf('');
        for (i = 0; i < KEYS.length; i++) {
          var p = KEYS[i].split('|');
          if (p[0] === title) { no = CHUNK[i]; break; }
        }
      }
      if (no === -1) return cb(false);
      loadChunk(no, cb);
    }
    /* 该首诗的注译是否还需要加载 */
    function need(title, author, id) {
      var cands = [];
      if (id !== undefined && id !== null) cands.push(id + ':' + title + '|' + author);
      cands.push(title + '|' + author);
      for (var i = 0; i < cands.length; i++) {
        var no = idxOf(cands[i]);
        if (no !== -1) return !cache[no];
      }
      return false;
    }
    return { ensure: ensure, need: need, chunk: loadChunk };
  })();

  /* ---------- 7a. 精编专题（课堂页入口，PRD Phase 2） ----------
   * 数据来自 assets/data/topics.js（build_topics.js 生成）。
   * 只做三件事：列专题卡 / 点开看诗单 / 点诗进课堂。
   * ⚠️ 不在前端做任何二次筛选或排序 —— 口径由构建脚本固化，
   *    前端再算一遍就会出现「卡上写 24 首、点进去 22 首」的不一致。 */

  /* 专题内诗单：点诗进课堂。诗的 id 不在 topics.js 里，需回索引查。
   * 索引分片可能未载入 → 走 IndexStore.ensureAll 补齐后再定位。 */
  var _topicIndex = null;
  function topicFindPoem(title, author) {
    if (!_topicIndex) {
      _topicIndex = [];
      var meta = window.POEM_INDEX_META || {};
      for (var c = 0; c < (meta.chunks || 0); c++) {
        var arr = window['POEM_INDEX_' + c];
        if (arr) _topicIndex = _topicIndex.concat(arr);
      }
    }
    var i, r;
    for (i = 0; i < _topicIndex.length; i++) {
      r = _topicIndex[i];
      if (r[0] === title && r[1] === author) return i;
    }
    /* 作者署名可能有差异（如「佚名」vs「汉乐府」）：退到标题全等 */
    for (i = 0; i < _topicIndex.length; i++) {
      if (_topicIndex[i][0] === title) return i;
    }
    return -1;
  }

  /* 分组顺序与标题：18 个专题混在一起会看不出层次，按维度分开列 */
  var TOPIC_GROUPS = [
    { kind: 'theme', title: '按主题', desc: '同一题材下的篇目' },
    { kind: 'author', title: '按诗人', desc: '一位诗人读透一组作品' },
    { kind: 'dynasty', title: '按朝代', desc: '一个时代的整体面貌' }
  ];

  function renderTopics() {
    var section = document.getElementById('topics-section');
    var grid = document.getElementById('topic-grid');
    if (!section || !grid) return false;
    var topics = window.STUDY_TOPICS;
    if (!topics || !topics.length) return false;

    section.hidden = false;

    /* ⚠️ data-topic 存的是**全局下标**，不是组内下标 ——
     * 分组≠切分数据源，点卡时仍要能取回原专题对象 */
    var html = '';
    TOPIC_GROUPS.forEach(function (g) {
      var idxs = [];
      topics.forEach(function (t, i) { if (t.kind === g.kind) idxs.push(i); });
      if (!idxs.length) return;         /* 该维度没有专题（如 topics.js 只含主题）*/

      html += '<div class="topic-group">' +
        '<div class="topic-group-head">' +
        '<h3 class="topic-group-title">' + esc(g.title) + '</h3>' +
        '<span class="topic-group-count">' + idxs.length + ' 个专题</span>' +
        '</div>' +
        '<p class="topic-group-desc">' + esc(g.desc) + '</p>' +
        '<div class="topic-group-grid">' +
        idxs.map(function (i) {
          var t = topics[i];
          return '<button class="topic-card" type="button" data-topic="' + i + '">' +
            '<span class="topic-card-name">' + esc(t.name) + '</span>' +
            (t.from ? '<span class="topic-card-from">' + esc(t.from) + '</span>' : '') +
            '<span class="topic-card-basis">' + esc(t.basis) + '</span>' +
            '<span class="topic-card-count">' + t.picked + ' 首</span>' +
            '</button>';
        }).join('') +
        '</div></div>';
    });

    /* 兜底：出现了 TOPIC_GROUPS 未覆盖的 kind，也要显示出来，不能吞掉 */
    var known = TOPIC_GROUPS.map(function (g) { return g.kind; });
    var orphans = [];
    topics.forEach(function (t, i) { if (known.indexOf(t.kind) === -1) orphans.push(i); });
    if (orphans.length) {
      html += '<div class="topic-group">' +
        '<div class="topic-group-head"><h3 class="topic-group-title">其他</h3></div>' +
        '<div class="topic-group-grid">' +
        orphans.map(function (i) {
          var t = topics[i];
          return '<button class="topic-card" type="button" data-topic="' + i + '">' +
            '<span class="topic-card-name">' + esc(t.name) + '</span>' +
            '<span class="topic-card-basis">' + esc(t.basis) + '</span>' +
            '<span class="topic-card-count">' + t.picked + ' 首</span></button>';
        }).join('') + '</div></div>';
    }

    grid.innerHTML = html;

    grid.addEventListener('click', function (e) {
      var card = e.target.closest('[data-topic]');
      if (!card) return;
      var t = topics[parseInt(card.getAttribute('data-topic'), 10)];
      if (t) openTopic(t);
    });
    return true;
  }

  function openTopic(t) {
    var cards = document.getElementById('topics-section');
    var detail = document.getElementById('topic-detail');
    if (!cards || !detail) return;
    cards.hidden = true;
    detail.hidden = false;

    var titleEl = document.getElementById('topic-detail-title');
    var metaEl = document.getElementById('topic-detail-meta');
    var listEl = document.getElementById('topic-poem-list');
    if (titleEl) titleEl.textContent = t.name;
    if (metaEl) {
      /* ⚠️ 口径全写在脸上：这个专题从多少首里选、依据是什么、题名出处。
       * 数字全部来自 topics.js（构建期固化），前端不重算、不美化。 */
      var parts = [];
      parts.push(t.basis);
      parts.push('候选池共 ' + t.poolTotal.toLocaleString('en-US') + ' 首，本专题收 ' + t.picked + ' 首');
      parts.push('入选篇目均有译文与赏析');
      if (t.from) parts.push('题名出自 ' + t.from);
      metaEl.textContent = parts.join(' · ');
    }

    if (listEl) {
      listEl.innerHTML = t.items.map(function (it) {
        /* 用 title+author 寻址（与错题本同一套入口），无需先知道 id */
        var href = 'study.html?title=' + encodeURIComponent(it.t) +
          '&author=' + encodeURIComponent(it.a);
        return '<li class="topic-poem-item">' +
          '<a class="topic-poem-link" href="' + href + '">' +
          '<span class="topic-poem-title">' + esc(it.t) + '</span>' +
          '<span class="topic-poem-author">' + esc(it.a) + ' · ' + esc(it.d) + '</span>' +
          '</a></li>';
      }).join('');
    }

    /* 题名出处的原诗：可点回原文。查不到就不显示这一行（宁缺不假） */
    if (t.fromId != null && t.fromTitle) {
      var more = document.createElement('p');
      more.className = 'topic-detail-source';
      more.innerHTML = '题名出自 <a href="study.html?id=' + t.fromId + '">' +
        esc(t.fromTitle) + '</a>';
      listEl.parentNode.insertBefore(more, listEl.nextSibling);
    }

    var main = document.getElementById('study-body');
    if (main) main.hidden = true;
    var head = document.getElementById('study-head-actions');
    if (head) head.hidden = true;
    var tEl = document.getElementById('study-title');
    if (tEl) tEl.textContent = t.name;
    var sEl = document.getElementById('study-subtitle');
    if (sEl) sEl.textContent = '精编专题';
    window.scrollTo(0, 0);
  }

  function bindTopicBack() {
    var back = document.getElementById('topic-back');
    if (!back) return;
    back.addEventListener('click', function () {
      var cards = document.getElementById('topics-section');
      var detail = document.getElementById('topic-detail');
      if (cards) cards.hidden = false;
      if (detail) detail.hidden = true;

      var main = document.getElementById('study-body');
      if (main) main.hidden = true;
      var head = document.getElementById('study-head-actions');
      if (head) head.hidden = true;
      var tEl = document.getElementById('study-title');
      if (tEl) tEl.textContent = '诗词课堂';
      var sEl = document.getElementById('study-subtitle');
      if (sEl) sEl.textContent = '';
      window.scrollTo(0, 0);
    });
  }

  /* ============ 精品课程（PRD 第十七条课堂四入口之一） ============
   * 与专题的区别：课程是有序学习路径 —— 课次有先后、有进度，面向「跟完一门课」。
   * 课次 id 由 build_courses.js 构建期固化（i 字段），前端不重算；
   * 已学状态复用 shici_learned（与课堂打卡同一存储，不另起口径）。 */
  function renderCourses() {
    var section = document.getElementById('courses-section');
    var grid = document.getElementById('course-grid');
    if (!section || !grid) return false;
    var courses = window.STUDY_COURSES;
    if (!courses || !courses.length) return false;

    section.hidden = false;
    grid.innerHTML = courses.map(function (c, i) {
      return '<button class="topic-card" type="button" data-course="' + i + '">' +
        '<span class="topic-card-name">' + esc(c.name) + '</span>' +
        '<span class="topic-card-basis">' + esc(c.basis) + '</span>' +
        '<span class="topic-card-count">' + c.lessonCount + ' 课</span>' +
        '</button>';
    }).join('');

    grid.addEventListener('click', function (e) {
      var card = e.target.closest('[data-course]');
      if (!card) return;
      var c = courses[parseInt(card.getAttribute('data-course'), 10)];
      if (c) openCourse(c);
    });
    return true;
  }

  function findCourse(cid) {
    var courses = window.STUDY_COURSES || [];
    for (var i = 0; i < courses.length; i++) {
      if (courses[i].id === cid) return courses[i];
    }
    return null;
  }

  function renderCourseLessons(c) {
    var listEl = document.getElementById('course-lesson-list');
    var progEl = document.getElementById('course-progress');
    if (!listEl) return;
    var done = 0;
    listEl.innerHTML = c.lessons.map(function (l) {
      var learned = typeof l.i === 'number' && isLearned(l.i);
      if (learned) done++;
      /* 优先用构建期固化的 id 直达；缺 id 时退回 title+author 寻址（不编造） */
      var href = typeof l.i === 'number'
        ? 'study.html?id=' + l.i
        : 'study.html?title=' + encodeURIComponent(l.t) + '&author=' + encodeURIComponent(l.a);
      return '<li class="topic-poem-item">' +
        '<a class="topic-poem-link' + (learned ? ' lesson-learned' : '') + '" href="' + href + '">' +
        '<span class="topic-poem-title">' + esc(l.t) + '</span>' +
        '<span class="topic-poem-author">' + esc(l.a) + ' · ' + esc(l.d) + '</span>' +
        (learned ? '<span class="lesson-badge">已学</span>' : '') +
        '</a></li>';
    }).join('');
    if (progEl) {
      /* 进度只陈述事实（学过 = 在原文页点过打卡），done 为 0 时如实显示 0 */
      progEl.textContent = '已学 ' + done + ' / ' + c.lessons.length +
        ' 课（学过 = 在原文页点过「今日打卡」）';
    }
  }

  function openCourse(c) {
    var cards = document.getElementById('courses-section');
    var topicsSec = document.getElementById('topics-section');
    var detail = document.getElementById('course-detail');
    if (!detail) return;
    if (cards) cards.hidden = true;
    if (topicsSec) topicsSec.hidden = true;
    detail.hidden = false;

    var titleEl = document.getElementById('course-detail-title');
    var metaEl = document.getElementById('course-detail-meta');
    if (titleEl) titleEl.textContent = c.name;
    if (metaEl) {
      /* 口径全写在脸上：数字全部来自 courses.js（构建期固化），前端不重算 */
      metaEl.textContent = c.basis + ' · 入选篇目均有注释与赏析';
    }
    renderCourseLessons(c);

    var main = document.getElementById('study-body');
    if (main) main.hidden = true;
    var head = document.getElementById('study-head-actions');
    if (head) head.hidden = true;
    var tEl = document.getElementById('study-title');
    if (tEl) tEl.textContent = c.name;
    var sEl = document.getElementById('study-subtitle');
    if (sEl) sEl.textContent = '精品课程';
    window.scrollTo(0, 0);
  }

  function bindCourseBack() {
    var back = document.getElementById('course-back');
    if (!back) return;
    back.addEventListener('click', function () {
      var cards = document.getElementById('courses-section');
      var topicsSec = document.getElementById('topics-section');
      var detail = document.getElementById('course-detail');
      if (cards) cards.hidden = false;
      /* 深链接 ?course= 直进时专题网格可能没渲染过：网格为空就不显示该区，
       * 不摆一个空壳（宁缺不假） */
      var topicGrid = document.getElementById('topic-grid');
      if (topicsSec && topicGrid && topicGrid.childElementCount) topicsSec.hidden = false;
      if (detail) detail.hidden = true;

      var main = document.getElementById('study-body');
      if (main) main.hidden = true;
      var head = document.getElementById('study-head-actions');
      if (head) head.hidden = true;
      var tEl = document.getElementById('study-title');
      if (tEl) tEl.textContent = '诗词课堂';
      var sEl = document.getElementById('study-subtitle');
      if (sEl) sEl.textContent = '';
      window.scrollTo(0, 0);
    });
  }

  function initStudy() {
    var titleEl = document.getElementById('study-title');
    if (!titleEl) return;

    var params = new URLSearchParams(location.search);
    var id = parseInt(params.get('id'), 10);
    var courseId = params.get('course');
    var hasPoemParam = params.has('id') || params.has('title');

    /* 入口页 = 精品课程 + 精编专题；?course=<id> 深链接则直接打开该门课。
     * course 值未知时如实退回入口页（网格照常显示，不报错装死）。
     * renderTopics/renderCourses 各只调用一次（内部会绑事件，调两次会重复绑定）。 */
    if (!hasPoemParam) {
      var courseHit = courseId ? findCourse(courseId) : null;
      var showedTopics = renderTopics();
      var showedCourses = renderCourses();
      if (showedTopics || showedCourses) {
        bindTopicBack();
        bindCourseBack();
        if (courseHit) {
          openCourse(courseHit);
        } else {
          titleEl.textContent = '诗词课堂';
          var sub = document.getElementById('study-subtitle');
          if (sub) sub.textContent = '读原文 · 逐句理解 · 了解背景 · 理解名句 · 整体赏析 · 开始背诵';
        }
        var body = document.getElementById('study-body');
        if (body) body.hidden = true;
        var headActions = document.getElementById('study-head-actions');
        if (headActions) headActions.hidden = true;
        return;
      }
      /* topics.js / courses.js 都没加载出来：如实降级到默认诗，不显示空入口区 */
    }

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

    /* 正文与注译**并行**懒加载，两者都到位再渲染（互不阻塞，谁快都等对方）。
     * 注译分片是「键所在的那一片」，通常只 1 片（约 400KB）；已在内存时立即回调。 */
    var _textReady = false, _notesReady = false, _poem = poem;
    var stepsRedraw = null;   /* initStudySteps 返回的重绘函数，供注译晚到时补绘 */
    /* 注译回调可能在 initStudySteps 之前就跑完（该片已缓存时是同步回调），
     * 那时 stepsRedraw 还未赋值 → 记下「已就绪」状态，赋值后再补一次。 */
    var _notesFired = false;
    function _tryRender() {
      if (_textReady && _notesReady) renderStudyText(_poem);
    }
    TextStore.text(poem.id, function (text) {
      _poem.text = text || _poem.line;
      _textReady = true;
      _tryRender();
    });
    NotesStore.ensure(poem.title, poem.author, poem.id, function () {
      /* 找不到也照常放行 —— 后续 lookupNotes 会走模糊兜底 */
      _notesReady = true;
      _notesFired = true;
      _tryRender();
      /* 六步的第 6 步（背诵提示）读 notes.r，且 render() 是同步的 ——
       * 若用户手快，在分片到位前就点到第 6 步，那一步会显示为空。
       * 故数据到手后主动重绘一次，让第 6 步就地补上（有则显示，无则整块隐藏）。 */
      if (typeof stepsRedraw === 'function') stepsRedraw();
    });

    /* 六步学习流程（PRD 第十七条）
     * 读原文 → 逐句理解 → 了解背景 → 理解名句 → 整体赏析 → 开始背诵
     * 进度按「每首诗」独立记忆（localStorage: shici_study_step = {poemId: n}），
     * 下次从这首诗上次停下的地方继续。 */
    stepsRedraw = initStudySteps(poem);
    if (_notesFired && typeof stepsRedraw === 'function') stepsRedraw();

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
          /* 记一笔到今天的趋势记录 —— 必须在「新学」分支里，
           * 重复点同一首不计数，否则曲线会被重复打卡虚增。 */
          markDailyToday(1);
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
        /* 学习手册「六、背诵」的提示（节奏 / 脉络 / 易错字）：有则展示，无则整块隐藏。
         * ⚠️ 只呈现手册原文，不生成、不补写（PRD 第四十条）。 */
        var guide = document.getElementById('recite-guide');
        if (guide) {
          var ex = lookupNotes(poem.title, poem.author, poem.id);
          var rg = ex && ex.r ? String(ex.r).trim() : '';
          if (rg) {
            guide.innerHTML =
              '<p class="recite-guide-label">学习手册 · 背诵提示</p>' +
              '<p class="serif recite-guide-text">' + esc(rg) + '</p>';
            guide.hidden = false;
          } else {
            guide.innerHTML = '';
            guide.hidden = true;
          }
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
    /* 返回重绘函数：注译分片晚到时可再调一次，
     * 让第 6 步的背诵提示（读 notes.r）就地补上，无需用户手动切步。 */
    return render;
  }

  /* 正文块到位后：渲染原文 / 注释 / 译文 / 赏析面板 */
  function renderStudyText(poem) {
    var curated = CURATED[poem.title + '|' + poem.author] || null;
    var extra = lookupNotes(poem.title, poem.author, poem.id);
    var lines = poem.text.split('\n');

    /* 原文面板：逐句可点，并可就地标「名句」。
     *
     * 为什么第 1 步就能标：六步是线性引导，用户读原文时已经看到全篇、
     * 心里那句「这写得好」是此刻冒出来的，却要一路点完前 3 步到第 4 步
     * 才能标 —— 摩擦就在这。这里给每句加一个轻量星标就够了。
     *
     * ⚠️ 与第 4 步共用同一份存储（shici_picked_lines），
     *    所以两边天然同步：这里标了，第 4 步「我的名句」面板立刻有。
     *    仍是「用户自己点选」，系统不判定哪句是名句（PRD 第四十条）。 */
    var verseList = document.getElementById('verse-list');
    if (verseList) {
      var pickedNow = loadPickedLines(poem.id);
      verseList.innerHTML = lines.map(function (ln, i) {
        var note = curated && curated.notes[i] ? curated.notes[i][1] : '';
        var t = String(ln || '').trim();
        var on = t && pickedNow.indexOf(t) !== -1;
        return (
          '<div class="verse-row' + (on ? ' is-picked' : '') + '" data-verse="' + i + '"' +
          (t ? ' data-verse-text="' + esc(t) + '"' : '') + '>' +
          '<span class="verse-text">' + esc(ln) + '</span>' +
          (note ? '<span class="verse-note">' + esc(note) + '</span>' : '') +
          (t ? '<button class="verse-pick" type="button"' +
            ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
            ' title="' + (on ? '取消标记' : '标为名句') + '"' +
            ' aria-label="' + (on ? '取消标记这句为名句' : '把这句标为名句') + '">' +
            '<span aria-hidden="true">' + (on ? '★' : '☆') + '</span></button>' : '') +
          '</div>'
        );
      }).join('');
      verseList.querySelectorAll('[data-verse]').forEach(function (row) {
        row.addEventListener('click', function (e) {
          /* 点星标 → 切换名句标记；点其余部分 → 高亮该句（原有行为） */
          if (e.target.closest('.verse-pick')) return;
          verseList.querySelectorAll('[data-verse]').forEach(function (r) {
            r.classList.toggle('is-active', r === row);
          });
        });
      });
      bindVersePick(verseList, poem);
      renderVersePickHint(verseList, poem);
    }

    /* 注释面板：优先逐句精注（CURATED），其次词句注释（notes.js 的 n 字段，
     * 来自科目一 docx 学习手册，格式「词：释义」），都没有才显示编校占位。
     * ⚠️ 不把词注硬凑成逐句 —— 有什么渲染什么，不装。 */
    var notePanel = document.getElementById('panel-notes');
    if (notePanel) {
      if (curated) {
        notePanel.innerHTML = '<ul class="note-list">' + curated.notes.map(function (n) {
          return '<li class="note-item"><strong>' + esc(n[0]) + '</strong><span>' + esc(n[1]) + '</span></li>';
        }).join('') + '</ul>';
      } else if (extra && extra.n && extra.n.length) {
        notePanel.innerHTML = '<ul class="note-list">' + extra.n.map(function (n) {
          var sep = n.indexOf('：');
          if (sep === -1) sep = n.indexOf(':');
          return sep > 0
            ? '<li class="note-item"><strong>' + esc(n.slice(0, sep)) + '</strong><span>' + esc(n.slice(sep + 1)) + '</span></li>'
            : '<li class="note-item"><span>' + esc(n) + '</span></li>';
        }).join('') + '</ul>';
      } else {
        notePanel.innerHTML = '<div class="empty-state">该篇的注释正在编校中，欢迎到社区广场分享你的理解。</div>';
      }
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
     * 数据在 notes.js 的 b 字段（1507 条注译中约 1221 条带背景）。
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
     *   · 学习手册标注的名句给「手册推荐名句」标记（可查的出版物标注，非系统瞎猜）；
     *   · 赏析中确实引用过的句子给「赏析曾引用」标记（有据可查，不是猜的）；
     *   · 用户选完写自己的理由，理由框留空也不编内容。 */
    var pickList = document.getElementById('pick-lines');
    var famousPanel = document.getElementById('panel-famous');
    var famousCard = document.getElementById('famous-card');
    if (pickList) {
      var hints = pickFamousLines(poem, lines, curated, apreForFamous(curated, extra), extra);
      renderPickLines(pickList, lines, hints, poem);
    }
    if (famousPanel) renderPickedFamous(famousPanel, poem);
  }

  /* 第四步的点选区：列出全篇句子，标出「手册推荐 / 赏析引用」的提示位。*/
  function renderPickLines(listEl, lines, hints, poem) {
    var hintSet = {};
    (hints || []).forEach(function (h) { hintSet[h.line] = { why: h.why || '', tag: h.tag || '赏析曾引用' }; });
    var picked = loadPickedLines(poem.id);
    listEl.innerHTML = lines.map(function (ln, i) {
      var t = String(ln || '').trim();
      if (!t) return '';
      var isHint = Object.prototype.hasOwnProperty.call(hintSet, t);
      var h = hintSet[t] || {};
      return '<li class="pick-line' + (isHint ? ' pick-line--hint' : '') + '"' +
        ' data-pick-line="' + i + '" data-line-text="' + esc(t) + '"' +
        ' role="button" tabindex="0"' +
        ' aria-pressed="' + (picked.indexOf(t) !== -1 ? 'true' : 'false') + '">' +
        '<span class="pick-line-text serif">' + esc(t) + '</span>' +
        (isHint ? '<span class="pick-line-tag">' + esc(h.tag) + '</span>' : '') +
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

  /* 第 1 步「读原文」里的就地标注。
   * 与第 4 步 bindPickLines 共用 loadPickedLines / savePickedLines，
   * 因此两处选择天然一致 —— 不再重复实现一份，避免两套逻辑日后走偏。 */
  function bindVersePick(verseList, poem) {
    function togglePick(row) {
      var text = row.getAttribute('data-verse-text');
      if (!text) return;
      var picked = loadPickedLines(poem.id);
      var idx = picked.indexOf(text);
      var nowOn;
      if (idx === -1) {
        picked.push(text);
        nowOn = true;
      } else {
        picked.splice(idx, 1);
        nowOn = false;
      }
      /* 上限 3 句，与第 4 步一致：多了不叫「名句」。
       * 用与第 4 步相同的写法（保留末尾 = 最新的 3 句），
       * 两处规则必须同源，否则同一次点击在两步得到的结果会不一样。 */
      var dropped = null;
      if (picked.length > 3) {
        var kept = picked.slice(-3);
        dropped = picked.slice(0, picked.length - 3).join('、');
        picked = kept;
      }
      savePickedLines(poem.id, picked);
      syncVersePickUI(verseList, poem);

      /* 第 4 步的名句面板若已在 DOM 里，一并刷新（两个面板同源，必须同步） */
      var famousPanel = document.getElementById('panel-famous');
      if (famousPanel) renderPickedFamous(famousPanel, poem);
      var pickList = document.getElementById('pick-lines');
      if (pickList) {
        Array.prototype.forEach.call(pickList.querySelectorAll('[data-pick-line]'), function (li) {
          var on = picked.indexOf(li.getAttribute('data-line-text')) !== -1;
          li.classList.toggle('is-picked', on);
          li.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }

      /* 挤掉旧句时如实说明，不让用户困惑「我刚才点的那句去哪了」 */
      if (dropped) {
        announceVersePick('已标 3 句（上限）。最早标记的「' + dropped + '」已移出。');
      } else {
        announceVersePick((nowOn ? '已标为名句：' : '已取消标记：') + text);
      }
    }
    verseList.addEventListener('click', function (e) {
      var btn = e.target.closest('.verse-pick');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var row = btn.closest('[data-verse]');
      if (row) togglePick(row);
    });
  }

  /* 把存储状态刷到第 1 步的星标上（含计数提示） */
  function syncVersePickUI(verseList, poem) {
    var picked = loadPickedLines(poem.id);
    Array.prototype.forEach.call(verseList.querySelectorAll('[data-verse]'), function (row) {
      var t = row.getAttribute('data-verse-text');
      var on = !!t && picked.indexOf(t) !== -1;
      row.classList.toggle('is-picked', on);
      var btn = row.querySelector('.verse-pick');
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.setAttribute('title', on ? '取消标记' : '标为名句');
        btn.setAttribute('aria-label', on ? '取消标记这句为名句' : '把这句标为名句');
        var inner = btn.querySelector('[aria-hidden="true"]');
        if (inner) inner.textContent = on ? '★' : '☆';
      }
    });
    renderVersePickHint(verseList, poem);
  }

  /* 第 1 步的计数与说明。没有选择时给一句「怎么用」，不给数字 0 干瞪眼。
   * ⚠️ 只说做得到的事：名句目前只在课堂页第 4 步与这里展示，
   *    「我的」页没有这个区块，不要写成「我的页也会显示」（PRD 第四十条）。 */
  function renderVersePickHint(verseList, poem) {
    var hint = document.getElementById('verse-pick-hint');
    if (!hint) return;
    var picked = loadPickedLines(poem.id);
    hint.textContent = picked.length
      ? '已标记 ' + picked.length + ' / 3 句名句 · 第 4 步「理解名句」会一并列出'
      : '读到喜欢的句子，点右侧 ☆ 标为你的名句（最多 3 句）';
  }

  /* 读屏播报：星标是图标按钮，视觉变化需要一句文字说明 */
  function announceVersePick(msg) {
    var live = document.getElementById('verse-pick-live');
    if (!live) return;
    live.textContent = msg;
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
  /* 诗句归一化：去掉标点、空白、引号，只留汉字，用于「手册名句能否落到原文某句」的比对 */
  function verseKey(s) {
    return String(s || '').replace(/[""'']/g, '').replace(/[^\u4e00-\u9fa5]/g, '');
  }
  /* 手册名句 m 字段 → 归一化后的句子数组。
   * m 常是多句拼接（「青，取之于蓝…。不积跬步…。锲而舍之…。」），必须拆开逐句落位；
   * 单引号对内的顿号/分号（「锲而舍之，朽木不折」）仍属同句，故只按句末标点切。
   * 返回去标点的纯汉字串，长度 < 4 的（语气残句等）由调用方丢弃。*/
  function splitFamousSentences(m) {
    return String(m || '')
      .split(/[。！？!?；;\n]/)
      .map(function (x) { return verseKey(x); })
      .filter(function (x) { return x.length >= 4; });
  }
  function pickFamousLines(poem, lines, curated, appreciation, extra) {
    var out = [];
    /* ① 手工标注的千古名句（最高优先，可信）—— 有则直接用 */
    if (curated && curated.famous && curated.famous.length) {
      return curated.famous.map(function (f) {
        return { line: f[0], why: f[1] || '' };
      });
    }
    /* ② 学习手册「四、名句」的标注（笔记 m 字段）—— 这是可查的出版物标注，
     *    不是「系统猜名句」，所以可作提示位（PRD 第四十条）。
     *    ⚠️ m 字段常是**多句拼接**（如「青，取之于蓝…。不积跬步…。锲而舍之…。」），
     *       故必须**先按句切分、再逐句各自落位** —— 整串拿去比对永远匹配不上。
     *    单句落位规则（库内断行不固定，故不能只比「整行全等」）：
     *      ⓐ 库内某一行**完整包含**该句（库常把两联并作一行）→ 标该行；
     *      ⓑ 该句**跨了库内多行**（库按句/联拆行）→ 标出构成它的每一行；
     *      ⓒ 都对不上（多为库内异文，如「啼不尽」vs 手册「啼不住」）→ 该句不标，绝不硬凑。
     *    关于「跨行上限」：散文名篇（劝学/三峡/兰亭集序…）正文常按整段或长句断行，
     *    一句名句跨 3~5 行是常态，故上限按该句长度推导而非写死。*/
    var m = extra && extra.m;
    if (m) {
      var sentences = splitFamousSentences(m);
      for (var si = 0; si < sentences.length; si++) {
        var mk = sentences[si];
        if (mk.length < 4) continue;
        /* ⓐ 库内整行是该句的子串（库把两联并作一行） */
        for (var q = 0; q < lines.length; q++) {
          var lq = String(lines[q] || '');
          if (lq.trim() && verseKey(lq).indexOf(mk) !== -1) {
            return [{ line: lq, why: '', tag: '手册推荐名句' }];
          }
        }
        /* ⓑ 该句跨库内多行 —— 收集构成它的每一行 */
        var parts = [];
        for (var w = 0; w < lines.length; w++) {
          var lw = String(lines[w] || '');
          var kw = verseKey(lw);
          if (kw.length >= 4 && mk.indexOf(kw) !== -1 && parts.indexOf(lw) === -1) parts.push(lw);
        }
        var maxParts = Math.max(2, Math.ceil(mk.length / 7) + 2);
        if (parts.length && parts.length <= maxParts) {
          return parts.map(function (x) { return { line: x, why: '', tag: '手册推荐名句' }; });
        }
      }
    }
    /* ③ 按「半句」在前 4 字做匹配 —— 赏析常引用半句、且可能不引全。
     *    实测这套规则在真实赏析上命中约 67%，且抽样结果无一误标
     *    （老骥伏枥 / 采菊东篱下 / 大漠孤烟直 等均为公认名句）。
     *    剩余标不出来是正常的 —— 那些诗的赏析本就没引原文，
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
        if (hit) out.push({ line: raw, why: '', tag: '赏析曾引用' });
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
    loadScript('assets/data/quizpool/p' + no + '.js?v=' + DATA_V, function (ok) {
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
