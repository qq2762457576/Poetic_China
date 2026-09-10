/* ============================================================
 * 诗意中国 — 云端配置
 * ------------------------------------------------------------
 * 这一文件是「本地模式」与「云端模式」的开关。
 *
 * 两个都留空   → 站点运行在本地模式（数据存浏览器 localStorage，
 *                分享与评论仅自己可见，适合离线演示）
 * 两个都填好   → 自动切换云端模式（Supabase），分享人人可见、
 *                评论跨用户互通、账号多端同步
 *
 * 填写方法见项目根目录 SETUP.md 第 2 节。
 * 注意：anon key 是「公开可暴露的匿名密钥」，本来就是给前端用的，
 *       配合 Supabase 的行级安全策略（RLS）才是安全的。不要把
 *       service_role 密钥填到这里，那个必须只在服务器上用。
 * ============================================================ */
window.SHICI_CONFIG = {
  // Project URL = Data API 地址去掉末尾的 /rest/v1/
  supabaseUrl: 'https://ocdomwjlipcwzfvzbowy.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jZG9td2psaXBjd3pmdnpib3d5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5OTQzNzEsImV4cCI6MjEwNDU3MDM3MX0.uedhjsz8FB_imcrnkLVzU6GA9iHPGLnZydjPtc29jjg',

  /* 站长（管理员）邮箱白名单
   * 只有这里的账号拥有社区审核权，且只有他们能把审核权授予别人。
   * 用邮箱而非昵称判断 —— 昵称可重名，邮箱是账号唯一标识。 */
  admins: ['2762457576@qq.com']
};
