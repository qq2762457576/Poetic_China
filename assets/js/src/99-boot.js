  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initTabbar();
    initMobileMenu();
    initAuthTabs();
    initAuthForm();
    initAuthUI();
    initHome();
    initMe();

    /* 云端会话恢复：SDK 就绪后若发现已登录会话，补画顶栏与信息流 */
    if (window.Cloud && window.Cloud.ready) {
      window.Cloud.auth.onChange(function (user) {
        initAuthUI();
        renderFeed();
        /* 已登录 → 合并本地与云端的学习进度/收藏/成绩 */
        if (user) syncUserData();
      });
    }

    /* 需要索引的页面：先载入第 0 片（1.7MB）立即出内容，再初始化 */
    var needsIndex =
      document.getElementById('poem-list') ||
      document.getElementById('study-title') ||
      document.getElementById('post-list');

    function booted() {
      initLibrary();
      initCommunity();
      initStudy();
      initChallenge();
    }
    if (needsIndex) IndexStore.boot(booted);
    else booted();
  });
})();
