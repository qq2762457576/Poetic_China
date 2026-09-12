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

