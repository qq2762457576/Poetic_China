  /* ============ 精品课程（PRD 第十七条课堂四入口之一） ============
   * 与专题的区别：课程是有序学习路径 —— 课次有先后、有进度，面向「跟完一门课」。
   * 课次 id 由 build_courses.js 构建期固化（i 字段），前端不重算；
   * 已学状态复用 shici_learned（与课堂打卡同一存储，不另起口径）。 */
  function renderCourses() {
    var section = document.getElementById('courses-section');
    var grid = document.getElementById('course-grid');
    if (!section || !grid) return false;
    var courses = window.STUDY_COURSES;
    if (!courses || !courses.length) return false;

    section.hidden = false;
    /* V3 模拟图：课程卡配封面（AI 生成水墨按课程序稳定分配，lazy loading §42） */
    var courseCovers = ['mountain', 'bamboo', 'moon', 'willow', 'farm'];
    grid.innerHTML = courses.map(function (c, i) {
      var cover = courseCovers[i % courseCovers.length];
      return '<button class="topic-card topic-card--cover" type="button" data-course="' + i + '">' +
        '<img class="topic-card-img" src="assets/img/covers/' + cover + '.jpg" alt="" loading="lazy" width="96" height="128" />' +
        '<span class="topic-card-name">' + esc(c.name) + '</span>' +
        '<span class="topic-card-basis">' + esc(c.basis) + '</span>' +
        '<span class="topic-card-count">' + c.lessonCount + ' 课</span>' +
        '</button>';
    }).join('');

    grid.addEventListener('click', function (e) {
      var card = e.target.closest('[data-course]');
      if (!card) return;
      var c = courses[parseInt(card.getAttribute('data-course'), 10)];
      if (c) openCourse(c);
    });
    return true;
  }

  function findCourse(cid) {
    var courses = window.STUDY_COURSES || [];
    for (var i = 0; i < courses.length; i++) {
      if (courses[i].id === cid) return courses[i];
    }
    return null;
  }

  function renderCourseLessons(c) {
    var listEl = document.getElementById('course-lesson-list');
    var progEl = document.getElementById('course-progress');
    if (!listEl) return;
    var done = 0;
    listEl.innerHTML = c.lessons.map(function (l) {
      var learned = typeof l.i === 'number' && isLearned(l.i);
      if (learned) done++;
      /* 优先用构建期固化的 id 直达；缺 id 时退回 title+author 寻址（不编造） */
      var href = typeof l.i === 'number'
        ? 'study.html?id=' + l.i
        : 'study.html?title=' + encodeURIComponent(l.t) + '&author=' + encodeURIComponent(l.a);
      return '<li class="topic-poem-item">' +
        '<a class="topic-poem-link' + (learned ? ' lesson-learned' : '') + '" href="' + href + '">' +
        '<span class="topic-poem-title">' + esc(l.t) + '</span>' +
        '<span class="topic-poem-author">' + esc(l.a) + ' · ' + esc(l.d) + '</span>' +
        (learned ? '<span class="lesson-badge">已学</span>' : '') +
        '</a></li>';
    }).join('');
    if (progEl) {
      /* 进度只陈述事实（学过 = 在原文页点过打卡），done 为 0 时如实显示 0 */
      progEl.textContent = '已学 ' + done + ' / ' + c.lessons.length +
        ' 课（学过 = 在原文页点过「今日打卡」）';
    }
  }

  function openCourse(c) {
    var cards = document.getElementById('courses-section');
    var topicsSec = document.getElementById('topics-section');
    var detail = document.getElementById('course-detail');
    if (!detail) return;
    if (cards) cards.hidden = true;
    if (topicsSec) topicsSec.hidden = true;
    detail.hidden = false;

    var titleEl = document.getElementById('course-detail-title');
    var metaEl = document.getElementById('course-detail-meta');
    if (titleEl) titleEl.textContent = c.name;
    if (metaEl) {
      /* 口径全写在脸上：数字全部来自 courses.js（构建期固化），前端不重算 */
      metaEl.textContent = c.basis + ' · 入选篇目均有注释与赏析';
    }
    renderCourseLessons(c);

    var main = document.getElementById('study-body');
    if (main) main.hidden = true;
    var head = document.getElementById('study-head-actions');
    if (head) head.hidden = true;
    var tEl = document.getElementById('study-title');
    if (tEl) tEl.textContent = c.name;
    var sEl = document.getElementById('study-subtitle');
    if (sEl) sEl.textContent = '精品课程';
    window.scrollTo(0, 0);
  }

  function bindCourseBack() {
    var back = document.getElementById('course-back');
    if (!back) return;
    back.addEventListener('click', function () {
      var cards = document.getElementById('courses-section');
      var topicsSec = document.getElementById('topics-section');
      var detail = document.getElementById('course-detail');
      if (cards) cards.hidden = false;
      /* 深链接 ?course= 直进时专题网格可能没渲染过：网格为空就不显示该区，
       * 不摆一个空壳（宁缺不假） */
      var topicGrid = document.getElementById('topic-grid');
      if (topicsSec && topicGrid && topicGrid.childElementCount) topicsSec.hidden = false;
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

  function initStudy() {
    var titleEl = document.getElementById('study-title');
    if (!titleEl) return;

    var params = new URLSearchParams(location.search);
    var id = parseInt(params.get('id'), 10);
    var courseId = params.get('course');
    var hasPoemParam = params.has('id') || params.has('title');

    /* 入口页 = 精品课程 + 精编专题；?course=<id> 深链接则直接打开该门课。
     * course 值未知时如实退回入口页（网格照常显示，不报错装死）。
     * renderTopics/renderCourses 各只调用一次（内部会绑事件，调两次会重复绑定）。 */
    if (!hasPoemParam) {
      var courseHit = courseId ? findCourse(courseId) : null;
      var showedTopics = renderTopics();
      var showedCourses = renderCourses();
      if (showedTopics || showedCourses) {
        bindTopicBack();
        bindCourseBack();
        if (courseHit) {
          openCourse(courseHit);
        } else {
          titleEl.textContent = '诗词课堂';
          var sub = document.getElementById('study-subtitle');
          if (sub) sub.textContent = '读原文 · 逐句理解 · 了解背景 · 理解名句 · 整体赏析 · 开始背诵';
        }
        var body = document.getElementById('study-body');
        if (body) body.hidden = true;
        var headActions = document.getElementById('study-head-actions');
        if (headActions) headActions.hidden = true;
        return;
      }
      /* topics.js / courses.js 都没加载出来：如实降级到默认诗，不显示空入口区 */
    }

    var poem = findPoem(id);
    if (!poem && id >= 0) {
      /* 索引分片尚未载入：先下载该片再渲染，保证深链接可达全库任意一首 */
      titleEl.textContent = '载入中…';
      IndexStore.poem(id, function (p2) {
        initStudyWith(p2 || findByTitleAuthor('登高', '杜甫') || loadedPoems()[0]);
      });
      return;
    }
    /* 按「标题+作者」寻址：错题本等入口没有 poem id，只有题面里的题名与作者。
     * 索引分片可能还没载入这首，需要异步补片后再找一次。 */
    var qTitle = params.get('title'), qAuthor = params.get('author');
    if (!poem && qTitle) {
      poem = findPoemLoose(qTitle, qAuthor);
      if (poem) { initStudyWith(poem); return; }
      titleEl.textContent = '载入中…';
      IndexStore.ensureAll(null, function () {
        initStudyWith(findPoemLoose(qTitle, qAuthor) || findByTitleAuthor('登高', '杜甫') || loadedPoems()[0]);
      });
      return;
    }
    if (!poem) poem = findByTitleAuthor('登高', '杜甫') || loadedPoems()[0];
    initStudyWith(poem);
  }

  function initStudyWith(poem) {
    var titleEl = document.getElementById('study-title');
    if (!poem || !titleEl) return;

    /* 头部：索引数据，立即渲染 */
    titleEl.textContent = poem.title;
    var subEl = document.getElementById('study-subtitle');
    if (subEl) subEl.textContent = poem.author + ' · ' + poem.dynasty + ' · ' + poem.form;
    var crumbEl = document.getElementById('study-crumb');
    if (crumbEl) crumbEl.textContent = poem.title;
    document.title = poem.title + ' · ' + poem.author + ' — 诗意中国';

    var verseList0 = document.getElementById('verse-list');
    if (verseList0) verseList0.innerHTML = '<div class="empty-state">正文载入中…</div>';

    /* 正文与注译**并行**懒加载，两者都到位再渲染（互不阻塞，谁快都等对方）。
     * 注译分片是「键所在的那一片」，通常只 1 片（约 400KB）；已在内存时立即回调。 */
    var _textReady = false, _notesReady = false, _poem = poem;
    var stepsRedraw = null;   /* initStudySteps 返回的重绘函数，供注译晚到时补绘 */
    /* 注译回调可能在 initStudySteps 之前就跑完（该片已缓存时是同步回调），
     * 那时 stepsRedraw 还未赋值 → 记下「已就绪」状态，赋值后再补一次。 */
    var _notesFired = false;
    function _tryRender() {
      if (_textReady && _notesReady) renderStudyText(_poem);
    }
    TextStore.text(poem.id, function (text) {
      _poem.text = text || _poem.line;
      _textReady = true;
      _tryRender();
    });
    NotesStore.ensure(poem.title, poem.author, poem.id, function () {
      /* 找不到也照常放行 —— 后续 lookupNotes 会走模糊兜底 */
      _notesReady = true;
      _notesFired = true;
      _tryRender();
      /* 六步的第 6 步（背诵提示）读 notes.r，且 render() 是同步的 ——
       * 若用户手快，在分片到位前就点到第 6 步，那一步会显示为空。
       * 故数据到手后主动重绘一次，让第 6 步就地补上（有则显示，无则整块隐藏）。 */
      if (typeof stepsRedraw === 'function') stepsRedraw();
    });

    /* 六步学习流程（PRD 第十七条）
     * 读原文 → 逐句理解 → 了解背景 → 理解名句 → 整体赏析 → 开始背诵
     * 进度按「每首诗」独立记忆（localStorage: shici_study_step = {poemId: n}），
     * 下次从这首诗上次停下的地方继续。 */
    stepsRedraw = initStudySteps(poem);
    if (_notesFired && typeof stepsRedraw === 'function') stepsRedraw();

    /* 注释 / 译文 切换（不依赖正文，直接绑定） */
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
          /* 记一笔到今天的趋势记录 —— 必须在「新学」分支里，
           * 重复点同一首不计数，否则曲线会被重复打卡虚增。 */
          markDailyToday(1);
          /* 已登录则同步上云，失败不影响本地记录 */
          if (loggedIn()) window.Cloud.learned.add(poem.id);
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
        /* 已登录则同步上云 */
        if (loggedIn()) {
          if (isFav(poem.id)) window.Cloud.favs.add(poem.id);
          else window.Cloud.favs.remove(poem.id);
        }
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

    /* 同题材推荐（可点击，索引数据即可） */
    var relEl = document.getElementById('related-list');
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

    /* 诗人卡 */
    var poetEl = document.getElementById('poet-card-body');
    if (poetEl) {
      var count = 0;
      loadedPoems().forEach(function (p) { if (p.author === poem.author) count++; });
      poetEl.innerHTML =
        '<div class="poet-name serif">' + esc(poem.author) + '</div>' +
        '<div class="poet-dynasty">' + esc(poem.dynasty) + '代 · 库中收录 ' + count + ' 首</div>';
    }
  }

