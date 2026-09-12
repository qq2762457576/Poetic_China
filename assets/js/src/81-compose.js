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

    /* 经典检索：按 诗题/作者 匹配，取前 8 条
     * ⚠️ 全库 89,927 首分 6 片，默认只载入 1 片。
     *    早期版本只搜 loadedPoems()，导致 5/6 的库搜不出来。
     *    这里在检索框获得焦点时就把全库索引后台补齐。 */
    if (searchInput && searchResults) {
      var _allHinted = false;
      function ensureFullIndex() {
        if (_allHinted) return;
        _allHinted = true;
        IndexStore.ensureAll(null, function () {
          /* 全库补齐后，如果框里还有关键词，重搜一次让用户看到完整结果 */
          if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
        });
      }
      searchInput.addEventListener('focus', ensureFullIndex);
      /* 切到「分享经典」模式时也预取，用户开始打字就不必等 */
      document.querySelectorAll('[data-compose-mode="classic"]').forEach(function (c) {
        c.addEventListener('click', ensureFullIndex);
      });

      searchInput.addEventListener('input', function () {
        var kw = searchInput.value.trim();
        picked = null;
        if (!kw) {
          searchResults.innerHTML = '';
          return;
        }
        ensureFullIndex();
        var hits = [];
        var _pool = loadedPoems();
        for (var i = 0; i < _pool.length; i++) {
          var p = _pool[i];
          if (p.title.indexOf(kw) !== -1 || p.author.indexOf(kw) !== -1) hits.push(p);
          if (hits.length >= 8) break;
        }
        /* 索引还在补齐时，把「结果可能不全」如实告诉用户，别让人误以为库里没有 */
        var more = !IndexStore.loadedCount || IndexStore.loadedCount() < IndexStore.totalCount;
        searchResults.innerHTML = hits.length
          ? hits.map(function (p) {
              return (
                '<div class="classic-hit" data-pick="' + p.id + '">' +
                '<strong>' + esc(p.title) + '</strong> · ' + esc(p.author) + '（' + esc(p.dynasty) + '）' +
                '<div class="classic-hit-line">' + esc(p.line) + '</div>' +
                '</div>'
              );
            }).join('') + (more ? '<div class="classic-more">全库仍在载入，结果可能不全…</div>' : '')
          : (more
              ? '<div class="empty-state">全库载入中，稍等再试；或换个更常见的关键词</div>'
              : '<div class="empty-state">库里没搜到，换个关键词</div>');
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
        if (!Auth.current()) {
          var hint0 = document.getElementById('feed-hint');
          if (hint0) hint0.textContent = '请先登录再发布作品，正在跳转登录页…';
          setTimeout(function () { location.href = 'auth.html'; }, 800);
          return;
        }
        var base = {
          id: 'p' + Date.now(),
          author: CURRENT_USER,
          ts: Date.now(),
          status: 'pending',
          likes: 0
        };
        var draft = null;
        if (mode === 'classic') {
          if (!picked) {
            if (searchInput) searchInput.focus();
            return;
          }
          var note = (document.getElementById('classic-note') || {}).value || '';
          draft = Object.assign(base, {
            kind: 'classic',
            title: picked.title + ' · ' + picked.author,
            text: note.trim(),
            poemId: picked.id
          });
        } else {
          var titleInput = document.getElementById('compose-title');
          var bodyInput = document.getElementById('compose-body');
          var body = bodyInput ? bodyInput.value.trim() : '';
          if (!body) {
            if (bodyInput) bodyInput.focus();
            return;
          }
          draft = Object.assign(base, {
            kind: 'original',
            title: (titleInput && titleInput.value.trim()) || '无题',
            text: body,
            poemId: null
          });
        }
        /* 云端模式：写库。status 由 cloud.js 按 draft.status 决定（= pending），
         * 审核通过后才公开。失败时兜底存本地，至少不丢用户写的内容。 */
        if (window.Cloud && window.Cloud.ready) {
          window.Cloud.posts.create(draft, function (row) {
            if (!row) {
              var fallback = getPosts();
              fallback.push(draft);
              setPosts(fallback);
              var hintFail = document.getElementById('feed-hint');
              if (hintFail) hintFail.textContent = '云端提交失败，已暂存在本机。请检查网络后重试。';
            }
            renderFeed();
            renderModeration();
          });
        } else {
          var posts = getPosts();
          posts.push(draft);
          setPosts(posts);
        }
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

    /* --- 审核操作 ---
     * 云端模式下必须写回 Supabase：早期版本只改 localStorage，
     * 而队列读的是云端，改完刷新就复原（看起来像「点了没反应」）。 */
    var queue = document.getElementById('moderation-queue');
    if (queue) {
      queue.addEventListener('click', function (e) {
        var item = e.target.closest('[data-review]');
        if (!item) return;
        if (!canReview()) return;   /* 无审核权不发请求，省一次必然被拒的往返 */
        var id = item.getAttribute('data-review');
        var next = null;
        if (e.target.closest('[data-approve]')) next = 'approved';
        else if (e.target.closest('[data-reject]')) next = 'rejected';
        else return;

        /* 云端模式：调数据库（RLS 的 posts_update_reviewer 策略兜底） */
        if (window.Cloud && window.Cloud.ready && window.Cloud.posts.setStatus) {
          var btns = item.querySelectorAll('button');
          btns.forEach(function (b) { b.disabled = true; });
          window.Cloud.posts.setStatus(id, next, function (ok) {
            btns.forEach(function (b) { b.disabled = false; });
            if (!ok) {
              var tip = document.getElementById('reviewer-hint');
              if (tip) tip.textContent = '审核失败：请确认已执行 patch_review_v2.sql，且你具备审核权。';
              return;
            }
            renderModeration();
            renderFeed();
          });
          return;
        }

        /* 本地模式：改本机存储 */
        var posts = getPosts();
        var target = null;
        posts.forEach(function (p) { if (p.id === id) target = p; });
        if (!target) return;
        target.status = next;
        setPosts(posts);
        renderFeed();
        renderModeration();
      });
    }

    /* 授权审核人（仅站长可提交；数据写云端 reviewers 表） */
    var addBtn = document.getElementById('add-reviewer');
    var addInput = document.getElementById('new-reviewer-name');
    if (addBtn && addInput) {
      addBtn.addEventListener('click', function () {
        if (!isAdmin()) return;
        var email = addInput.value.trim().toLowerCase();
        if (!email) return;
        /* 必须是邮箱：昵称会重名，权限判断认不出是谁 */
        if (email.indexOf('@') === -1) {
          var tip = document.getElementById('reviewer-hint');
          if (tip) tip.textContent = '请填对方的登录邮箱（昵称会重名，认不准人）。';
          return;
        }
        if (!window.Cloud || !window.Cloud.reviewers) return;
        window.Cloud.reviewers.add(email, function (ok) {
          var tip = document.getElementById('reviewer-hint');
          if (!ok) {
            if (tip) tip.textContent = '授权失败：请确认 SQL 脚本已执行，且你已登录站长账号。';
            return;
          }
          addInput.value = '';
          loadReviewers(renderModeration);
        });
      });
    }
    var reviewerList = document.getElementById('reviewer-list');
    if (reviewerList) {
      reviewerList.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-remove-reviewer]');
        if (!rm || !isAdmin()) return;
        var email = rm.getAttribute('data-remove-reviewer');
        if (!window.Cloud || !window.Cloud.reviewers) return;
        window.Cloud.reviewers.remove(email, function () {
          loadReviewers(renderModeration);
        });
      });
    }
  }

