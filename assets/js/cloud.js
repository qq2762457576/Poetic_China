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
  var URL = String(CFG.supabaseUrl || '').trim().replace(/\/+$/, ''); /* 容忍末尾斜杠 */
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
            /* 尊重调用方指定的状态：默认待审，审核通过后才公开。
             * 早期版本这里写死 'approved'，导致审核流程形同虚设 —— 不要改回去。 */
            status: post.status || 'pending',
            likes: 0
          };
          c.from('posts').insert(row).select().then(function (r) {
            cb(r.error ? null : (r.data && r.data[0]));
          });
        });
      },
      /* 审核队列：拉取全部待审帖子（含他人发布的）。
       * 依赖数据库的 posts_select_reviewer 策略 —— 没有审核权的人会被 RLS 挡下，
       * 拿不到数据（而不是拿到数据后再由前端过滤），前端权限校验只是第一道。 */
      pending: function (cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          c.from('posts').select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .then(function (r) { cb(r.error ? null : (r.data || [])); });
        });
      },
      like: function (id, cb) {
        ensure(function (c) {
          if (!c) return cb(false);
          /* 参数名统一为 post_id；为防个别库残留 p_post_id 版本，失败后再试一次 */
          c.rpc('increment_likes', { post_id: id }).then(function (r) {
            if (!r.error) return cb(true);
            c.rpc('increment_likes', { p_post_id: id }).then(function (r2) {
              cb(!r2.error);
            });
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
    },

    /* ---------- 审核人名单 ----------
     * 读取：任何人都能读（渲染名单用）。
     * 写入：只有站长能写 —— 前端在 main.js 拦一道，数据库 RLS 再拦一道。
     * 即便有人绕过前端直接调接口，也会被 reviewers 表策略挡掉。 */
    reviewers: {
      list: function (cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          c.from('reviewers').select('email').then(function (r) {
            cb(r.error ? null : (r.data || []).map(function (x) {
              return String(x.email || '').toLowerCase();
            }));
          });
        });
      },
      add: function (email, cb) {
        ensure(function (c) {
          if (!c) return cb && cb(false);
          c.from('reviewers').insert({ email: String(email).toLowerCase() })
            .then(function (r) { cb && cb(!r.error, r.error && r.error.message); });
        });
      },
      remove: function (email, cb) {
        ensure(function (c) {
          if (!c) return cb && cb(false);
          c.from('reviewers').delete().eq('email', String(email).toLowerCase())
            .then(function (r) { cb && cb(!r.error); });
        });
      }
    },

    /* ---------- 学习进度 / 收藏 / 成绩（登录后走云端） ---------- */
    /* 读：返回 id 数组；写：fire-and-forget，失败不影响本地体验 */
    learned: {
      list: function (cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          var uid = Cloud.auth.userId();
          if (!uid) return cb(null);
          c.from('learned').select('poem_id').eq('user_id', uid)
            .then(function (r) {
              cb(r.error ? null : (r.data || []).map(function (x) { return x.poem_id; }));
            });
        });
      },
      add: function (poemId, cb) {
        ensure(function (c) {
          var uid = Cloud.auth.userId();
          if (!c || !uid) return cb && cb(false);
          /* upsert：重复标记同一首不报错（唯一约束 user_id+poem_id） */
          c.from('learned').upsert(
            { user_id: uid, poem_id: poemId },
            { onConflict: 'user_id,poem_id', ignoreDuplicates: true }
          ).then(function (r) { cb && cb(!r.error); });
        });
      },
      remove: function (poemId, cb) {
        ensure(function (c) {
          var uid = Cloud.auth.userId();
          if (!c || !uid) return cb && cb(false);
          c.from('learned').delete().eq('user_id', uid).eq('poem_id', poemId)
            .then(function (r) { cb && cb(!r.error); });
        });
      },
      /* 批量合并：把本地进度一次性推上云（首次登录用） */
      merge: function (poemIds, cb) {
        ensure(function (c) {
          var uid = Cloud.auth.userId();
          if (!c || !uid || !poemIds || !poemIds.length) return cb && cb(false);
          var rows = poemIds.map(function (id) { return { user_id: uid, poem_id: id }; });
          c.from('learned').upsert(rows,
            { onConflict: 'user_id,poem_id', ignoreDuplicates: true }
          ).then(function (r) { cb && cb(!r.error); });
        });
      }
    },

    favs: {
      list: function (cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          var uid = Cloud.auth.userId();
          if (!uid) return cb(null);
          c.from('favs').select('poem_id').eq('user_id', uid)
            .then(function (r) {
              cb(r.error ? null : (r.data || []).map(function (x) { return x.poem_id; }));
            });
        });
      },
      add: function (poemId, cb) {
        ensure(function (c) {
          var uid = Cloud.auth.userId();
          if (!c || !uid) return cb && cb(false);
          c.from('favs').upsert(
            { user_id: uid, poem_id: poemId },
            { onConflict: 'user_id,poem_id', ignoreDuplicates: true }
          ).then(function (r) { cb && cb(!r.error); });
        });
      },
      remove: function (poemId, cb) {
        ensure(function (c) {
          var uid = Cloud.auth.userId();
          if (!c || !uid) return cb && cb(false);
          c.from('favs').delete().eq('user_id', uid).eq('poem_id', poemId)
            .then(function (r) { cb && cb(!r.error); });
        });
      },
      merge: function (poemIds, cb) {
        ensure(function (c) {
          var uid = Cloud.auth.userId();
          if (!c || !uid || !poemIds || !poemIds.length) return cb && cb(false);
          var rows = poemIds.map(function (id) { return { user_id: uid, poem_id: id }; });
          c.from('favs').upsert(rows,
            { onConflict: 'user_id,poem_id', ignoreDuplicates: true }
          ).then(function (r) { cb && cb(!r.error); });
        });
      }
    },

    scores: {
      get: function (cb) {
        ensure(function (c) {
          if (!c) return cb(null);
          var uid = Cloud.auth.userId();
          if (!uid) return cb(null);
          c.from('scores').select('*').eq('user_id', uid).maybeSingle()
            .then(function (r) {
              if (r.error) return cb(null);
              if (!r.data) return cb(null);
              cb({
                bestScore: r.data.best_score || 0,
                bestStreak: r.data.best_streak || 0,
                done: r.data.total_done || 0,
                correct: r.data.total_right || 0
              });
            });
        });
      },
      /* 由数据库取最大值，不会覆盖更好的历史记录 */
      save: function (s, cb) {
        ensure(function (c) {
          var uid = Cloud.auth.userId();
          if (!c || !uid) return cb && cb(false);
          c.rpc('upsert_score', {
            p_score: s.bestScore || 0,
            p_streak: s.bestStreak || 0,
            p_done: s.done || 0,
            p_right: s.correct || 0
          }).then(function (r) { cb && cb(!r.error); });
        });
      }
    }
  };

  window.Cloud = Cloud;
})();
