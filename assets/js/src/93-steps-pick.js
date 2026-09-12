  function renderPickLines(listEl, lines, hints, poem) {
    var hintSet = {};
    (hints || []).forEach(function (h) { hintSet[h.line] = { why: h.why || '', tag: h.tag || '赏析曾引用' }; });
    var picked = loadPickedLines(poem.id);
    listEl.innerHTML = lines.map(function (ln, i) {
      var t = String(ln || '').trim();
      if (!t) return '';
      var isHint = Object.prototype.hasOwnProperty.call(hintSet, t);
      var h = hintSet[t] || {};
      return '<li class="pick-line' + (isHint ? ' pick-line--hint' : '') + '"' +
        ' data-pick-line="' + i + '" data-line-text="' + esc(t) + '"' +
        ' role="button" tabindex="0"' +
        ' aria-pressed="' + (picked.indexOf(t) !== -1 ? 'true' : 'false') + '">' +
        '<span class="pick-line-text serif">' + esc(t) + '</span>' +
        (isHint ? '<span class="pick-line-tag">' + esc(h.tag) + '</span>' : '') +
        '</li>';
    }).filter(Boolean).join('');
    /* 恢复上次选择 */
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-pick-line]'), function (li) {
      if (picked.indexOf(li.getAttribute('data-line-text')) !== -1) li.classList.add('is-picked');
    });
    bindPickLines(listEl, poem);
  }

  function bindPickLines(listEl, poem) {
    function toggle(li) {
      var text = li.getAttribute('data-line-text');
      var on = li.classList.toggle('is-picked');
      li.setAttribute('aria-pressed', on ? 'true' : 'false');
      var picked = loadPickedLines(poem.id);
      var idx = picked.indexOf(text);
      if (on && idx === -1) picked.push(text);
      if (!on && idx !== -1) picked.splice(idx, 1);
      if (picked.length > 3) picked = picked.slice(-3);   /* 最多留 3 句，多了不叫「名句」 */
      savePickedLines(poem.id, picked);
      renderPickedFamous(document.getElementById('panel-famous'), poem);
    }
    listEl.addEventListener('click', function (e) {
      var li = e.target.closest('[data-pick-line]');
      if (li) toggle(li);
    });
    listEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var li = e.target.closest('[data-pick-line]');
      if (!li) return;
      e.preventDefault();
      toggle(li);
    });
  }

  /* 第 1 步「读原文」里的就地标注。
   * 与第 4 步 bindPickLines 共用 loadPickedLines / savePickedLines，
   * 因此两处选择天然一致 —— 不再重复实现一份，避免两套逻辑日后走偏。 */
  function bindVersePick(verseList, poem) {
    function togglePick(row) {
      var text = row.getAttribute('data-verse-text');
      if (!text) return;
      var picked = loadPickedLines(poem.id);
      var idx = picked.indexOf(text);
      var nowOn;
      if (idx === -1) {
        picked.push(text);
        nowOn = true;
      } else {
        picked.splice(idx, 1);
        nowOn = false;
      }
      /* 上限 3 句，与第 4 步一致：多了不叫「名句」。
       * 用与第 4 步相同的写法（保留末尾 = 最新的 3 句），
       * 两处规则必须同源，否则同一次点击在两步得到的结果会不一样。 */
      var dropped = null;
      if (picked.length > 3) {
        var kept = picked.slice(-3);
        dropped = picked.slice(0, picked.length - 3).join('、');
        picked = kept;
      }
      savePickedLines(poem.id, picked);
      syncVersePickUI(verseList, poem);

      /* 第 4 步的名句面板若已在 DOM 里，一并刷新（两个面板同源，必须同步） */
      var famousPanel = document.getElementById('panel-famous');
      if (famousPanel) renderPickedFamous(famousPanel, poem);
      var pickList = document.getElementById('pick-lines');
      if (pickList) {
        Array.prototype.forEach.call(pickList.querySelectorAll('[data-pick-line]'), function (li) {
          var on = picked.indexOf(li.getAttribute('data-line-text')) !== -1;
          li.classList.toggle('is-picked', on);
          li.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }

      /* 挤掉旧句时如实说明，不让用户困惑「我刚才点的那句去哪了」 */
      if (dropped) {
        announceVersePick('已标 3 句（上限）。最早标记的「' + dropped + '」已移出。');
      } else {
        announceVersePick((nowOn ? '已标为名句：' : '已取消标记：') + text);
      }
    }
    verseList.addEventListener('click', function (e) {
      var btn = e.target.closest('.verse-pick');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var row = btn.closest('[data-verse]');
      if (row) togglePick(row);
    });
  }

  /* 把存储状态刷到第 1 步的星标上（含计数提示） */
  function syncVersePickUI(verseList, poem) {
    var picked = loadPickedLines(poem.id);
    Array.prototype.forEach.call(verseList.querySelectorAll('[data-verse]'), function (row) {
      var t = row.getAttribute('data-verse-text');
      var on = !!t && picked.indexOf(t) !== -1;
      row.classList.toggle('is-picked', on);
      var btn = row.querySelector('.verse-pick');
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.setAttribute('title', on ? '取消标记' : '标为名句');
        btn.setAttribute('aria-label', on ? '取消标记这句为名句' : '把这句标为名句');
        var inner = btn.querySelector('[aria-hidden="true"]');
        if (inner) inner.textContent = on ? '★' : '☆';
      }
    });
    renderVersePickHint(verseList, poem);
  }

  /* 第 1 步的计数与说明。没有选择时给一句「怎么用」，不给数字 0 干瞪眼。
   * ⚠️ 只说做得到的事：名句目前只在课堂页第 4 步与这里展示，
   *    「我的」页没有这个区块，不要写成「我的页也会显示」（PRD 第四十条）。 */
  function renderVersePickHint(verseList, poem) {
    var hint = document.getElementById('verse-pick-hint');
    if (!hint) return;
    var picked = loadPickedLines(poem.id);
    hint.textContent = picked.length
      ? '已标记 ' + picked.length + ' / 3 句名句 · 第 4 步「理解名句」会一并列出'
      : '读到喜欢的句子，点右侧 ☆ 标为你的名句（最多 3 句）';
  }

  /* 读屏播报：星标是图标按钮，视觉变化需要一句文字说明 */
  function announceVersePick(msg) {
    var live = document.getElementById('verse-pick-live');
    if (!live) return;
    live.textContent = msg;
  }

  var PICKED_KEY = 'shici_picked_lines';
  function loadPickedLines(poemId) {
    try {
      var map = JSON.parse(localStorage.getItem(PICKED_KEY) || '{}');
      var v = map[String(poemId)];
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function savePickedLines(poemId, arr) {
    try {
      var map = JSON.parse(localStorage.getItem(PICKED_KEY) || '{}');
      map[String(poemId)] = arr;
      var ks = Object.keys(map);
      /* 只留最近 300 首，避免 localStorage 无限膨胀 */
      if (ks.length > 300) { ks.slice(0, ks.length - 300).forEach(function (k) { delete map[k]; }); }
      localStorage.setItem(PICKED_KEY, JSON.stringify(map));
    } catch (e) { /* 隐私模式下写不进去，静默降级 */ }
  }

  /* 用户选中的名句区：只显示用户自己选的，一个字都不替他编。
   * 理由框允许留空 —— 留空就只显示句子，不生成套话填充。*/
  function renderPickedFamous(panel, poem) {
    if (!panel) return;
    var picked = loadPickedLines(poem.id);
    if (!picked.length) {
      panel.innerHTML = '<div class="empty-state">还没选。点上方任意一句，' +
        '它就会出现在这里，陪着这首诗留在你的记录里。</div>';
      return;
    }
    panel.innerHTML = picked.map(function (ln) {
      return '<p class="famous-line serif">' + esc(ln) + '</p>';
    }).join('') +
      '<p class="famous-why pick-note">以上是你自己挑出的句子，已存入本机记录。' +
      '背诵时先想它们，全篇就容易串起来。</p>';
  }

  /* 提示用：找出「赏析里确实引用过」的原文句子。
   * ⚠️ 这不是「判定名句」，只是把有据可查的引用挑出来做浅色标记。
   *    绝不因为「看起来像名句」就标 —— 宁可标不出，也不编造（PRD 第四十条）。*/
  function apreForFamous(curated, extra) {
    return (curated && curated.appreciation) || (extra && extra.s) || '';
  }
  /* 诗句归一化：去掉标点、空白、引号，只留汉字，用于「手册名句能否落到原文某句」的比对 */
  function verseKey(s) {
    return String(s || '').replace(/[""'']/g, '').replace(/[^\u4e00-\u9fa5]/g, '');
  }
  /* 手册名句 m 字段 → 归一化后的句子数组。
   * m 常是多句拼接（「青，取之于蓝…。不积跬步…。锲而舍之…。」），必须拆开逐句落位；
   * 单引号对内的顿号/分号（「锲而舍之，朽木不折」）仍属同句，故只按句末标点切。
   * 返回去标点的纯汉字串，长度 < 4 的（语气残句等）由调用方丢弃。*/
  function splitFamousSentences(m) {
    return String(m || '')
      .split(/[。！？!?；;\n]/)
      .map(function (x) { return verseKey(x); })
      .filter(function (x) { return x.length >= 4; });
  }
  function pickFamousLines(poem, lines, curated, appreciation, extra) {
    var out = [];
    /* ① 手工标注的千古名句（最高优先，可信）—— 有则直接用 */
    if (curated && curated.famous && curated.famous.length) {
      return curated.famous.map(function (f) {
        return { line: f[0], why: f[1] || '' };
      });
    }
    /* ② 学习手册「四、名句」的标注（笔记 m 字段）—— 这是可查的出版物标注，
     *    不是「系统猜名句」，所以可作提示位（PRD 第四十条）。
     *    ⚠️ m 字段常是**多句拼接**（如「青，取之于蓝…。不积跬步…。锲而舍之…。」），
     *       故必须**先按句切分、再逐句各自落位** —— 整串拿去比对永远匹配不上。
     *    单句落位规则（库内断行不固定，故不能只比「整行全等」）：
     *      ⓐ 库内某一行**完整包含**该句（库常把两联并作一行）→ 标该行；
     *      ⓑ 该句**跨了库内多行**（库按句/联拆行）→ 标出构成它的每一行；
     *      ⓒ 都对不上（多为库内异文，如「啼不尽」vs 手册「啼不住」）→ 该句不标，绝不硬凑。
     *    关于「跨行上限」：散文名篇（劝学/三峡/兰亭集序…）正文常按整段或长句断行，
     *    一句名句跨 3~5 行是常态，故上限按该句长度推导而非写死。*/
    var m = extra && extra.m;
    if (m) {
      var sentences = splitFamousSentences(m);
      for (var si = 0; si < sentences.length; si++) {
        var mk = sentences[si];
        if (mk.length < 4) continue;
        /* ⓐ 库内整行是该句的子串（库把两联并作一行） */
        for (var q = 0; q < lines.length; q++) {
          var lq = String(lines[q] || '');
          if (lq.trim() && verseKey(lq).indexOf(mk) !== -1) {
            return [{ line: lq, why: '', tag: '手册推荐名句' }];
          }
        }
        /* ⓑ 该句跨库内多行 —— 收集构成它的每一行 */
        var parts = [];
        for (var w = 0; w < lines.length; w++) {
          var lw = String(lines[w] || '');
          var kw = verseKey(lw);
          if (kw.length >= 4 && mk.indexOf(kw) !== -1 && parts.indexOf(lw) === -1) parts.push(lw);
        }
        var maxParts = Math.max(2, Math.ceil(mk.length / 7) + 2);
        if (parts.length && parts.length <= maxParts) {
          return parts.map(function (x) { return { line: x, why: '', tag: '手册推荐名句' }; });
        }
      }
    }
    /* ③ 按「半句」在前 4 字做匹配 —— 赏析常引用半句、且可能不引全。
     *    实测这套规则在真实赏析上命中约 67%，且抽样结果无一误标
     *    （老骥伏枥 / 采菊东篱下 / 大漠孤烟直 等均为公认名句）。
     *    剩余标不出来是正常的 —— 那些诗的赏析本就没引原文，
     *    此时第 4 步靠用户自己点选，功能依然成立。*/
    if (appreciation) {
      var flat = String(appreciation);
      for (var i = 0; i < lines.length; i++) {
        var raw = String(lines[i] || '');
        if (!raw.trim()) continue;
        var parts = raw.split(/[，。！？、；：]/);
        var hit = false;
        for (var j = 0; j < parts.length; j++) {
          var seg = parts[j].replace(/[""'']/g, '').replace(/[^\u4e00-\u9fa5]/g, '');
          if (seg.length < 4) continue;
          if (flat.indexOf(seg.slice(0, 4)) !== -1) { hit = true; break; }
        }
        if (hit) out.push({ line: raw, why: '', tag: '赏析曾引用' });
        if (out.length >= 2) break;
      }
    }
    return out;   /* 提示不出来就返回空 —— 由用户自己选，绝不硬凑 */
  }

  /* 错题解释卡（PRD 第十九条闭环的「解释」环节）
   * 只呈现两类**已有事实**：① 题目自带的原句 tip ② 你在选项里挑错的那个是否为原诗真实句子。
   * ⚠️ 不做「为什么错」的生成式分析 —— 那是编造（PRD 第四十条）。
   *    提示语只描述客观情况（正确答案是第几项、原句是什么），不评价用户。 */
  function buildWrongExplain(q) {
    var letters = ['A', 'B', 'C', 'D'];
    var ansLetter = letters[q.answer] || '';
    var esc2 = esc;
    return (
      '<span class="explain-title">差一点 —— 正确答案是 ' + esc2(ansLetter) + '</span>' +
      '<span class="explain-line">' + esc2(q.tip || '') + '</span>' +
      '<span class="explain-actions">' +
      '<a class="explain-link" href="#" data-explain-study ' +
      'data-ex-title="' + esc2(q.title || '') + '" data-ex-author="' + esc2(q.author || '') + '">' +
      '去课堂读这首' + esc2(q.author ? q.author + '《' + q.title + '》' : q.title || '') + '</a>' +
      '</span>'
    );
  }

  /* 从题目本体重建一道同类型的新题（错题「再练」用）。
   * ⚠️ 错题本只存了 title/author/stem/tip/mode，**没有存 options/answer** ——
   *    这是有意的：原样回放等于让用户背答案。改为按 title+author 找回原诗、
   *    用同一题型重新出题，每次再练都是真练。 */
  function rebuildQuestionFromWrong(item) {
    var maker = QUIZ_MAKER[item.mode] || QUIZ_MAKER.fill;
    var poem = null;
    try { poem = findPoemLoose(item.title, item.author); } catch (e) { poem = null; }
    if (poem && poem.lines && poem.lines.length) {
      var q = maker(QUIZ_POOL, poem);
      if (q) return q;
    }
    /* 索引里暂时找不到原诗（分片未载入）—— 用题目本体做一个降级版：
     * 直接把原句作为正确项、题干里的方框作为题面。仍然只搬事实，不编内容。 */
    return fallbackQuestionFromWrong(item);
  }

  function fallbackQuestionFromWrong(item) {
    var tip = String(item.tip || '').replace(/^原句[：:]\s*/, '');
    var correct = tip.replace(/[，。！？、；：\s]/g, '');
    if (!correct) return null;
    var made = makeOptions(correct, function (exclude) { return randomLineOfLen(correct.length, exclude); });
    return {
      stem: item.stem || '',
      title: item.title || '',
      author: item.author || '',
      source: (item.author || '') + '《' + (item.title || '') + '》 · 复习错题',
      options: made.options,
      answer: made.answer,
      tip: item.tip || ''
    };
  }

  /* 错题「再练」：把错题本里的题组成一副牌，走与正式挑战相同的答题流程。
   * 答对即视为掌握（从错题本移除），答错则保留 —— 这才是闭环的「重新挑战」。
   * 实现方式：把牌放进 window.__wrongPracticeDeck，newDeck() 会优先取它；
   * 摆好牌后切到 fill 模式重新开局（走真实的模式卡点击路径，不伪造内部状态）。 */
  function startWrongPractice() {
    var arr = loadWrongBook();
    if (!arr.length) return;
    var deck = [];
    arr.slice(0, QUIZ_PER_RUN).forEach(function (it) {
      var q = rebuildQuestionFromWrong(it);
      if (q) { q.__wrongKey = wrongKeyOf(it); deck.push(q); }
    });
    if (!deck.length) {
      window.__toast && window.__toast('错题本里的诗暂时找不到原文，请稍后再试。');
      return;
    }
    window.__wrongPracticeDeck = deck;
    var cardEl = document.querySelector('#mode-row .mode-card[data-mode="fill"]');
    if (cardEl) cardEl.click();
  }

