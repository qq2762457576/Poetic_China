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

