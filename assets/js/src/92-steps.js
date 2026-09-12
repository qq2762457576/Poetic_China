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
