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

  /* 渲染错题本。未登录也能用（本地存储），登录后随其他数据一同同步。
   * 两处消费方共用同一套数据与 id 口径：
   *   · 挑战页底部「错题本」横幅区（wrong-count / wrong-empty / wrong-actions / wrong-recent）
   *   · 错题本独立页 wrongbook.html（完整列表 wrong-list + wrong-clear）
   * 元素不存在就跳过 —— 两个页面各自渲染各自的，互不依赖。 */
  function renderWrongBook() {
    var arr = loadWrongBook();
    var countEl = document.getElementById('wrong-count');
    if (countEl) countEl.textContent = arr.length ? String(arr.length) : '0';

    var emptyEl = document.getElementById('wrong-empty');
    var actionsEl = document.getElementById('wrong-actions');
    if (emptyEl) emptyEl.hidden = arr.length > 0;
    if (actionsEl) actionsEl.hidden = arr.length === 0;

    var box = document.getElementById('wrong-list');
    if (box) {
      box.innerHTML = arr.length ? arr.map(function (it) {
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
      }).join('') : '';
    }

    /* 挑战页底部的「最近错题」精简区（完整列表在独立页） */
    renderWrongRecent();
  }

  /* 挑战页底部横幅区：最近 6 条错题的精简卡，点击直达原诗；
   * 完整管理（逐条移除 / 清空）在错题本独立页 wrongbook.html。 */
  function renderWrongRecent() {
    var box = document.getElementById('wrong-recent');
    if (!box) return;
    var arr = loadWrongBook();
    box.innerHTML = arr.slice(0, 6).map(function (it) {
      var href = 'study.html?title=' + encodeURIComponent(it.title) +
        '&author=' + encodeURIComponent(it.author);
      return (
        '<a class="wrong-recent-item" href="' + href + '">' +
        '<span class="wrong-recent-stem">' + esc(it.stem) + '</span>' +
        '<span class="wrong-recent-meta">' + esc(it.author) + '《' + esc(it.title) + '》' +
        '<em>' + esc(MODE_NAME[it.mode] || '练习') + '</em></span>' +
        '</a>'
      );
    }).join('');
  }

  /* ---------- 错题本独立页（wrongbook.html）----------
   * 与挑战页共用同一套存储口径（shici_wrongbook）与渲染（renderWrongBook）。
   * 「再练一遍」跳回挑战页 ?wrong=1 自动开局 —— 题库分片只在挑战页加载。 */
  function initWrongbookPage() {
    if (!document.getElementById('wrongbook-page')) return;

    renderWrongBook();
    /* 已登录但本地为空 → 错题可能只存在云端（换了设备），补拉一次（与挑战页同构） */
    if (loggedIn() && !loadWrongBook().length &&
        window.Cloud && window.Cloud.wrongbook) {
      window.Cloud.wrongbook.list(function (items) {
        if (!items || !items.length) return;
        saveWrongBook(items.slice(0, WRONG_MAX));
        renderWrongBook();
      });
    }

    var box = document.getElementById('wrong-list');
    if (box) {
      box.addEventListener('click', function (e) {
        var del = e.target.closest('[data-wrong-del]');
        if (del) { removeWrong(del.getAttribute('data-wrong-del')); e.preventDefault(); }
      });
    }
    var clearBtn = document.getElementById('wrong-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearWrongBook);
    var practice = document.getElementById('wrong-practice');
    if (practice) {
      practice.addEventListener('click', function () {
        location.href = 'challenge.html?wrong=1';
      });
    }
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
      maybeAutoWrongPractice();
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
      maybeAutoWrongPractice();
    });
  }

  /* 带 ?wrong=1 进入挑战页（错题本页「再练一遍」的落点）→ 题库就绪后自动开局。
   * 必须放在 bootChallenge 之后：startWrongPractice 走真实模式卡点击路径，
   * 而 mode-row 的监听是在 bootChallenge 里挂上的，早了会点空。 */
  function maybeAutoWrongPractice() {
    try {
      if (new URLSearchParams(location.search).get('wrong') === '1') {
        startWrongPractice();
      }
    } catch (e) {}
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
    var levelStrip = document.getElementById('quiz-levels');

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
      if (levelList) {
        levelList.innerHTML = st.deck
          .map(function (q, i) {
            var cls = i < st.index ? 'level-row is-done' : i === st.index ? 'level-row is-current' : 'level-row';
            var label = i < st.index ? '\u5DF2\u4F5C\u7B54' : i === st.index ? '\u8FDB\u884C\u4E2D' : '\u5F85\u4F5C\u7B54';
            return '<div class="' + cls + '"><span class="name">\u7B2C ' + (i + 1) + ' \u9898</span><span class="state">' + label + '</span></div>';
          })
          .join('');
      }
      /* 横向关卡进度（V3 §22）：答题区上方一格一题。
       * 口径与左栏「本轮进度」一致：i < index 为已作答，
       * 当前题在作答后（st.answered）立即转已答色，不等下一题。 */
      if (levelStrip) {
        levelStrip.innerHTML = st.deck
          .map(function (_, i) {
            var done = i < st.index || (i === st.index && st.answered);
            var cur = i === st.index && !st.answered;
            var cls = done ? 'lv-seg is-done' : cur ? 'lv-seg is-current' : 'lv-seg';
            return '<span class="' + cls + '" title="\u7B2C ' + (i + 1) + ' \u9898"></span>';
          })
          .join('');
      }
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
      /* 答题后立即刷新横向关卡进度（当前题作答即转已答色，不必等下一题） */
      renderLevels();
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


