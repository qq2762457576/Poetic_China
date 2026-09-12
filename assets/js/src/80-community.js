  /* ---------- 6. 社区广场：分享 + 审核 ---------- */
  /* 帖子: {id, kind:'classic'|'original', title, text, poemId, author, ts, status, likes}
   * 说明：不设任何种子/示例帖子 —— 社区内容全部来自真实用户（PRD 第四十条） */

  function getPosts() { return store('shici_posts', []); }
  function setPosts(posts) { saveStore('shici_posts', posts); }

  /* ---------- 审核人名单（云端权威） ----------
   * 规则：站长（config.admins 里的邮箱）天然是审核人，不占名额、不可被移除。
   *       被授权的审核人存在云端 reviewers 表，只有站长能增删（RLS 兜底）。
   *       早期版本把名单存在 localStorage 且「第一个到访者自动成为审核人」，
   *       那等于把审核权送给任何人，已废弃。 */
  var ADMIN_NAME = '站长';

  /* 拉取云端审核人邮箱（邮箱是账号唯一标识，昵称会重名）→ 缓存到 reviewerEmails */
  function loadReviewers(cb) {
    if (!window.Cloud || !window.Cloud.reviewers) { if (cb) cb(); return; }
    window.Cloud.reviewers.list(function (emails) {
      if (emails) reviewerEmails = emails.map(function (e) { return String(e).toLowerCase(); });
      if (cb) cb();
    });
  }

  /* 面板里展示用：站长 + 云端授权名单 */
  function reviewerRows() {
    var rows = [{ email: '', name: ADMIN_NAME, me: isAdmin(), admin: true }];
    var me = myEmail();
    (reviewerEmails || []).forEach(function (e) {
      /* 站长自己的邮箱不重复列 */
      if (adminEmails().indexOf(e) !== -1) return;
      rows.push({ email: e, name: e, me: e === me, admin: false });
    });
    return rows;
  }

  /* ---------- 评论：云端优先，本地兜底 ---------- */
  var CKEY = 'shici_comments';
  function localComments(postId) {
    var all = store(CKEY, {});
    return all[postId] || [];
  }
  function addLocalComment(postId, c) {
    var all = store(CKEY, {});
    if (!all[postId]) all[postId] = [];
    all[postId].push(c);
    saveStore(CKEY, all);
  }

  /* 云端帖子 → 统一结构（本地帖子用 ts，云端用 created_at） */
  function normalizeCloudPost(r) {
    return {
      id: r.id,
      kind: r.kind || 'original',
      title: r.title,
      text: r.body || '',
      poemId: (r.poem_id === null || r.poem_id === undefined) ? null : r.poem_id,
      author: r.author,
      ts: new Date(r.created_at).getTime(),
      status: r.status || 'approved',
      likes: r.likes || 0,
      cloud: true
    };
  }

  /* 合并信息流：云端（人人可见）+ 本机发布 */
  function loadFeed(cb) {
    var local = getPosts().filter(function (p) {
      return p.status === 'approved' || p.author === CURRENT_USER;
    });
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.posts.list(function (rows) {
        var cloud = (rows || []).map(normalizeCloudPost);
        var seen = {};
        var all = cloud.concat(local).filter(function (p) {
          if (!p || seen[p.id]) return false;
          seen[p.id] = 1;
          return true;
        }).sort(function (a, b) { return b.ts - a.ts; });
        cb(all);
      });
    } else {
      var seen2 = {};
      var all2 = local.filter(function (p) {
        if (!p || seen2[p.id]) return false;
        seen2[p.id] = 1;
        return true;
      }).sort(function (a, b) { return b.ts - a.ts; });
      cb(all2);
    }
  }

  function postBody(p) {
    if (p.kind === 'classic' && p.poemId !== null && p.poemId !== undefined) {
      var poem = findPoem(p.poemId);
      if (poem) {
        /* 正文按需加载：先放首行占位，块到位后替换为全文 */
        return '<span data-poem-body="' + poem.id + '">' + esc(poem.line) + ' …</span>';
      }
    }
    return esc(p.text).replace(/\n/g, '<br />');
  }

  function fillClassicBodies(root) {
    if (!root) return;
    root.querySelectorAll('[data-poem-body]').forEach(function (el) {
      var id = parseInt(el.getAttribute('data-poem-body'), 10);
      TextStore.text(id, function (text) {
        if (text) el.innerHTML = text.split('\n').map(esc).join('<br />');
      });
    });
  }

  function postCard(p, mine) {
    var statusBadge = '';
    if (p.status === 'pending') statusBadge = '<span class="badge-pill badge-pending">待审核</span>';
    if (p.status === 'rejected') statusBadge = '<span class="badge-pill badge-rejected">未通过</span>';
    var classicTag = p.kind === 'classic' ? '<span class="badge-pill badge-classic">分享经典</span>' : '';
    var d = new Date(p.ts);
    var when = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    /* 4.4 关联作品直达：分享经典且诗还在库里 → 给「读原文」入口 */
    var poemLink = '';
    if (p.kind === 'classic' && p.poemId !== null && p.poemId !== undefined) {
      var pl = findPoem(p.poemId);
      if (pl) poemLink = '<a class="post-poem-link" href="' + poemUrl(pl.id) + '">读原文 →</a>';
    }
    var rep = reportedIds().indexOf(String(p.id)) >= 0;
    var reportBtn = '<button data-report="' + esc(p.id) + '"' +
      (rep ? ' disabled class="is-reported"' : '') + '>' +
      (rep ? '已举报' : '举报') + '</button>';
    return (
      '<article class="card post-card anim-rise is-in" data-post="' + esc(p.id) + '">' +
      '<div class="post-head">' + avatarHtml(p.author) +
      '<span class="who">' + esc(p.author) + ' · ' + when + '</span>' + classicTag + statusBadge + '</div>' +
      '<h3 class="post-title">' + esc(p.title) + '</h3>' +
      '<p class="poem-body">' + postBody(p) + poemLink + '</p>' +
      '<div class="post-foot">' +
      '<button data-like="' + p.likes + '">赞 ' + p.likes + '</button>' +
      '<button data-comments-toggle="' + esc(p.id) + '">评论</button>' +
      reportBtn +
      '</div>' +
      '<div class="comment-area" data-comments="' + esc(p.id) + '" hidden></div>' +
      '</article>'
    );
  }

  /* ---------- 举报（PRD 4.1）：mailto 通道 + 本地防重复 ----------
   * 零 SQL、立即可用：点举报 → 拉起邮件客户端预填帖子信息发给站长；
   * 站长处置路径复用审核面板的 setStatus（驳回/下架）。
   * shici_reported 只在本机记「我已举报过哪几条」，防止重复骚扰。 */
  var REPORT_EMAIL = '2762457576@qq.com';

  function reportedIds() {
    try { return JSON.parse(localStorage.getItem('shici_reported') || '[]'); }
    catch (e) { return []; }
  }

  function markReported(id) {
    var list = reportedIds();
    if (list.indexOf(id) < 0) {
      list.push(id);
      if (list.length > 200) list = list.slice(-200);
      localStorage.setItem('shici_reported', JSON.stringify(list));
    }
  }

  function reportMailto(info) {
    var subject = '[诗词站举报] ' + (info.title || '无标题');
    var body = '举报帖子：\n' +
      '帖子ID：' + info.id + '\n' +
      '标题：' + (info.title || '') + '\n' +
      '作者：' + (info.author || '') + '\n' +
      '页面：' + location.href + '\n\n' +
      '举报理由（请在此填写）：';
    return 'mailto:' + REPORT_EMAIL +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

  function bindReport(btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-report');
      if (reportedIds().indexOf(id) >= 0) {
        btn.textContent = '已举报';
        btn.disabled = true;
        return;
      }
      var card = btn.closest('.post-card');
      var titleEl = card ? card.querySelector('.post-title') : null;
      var whoEl = card ? card.querySelector('.who') : null;
      markReported(id);
      btn.textContent = '已举报';
      btn.disabled = true;
      location.href = reportMailto({
        id: id,
        title: titleEl ? titleEl.textContent : '',
        author: whoEl ? (whoEl.textContent.split(' · ')[0] || '') : ''
      });
    });
  }

  /* ---------- 评论区渲染 ---------- */
  function commentItem(c) {
    var d = new Date(c.ts || c.created_at);
    var when = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return (
      '<div class="comment-item" data-comment="' + esc(c.id) + '">' +
      avatarHtml(c.author, 'avatar--xs') +
      '<div class="comment-main">' +
      '<span class="comment-who">' + esc(c.author) + ' · ' + when + '</span>' +
      '<p class="comment-body">' + esc(c.body).replace(/\n/g, '<br />') + '</p>' +
      '</div></div>'
    );
  }

  function renderComments(box, postId) {
    box.hidden = false;
    box.innerHTML = '<div class="comment-loading">评论载入中…</div>';
    function paint(list) {
      var mine = localComments(postId);
      var all = (list || []).map(function (r) {
        return { id: r.id, author: r.author, body: r.body, ts: new Date(r.created_at).getTime() };
      }).concat(mine);
      var html = all.length
        ? '<div class="comment-list">' + all.map(commentItem).join('') + '</div>'
        : '<div class="comment-empty">还没有人评论，来说两句</div>';
      var needLogin = window.Cloud && window.Cloud.ready && !Auth.current();
      html += needLogin
        ? '<div class="comment-form-locked">登录后即可发表评论 · <a href="auth.html">去登录</a></div>'
        : '<form class="comment-form" data-comment-form="' + esc(postId) + '">' +
          '<input class="comment-input" type="text" maxlength="200" placeholder="写下你的感受…" />' +
          '<button type="submit" class="btn btn--primary btn--sm">发送</button></form>';
      box.innerHTML = html;

      var form = box.querySelector('[data-comment-form]');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var input = form.querySelector('.comment-input');
          var body = (input.value || '').trim();
          if (!body) return;
          input.value = '';
          var who = Auth.current() || CURRENT_USER;
          if (window.Cloud && window.Cloud.ready) {
            window.Cloud.comments.create(postId, body, function (row) {
              if (!row) {
                addLocalComment(postId, { id: 'c' + Date.now(), author: who, body: body, ts: Date.now() });
              }
              renderComments(box, postId);
            });
          } else {
            addLocalComment(postId, { id: 'c' + Date.now(), author: who, body: body, ts: Date.now() });
            renderComments(box, postId);
          }
        });
      }
    }
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.comments.list(postId, function (rows) { paint(rows || []); });
    } else {
      paint([]);
    }
  }

  function bindCommentToggles(root) {
    root.querySelectorAll('[data-comments-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-comments-toggle');
        var box = root.querySelector('[data-comments="' + id + '"]');
        if (!box) return;
        if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
        renderComments(box, id);
      });
    });
  }

  function bindLike(btn) {
    btn.addEventListener('click', function () {
      var n = parseInt(btn.getAttribute('data-like'), 10) || 0;
      if (btn.dataset.liked === '1') {
        btn.dataset.liked = '0';
        n -= 1;
      } else {
        btn.dataset.liked = '1';
        n += 1;
      }
      btn.setAttribute('data-like', String(n));
      btn.textContent = '赞 ' + n;
    });
  }

  function renderFeed() {
    var list = document.getElementById('post-list');
    if (!list) return;
    list.innerHTML = skeletonCards(3, '正在载入诗友分享');
    /* 云端模式：所有访客（含未登录）都能看到全站已通过的分享 */
    loadFeed(function (all) {
      list.innerHTML = all.map(function (p) { return postCard(p); }).join('') ||
        '<div class="empty-state">' +
        '<p style="margin:0 0 14px;">这里还很安静。分享第一首诗，或把喜欢的经典推荐给同好。</p>' +
        '<button class="btn btn--primary" data-open-compose>发布分享</button>' +
        '</div>';
      list.querySelectorAll('[data-like]').forEach(bindLike);
      list.querySelectorAll('[data-report]').forEach(bindReport);
      bindCommentToggles(list);
      fillClassicBodies(list);
      var composeBtn = list.querySelector('[data-open-compose]');
      if (composeBtn) composeBtn.addEventListener('click', function () {
        var trigger = document.querySelector('[data-compose-open]');
        if (trigger) trigger.click();
        else {
          var card = document.getElementById('compose');
          if (card) { card.hidden = false; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }
      });
    });
  }

  /* 审核面板渲染
   * ⚠️ 待审队列必须读**云端**：帖子存在 Supabase posts 表里，
   *    早期版本这里读 getPosts()（localStorage），而提交写的是云端，
   *    两边不通 → 队列永远是空的。不要再改回本地读取。 */
  function renderModeration() {
    var panel = document.getElementById('moderation-panel');
    if (!panel) return;

    /* 没有审核资格的人，连面板都看不到（不是禁用按钮，是整个不渲染） */
    panel.hidden = !canReview();
    if (panel.hidden) return;

    var queueEl = document.getElementById('moderation-queue');
    var countEl = document.getElementById('moderation-count');

    /* 云端模式：向数据库要待审队列（RLS 会挡下无权限的人） */
    if (window.Cloud && window.Cloud.ready && window.Cloud.posts.pending) {
      if (queueEl) queueEl.innerHTML = skeletonCards(2, '正在载入待审队列');
      window.Cloud.posts.pending(function (rows) {
        if (!rows) {
          /* 拉取失败（如未执行 patch_review_v2.sql）→ 说清楚原因，别假装队列为空 */
          if (queueEl) {
            queueEl.innerHTML =
              '<div class="empty-state">待审队列读取失败。若你是站长，' +
              '请确认已在 Supabase 执行 <code>supabase/patch_review_v2.sql</code>。</div>';
          }
          if (countEl) countEl.textContent = '—';
          return;
        }
        var list = rows.map(normalizeCloudPost);
        if (countEl) countEl.textContent = list.length;
        if (queueEl) {
          queueEl.innerHTML = list.length ? list.map(reviewCard).join('')
            : '<div class="empty-state">审核队列已清空，喝杯茶吧</div>';
          fillClassicBodies(queueEl);
        }
        renderReviewerList();
      });
      return;
    }

    /* 本地模式：帖子本来就存在本机，读本地即可 */
    var local = getPosts().filter(function (p) { return p.status === 'pending'; });
    if (countEl) countEl.textContent = local.length;
    if (queueEl) {
      queueEl.innerHTML = local.length ? local.map(reviewCard).join('')
        : '<div class="empty-state">审核队列已清空，喝杯茶吧</div>';
      fillClassicBodies(queueEl);
    }
    renderReviewerList();
  }

  /* 单条待审卡片的 HTML */
  function reviewCard(p) {
    return (
      '<div class="review-item" data-review="' + esc(p.id) + '">' +
      '<div class="review-body">' +
      '<div class="post-head">' + avatarHtml(p.author, 'avatar--sm') +
      '<span class="who">' + esc(p.author) + (p.kind === 'classic' ? ' · 分享经典' : ' · 原创') + '</span></div>' +
      '<h3 class="post-title">' + esc(p.title) + '</h3>' +
      '<p class="poem-body">' + postBody(p) + '</p>' +
      '</div>' +
      '<div class="review-actions">' +
      '<button class="btn btn--primary" data-approve>通过</button>' +
      '<button class="btn btn--ghost" data-reject>驳回</button>' +
      '</div>' +
      '</div>'
    );
  }

  /* 审核人名单 + 授权表单（与队列分开渲染，避免被异步打乱） */
  function renderReviewerList() {
    /* 审核人列表：站长置顶且不可移除 */
    var reviewerList = document.getElementById('reviewer-list');
    if (reviewerList) {
      reviewerList.innerHTML = reviewerRows().map(function (r) {
        var label = r.admin ? '站长' : esc(r.name);
        var tail = r.admin ? '（掌印）' : (r.me ? '（我）' : '');
        /* 只有站长能移除他人；站长本人永远保留 */
        var rm = (isAdmin() && !r.admin)
          ? ' <a data-remove-reviewer="' + esc(r.email) + '" title="移出审核人">×</a>'
          : '';
        return '<span class="chip chip--active">' + label + tail + rm + '</span>';
      }).join('');
    }

    /* 授权表单：只有站长看得到、能提交 */
    var grantBox = document.getElementById('reviewer-grant');
    if (grantBox) grantBox.hidden = !isAdmin();

    var hintEl = document.getElementById('reviewer-hint');
    if (hintEl) {
      hintEl.textContent = isAdmin()
        ? '你是站长，可把审核权授予他人，也可随时收回。'
        : '审核权由站长授予，如被移除则需重新授权。';
    }
  }

  function initCommunity() {
    var feed = document.getElementById('post-list');
    if (!feed) return;

    renderFeed();
    /* 先按「未登录/非站长」渲染（面板默认隐藏），再拉云端名单复渲染一次，
     * 避免网络慢时把审核面板闪给不该看的人 */
    renderModeration();
    loadReviewers(renderModeration);

