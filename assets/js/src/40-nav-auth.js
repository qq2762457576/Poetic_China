  /* ---------- 2. 底部导航 / 移动菜单 ---------- */
  function initTabbar() {
    var page = document.body.getAttribute('data-page');
    document.querySelectorAll('.tab-item').forEach(function (item) {
      item.classList.toggle('is-active', item.getAttribute('data-tab') === page);
    });
    document.querySelectorAll('.mobile-menu a').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-tab') === page);
    });
  }

  /* 移动端汉堡菜单
   * 要点：① 同步 aria-expanded（无障碍，PRD 第二十八条）
   *      ② 点了菜单里的链接要自动收起 —— 否则跳转后菜单仍敞着遮住页面
   *      ③ 点菜单外 / 按 Esc 关闭 —— 手机上没有「点空白处」的习惯，但 Esc 对
   *         外接键盘和读屏用户是必需出口 */
  function initMobileMenu() {
    var btn = document.querySelector('[data-menu-toggle]');
    var menu = document.querySelector('.mobile-menu');
    if (!btn || !menu) return;

    function setOpen(open) {
      menu.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      /* 读屏用户听到的是「展开菜单 / 收起菜单」，与视觉状态一致 */
      btn.setAttribute('aria-label', open ? '收起菜单' : '打开菜单');
    }
    /* 初始态：菜单默认收起 */
    if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!menu.classList.contains('is-open'));
    });

    /* 点菜单里的链接 → 立即收起（页面正在跳转，先给出视觉反馈） */
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    /* 点菜单与按钮之外的区域 → 收起 */
    document.addEventListener('click', function (e) {
      if (!menu.classList.contains('is-open')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });

    /* Esc → 收起并把焦点还给按钮（键盘 / 读屏用户出口） */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!menu.classList.contains('is-open')) return;
      setOpen(false);
      btn.focus();
    });
  }

  /* ---------- 3. 注册 / 登录 ---------- */
  function initAuthTabs() {
    var tabs = document.querySelectorAll('.auth-tab');
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.toggle('is-active', t === tab); });
        var mode = tab.getAttribute('data-mode');
        document.querySelectorAll('[data-panel]').forEach(function (panel) {
          panel.hidden = panel.getAttribute('data-panel') !== mode;
        });
      });
    });
  }

  function initAuthForm() {
    var regForm = document.querySelector('form[data-panel="register"]');
    var loginForm = document.querySelector('form[data-panel="login"]');
    if (!regForm && !loginForm) return;

    function hint(form, msg, ok) {
      var el = form.querySelector('[data-hint]');
      if (!el) return;
      el.textContent = msg;
      el.classList.toggle('is-error', !ok);
      el.classList.toggle('is-ok', !!ok);
    }
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    if (regForm) {
      regForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var account = val('reg-account');
        var name = val('reg-name');
        var pwd = val('reg-pwd');
        var agree = document.getElementById('reg-agree');
        var cloudMode = window.Cloud && window.Cloud.ready;
        /* 云端账号体系只认邮箱；本地模式宽松些 */
        if (cloudMode && !/^\S+@\S+\.\S+$/.test(account)) return hint(regForm, '云端账号请用邮箱注册');
        if (!cloudMode && !/^(\S+@\S+\.\S+|1\d{10})$/.test(account)) return hint(regForm, '账号请填邮箱或 11 位手机号');
        if (name.length < 2 || name.length > 12) return hint(regForm, '笔名取 2-12 个字');
        if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) return hint(regForm, '密码至少 8 位，且同时包含字母与数字');
        if (agree && !agree.checked) return hint(regForm, '请先勾选同意《社区公约》与《隐私政策》');
        hint(regForm, '注册中…', true);
        Auth.register(account, name, pwd, function (err, msg) {
          if (err) return hint(regForm, err);
          /* 邮箱需要点确认链接时，停在页面提示，不跳转 */
          if (msg && msg.indexOf('确认') !== -1) return hint(regForm, msg, true);
          hint(regForm, msg || '注册成功，正在进入你的空间…', true);
          setTimeout(function () { location.href = 'me.html'; }, 700);
        });
      });
    }

    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var account = val('login-account');
        var pwd = val('login-pwd');
        if (!account || !pwd) return hint(loginForm, '账号和密码都要填');
        hint(loginForm, '登录中…', true);
        Auth.login(account, pwd, function (err) {
          if (err) return hint(loginForm, err);
          hint(loginForm, '登录成功，欢迎回来…', true);
          setTimeout(function () { location.href = 'me.html'; }, 700);
        });
      });
    }

    /* 第三方登录：演示站占位 */
    document.querySelectorAll('.oauth-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        hint(regForm || loginForm, '演示站点暂未接入第三方登录，请用账号注册 / 登录');
      });
    });

    /* ---------- 密码找回（2.6） ----------
     * 三个面板切换：login/register 走 tab，reset/newpwd 靠这里。
     * 恢复流程：邮件链接回跳带 #type=recovery → SDK 建立临时会话并触发
     * PASSWORD_RECOVERY → 显示「设置新密码」面板。 */
    function showPanel(name) {
      document.querySelectorAll('[data-panel]').forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-panel') !== name;
      });
      document.querySelectorAll('.auth-tab').forEach(function (t) {
        t.classList.toggle('is-active', t.getAttribute('data-mode') === name);
      });
    }
    var gotoReset = document.getElementById('goto-reset');
    if (gotoReset) {
      gotoReset.addEventListener('click', function () { showPanel('reset'); });
    }
    var resetForm = document.querySelector('form[data-panel="reset"]');
    if (resetForm) {
      resetForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = val('reset-email');
        if (!/^\S+@\S+\.\S+$/.test(email)) return hint(resetForm, '请填写有效的邮箱地址');
        hint(resetForm, '发送中…', true);
        window.Cloud.auth.resetPassword(email, function (err) {
          if (err) return hint(resetForm, err);
          /* 隐私要点：不透露该邮箱是否已注册（Supabase 对未注册邮箱也返回成功） */
          hint(resetForm, '如果该邮箱注册过，重置邮件已发出，请到邮箱查收（留意垃圾邮件）', true);
        });
      });
    }
    var newPwdForm = document.querySelector('form[data-panel="newpwd"]');
    if (newPwdForm) {
      newPwdForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var p1 = val('new-pwd');
        var p2 = val('new-pwd2');
        if (p1.length < 8 || !/[a-zA-Z]/.test(p1) || !/\d/.test(p1)) return hint(newPwdForm, '密码至少 8 位，且同时包含字母与数字');
        if (p1 !== p2) return hint(newPwdForm, '两次输入的密码不一致');
        hint(newPwdForm, '保存中…', true);
        window.Cloud.auth.updatePassword(p1, function (err) {
          if (err) return hint(newPwdForm, err);
          hint(newPwdForm, '新密码已生效，正在进入你的空间…', true);
          setTimeout(function () { location.href = 'me.html'; }, 700);
        });
      });
    }
    /* 进入页面时就在找回流程中（点邮件链接回跳）→ 直接显示改密码面板 */
    if (window.Cloud && window.Cloud.auth && window.Cloud.auth.onRecovery) {
      var inRecovery = window.Cloud.auth.onRecovery(function () { showPanel('newpwd'); });
      if (inRecovery) showPanel('newpwd');
    }

    /* 已登录用户直达 */
    if (Auth.current()) {
      var wrap = document.querySelector('.auth-form-wrap');
      if (wrap) {
        wrap.innerHTML =
          '<div style="text-align:center;padding:40px 0;">' +
          '<h2 class="form-title">已登录为「' + esc(Auth.current()) + '」</h2>' +
          '<p class="form-sub" style="margin:12px 0 24px;">' +
          (window.Cloud && window.Cloud.ready
            ? '账号已同步云端，换设备登录同一邮箱即可继续'
            : '学习进度与闯关成绩会在本机自动保存') + '</p>' +
          '<a class="btn btn--primary btn--block" href="me.html">进入我的空间</a>' +
          '<p class="form-hint" style="margin-top:16px;">' +
          '<a href="index.html" style="margin-right:16px;">回到首页</a>' +
          '<a data-logout style="cursor:pointer;">退出登录</a></p>' +
          '</div>';
      }
    }

    document.querySelectorAll('[data-switch]').forEach(function (link) {
      link.addEventListener('click', function () {
        var tab = document.querySelector('.auth-tab[data-mode="' + link.getAttribute('data-switch') + '"]');
        if (tab) tab.click();
      });
    });
  }

  /* 顶栏账号模式徽标（Phase 2.8）
   * 注入到 .header-actions 里，和登录/退出按钮并排。位置上刻意放在账号区附近：
   * 用户看「我现在是谁」的时候，顺手就能看到「我的数据存在哪」。
   *
   * ⚠️ 幂等：initAuthUI 会被反复调用（换头像、同步回来都要重刷），
   *    所以这里用 data-mode-badge 找已存在的节点做「就地更新」而不是追加，
   *    否则每刷新一次就多一个徽标。 */
  function renderModeBadge() {
    var host = document.querySelector('.header-actions');
    if (!host) return;
    var info = accountModeInfo();

    var el = host.querySelector('[data-mode-badge]');
    if (!el) {
      el = document.createElement('span');
      el.setAttribute('data-mode-badge', '');
      /* 插到最前面，避免把登录按钮挤到搜索图标右侧 */
      host.insertBefore(el, host.firstChild);
    }
    el.className = 'mode-badge mode-badge--' + info.key;
    el.setAttribute('title', info.title + '：' + info.desc);
    el.setAttribute('aria-label', info.title + '。' + info.desc);
    /* 圆点 + 短文案：窄屏只留圆点（CSS 控制），宽屏显示全称 */
    el.innerHTML = '<span class="mode-badge-dot" aria-hidden="true"></span>' +
      '<span class="mode-badge-text">' + esc(info.badgeShort) + '</span>';
  }

  /* 顶栏登录态：登录后显示笔名 + 退出 */
  function initAuthUI() {
    var name = Auth.current();

    /* 换头像后要能就地刷新顶栏（否则头像换了、顶上还是旧字）。
     * 重跑 initAuthUI 即可：它是幂等的（用 __named / __bound 标记防重复）。 */
    window.__refreshNavAvatar = function () { initAuthUI(); };

    renderModeBadge();

    /* 「我的」页的顶栏专用结构：两个容器按登录态互斥显隐 */
    var accBox = document.getElementById('header-account');
    var guestBox = document.getElementById('header-guest');
    if (accBox || guestBox) {
      if (name) {
        if (accBox) {
          accBox.hidden = false;
          var hn = document.getElementById('header-account-name');
          if (hn) hn.textContent = name;
          var hs = document.getElementById('header-signout');
          if (hs && !hs.__bound) {
            hs.__bound = 1;
            hs.addEventListener('click', function (e) {
              e.preventDefault();
              Auth.logout(function () { location.reload(); });
            });
          }
        }
        if (guestBox) guestBox.hidden = true;
      } else {
        if (accBox) accBox.hidden = true;
        if (guestBox) guestBox.hidden = false;
      }
    }

    if (!name) return;
    /* 顶栏登录态：笔名本身必须可点，直接进「我的」。
     * ⚠️ 早期版本这里是个纯 <span>，用户看到「你好，江心屿」却点不动，
     *    只能绕道移动端 tabbar 才能进个人中心 —— 不要再改回不可点。
     *
     * ⚠️ 也必须用「就地替换」而不是整体 innerHTML 重写：
     *    library / challenge 的同一个容器里还放着搜索图标，
     *    整体重写会把它们一起抹掉。这里只摘掉指向 auth.html 的那两条链接。 */
    document.querySelectorAll('.header-actions .only-desktop').forEach(function (box) {
      var authLinks = box.querySelectorAll('a[href="auth.html"]');
      if (!authLinks.length) return;
      var onMe = /me\.html$/.test(location.pathname);
      var userLink = document.createElement('a');
      userLink.className = 'auth-user';
      userLink.href = 'me.html';
      if (onMe) userLink.setAttribute('aria-current', 'page');
      userLink.setAttribute('data-user-entry', '');
      userLink.innerHTML =
        avatarHtml(name, 'auth-user-avatar') +
        '<span class="auth-user-name">' + esc(name) + '</span>';
      var outLink = document.createElement('a');
      outLink.className = 'btn btn--ghost';
      outLink.style.cssText = 'padding:9px 20px;cursor:pointer;';
      outLink.setAttribute('data-logout', '');
      outLink.textContent = '退出';
      /* 用第一条 auth 链接的位置当锚点，其余 auth 链接与旧登出链接一并移除 */
      var anchor = authLinks[0];
      box.insertBefore(userLink, anchor);
      box.insertBefore(outLink, anchor);
      authLinks.forEach(function (a) { a.parentNode && a.parentNode.removeChild(a); });
      var stale = box.querySelectorAll('[data-logout]');
      Array.prototype.forEach.call(stale, function (n) {
        if (n !== outLink && n.parentNode) n.parentNode.removeChild(n);
      });
    });
    /* 移动菜单：登录后把「登录 / 注册」那条换成「退出登录（笔名）」，
     * 但「我的」那一项保持原样可点 —— 两者是并列的两条，别合并。 */
    document.querySelectorAll('.mobile-menu a[href="auth.html"]').forEach(function (a) {
      a.textContent = '退出登录（' + name + '）';
      a.removeAttribute('href');
      a.setAttribute('data-logout', '');
    });
    /* 移动菜单里的「我的」补上笔名，让用户一眼确认身份 */
    document.querySelectorAll('.mobile-menu a[data-tab="me"]').forEach(function (a) {
      if (a.__named) return;
      a.__named = 1;
      a.textContent = '我的 · ' + name;
    });
  }

