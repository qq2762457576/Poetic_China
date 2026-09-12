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

    /* --- 3.6 学习成就：由已学/连续/收藏/成绩实时推导 --- */
    renderMeAchievements();

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

