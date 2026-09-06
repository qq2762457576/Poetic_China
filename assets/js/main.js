/* 诗韵中华 · 全站交互脚本（无框架，IIFE）
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

  /* 当前用户（演示站点：站长即段瑜，默认审核人） */
  var CURRENT_USER = '段瑜';

  /* ---------- 1. 诗词数据层 ---------- */
  var DYNASTY_KEY = { '唐': '唐', '宋': '宋', '先秦': '先秦', '汉魏六朝': '汉魏六朝', '元': '元明清', '明': '明', '清': '元明清', '近现代': '近现代' };
  var GENRE_KEY = { '绝': '诗', '律': '诗', '古': '诗', '诗': '诗', '骚': '诗', '词': '词', '曲': '曲' };

  var POEMS = (window.POEM_DATA || []).map(function (r, i) {
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
      text: r[6],
      line: r[6].split('\n')[0],
      notes: 3 + ((i * 37) % 96),
      readers: (((i * 53) % 900 + 60) / 10).toFixed(1) + ' 万'
    };
  });

  function poemUrl(id) { return 'study.html?id=' + id; }
  function findPoem(id) { return POEMS[id] || null; }
  function findByTitleAuthor(title, author) {
    for (var i = 0; i < POEMS.length; i++) {
      if (POEMS[i].title === title && POEMS[i].author === author) return POEMS[i];
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
        tabs.forEach(function (t) { t.classList.toggle('auth-tab--active', t === tab); });
        var mode = tab.getAttribute('data-mode');
        document.querySelectorAll('[data-panel]').forEach(function (panel) {
          panel.hidden = panel.getAttribute('data-panel') !== mode;
        });
      });
    });
  }

  function initAuthForm() {
    document.querySelectorAll('form[data-panel]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = form.querySelector('button[type="submit"]');
        if (btn) {
          btn.textContent = '已提交 · 演示站点不落库';
          btn.disabled = true;
          setTimeout(function () {
            btn.textContent = btn.getAttribute('data-label') || '提交';
            btn.disabled = false;
          }, 1600);
        }
      });
    });
    document.querySelectorAll('[data-switch]').forEach(function (link) {
      link.addEventListener('click', function () {
        var tab = document.querySelector('.auth-tab[data-mode="' + link.getAttribute('data-switch') + '"]');
        if (tab) tab.click();
      });
    });
  }

  /* ---------- 4. 首页：每日推荐 + 分体裁板块 ---------- */
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

  function initHome() {
    var dailyEl = document.getElementById('daily-poem');
    if (!dailyEl) return;

    var seed = daySeed();
    /* 每日推荐：从短于 120 字的名篇体量里按日期轮换 */
    var shortOnes = POEMS.filter(function (p) { return p.text.length <= 120; });
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
      var list = POEMS.filter(function (p) { return p.genreKey === b.key && p.text.length <= 200; });
      var picks = seededPick(list, seed + bi * 104729, b.count);
      b.el.innerHTML = picks.map(function (p) { return miniCard(p, p.form); }).join('');
    });

    /* 数据条：真实统计 */
    var statPoems = document.getElementById('stat-poems');
    var statAuthors = document.getElementById('stat-authors');
    if (statPoems) statPoems.textContent = POEMS.length.toLocaleString('en-US');
    if (statAuthors) {
      var authors = {};
      POEMS.forEach(function (p) { authors[p.author] = 1; });
      statAuthors.textContent = Object.keys(authors).length.toLocaleString('en-US');
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
    page: 1
  };
  var PER_PAGE = 20;

  function matchFilters(poem) {
    if (state.dynasty !== '全部朝代' && poem.dynastyKey !== state.dynasty) return false;
    if (state.genre !== '全部' && poem.genreKey !== state.genre) return false;
    if (state.theme !== '全部' && poem.themes.indexOf(state.theme) === -1) return false;
    if (state.status === '已学' && !isLearned(poem.id)) return false;
    if (state.status === '未学' && isLearned(poem.id)) return false;
    if (state.status === '已收藏' && !isFav(poem.id)) return false;
    if (state.keyword) {
      var haystack = poem.title + poem.author + poem.text + poem.dynasty + poem.form;
      if (haystack.indexOf(state.keyword) === -1) return false;
    }
    return true;
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

    var list = sortPoems(POEMS.filter(matchFilters));
    if (countEl) countEl.textContent = '共 ' + list.length.toLocaleString('en-US') + ' 首符合条件';

    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PER_PAGE;
    var pageItems = list.slice(start, start + PER_PAGE);

    if (!pageItems.length) {
      wrap.innerHTML = '<div class="empty-state">没有找到匹配的作品，换个词试试</div>';
      renderPagination(1);
      return;
    }

    wrap.innerHTML = pageItems
      .map(function (p) {
        var learned = isLearned(p.id);
        var meta = '注释 ' + p.notes + ' 条 · ' + p.readers + ' 人读过' + (learned ? ' · 已学' : '');
        /* 展示完整内容：超过 4 行的截断，详情进课堂页看 */
        var lines = p.text.split('\n');
        var shown = lines.slice(0, 4).map(esc).join('<br />');
        if (lines.length > 4) shown += '<br /><span class="poem-row-more">…… 共 ' + lines.length + ' 行，点击查看全文</span>';
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
    var total = POEMS.length || 1;
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

    var input = document.getElementById('library-search');
    if (input) {
      input.addEventListener('input', function () {
        state.keyword = input.value.trim();
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

  function postBody(p) {
    if (p.kind === 'classic' && p.poemId !== null && p.poemId !== undefined) {
      var poem = findPoem(p.poemId);
      if (poem) return poem.text.split('\n').map(esc).join('<br />');
    }
    return esc(p.text).replace(/\n/g, '<br />');
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
      '<div class="post-foot"><button data-like="' + p.likes + '">赞 ' + p.likes + '</button></div>' +
      '</article>'
    );
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
    var stored = getPosts();
    /* 信息流：种子 + 已通过 + 自己的（任何状态都自己可见） */
    var visible = stored.filter(function (p) {
      return p.status === 'approved' || p.author === CURRENT_USER;
    });
    var all = visible.sort(function (a, b) { return b.ts - a.ts; }).concat(
      SEED_POSTS.filter(function (s) {
        return !visible.some(function (v) { return v.id === s.id; });
      })
    );
    list.innerHTML = all.map(function (p) { return postCard(p); }).join('') ||
      '<div class="empty-state">还没有作品，来写第一首吧</div>';
    list.querySelectorAll('[data-like]').forEach(bindLike);
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
        for (var i = 0; i < POEMS.length && hits.length < 8; i++) {
          var p = POEMS[i];
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
        var posts = getPosts();
        var base = {
          id: 'p' + Date.now(),
          author: CURRENT_USER,
          ts: Date.now(),
          status: 'pending',
          likes: 0
        };
        if (mode === 'classic') {
          if (!picked) {
            if (searchInput) searchInput.focus();
            return;
          }
          var note = (document.getElementById('classic-note') || {}).value || '';
          posts.push(Object.assign(base, {
            kind: 'classic',
            title: picked.title + ' · ' + picked.author,
            text: note.trim(),
            poemId: picked.id
          }));
        } else {
          var titleInput = document.getElementById('compose-title');
          var bodyInput = document.getElementById('compose-body');
          var body = bodyInput ? bodyInput.value.trim() : '';
          if (!body) {
            if (bodyInput) bodyInput.focus();
            return;
          }
          posts.push(Object.assign(base, {
            kind: 'original',
            title: (titleInput && titleInput.value.trim()) || '无题',
            text: body,
            poemId: null
          }));
        }
        setPosts(posts);
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

  function initStudy() {
    var titleEl = document.getElementById('study-title');
    if (!titleEl) return;

    var params = new URLSearchParams(location.search);
    var id = parseInt(params.get('id'), 10);
    var poem = findPoem(id);
    if (!poem) {
      poem = findByTitleAuthor('登高', '杜甫') || POEMS[0];
    }
    if (!poem) return;

    var curated = CURATED[poem.title + '|' + poem.author] || null;
    var lines = poem.text.split('\n');

    /* 头部 */
    titleEl.textContent = poem.title;
    var subEl = document.getElementById('study-subtitle');
    if (subEl) subEl.textContent = poem.author + ' · ' + poem.dynasty + ' · ' + poem.form;
    var crumbEl = document.getElementById('study-crumb');
    if (crumbEl) crumbEl.textContent = poem.title;
    document.title = poem.title + ' · ' + poem.author + ' — 诗韵中华';

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
      transPanel.innerHTML = curated
        ? '<p class="serif study-prose">' + esc(curated.translation) + '</p>'
        : '<div class="empty-state">白话译文正在编校中。先读原文，体会字面之下的节奏与气息。</div>';
    }

    /* 赏析面板 */
    var aprePanel = document.getElementById('panel-appreciation');
    if (aprePanel) {
      aprePanel.innerHTML = curated
        ? '<p class="serif study-prose">' + esc(curated.appreciation) + '</p>'
        : '<div class="empty-state">赏析文章正在编校中。' + esc(poem.form) + ' · ' + esc(poem.themes[0]) + '题材，全文 ' + lines.length + ' 行。</div>';
    }

    /* 四栏切换 */
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

    /* 同题材推荐（可点击） */
    var relEl = document.getElementById('related-list');
    if (relEl) {
      var same = POEMS.filter(function (p) {
        return p.id !== poem.id && p.themes[0] === poem.themes[0] && p.text.length <= 120;
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
      POEMS.forEach(function (p) { if (p.author === poem.author) count++; });
      poetEl.innerHTML =
        '<div class="poet-name serif">' + esc(poem.author) + '</div>' +
        '<div class="poet-dynasty">' + esc(poem.dynasty) + '代 · 库中收录 ' + count + ' 首</div>';
    }
  }

  /* ---------- 8. 挑战闯关（从诗词库随机出题） ---------- */
  var MODE_NAME = { fill: '填空补全', chain: '上下句接龙', recite: '背诵闯关', exam: '考试闯关', hot: '热门挑战' };
  var QUIZ_PER_RUN = 10;

  /* 可出题的诗：2-12 句、每句 3-10 字（保证干扰项质量） */
  var QUIZ_POOL = [];
  var QUIZ_LINES = [];
  (function buildQuizPool() {
    POEMS.forEach(function (p) {
      var lines = (p.text || '')
        .split('\n')
        .map(function (s) { return s.trim().replace(/[，。！？；：、,.!?;:]+$/, ''); })
        .filter(function (s) {
          return s.length >= 3 && s.length <= 10 && !/[（）()“”‘’《》〈〉「」\[\]a-zA-Z0-9]/.test(s);
        });
      if (lines.length >= 2 && lines.length <= 12) {
        QUIZ_POOL.push({ title: p.title, author: p.author, dynasty: p.dynasty, lines: lines });
      }
    });
    QUIZ_POOL.forEach(function (p) {
      p.lines.forEach(function (l) { QUIZ_LINES.push(l); });
    });
  })();

  /* 精选题库（quizbanks.js 提供 window.QUIZ_BANKS），结构与 QUIZ_POOL 一致 */
  var BANK_POOLS = { exam: [], hot: [] };
  (function buildBankPools() {
    var banks = window.QUIZ_BANKS || { exam: [], hot: [] };
    ['exam', 'hot'].forEach(function (k) {
      BANK_POOLS[k] = (banks[k] || []).map(function (p) {
        /* 诗经/词/古体的段落里常含多个句子，先按句读拆开再取 3-10 字的短句 */
        var lines = [];
        (p.text || '').split('\n').forEach(function (seg) {
          seg.split(/[。！？!?]/).forEach(function (s2) {
            var t = s2.trim().replace(/^[，；：、,;:]+|[，；：、,;:]+$/g, '');
            if (t.length >= 3 && t.length <= 10 && !/[（）()“”‘’《》〈〉「」\[\]a-zA-Z0-9]/.test(t)) lines.push(t);
          });
        });
        return { title: p.title, author: p.author, dynasty: p.dynasty, lines: lines };
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
    if (!stemEl || !optionsEl || !QUIZ_POOL.length) return;

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
  }


  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initTabbar();
    initMobileMenu();
    initAuthTabs();
    initAuthForm();
    initHome();
    initLibrary();
    initCommunity();
    initStudy();
    initChallenge();
  });
})();
