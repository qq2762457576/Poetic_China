  /* ---------- 4. 首页：每日推荐 + 分体裁板块 ----------
   * 首页只加载 featured.js（54KB，含正文与全站统计），不加载全库索引 */
  /* ---------- 学习成就（3.5 / PRD 第二十一条）----------
   * 六项成就全部由已有数据实时推导：
   *   已学篇目 / 连续天数 / 每日记录 / 收藏数 / 挑战最高分。
   * ⚠️ 刻意不新增存储字段、不建表 ——
   *   ① 派生值不会因同步遗漏而与真实进度不一致
   *   ② 不需要站长跑任何 SQL 补丁（写了≠生效）
   *   ③ 换设备登录后算出的成就完全一致
   * ⚠️ 不用「攻克错题数」做成就：错题掌握后即从本中移除，
   *    历史攻克数没有任何地方记录，做出来只能是编造。
   * 阈值集中在 ACHIEVEMENTS 表，调整只改这里。 */
  var ACHIEVEMENTS = [
    { id: 'first', seal: '初', name: '初识诗香', desc: '学会第一首诗',
      need: 1, value: function (s) { return s.learned; }, unit: '首' },
    { id: 'learn30', seal: '积', name: '积学储宝', desc: '累计学会 30 首',
      need: 30, value: function (s) { return s.learned; }, unit: '首' },
    { id: 'streak7', seal: '韦', name: '韦编三绝', desc: '连续学习 7 天',
      need: 7, value: function (s) { return s.streak; }, unit: '天' },
    { id: 'days10', seal: '诗', name: '诗心不辍', desc: '累计 10 天有学习记录',
      need: 10, value: function (s) { return s.activeDays; }, unit: '天' },
    { id: 'fav20', seal: '博', name: '博观约取', desc: '收藏 20 首',
      need: 20, value: function (s) { return s.favs; }, unit: '首' },
    { id: 'score80', seal: '才', name: '才高八斗', desc: '挑战单局最高分达 80',
      need: 80, value: function (s) { return s.bestScore; }, unit: '分' }
  ];
  /* 纯函数：给统计对象，返回带进度与达成态的成就列表（便于测试） */
  function computeAchievements(stats, defs) {
    var list = defs || ACHIEVEMENTS;
    var s = stats || {};
    return list.map(function (a) {
      var cur = a.value(s) || 0;
      /* 进度封顶，避免显示「137 / 30」这种超过目标的数字 */
      var shown = Math.min(cur, a.need);
      return {
        id: a.id, seal: a.seal, name: a.name, desc: a.desc,
        unit: a.unit, need: a.need, cur: cur, shown: shown,
        got: cur >= a.need
      };
    });
  }

  function renderMeAchievements() {
    var grid = document.getElementById('me-achieve-grid');
    if (!grid) return;   /* 不是「我的」页 */

    var st = loadChallengeStats();
    var daily = loadDaily();
    var activeDays = 0;
    Object.keys(daily).forEach(function (k) { if (daily[k] > 0) activeDays++; });
    var stats = {
      learned: learnedIds.length,
      favs: favIds.length,
      streak: dailyStreak(),
      activeDays: activeDays,
      bestScore: st.bestScore || 0
    };
    var list = computeAchievements(stats);
    var got = list.filter(function (a) { return a.got; }).length;

    var gotEl = document.getElementById('me-achieve-got');
    if (gotEl) gotEl.textContent = String(got);

    grid.innerHTML = list.map(function (a) {
      return '<div class="me-achieve-item' + (a.got ? ' is-got' : '') + '">' +
        '<div class="me-achieve-seal" aria-hidden="true">' + esc(a.seal) + '</div>' +
        '<div class="me-achieve-body">' +
        '<p class="me-achieve-name">' + esc(a.name) + '</p>' +
        '<p class="me-achieve-desc">' + esc(a.desc) + '</p>' +
        '<p class="me-achieve-prog">' +
        (a.got ? '已达成' : a.shown + ' / ' + a.need + ' ' + esc(a.unit)) +
        '</p>' +
        '</div></div>';
    }).join('');

    /* 全未达成时给一句「怎么才会有」，不冷冰冰地摆六个灰格子 */
    var noteEl = document.getElementById('me-achieve-note');
    if (noteEl) {
      noteEl.hidden = got > 0;
      if (!got) {
        noteEl.textContent = '还没有解锁任何成就。读一首诗并点「今日打卡」，'
          + '「初识诗香」就会亮起来。';
      }
    }
  }

  function daySeed() {
    var d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /* ---------- 时令推荐（PRD 第八条：春→春日、中秋→月亮思乡、毕业季→送别） ----------
   * 全年六档时令（中秋按公历浮动区间 9.1–10.10 覆盖，文案不写死具体日期）。
   * 每档给「标题 + 匹配规则」；候选不足 MIN 时整块隐藏 —— 不硬塞（PRD 空状态原则）。
   * 候选池复用 FEATURED 名篇精选（260 首，首页必载，零额外请求）。 */
  var SEASON_MIN = 4;
  var SEASONS = [
    { id: 'spring', title: '春日诗笺', sub: '时令 · 春',
      desc: '春山暖日和风。古人把春天写进了几千首诗里，挑几首应应景。',
      in: function (m) { return m >= 3 && m <= 5; },
      match: function (t, x) { return /春/.test(t + x); } },
    { id: 'grad', title: '骊歌一曲送君行', sub: '时令 · 毕业季',
      desc: '六月是离别的季节。古人送别不流泪，折柳赠诗，情在字间。',
      in: function (m) { return m === 6; },
      match: function (t) { return /送|别|柳/.test(t); } },
    { id: 'summer', title: '夏木阴阴正可人', sub: '时令 · 夏',
      desc: '荷风送香，蝉鸣入夜。夏天的诗，自带一缕凉意。',
      in: function (m) { return m === 7 || m === 8; },
      match: function (t, x) { return /荷|莲|夏|纳凉/.test(t + x); } },
    { id: 'moon', title: '月圆时节', sub: '时令 · 望月',
      desc: '海上生明月，天涯共此时。一年里最该读月亮诗的日子。',
      in: function (m, d) { return m === 9 || (m === 10 && d <= 10); },
      match: function (t, x) { return /月/.test(t + x); } },
    { id: 'autumn', title: '秋思入句来', sub: '时令 · 秋',
      desc: '自古逢秋悲寂寥？秋天的诗，不止一种读法。',
      in: function (m, d) { return (m === 10 && d > 10) || m === 11; },
      match: function (t, x) { return /秋/.test(t + x); } },
    { id: 'winter', title: '晚来天欲雪', sub: '时令 · 岁寒',
      desc: '绿蚁新醅酒，红泥小火炉。冬天，正该围炉读诗。',
      in: function (m) { return m === 12 || m === 1 || m === 2; },
      match: function (t, x) { return /雪|梅|寒/.test(t + x); } }
  ];
  /* 纯函数：给定时间与时令表，返回当前档（找不到返回 null）——便于测试 */
  function currentSeason(now, seasons) {
    var d = now || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    var list = seasons || SEASONS;
    for (var i = 0; i < list.length; i++) {
      if (list[i].in(m, day)) return list[i];
    }
    return null;
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

    /* 时令推荐：按当前日期选档 → 时令关键词筛名篇 → 按日轮换展示 4 首。
     * 候选不足 SEASON_MIN 时整块保持 hidden（初始即 hidden），不硬塞。 */
    var seasonEl = document.getElementById('season-section');
    if (seasonEl && seasonEl.hidden) {
      var season = currentSeason(new Date());
      if (season) {
        var pool = FEATURED.filter(function (p) { return season.match(p.title, p.text); });
        if (pool.length >= SEASON_MIN) {
          var picks = seededPick(pool, seed + 733, 4);
          var tEl = document.getElementById('season-title');
          var sEl = document.getElementById('season-sub');
          var dEl = document.getElementById('season-desc');
          var gEl = document.getElementById('season-grid');
          if (tEl) tEl.textContent = season.title;
          if (sEl) sEl.textContent = season.sub;
          if (dEl) dEl.textContent = season.desc;
          if (gEl) gEl.innerHTML = picks.map(function (p) { return miniCard(p, p.form); }).join('');
          seasonEl.hidden = false;
        }
      }
    }

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

