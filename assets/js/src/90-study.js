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

  /* 注译键的两种形态：
   *   ① "id:标题|作者" —— 同名多首经正文比对唯一定位后精确挂载（优先）
   *   ② "标题|作者"    —— 唯一的篇目，或同名多首中无法唯一定位的（走兜底）
   * 查法：先按 id 精确命中；未中再按标题全等；仍未中按同作者标题互含。
   * ⚠️ 第三级兜底对同名多首是「可能错挂」的 —— 保留它是因为大量标题带
   *    卷次/异体字的篇目靠它命中，禁用会让这些诗整块失去注译。 */
  function lookupNotes(title, author, id) {
    var notes = window.POEM_NOTES || {};
    /* ① 精确：id 命中（点开哪一首就给哪一首的注译） */
    var nid = (id === undefined || id === null) ? '' : String(id);
    if (nid) {
      var byId = notes[nid + ':' + title + '|' + author];
      if (byId) return byId;
    }
    var key = title + '|' + author;
    if (notes[key]) return notes[key];
    var k, parts;
    for (k in notes) {
      parts = k.split('|');
      if (parts[0] === title) return notes[k];
    }
    for (k in notes) {
      parts = k.split('|');
      if (parts[1] === author && (title.indexOf(parts[0]) !== -1 || parts[0].indexOf(title) !== -1)) return notes[k];
    }
    return null;
  }

  /* ---------- 注译分片懒加载（性能：notes.js 3.05MB → 首屏仅索引 42KB） ----------
   * notes-index.js 给出「键 → 片号」的平行数组，据此只拉用到的那一片。
   * 与 TextStore 同构：cache 存已载片、pending 存同片的并发回调队列，
   * 避免同一片被并发请求重复下载。 */
  var NotesStore = (function () {
    var cache = {};      /* 片号 -> true（内容已并入 window.POEM_NOTES） */
    var pending = {};
    var KEYS = null, CHUNK = null;

    function idxOf(key) {
      if (!KEYS) {
        KEYS = window.POEM_NOTES_KEYS || [];
        CHUNK = window.POEM_NOTES_CHUNK || [];
      }
      var i = KEYS.indexOf(key);
      return i === -1 ? -1 : CHUNK[i];
    }
    function loadChunk(no, cb) {
      if (cache[no]) return cb(true);
      if (pending[no]) { pending[no].push(cb); return; }
      pending[no] = [cb];
      loadScript('assets/data/notes/p' + no + '.js?v=' + DATA_V, function (ok) {
        var got = window['POEM_NOTES_' + no];
        if (ok && got) {
          /* 并入全局表：lookupNotes 的遍历逻辑无需改动 */
          var N = window.POEM_NOTES || (window.POEM_NOTES = {});
          for (var k in got) if (got.hasOwnProperty(k)) N[k] = got[k];
          cache[no] = true;
        }
        var cbs = pending[no];
        delete pending[no];
        cbs.forEach(function (cb2) { cb2(!!cache[no]); });
      });
    }
    /* 加载某首诗的注译。候选键按精确度降序尝试，取第一个在索引里存在的：
     *   ① "id:标题|作者" —— 同名多首精确挂载的条目
     *   ② "标题|作者"    —— 唯一篇目
     *   ③ 标题全等的任一键 —— 同名多首中未精确挂载的（与 lookupNotes 兜底一致）
     * 都找不到 → 回调 false，由 lookupNotes 自己再兜底一遍。 */
    function ensure(title, author, id, cb) {
      var cands = [];
      if (id !== undefined && id !== null) cands.push(id + ':' + title + '|' + author);
      cands.push(title + '|' + author);
      var no = -1, i;
      for (i = 0; i < cands.length; i++) { no = idxOf(cands[i]); if (no !== -1) break; }
      if (no === -1) {
        /* 标题全等兜底：同名多首里只有其中一首被挂了注译时仍能加载到那一片。
         * 先调一次 idxOf 确保 KEYS/CHUNK 已从 window 初始化，再遍历。 */
        idxOf('');
        for (i = 0; i < KEYS.length; i++) {
          var p = KEYS[i].split('|');
          if (p[0] === title) { no = CHUNK[i]; break; }
        }
      }
      if (no === -1) return cb(false);
      loadChunk(no, cb);
    }
    /* 该首诗的注译是否还需要加载 */
    function need(title, author, id) {
      var cands = [];
      if (id !== undefined && id !== null) cands.push(id + ':' + title + '|' + author);
      cands.push(title + '|' + author);
      for (var i = 0; i < cands.length; i++) {
        var no = idxOf(cands[i]);
        if (no !== -1) return !cache[no];
      }
      return false;
    }
    return { ensure: ensure, need: need, chunk: loadChunk };
  })();

  /* ---------- 7a. 精编专题（课堂页入口，PRD Phase 2） ----------
   * 数据来自 assets/data/topics.js（build_topics.js 生成）。
   * 只做三件事：列专题卡 / 点开看诗单 / 点诗进课堂。
   * ⚠️ 不在前端做任何二次筛选或排序 —— 口径由构建脚本固化，
   *    前端再算一遍就会出现「卡上写 24 首、点进去 22 首」的不一致。 */

  /* 专题内诗单：点诗进课堂。诗的 id 不在 topics.js 里，需回索引查。
   * 索引分片可能未载入 → 走 IndexStore.ensureAll 补齐后再定位。 */
  var _topicIndex = null;
  function topicFindPoem(title, author) {
    if (!_topicIndex) {
      _topicIndex = [];
      var meta = window.POEM_INDEX_META || {};
      for (var c = 0; c < (meta.chunks || 0); c++) {
        var arr = window['POEM_INDEX_' + c];
        if (arr) _topicIndex = _topicIndex.concat(arr);
      }
    }
    var i, r;
    for (i = 0; i < _topicIndex.length; i++) {
      r = _topicIndex[i];
      if (r[0] === title && r[1] === author) return i;
    }
    /* 作者署名可能有差异（如「佚名」vs「汉乐府」）：退到标题全等 */
    for (i = 0; i < _topicIndex.length; i++) {
      if (_topicIndex[i][0] === title) return i;
    }
    return -1;
  }

  /* 分组顺序与标题：18 个专题混在一起会看不出层次，按维度分开列 */
  var TOPIC_GROUPS = [
    { kind: 'theme', title: '按主题', desc: '同一题材下的篇目' },
    { kind: 'author', title: '按诗人', desc: '一位诗人读透一组作品' },
    { kind: 'dynasty', title: '按朝代', desc: '一个时代的整体面貌' }
  ];

  function renderTopics() {
    var section = document.getElementById('topics-section');
    var grid = document.getElementById('topic-grid');
    if (!section || !grid) return false;
    var topics = window.STUDY_TOPICS;
    if (!topics || !topics.length) return false;

    section.hidden = false;

    /* ⚠️ data-topic 存的是**全局下标**，不是组内下标 ——
     * 分组≠切分数据源，点卡时仍要能取回原专题对象 */
    var html = '';
    TOPIC_GROUPS.forEach(function (g) {
      var idxs = [];
      topics.forEach(function (t, i) { if (t.kind === g.kind) idxs.push(i); });
      if (!idxs.length) return;         /* 该维度没有专题（如 topics.js 只含主题）*/

      html += '<div class="topic-group">' +
        '<div class="topic-group-head">' +
        '<h3 class="topic-group-title">' + esc(g.title) + '</h3>' +
        '<span class="topic-group-count">' + idxs.length + ' 个专题</span>' +
        '</div>' +
        '<p class="topic-group-desc">' + esc(g.desc) + '</p>' +
        '<div class="topic-group-grid">' +
        idxs.map(function (i) {
          var t = topics[i];
          return '<button class="topic-card" type="button" data-topic="' + i + '">' +
            '<span class="topic-card-name">' + esc(t.name) + '</span>' +
            (t.from ? '<span class="topic-card-from">' + esc(t.from) + '</span>' : '') +
            '<span class="topic-card-basis">' + esc(t.basis) + '</span>' +
            '<span class="topic-card-count">' + t.picked + ' 首</span>' +
            '</button>';
        }).join('') +
        '</div></div>';
    });

    /* 兜底：出现了 TOPIC_GROUPS 未覆盖的 kind，也要显示出来，不能吞掉 */
    var known = TOPIC_GROUPS.map(function (g) { return g.kind; });
    var orphans = [];
    topics.forEach(function (t, i) { if (known.indexOf(t.kind) === -1) orphans.push(i); });
    if (orphans.length) {
      html += '<div class="topic-group">' +
        '<div class="topic-group-head"><h3 class="topic-group-title">其他</h3></div>' +
        '<div class="topic-group-grid">' +
        orphans.map(function (i) {
          var t = topics[i];
          return '<button class="topic-card" type="button" data-topic="' + i + '">' +
            '<span class="topic-card-name">' + esc(t.name) + '</span>' +
            '<span class="topic-card-basis">' + esc(t.basis) + '</span>' +
            '<span class="topic-card-count">' + t.picked + ' 首</span></button>';
        }).join('') + '</div></div>';
    }

    grid.innerHTML = html;

    grid.addEventListener('click', function (e) {
      var card = e.target.closest('[data-topic]');
      if (!card) return;
      var t = topics[parseInt(card.getAttribute('data-topic'), 10)];
      if (t) openTopic(t);
    });
    return true;
  }

  function openTopic(t) {
    var cards = document.getElementById('topics-section');
    var detail = document.getElementById('topic-detail');
    if (!cards || !detail) return;
    cards.hidden = true;
    detail.hidden = false;

    var titleEl = document.getElementById('topic-detail-title');
    var metaEl = document.getElementById('topic-detail-meta');
    var listEl = document.getElementById('topic-poem-list');
    if (titleEl) titleEl.textContent = t.name;
    if (metaEl) {
      /* ⚠️ 口径全写在脸上：这个专题从多少首里选、依据是什么、题名出处。
       * 数字全部来自 topics.js（构建期固化），前端不重算、不美化。 */
      var parts = [];
      parts.push(t.basis);
      parts.push('候选池共 ' + t.poolTotal.toLocaleString('en-US') + ' 首，本专题收 ' + t.picked + ' 首');
      parts.push('入选篇目均有译文与赏析');
      if (t.from) parts.push('题名出自 ' + t.from);
      metaEl.textContent = parts.join(' · ');
    }

    if (listEl) {
      listEl.innerHTML = t.items.map(function (it) {
        /* 用 title+author 寻址（与错题本同一套入口），无需先知道 id */
        var href = 'study.html?title=' + encodeURIComponent(it.t) +
          '&author=' + encodeURIComponent(it.a);
        return '<li class="topic-poem-item">' +
          '<a class="topic-poem-link" href="' + href + '">' +
          '<span class="topic-poem-title">' + esc(it.t) + '</span>' +
          '<span class="topic-poem-author">' + esc(it.a) + ' · ' + esc(it.d) + '</span>' +
          '</a></li>';
      }).join('');
    }

    /* 题名出处的原诗：可点回原文。查不到就不显示这一行（宁缺不假） */
    if (t.fromId != null && t.fromTitle) {
      var more = document.createElement('p');
      more.className = 'topic-detail-source';
      more.innerHTML = '题名出自 <a href="study.html?id=' + t.fromId + '">' +
        esc(t.fromTitle) + '</a>';
      listEl.parentNode.insertBefore(more, listEl.nextSibling);
    }

    var main = document.getElementById('study-body');
    if (main) main.hidden = true;
    var head = document.getElementById('study-head-actions');
    if (head) head.hidden = true;
    var tEl = document.getElementById('study-title');
    if (tEl) tEl.textContent = t.name;
    var sEl = document.getElementById('study-subtitle');
    if (sEl) sEl.textContent = '精编专题';
    window.scrollTo(0, 0);
  }

  function bindTopicBack() {
    var back = document.getElementById('topic-back');
    if (!back) return;
    back.addEventListener('click', function () {
      var cards = document.getElementById('topics-section');
      var detail = document.getElementById('topic-detail');
      if (cards) cards.hidden = false;
      if (detail) detail.hidden = true;

      var main = document.getElementById('study-body');
      if (main) main.hidden = true;
      var head = document.getElementById('study-head-actions');
      if (head) head.hidden = true;
      var tEl = document.getElementById('study-title');
      if (tEl) tEl.textContent = '诗词课堂';
      var sEl = document.getElementById('study-subtitle');
      if (sEl) sEl.textContent = '';
      window.scrollTo(0, 0);
    });
  }

