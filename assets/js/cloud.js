/* ============================================================
 * 诗意中国 · 云端数据层（Supabase）
 * ------------------------------------------------------------
 * 设计：云端优先，本地兜底。
 *  - 未配置 config.js 时，ready=false，所有方法回调 null，
 *    调用方自动退回 localStorage，站点功能不受影响。
 *  - 配置后按需加载 supabase-js（UMD），不拖慢首屏。
 *  - 账号由 Supabase Auth 托管：密码走 bcrypt 存服务端，
 *    前端从不接触任何密码明文，也不自己存密码。
 * ============================================================ */
(function () {
  var CFG = window.SHICI_CONFIG || {};
  var URL = String(CFG.supabaseUrl || '').trim();
  var KEY = String(CFG.supabaseAnonKey || '').trim();
  var CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

  var ready = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(URL) && KEY.length > 40;

  var client = null;
  var loading = false;
  var waiters = [];
  var PROFILE_KEY = 'shici_profile';

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { cb(true); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  /* 懒加载 SDK 并建客户端 */
  function ensure(cb) {
    if (!ready) return cb(null);
    if (client) return cb(client);
    if (loading) { waiters.push(cb); return; }
    loading = true;
    loadScript(CDN, function (ok) {
      loading = false;
      if (ok && window.supabase && window.supabase.createClient) {
        client = window.supabase.createClient(URL, KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
      } else {
        ready = false; /* SDK 加载失败 → 退回本地模式 */
      }
      var w = waiters.slice();
      waiters = [];
      w.forEach(function (f) { f(client); });
      cb(client);
    });
  }

  function profileCache() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setProfileCache(p) {
    try {
      if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
      else localStorage.removeItem(PROFILE_KEY);
    } catch (e) { /* 忽略 */ }
  }

  var Cloud = {
    get ready() { return ready; },
    mode: function () { return ready ? 'cloud' : 'local'; },

    /* ---------- 账号 ---------- */
    auth: {
      /* 同步返回当前用户（首次刷新时可能短暂为 null，随后由 onChange 补上） */
      current: function () {
        var p = profileCache();
        return p && p.name ? p : null;
      },
      onChange: function (fn) {
        ensure(function (c) {
          if (!c) return;
          c.auth.onAuthStateChange(function (_evt, session) {
            var u = session && session.user;
            if (u) {
              var name = (u.user_metadata && u.user_metadata.name) || (u.email || '').split('@')[0];
              setProfileCache({ account: u.email, name: name, id: u.id });
            } else {
              setProfileCache(null);
            }
            fn(u ? profileCache() : null);
          });
        });
      },
      signUp: function (email, pwd, name, cb) {
        ensure(function (c) {
          if (!c) return cb('云端未配置');
          c.auth.signUp({
            email: email,
            password: pwd,
            options: { data: { name: name } }
          }).then(function (r) {
            if (r.error) return cb(r.error.message);
            /* 邮箱未开启验证时直接登录成功；开启验证时提示去查收邮件 */
            if (r.data && r.data.session) {
              setProfileCache({ account: email, name: name, id: r.data.user.id });
              cb(null, { needConfirm: false });
            } else {
              cb(null, { needConfirm: true });
            }
          }, function (e) { cb(e.message || '注册失败'); });
        });
      },
      signIn: function (email, pwd, cb) {
        ensure(function (c) {
          if (!c) return cb('云端未配置');
          c.auth.signInWithPassword({ email: email, password: pwd }).then(function (r) {
            if (r.error) return cb(r.error.message);
            var u = r.data.user;
            var name = (u.user_metadata && u.user_metadata.name) || email.split('@')[0];
            setProfileCache({ account: email, name: name, id: u.id });
            cb(null, profileCache());
          }, function (e) { cb(e.message || '登录失败'); });
        });
      },
      signOut: function (cb) {
        setProfileCache(null);
        ensure(function (c) {
          if (!c) return cb && cb();
          c.auth.signOut().then(function () { cb && cb(); }, function () { cb && cb(); });
        });
      },
      userId: function () {
        var p = profileCache();
        return p ? p.id : null;
      }
    },

    /* ---------- 帖子 ---------- */
    posts: {
      list: function (cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          var me = Cloud.auth.userId();
          var q = c.from('posts').select('*').order('created_at', { ascending: false }).limit(200);
          /* 已通过的公开可见；登录用户额外看到自己待审/驳回的 */
          q = me ? q.or('status.eq.approved,user_id.eq.' + me) : q.eq('status', 'approved');
          q.then(function (r) { cb(r.error ? null : (r.data || [])); });
        });
      },
      create: function (post, cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          var uid = Cloud.auth.userId();
          var row = {
            kind: post.kind || 'original',
            title: post.title,
            body: post.text || '',
            poem_id: (post.poemId === null || post.poemId === undefined) ? null : post.poemId,
            author: post.author,
            user_id: uid,
            status: 'approved',
            likes: 0
          };
          c.from('posts').insert(row).select().then(function (r) {
            cb(r.error ? null : (r.data && r.data[0]));
          });
        });
      },
      like: function (id, cb) {
        ensure(function (c) {
          if (!c) return cb(false);
          c.rpc('increment_likes', { post_id: id }).then(function (r) {
            cb(!r.error);
          });
        });
      },
      setStatus: function (id, status, cb) {
        ensure(function (c) {
          if (!c) return cb(false);
          c.from('posts').update({ status: status }).eq('id', id).then(function (r) {
            cb(!r.error);
          });
        });
      }
    },

    /* ---------- 评论 ---------- */
    comments: {
      list: function (postId, cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          c.from('comments').select('*').eq('post_id', postId)
            .order('created_at', { ascending: true })
            .then(function (r) { cb(r.error ? null : (r.data || [])); });
        });
      },
      create: function (postId, body, cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          var p = Cloud.auth.current();
          c.from('comments').insert({
            post_id: postId,
            body: body,
            author: p ? p.name : '匿名诗友',
            user_id: Cloud.auth.userId()
          }).select().then(function (r) {
            cb(r.error ? null : (r.data && r.data[0]));
          });
        });
      },
      remove: function (id, cb) {
        ensure(function (c) {
          if (!c) return cb(false);
          c.from('comments').delete().eq('id', id).then(function (r) { cb(!r.error); });
        });
      }
    }
  };

  window.Cloud = Cloud;
})();
