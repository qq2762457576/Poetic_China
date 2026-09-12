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
  var DATA_V = '20260912f';

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

