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

