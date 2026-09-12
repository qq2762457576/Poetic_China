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

  /* ---------- V3 封面分配（确定性：同一首诗永远同一张图） ----------
   * 按「标题+首句」匹配主题关键词；都不中时用 id 散列兜底。
   * 图源：AI 生成水墨 8 张（assets/img/covers/，§37 版权安全）。 */
  var COVER_THEMES = [
    { img: 'snow.jpg',   keys: ['雪', '寒', '冬', '梅', '江雪'] },
    { img: 'lotus.jpg',  keys: ['荷', '莲', '芙蕖', '采菱', '清波'] },
    { img: 'bamboo.jpg', keys: ['竹', '笋', '绿筠'] },
    { img: 'desert.jpg', keys: ['塞', '戍', '征', '关山', '大漠', '燕然'] },
    { img: 'farm.jpg',   keys: ['田', '村', '农', '归园', '田园', '村居'] },
    { img: 'willow.jpg', keys: ['柳', '送别', '春', '花', '江南', '燕'] },
    { img: 'moon.jpg',   keys: ['月', '夜', '嫦娥', '中秋', '相思', '秋'] }
  ];
  var COVER_FALLBACK = ['mountain.jpg', 'moon.jpg', 'willow.jpg', 'bamboo.jpg',
    'lotus.jpg', 'snow.jpg', 'farm.jpg', 'desert.jpg'];

  function coverOf(p) {
    var hay = (p.title || '') + (p.line || '');
    for (var i = 0; i < COVER_THEMES.length; i++) {
      var keys = COVER_THEMES[i].keys;
      for (var j = 0; j < keys.length; j++) {
        if (hay.indexOf(keys[j]) >= 0) return COVER_THEMES[i].img;
      }
    }
    var id = typeof p.id === 'number' ? p.id : 0;
    return COVER_FALLBACK[Math.abs(id) % COVER_FALLBACK.length];
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
        /* V3 封面（模拟图：列表配竖版水墨小画）：主题关键词优先，兜底 id 稳定散列。
         * 图为 AI 生成水墨（无版权来源问题，§37），loading=lazy（§42）。 */
        return (
          '<article class="poem-row poem-row--link" data-goto="' + poemUrl(p.id) + '">' +
          '<img class="poem-row-cover" src="assets/img/covers/' + coverOf(p) + '" alt="" loading="lazy" width="88" height="117" />' +
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

    /* V3 §12：承接首页 Hero 搜索 —— library.html?kw=… 预填并执行一次检索。
     * 不写入搜索历史（那是用户在库内主动回车的记忆）。 */
    (function () {
      var urlKw = '';
      try { urlKw = (new URLSearchParams(location.search).get('kw') || '').trim(); } catch (e) { /* 老浏览器静默跳过 */ }
      if (urlKw && input) {
        input.value = urlKw;
        state.keyword = urlKw;
        state.page = 1;
        renderPoems();
      }
    })();

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

