  /* ---------- 7b. 阅读优先视图（V3 方案 §13/§14） ----------
   * 默认进入「读」的状态：居中标题、大字正文、注/译/赏/作者/背景五标签。
   * 六步学习流程不删不改，经「开始系统学习」按钮（或 ?mode=steps）进入。
   *
   * 口径约束（与六步流完全一致，不新造）：
   *   · 收藏  → shici_favs + Cloud.favs（与 fav-btn 同一套）
   *   · 打卡  → shici_learned + markDailyToday（仅新学计数，与 checkin-btn 同一套）
   *   · 注译  → CURATED / lookupNotes 三级兜底（与 renderStudyText 同一套）
   *   · 同题材推荐 → seededPick(poem.id*31+7, 3)，与侧栏 related-list 同一套
   * 刻意不做的：阅读视图里不重复渲染六步流的内容面板 —— 两套视图共用
   * renderStudyText 一次性灌入，谁在前台用户看谁。 */

  /* 阅读视图 ↔ 六步流 的显隐切换。on=true 显示阅读视图 */
  function showReadingView(on) {
    var rd = document.getElementById('reading-view');
    if (!rd) return;
    rd.hidden = !on;
    var pageHead = document.querySelector('.page-head');
    if (pageHead) pageHead.hidden = on;
    var body = document.getElementById('study-body');
    if (body) body.hidden = on;
  }

  /* 头部 / 操作区 / 骨架：索引数据到手即可渲染（正文与面板由 renderReadingContent 补） */
  function renderReadingView(poem, active) {
    var rd = document.getElementById('reading-view');
    if (!rd || !poem) return;

    var metaEl = document.getElementById('rd-meta');
    if (metaEl) metaEl.textContent = poem.dynasty + ' · ' + poem.form;
    var titleEl = document.getElementById('rd-title');
    if (titleEl) titleEl.textContent = poem.title;
    var authorEl = document.getElementById('rd-author');
    if (authorEl) authorEl.textContent = poem.author + '〔' + poem.dynasty + '〕';

    var ch = document.getElementById('rd-challenge');
    if (ch) ch.href = 'challenge.html?title=' + encodeURIComponent(poem.title) +
      '&author=' + encodeURIComponent(poem.author);

    /* 收藏 */
    var favBtn = document.getElementById('rd-fav');
    function syncFav() {
      if (favBtn) favBtn.textContent = isFav(poem.id) ? '已收藏' : '收藏';
    }
    if (favBtn) {
      favBtn.addEventListener('click', function () {
        toggleIn(favIds, poem.id);
        saveStore('shici_favs', favIds);
        if (loggedIn()) {
          if (isFav(poem.id)) window.Cloud.favs.add(poem.id);
          else window.Cloud.favs.remove(poem.id);
        }
        syncFav();
        /* 头部六步流的收藏按钮文案同步（两处共用一套存储） */
        var headFav = document.getElementById('fav-btn');
        if (headFav) headFav.textContent = isFav(poem.id) ? '已收藏' : '收藏';
      });
      syncFav();
    }

    /* 打卡：与侧栏打卡同一口径（新学才 markDailyToday） */
    var checkin = document.getElementById('rd-checkin');
    function syncCheckin() {
      if (!checkin) return;
      if (isLearned(poem.id)) {
        checkin.textContent = '已加入学习记录';
        checkin.disabled = true;
        checkin.style.opacity = '.6';
      }
    }
    if (checkin) {
      checkin.addEventListener('click', function () {
        if (!isLearned(poem.id)) {
          learnedIds.push(poem.id);
          saveStore('shici_learned', learnedIds);
          markDailyToday(1);
          if (loggedIn()) window.Cloud.learned.add(poem.id);
        }
        syncCheckin();
        var sideCheckin = document.getElementById('checkin-btn');
        if (sideCheckin && isLearned(poem.id)) {
          sideCheckin.textContent = '已加入学习记录';
          sideCheckin.disabled = true;
          sideCheckin.style.opacity = '.6';
        }
      });
      syncCheckin();
    }

    /* 五标签切换（与 study-tabs 同构） */
    var tabBar = document.getElementById('rd-tabs');
    if (tabBar) {
      tabBar.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-rd-tab]');
        if (!tab) return;
        tabBar.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('tab--active'); });
        tab.classList.add('tab--active');
        var key = tab.getAttribute('data-rd-tab');
        rd.querySelectorAll('[data-rd-panel]').forEach(function (p) {
          p.hidden = p.getAttribute('data-rd-panel') !== key;
        });
      });
    }

    /* 开始系统学习 → 切回六步流 */
    var stepsBtn = document.getElementById('rd-steps');
    if (stepsBtn) {
      stepsBtn.addEventListener('click', function () {
        showReadingView(false);
        var anchor = document.getElementById('study-steps');
        if (anchor) window.scrollTo({ top: Math.max(anchor.offsetTop - 90, 0), behavior: 'smooth' });
      });
    }

    /* 上一首 / 下一首（索引数据即可，无需等正文） */
    var prevEl = document.getElementById('rd-prev');
    if (prevEl) {
      var prev = findPoem(poem.id - 1);
      if (prev) { prevEl.href = poemUrl(prev.id); prevEl.textContent = '← ' + prev.title; prevEl.hidden = false; }
      else prevEl.hidden = true;
    }
    var nextEl = document.getElementById('rd-next');
    if (nextEl) {
      var next = findPoem(poem.id + 1);
      if (next) { nextEl.href = poemUrl(next.id); nextEl.textContent = next.title + ' →'; nextEl.hidden = false; }
      else nextEl.hidden = true;
    }

    showReadingView(!!active);
  }

  /* 正文 + 注译都到位后，由 renderStudyText 调用：灌入阅读视图的内容区。
   * poem.text / curated / extra / lines 全部来自调用方，不重复取数。 */
  function renderReadingContent(poem, curated, extra, lines) {
    /* 正文：居中大字，一行一联 */
    var verses = document.getElementById('rd-verses');
    if (verses) {
      var got = false;
      verses.innerHTML = lines.map(function (ln) {
        var t = String(ln || '').trim();
        if (!t) return '';
        got = true;
        return '<p class="rd-verse">' + esc(ln) + '</p>';
      }).join('');
      if (!got) verses.innerHTML = '<div class="empty-state">正文载入失败，请刷新重试。</div>';
    }

    /* 注释面板：精编逐句注优先，其次手册词注，没有如实占位（与六步流同一套口径） */
    var notePanel = document.getElementById('rd-panel-notes');
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
    var transPanel = document.getElementById('rd-panel-translation');
    if (transPanel) {
      var trans = curated ? curated.translation : (extra && extra.y);
      transPanel.innerHTML = trans
        ? '<p class="serif study-prose">' + esc(trans) + '</p>'
        : '<div class="empty-state">白话译文正在编校中。先读原文，体会字面之下的节奏与气息。</div>';
    }

    /* 赏析面板 */
    var aprePanel = document.getElementById('rd-panel-appreciation');
    if (aprePanel) {
      var apre = curated ? curated.appreciation : (extra && extra.s);
      aprePanel.innerHTML = apre
        ? '<p class="serif study-prose">' + esc(apre) + '</p>'
        : '<div class="empty-state">赏析文章正在编校中。' + esc(poem.form) + ' · ' + esc(poem.themes[0]) + '题材，全文 ' + lines.length + ' 行。</div>';
    }

    /* 作者面板：库里可查的事实（署名净名 + 收录数），不编生平 */
    var poetPanel = document.getElementById('rd-panel-poet');
    if (poetPanel) {
      var count = 0;
      loadedPoems().forEach(function (p) { if (p.author === poem.author) count++; });
      poetPanel.innerHTML =
        '<div class="poet-name serif">' + esc(poem.author) + '</div>' +
        '<div class="poet-dynasty">' + esc(poem.dynasty) + '代 · 库中收录 ' + count + ' 首</div>';
    }

    /* 背景面板：notes.b（约 1221 条带背景），没有如实说明 */
    var bgPanel = document.getElementById('rd-panel-background');
    if (bgPanel) {
      var bg = (curated && curated.background) || (extra && extra.b);
      bgPanel.innerHTML = bg
        ? '<p class="serif study-prose">' + esc(bg) + '</p>'
        : '<div class="empty-state">创作背景暂未收录。先把诗读熟，字句自会说话。</div>';
    }

    /* 同题材推荐：与侧栏 related-list 同一取法（同种子 → 同推荐） */
    var relEl = document.getElementById('rd-related');
    if (relEl) {
      var same = loadedPoems().filter(function (p) {
        return p.id !== poem.id && p.themes[0] === poem.themes[0] && p.line.length <= 30;
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
  }
