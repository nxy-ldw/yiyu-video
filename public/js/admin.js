/* ============================================
   一屿视频管理后台 V4.0 - 主逻辑
   全部原生JS ES5兼容 (var/function)
   ============================================ */

var adminToken = localStorage.getItem('admin_token') || '';
var adminUserInfo = null;
var currentAdminPage = 'dashboard';

/* ========== 通用工具函数 ========== */

function adminRequest(url, options) {
  options = options || {};
  var headers = { 'Content-Type': 'application/json' };
  if (options.headers) {
    for (var k in options.headers) headers[k] = options.headers[k];
  }
  if (adminToken) {
    headers['Authorization'] = 'Bearer ' + adminToken;
  }
  return fetch(getApiUrl(url), {
    method: options.method || 'GET',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(function(r) { return r.json(); });
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTime(t) {
  if (!t) return '-';
  var d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  function pad(n) { return n < 10 ? '0' + n : n; }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function shortId(id) {
  if (!id) return '-';
  var s = String(id);
  return s.length > 10 ? s.slice(0, 7) + '...' : s;
}

/* ========== Toast 提示 ========== */

function adminToast(msg, type) {
  type = type || 'info';
  var wrap = document.getElementById('admin-toast-wrap');
  if (!wrap) return;
  var icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  var el = document.createElement('div');
  el.className = 'admin-toast ' + type;
  el.innerHTML = '<span class="toast-ico">' + (icons[type] || 'ℹ') + '</span>' +
                 '<span class="toast-msg">' + escapeHtml(msg) + '</span>';
  wrap.appendChild(el);
  setTimeout(function() {
    el.classList.add('leaving');
    setTimeout(function() { el.remove(); }, 300);
  }, 2800);
}

/* ========== 弹窗 ========== */

var modalOnOkCallback = null;

function showModal(title, html, onOk) {
  var m = document.getElementById('admin-modal');
  document.getElementById('modal-title').innerHTML = escapeHtml(title);
  document.getElementById('modal-body').innerHTML = html;
  modalOnOkCallback = typeof onOk === 'function' ? onOk : null;
  var okBtn = document.getElementById('modal-ok-btn');
  okBtn.onclick = function() {
    if (modalOnOkCallback) {
      var ret = modalOnOkCallback();
      if (ret === false) return;
    }
    hideModal();
  };
  m.style.display = 'flex';
}

function hideModal() {
  document.getElementById('admin-modal').style.display = 'none';
  document.getElementById('modal-body').innerHTML = '';
  modalOnOkCallback = null;
}

/* ========== 通用分页 ========== */

function renderPagination(container, page, total, limit, onChange) {
  var totalPages = Math.max(1, Math.ceil(total / limit));
  page = Math.min(Math.max(1, page), totalPages);
  var info = '共 <b style="color:#2c3e50">' + total + '</b> 条，第 <b style="color:#ff6b6b">' +
             page + '</b> / ' + totalPages + ' 页';
  var btns = '';
  btns += '<button class="page-btn" ' + (page <= 1 ? 'disabled' : '') +
          ' onclick="window.__pg_' + container.id + '_cb(' + (page - 1) + ')">‹</button>';
  var s = Math.max(1, page - 2), e = Math.min(totalPages, page + 2);
  if (s > 1) { btns += '<button class="page-btn" onclick="window.__pg_' + container.id + '_cb(1)">1</button>'; if (s > 2) btns += '<span class="page-ellipsis">…</span>'; }
  for (var i = s; i <= e; i++) {
    btns += '<button class="page-btn ' + (i === page ? 'active' : '') +
            '" onclick="window.__pg_' + container.id + '_cb(' + i + ')">' + i + '</button>';
  }
  if (e < totalPages) { if (e < totalPages - 1) btns += '<span class="page-ellipsis">…</span>'; btns += '<button class="page-btn" onclick="window.__pg_' + container.id + '_cb(' + totalPages + ')">' + totalPages + '</button>'; }
  btns += '<button class="page-btn" ' + (page >= totalPages ? 'disabled' : '') +
          ' onclick="window.__pg_' + container.id + '_cb(' + (page + 1) + ')">›</button>';
  container.innerHTML =
    '<div class="pagination-wrap"><div class="pagination-info">' + info +
    '</div><div class="pagination">' + btns + '</div></div>';
  window['__pg_' + container.id + '_cb'] = function(p) { onChange(p); };
}

/* ========== 登录/登出 ========== */

function showAdminApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('admin-app').style.display = 'flex';
}
function showLoginView() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('admin-app').style.display = 'none';
}

function adminLogin() {
  var acc = document.getElementById('admin-account').value.trim();
  var pwd = document.getElementById('admin-password').value;
  if (!acc || !pwd) { adminToast('请输入账号和密码', 'warning'); return; }
  fetch(getApiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: acc, password: pwd })
  }).then(function(r) { return r.json(); }).then(function(res) {
    if (res.code !== 0) { adminToast(res.message || '登录失败', 'error'); return; }
    if (!res.data || !res.data.user || !res.data.user.isAdmin) {
      adminToast('您不是管理员，无权进入后台', 'error'); return;
    }
    adminToken = res.data.token;
    adminUserInfo = res.data.user;
    localStorage.setItem('admin_token', adminToken);
    document.getElementById('admin-name').textContent = adminUserInfo.username;
    document.getElementById('admin-avatar').textContent = (adminUserInfo.username || 'A').charAt(0).toUpperCase();
    adminToast('登录成功，欢迎回来！', 'success');
    showAdminApp();
    adminSwitchPage('dashboard');
  }).catch(function() { adminToast('网络错误，请稍后重试', 'error'); });
}

function adminLogout() {
  showModal('退出确认', '<p style="padding:10px 0;">确定要退出管理员后台吗？</p>', function() {
    adminToken = '';
    adminUserInfo = null;
    localStorage.removeItem('admin_token');
    adminToast('已安全退出', 'success');
    setTimeout(showLoginView, 500);
  });
}

/* ========== 页面路由 ========== */

var pageBreadcrumbs = {
  'dashboard': '仪表盘',
  'users': '用户管理',
  'ann-home': '公告管理 / 首页公告',
  'ann-login': '公告管理 / 登录页公告',
  'sources': '数据源管理',
  'ads-banner': '广告管理 / 首页Banner',
  'ads-mine': '广告管理 / 我的页面广告',
  'push': '推送通知',
  'feedback': '功能反馈',
  'logs-op': '日志管理 / 操作日志',
  'logs-reg': '日志管理 / 注册日志',
  'server': '服务器控制',
  'settings': '系统设置'
};

function adminSwitchPage(page) {
  currentAdminPage = page;
  var items = document.querySelectorAll('.menu-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', items[i].getAttribute('data-page') === page);
  }
  document.getElementById('breadcrumb-page').textContent = pageBreadcrumbs[page] || page;
  var loaders = {
    'dashboard': adminShowDashboard,
    'users': adminShowUsers,
    'ann-home': adminShowAnnHome,
    'ann-login': adminShowAnnLogin,
    'sources': adminShowSources,
    'ads-banner': adminShowAdsBanner,
    'ads-mine': adminShowAdsMine,
    'push': adminShowPush,
    'feedback': adminShowFeedback,
    'logs-op': adminShowOpLogs,
    'logs-reg': adminShowRegLogs,
    'server': adminShowServer,
    'settings': adminShowSettings
  };
  var fn = loaders[page];
  var c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载中...</div>';
  if (fn) { try { fn(); } catch(e) { c.innerHTML = '<div class="card" style="color:#ee5253">页面加载出错：' + escapeHtml(e.message) + '</div>'; } }
}

/* ========== 1. 仪表盘 ========== */

function adminShowDashboard() {
  adminRequest('/admin/dashboard').then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var d = res.data || {};
    function v(x, def) { return x == null ? (def == null ? 0 : def) : x; }
    c.innerHTML = '' +
      '<div class="stat-grid">' +
        statCard('primary', '👥', '总用户数', v(d.totalUsers)) +
        statCard('info', '🛡️', '管理员数', v(d.adminUsers)) +
        statCard('secondary', '👑', 'VIP用户', v(d.vipUsers)) +
        statCard('danger', '🚫', '封禁用户', v(d.bannedUsers)) +
        statCard('warn', '💬', '待处理反馈', v(d.pendingFeedback)) +
        statCard('success', '📨', '总反馈数', v(d.totalFeedback)) +
      '</div>' +
      '<div class="today-grid">' +
        '<div class="today-card"><div class="today-ico blue">📱</div>' +
          '<div><div class="today-label">今日登录数</div><div class="today-num">' + v(d.todayLogins) + '</div><div class="today-sub">较昨日 -</div></div></div>' +
        '<div class="today-card"><div class="today-ico green">🎉</div>' +
          '<div><div class="today-label">今日注册数</div><div class="today-num">' + v(d.todayRegistrations) + '</div><div class="today-sub">新增会员用户</div></div></div>' +
      '</div>' +
      '<div class="card"><div class="card-title"><span><span class="card-title-ico">📋</span>最近10条操作日志</span></div>' +
        renderSimpleTable(
          ['时间', '用户', '动作', 'IP'],
          (d.recentLogs || []).slice(0, 10).map(function(l) {
            return [formatTime(l.time), escapeHtml(l.user || '-'), escapeHtml(l.action || '-'), escapeHtml(l.ip || '-')];
          })
        ) +
      '</div>' +
      '<div class="card"><div class="card-title"><span><span class="card-title-ico">📝</span>最近10条注册记录</span></div>' +
        renderSimpleTable(
          ['时间', '用户名', '手机号', 'IP'],
          (d.recentRegistrations || []).slice(0, 10).map(function(r) {
            return [formatTime(r.time), escapeHtml(r.username || '-'), escapeHtml(r.phone || '-'), escapeHtml(r.ip || '-')];
          })
        ) +
      '</div>';
  });
}

function statCard(cls, ico, label, val) {
  return '<div class="stat-card ' + cls + '"><div class="stat-icon">' + ico +
         '</div><div class="stat-label">' + label + '</div><div class="stat-value">' + val + '</div></div>';
}

function renderSimpleTable(heads, rows) {
  if (!rows || rows.length === 0) {
    return '<div class="empty-state"><div class="empty-ico">📭</div><div class="empty-text">暂无数据</div></div>';
  }
  var h = '<table class="admin-table"><thead><tr>';
  for (var i = 0; i < heads.length; i++) h += '<th>' + heads[i] + '</th>';
  h += '</tr></thead><tbody>';
  for (var j = 0; j < rows.length; j++) {
    h += '<tr>';
    for (var k = 0; k < rows[j].length; k++) h += '<td>' + rows[j][k] + '</td>';
    h += '</tr>';
  }
  h += '</tbody></table>';
  return h;
}

/* ========== 2. 用户管理 ========== */

var usersPage = 1;
var usersKeyword = '';

function adminShowUsers(page) {
  if (typeof page === 'number') usersPage = page;
  var kw = document.getElementById('users-search-input') ? document.getElementById('users-search-input').value : usersKeyword;
  usersKeyword = kw || '';
  adminRequest('/admin/users?page=' + usersPage + '&limit=20&keyword=' + encodeURIComponent(usersKeyword)).then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var d = res.data || {};
    var list = d.list || [];
    var rows = list.map(function(u) {
      var lv = u.level || 1;
      var lvTag = '<span class="tag tag-level-' + Math.min(4, Math.max(1, lv)) + '">Lv.' + lv + '</span>';
      var vipTag = (u.isVip || u.vip) ? '<span class="tag tag-vip">' +
        ((u.vipExpireAt && new Date(u.vipExpireAt).getTime() > Date.now()) ?
         'VIP至 ' + formatTime(u.vipExpireAt).slice(0, 10) : 'VIP') + '</span>' : '<span class="tag tag-vip-off">非VIP</span>';
      var banBtn = (u.isBanned ? '<button class="btn btn-sm btn-success" onclick="adminUserToggleBan(\'' + u.id + '\',false)">解封</button>'
                                : '<button class="btn btn-sm btn-warn" onclick="adminUserToggleBan(\'' + u.id + '\',true)">封禁</button>');
      return '' +
        '<td><span class="id-cell" title="' + escapeHtml(u.id) + '">' + escapeHtml(shortId(u.id)) + '</span></td>' +
        '<td>' + escapeHtml(u.username || '-') + '</td>' +
        '<td>' + escapeHtml(u.phone || '-') + '</td>' +
        '<td>' + escapeHtml(u.qq || '-') + '</td>' +
        '<td>' + lvTag + '</td>' +
        '<td>' + vipTag + '</td>' +
        '<td>' + formatTime(u.createdAt) + '</td>' +
        '<td class="action-group">' +
          '<button class="btn btn-sm btn-primary" onclick=\'adminEditUser(' + JSON.stringify(u).replace(/'/g, "&#39;") + ')\">编辑</button>' +
          banBtn +
          '<button class="btn btn-sm btn-danger" onclick="adminDeleteUser(\'' + u.id + '\',\'' + escapeHtml(u.username || '') + '\')">删除</button>' +
        '</td>';
    });
    c.innerHTML = '' +
      '<div class="card"><div class="search-bar">' +
        '<input type="text" id="users-search-input" class="form-input" placeholder="搜索：用户名 / 手机号 / QQ号" value="' + escapeHtml(usersKeyword) + '" onkeypress="if(event.key===\'Enter\'){usersPage=1;adminShowUsers(1);}">' +
        '<button class="btn btn-primary" onclick="usersPage=1;adminShowUsers(1);">🔍 搜索</button>' +
        (usersKeyword ? '<button class="btn btn-default" onclick="document.getElementById(\'users-search-input\').value=\'\';usersKeyword=\'\';usersPage=1;adminShowUsers(1);">清除</button>' : '') +
      '</div>' +
      '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>ID</th><th>用户名</th><th>手机号</th><th>QQ号</th><th>等级</th><th>VIP状态</th><th>注册时间</th><th>操作</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.map(function(r){return '<tr>'+r+'</tr>';}).join('') : '<tr><td colspan="8"><div class="empty-state"><div class="empty-ico">👥</div><div class="empty-text">暂无用户</div></div></td></tr>') +
      '</tbody></table></div></div>';
    var pg = document.createElement('div'); pg.id = 'users-pg'; c.appendChild(pg);
    if (d.total > 0) renderPagination(pg, usersPage, d.total, 20, function(p) { adminShowUsers(p); });
  });
}

function adminEditUser(u) {
  var exp = u.vipExpireAt ? new Date(u.vipExpireAt).toISOString().slice(0, 10) : '';
  var html = '' +
    '<div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" value="' + escapeHtml(u.username || '') + '" disabled></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">手机号</label><input type="text" id="eu-phone" class="form-input" value="' + escapeHtml(u.phone || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">QQ号</label><input type="text" id="eu-qq" class="form-input" value="' + escapeHtml(u.qq || '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">用户等级</label>' +
        '<select id="eu-level" class="form-select">' +
          '<option value="1" ' + (u.level == 1 ? 'selected' : '') + '>Lv.1 普通</option>' +
          '<option value="2" ' + (u.level == 2 ? 'selected' : '') + '>Lv.2 青铜</option>' +
          '<option value="3" ' + (u.level == 3 ? 'selected' : '') + '>Lv.3 白银</option>' +
          '<option value="4" ' + (u.level == 4 ? 'selected' : '') + '>Lv.4 黄金</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">重置密码（留空不修改）</label><input type="text" id="eu-password" class="form-input" placeholder="输入新密码"></div>' +
    '</div>' +
    '<div class="toggle-line"><div class="toggle-text"><div class="tt-name">VIP会员</div><div class="tt-desc">开启后用户享受VIP权益</div></div>' +
      '<label class="adv-switch green"><input type="checkbox" id="eu-vip" ' + ((u.isVip || u.vip) ? 'checked' : '') + '><span class="adv-slider"></span></label>' +
    '</div>' +
    '<div class="form-group" style="margin-top:12px;"><label class="form-label">VIP到期时间</label><input type="date" id="eu-expire" class="form-input" value="' + exp + '"></div>' +
    '<div class="toggle-line"><div class="toggle-text"><div class="tt-name">账号封禁状态</div><div class="tt-desc">封禁后用户无法登录</div></div>' +
      '<label class="adv-switch"><input type="checkbox" id="eu-ban" ' + (u.isBanned ? 'checked' : '') + '><span class="adv-slider"></span></label>' +
    '</div>';
  showModal('编辑用户 - ' + (u.username || ''), html, function() {
    var body = {
      phone: document.getElementById('eu-phone').value.trim(),
      qq: document.getElementById('eu-qq').value.trim(),
      level: parseInt(document.getElementById('eu-level').value, 10) || 1,
      isVip: document.getElementById('eu-vip').checked,
      vipExpireAt: document.getElementById('eu-expire').value || null,
      isBanned: document.getElementById('eu-ban').checked
    };
    var pwd = document.getElementById('eu-password').value;
    if (pwd) body.password = pwd;
    adminRequest('/admin/users/' + u.id, { method: 'PUT', body: body }).then(function(res) {
      if (res.code === 0) { adminToast('用户信息已保存', 'success'); adminShowUsers(); }
      else adminToast(res.message || '保存失败', 'error');
    });
  });
}

function adminUserToggleBan(id, ban) {
  showModal(ban ? '封禁用户' : '解封用户',
    '<p style="padding:8px 0;color:#576574;">确定要' + (ban ? '<b style="color:#ee5253">封禁</b>' : '<b style="color:#10ac84">解封</b>') + '该用户吗？</p>',
    function() {
      adminRequest('/admin/users/' + id, { method: 'PUT', body: { isBanned: !!ban } }).then(function(res) {
        if (res.code === 0) { adminToast(ban ? '已封禁用户' : '已解封用户', 'success'); adminShowUsers(); }
        else adminToast(res.message || '操作失败', 'error');
      });
    });
}

function adminDeleteUser(id, name) {
  showModal('删除用户', '<div style="padding:10px 0;"><p style="margin-bottom:10px;color:#576574;">确定要永久删除用户 <b style="color:#ee5253">' + escapeHtml(name || '该用户') + '</b> 吗？</p><p style="font-size:12px;color:#ff9f43;">⚠ 此操作不可恢复，用户所有数据将被清除！</p></div>', function() {
    adminRequest('/admin/users/' + id, { method: 'DELETE' }).then(function(res) {
      if (res.code === 0) { adminToast('用户已删除', 'success'); adminShowUsers(); }
      else adminToast(res.message || '删除失败', 'error');
    });
  });
}

/* ========== 3. 公告管理 - 首页公告 ========== */

function adminShowAnnHome() {
  adminRequest('/admin/announcements').then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var a = (res.data && res.data.home) || {};
    c.innerHTML = '<div class="card" style="max-width:760px;margin:0 auto;">' +
      '<div class="card-title"><span><span class="card-title-ico">🏠</span>首页公告配置</span></div>' +
      '<div class="form-group"><label class="form-label">公告内容（支持换行）</label>' +
        '<textarea id="ann-home-content" class="form-textarea" placeholder="输入首页公告内容，支持富文本...">' + escapeHtml(a.content || '') + '</textarea></div>' +
      '<div class="toggle-line"><div class="toggle-text"><div class="tt-name">启用公告</div><div class="tt-desc">关闭后首页不显示公告栏</div></div>' +
        '<label class="adv-switch green"><input type="checkbox" id="ann-home-active" ' + (a.active ? 'checked' : '') + '><span class="adv-slider"></span></label>' +
      '</div>' +
      '<div style="margin-top:20px;display:flex;gap:10px;">' +
        '<button class="btn btn-primary btn-lg" onclick="adminSaveAnnHome()">💾 保存配置</button>' +
        '<button class="btn btn-default btn-lg" onclick="adminShowAnnHome()">↺ 重置</button>' +
      '</div></div>';
  });
}
function adminSaveAnnHome() {
  adminRequest('/admin/announcements/home', {
    method: 'PUT',
    body: { content: document.getElementById('ann-home-content').value, active: document.getElementById('ann-home-active').checked }
  }).then(function(res) {
    if (res.code === 0) adminToast('首页公告已保存', 'success');
    else adminToast(res.message || '保存失败', 'error');
  });
}

/* ========== 4. 公告管理 - 登录页公告 ========== */

function adminShowAnnLogin() {
  adminRequest('/admin/announcements').then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var a = (res.data && res.data.login) || {};
    c.innerHTML = '<div class="card" style="max-width:760px;margin:0 auto;">' +
      '<div class="card-title"><span><span class="card-title-ico">🔐</span>登录页公告配置</span></div>' +
      '<div class="form-group"><label class="form-label">公告内容</label>' +
        '<textarea id="ann-login-content" class="form-textarea" placeholder="输入登录页公告内容...">' + escapeHtml(a.content || '') + '</textarea></div>' +
      '<div class="toggle-line"><div class="toggle-text"><div class="tt-name">启用公告</div><div class="tt-desc">关闭后登录页不显示公告栏</div></div>' +
        '<label class="adv-switch green"><input type="checkbox" id="ann-login-active" ' + (a.active ? 'checked' : '') + '><span class="adv-slider"></span></label>' +
      '</div>' +
      '<div style="margin-top:20px;"><button class="btn btn-primary btn-lg" onclick="adminSaveAnnLogin()">💾 保存配置</button></div></div>';
  });
}
function adminSaveAnnLogin() {
  adminRequest('/admin/announcements/login', {
    method: 'PUT',
    body: { content: document.getElementById('ann-login-content').value, active: document.getElementById('ann-login-active').checked }
  }).then(function(res) {
    if (res.code === 0) adminToast('登录页公告已保存', 'success');
    else adminToast(res.message || '保存失败', 'error');
  });
}

/* ========== 5. 数据源管理 ========== */

var currentSources = [];
var defaultSources = [
  { name: '非凡资源', key: 'ff', api: 'https://api.ffzy.tv/api.php/provide/vod/from/ffm3u8/', playFrom: 'ffzy', enabled: true },
  { name: '量子资源', key: 'lz', api: 'https://api.lzzy.tv/api.php/provide/vod/from/lzm3u8/', playFrom: 'lzzy', enabled: true },
  { name: '暴风资源', key: 'bf', api: 'https://api.bfzy.tv/api.php/provide/vod/from/bfm3u8/', playFrom: 'bfzy', enabled: true }
];

function adminShowSources() {
  adminRequest('/admin/sources').then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code === 0 && res.data) currentSources = JSON.parse(JSON.stringify(res.data.list || res.data || []));
    c.innerHTML = '<div class="card">' +
      '<div class="card-title"><span><span class="card-title-ico">📺</span>数据源管理</span>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-warn btn-sm" onclick="adminResetSources()">↺ 恢复默认</button>' +
          '<button class="btn btn-success btn-sm" onclick="adminAddSource()">＋ 添加数据源</button>' +
        '</div>' +
      '</div>' +
      '<div id="sources-list">' + renderSourcesList() + '</div>' +
      '<div style="margin-top:18px;display:flex;gap:10px;">' +
        '<button class="btn btn-primary btn-lg" onclick="adminSaveSources()">💾 保存全部</button>' +
        '<span style="font-size:12px;color:#8395a7;align-self:center;">共 <b style="color:#2c3e50">' + currentSources.length + '</b> 个数据源</span>' +
      '</div></div>';
  });
}

function renderSourcesList() {
  if (currentSources.length === 0) return '<div class="empty-state"><div class="empty-ico">📺</div><div class="empty-text">暂无数据源，点击右上角"添加数据源"</div></div>';
  var html = '';
  for (var i = 0; i < currentSources.length; i++) {
    var s = currentSources[i];
    html += '<div class="source-edit-grid" data-idx="' + i + '">' +
      '<div><label class="form-label" style="font-size:12px;">名称</label>' +
        '<input type="text" class="form-input inline" value="' + escapeHtml(s.name || '') + '" onchange="adminUpdateSource(' + i + ',\'name\',this.value)"></div>' +
      '<div><label class="form-label" style="font-size:12px;">Key标识</label>' +
        '<input type="text" class="form-input inline" value="' + escapeHtml(s.key || '') + '" onchange="adminUpdateSource(' + i + ',\'key\',this.value)"></div>' +
      '<div><label class="form-label" style="font-size:12px;">API地址</label>' +
        '<input type="text" class="form-input inline" value="' + escapeHtml(s.api || '') + '" onchange="adminUpdateSource(' + i + ',\'api\',this.value)"></div>' +
      '<div><label class="form-label" style="font-size:12px;">playFrom</label>' +
        '<input type="text" class="form-input inline" value="' + escapeHtml(s.playFrom || '') + '" onchange="adminUpdateSource(' + i + ',\'playFrom\',this.value)"></div>' +
      '<div style="padding-bottom:6px;"><label class="form-label" style="font-size:12px;">启用</label><br>' +
        '<label class="adv-switch small green"><input type="checkbox" ' + (s.enabled !== false ? 'checked' : '') + ' onchange="adminUpdateSource(' + i + ',\'enabled\',this.checked)"><span class="adv-slider"></span></label></div>' +
      '<div style="padding-bottom:6px;"><label class="form-label" style="font-size:12px;">&nbsp;</label><br>' +
        '<button class="btn btn-sm btn-danger" onclick="adminRemoveSource(' + i + ')">🗑 删除</button></div>' +
    '</div>';
  }
  return html;
}
function adminUpdateSource(i, k, v) { if (currentSources[i]) currentSources[i][k] = v; }
function adminAddSource() {
  currentSources.push({ name: '新数据源', key: 'src' + Date.now().toString(36), api: '', playFrom: '', enabled: true });
  document.getElementById('sources-list').innerHTML = renderSourcesList();
  adminToast('已添加空数据源，请填写信息后保存', 'info');
}
function adminRemoveSource(i) {
  showModal('删除确认', '<p style="padding:10px 0;">确定删除该数据源「<b>' + escapeHtml(currentSources[i] && currentSources[i].name || '') + '</b>」吗？</p>', function() {
    currentSources.splice(i, 1);
    document.getElementById('sources-list').innerHTML = renderSourcesList();
    adminToast('已删除（未保存到服务器）', 'info');
  });
}
function adminResetSources() {
  showModal('恢复默认', '<p style="padding:10px 0;">将重置为3个默认源（非凡/量子/暴风），当前未保存的修改会丢失，继续吗？</p>', function() {
    currentSources = JSON.parse(JSON.stringify(defaultSources));
    document.getElementById('sources-list').innerHTML = renderSourcesList();
    adminToast('已恢复默认（未保存到服务器）', 'success');
  });
}
function adminSaveSources() {
  adminRequest('/admin/sources', { method: 'PUT', body: { sources: currentSources } }).then(function(res) {
    if (res.code === 0) adminToast('所有数据源已保存', 'success');
    else adminToast(res.message || '保存失败', 'error');
  });
}

/* ========== 6. 广告管理 - Banner ========== */

var currentBanners = [];

function adminShowAdsBanner() {
  adminRequest('/admin/ads').then(function(res) {
    var c = document.getElementById('admin-content');
    currentBanners = [];
    if (res.code === 0 && res.data && res.data.banners) currentBanners = JSON.parse(JSON.stringify(res.data.banners));
    c.innerHTML = '<div class="card">' +
      '<div class="card-title"><span><span class="card-title-ico">🖼️</span>首页Banner广告管理</span>' +
        '<button class="btn btn-success btn-sm" onclick="adminAddBanner()">＋ 添加Banner</button>' +
      '</div>' +
      '<div id="banner-list">' + renderBannerList() + '</div>' +
      '<div style="margin-top:18px;"><button class="btn btn-primary btn-lg" onclick="adminSaveBanners()">💾 保存全部Banner</button></div></div>';
  });
}

function renderBannerList() {
  if (currentBanners.length === 0) return '<div class="empty-state"><div class="empty-ico">🖼️</div><div class="empty-text">暂无Banner，点击右上角添加</div></div>';
  var html = '';
  for (var i = 0; i < currentBanners.length; i++) {
    var b = currentBanners[i];
    html += '<div class="banner-edit-grid" data-idx="' + i + '">' +
      '<div><label class="form-label" style="font-size:12px;">图片URL</label>' +
        '<input type="text" class="form-input inline" placeholder="https://..." value="' + escapeHtml(b.image || '') + '" onchange="adminUpdateBanner(' + i + ',\'image\',this.value)"></div>' +
      '<div><label class="form-label" style="font-size:12px;">跳转链接</label>' +
        '<input type="text" class="form-input inline" placeholder="https://..." value="' + escapeHtml(b.link || '') + '" onchange="adminUpdateBanner(' + i + ',\'link\',this.value)"></div>' +
      '<div><label class="form-label" style="font-size:12px;">描述文字</label>' +
        '<input type="text" class="form-input inline" value="' + escapeHtml(b.desc || '') + '" onchange="adminUpdateBanner(' + i + ',\'desc\',this.value)"></div>' +
      '<div style="padding-bottom:6px;"><label class="form-label" style="font-size:12px;">启用</label><br>' +
        '<label class="adv-switch small green"><input type="checkbox" ' + (b.enabled !== false ? 'checked' : '') + ' onchange="adminUpdateBanner(' + i + ',\'enabled\',this.checked)"><span class="adv-slider"></span></label></div>' +
      '<div><label class="form-label" style="font-size:12px;">排序</label>' +
        '<input type="number" class="form-input inline" value="' + (b.sort != null ? b.sort : (i + 1)) + '" onchange="adminUpdateBanner(' + i + ',\'sort\',parseInt(this.value)||0)"></div>' +
      '<div style="display:flex;flex-direction:column;gap:4px;padding-bottom:6px;">' +
        '<label class="form-label" style="font-size:12px;">移动</label>' +
        '<div style="display:flex;gap:4px;">' +
          '<button class="btn btn-sm btn-default" ' + (i === 0 ? 'disabled style="opacity:0.4"' : '') + ' onclick="adminMoveBanner(' + i + ',-1)">↑</button>' +
          '<button class="btn btn-sm btn-default" ' + (i === currentBanners.length - 1 ? 'disabled style="opacity:0.4"' : '') + ' onclick="adminMoveBanner(' + i + ',1)">↓</button>' +
        '</div></div>' +
      '<div style="padding-bottom:6px;"><label class="form-label" style="font-size:12px;">操作</label><br>' +
        '<button class="btn btn-sm btn-danger" onclick="adminRemoveBanner(' + i + ')">🗑</button></div>' +
    '</div>';
  }
  return html;
}
function adminUpdateBanner(i, k, v) { if (currentBanners[i]) currentBanners[i][k] = v; }
function adminAddBanner() {
  currentBanners.push({ image: '', link: '', desc: '新Banner', enabled: true, sort: currentBanners.length + 1 });
  document.getElementById('banner-list').innerHTML = renderBannerList();
  adminToast('已添加Banner', 'info');
}
function adminRemoveBanner(i) {
  currentBanners.splice(i, 1);
  document.getElementById('banner-list').innerHTML = renderBannerList();
}
function adminMoveBanner(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= currentBanners.length) return;
  var t = currentBanners[i]; currentBanners[i] = currentBanners[j]; currentBanners[j] = t;
  document.getElementById('banner-list').innerHTML = renderBannerList();
}
function adminSaveBanners() {
  adminRequest('/admin/ads/banners', { method: 'PUT', body: { banners: currentBanners } }).then(function(res) {
    if (res.code === 0) adminToast('Banner已保存', 'success');
    else adminToast(res.message || '保存失败', 'error');
  });
}

/* ========== 7. 广告管理 - 我的页面广告 ========== */

function adminShowAdsMine() {
  adminRequest('/admin/ads').then(function(res) {
    var c = document.getElementById('admin-content');
    var m = (res.code === 0 && res.data && res.data.mine) || {};
    c.innerHTML = '<div class="card" style="max-width:640px;margin:0 auto;">' +
      '<div class="card-title"><span><span class="card-title-ico">👤</span>我的页面广告</span>' +
        '<span style="font-size:12px;color:#8395a7;font-weight:400;">（显示在"我的"页面顶部）</span></div>' +
      '<div class="form-group"><label class="form-label">广告标题</label>' +
        '<input type="text" id="ad-mine-title" class="form-input" value="' + escapeHtml(m.title || '') + '" placeholder="例如：开通VIP享特权"></div>' +
      '<div class="form-group"><label class="form-label">广告内容描述</label>' +
        '<textarea id="ad-mine-content" class="form-textarea small" placeholder="广告详细说明...">' + escapeHtml(m.content || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">广告图片URL</label>' +
        '<input type="text" id="ad-mine-image" class="form-input" value="' + escapeHtml(m.image || '') + '" placeholder="https://..."></div>' +
      '<div class="form-group"><label class="form-label">跳转链接</label>' +
        '<input type="text" id="ad-mine-link" class="form-input" value="' + escapeHtml(m.link || '') + '" placeholder="点击后跳转的URL"></div>' +
      '<div class="toggle-line"><div class="toggle-text"><div class="tt-name">启用广告</div><div class="tt-desc">关闭后用户端不展示此广告位</div></div>' +
        '<label class="adv-switch green"><input type="checkbox" id="ad-mine-active" ' + (m.active ? 'checked' : '') + '><span class="adv-slider"></span></label>' +
      '</div>' +
      '<div style="margin-top:20px;"><button class="btn btn-primary btn-lg" onclick="adminSaveAdsMine()">💾 保存配置</button></div></div>';
  });
}
function adminSaveAdsMine() {
  adminRequest('/admin/ads/mine', {
    method: 'PUT',
    body: {
      title: document.getElementById('ad-mine-title').value,
      content: document.getElementById('ad-mine-content').value,
      image: document.getElementById('ad-mine-image').value,
      link: document.getElementById('ad-mine-link').value,
      active: document.getElementById('ad-mine-active').checked
    }
  }).then(function(res) {
    if (res.code === 0) adminToast('我的页面广告已保存', 'success');
    else adminToast(res.message || '保存失败', 'error');
  });
}

/* ========== 8. 推送通知 ========== */

function adminShowPush() {
  adminRequest('/admin/announcements').then(function(res) {
    var c = document.getElementById('admin-content');
    var list = (res.code === 0 && res.data && res.data.push) ? res.data.push.slice().reverse() : [];
    c.innerHTML = '' +
      '<div class="card" style="max-width:720px;margin:0 auto 18px;">' +
        '<div class="card-title"><span><span class="card-title-ico">🔔</span>发送推送通知</span></div>' +
        '<div class="form-group"><label class="form-label">通知标题 <span class="req">*</span></label>' +
          '<input type="text" id="push-title" class="form-input" placeholder="例如：系统更新通知"></div>' +
        '<div class="form-group"><label class="form-label">通知内容 <span class="req">*</span></label>' +
          '<textarea id="push-content" class="form-textarea" placeholder="请输入推送的详细内容..."></textarea></div>' +
        '<button class="btn btn-primary btn-lg" onclick="adminSendPush()">🔔 立即推送</button>' +
      '</div>' +
      '<div class="card"><div class="card-title"><span><span class="card-title-ico">📜</span>历史推送记录</span>' +
        '<span style="font-size:12px;color:#8395a7;font-weight:400;">共 ' + list.length + ' 条，最新在前</span></div>' +
        (list.length === 0 ? '<div class="empty-state"><div class="empty-ico">🔕</div><div class="empty-text">暂无推送记录</div></div>' :
          '<ul class="adv-list">' + list.map(function(p) {
            return '<li><div class="adv-head"><div class="adv-title">' + escapeHtml(p.title || '(无标题)') +
              '</div><div class="adv-time">' + formatTime(p.time || p.createdAt) + '</div></div>' +
              '<div class="adv-body">' + escapeHtml(p.content || '').replace(/\n/g, '<br>') + '</div></li>';
          }).join('') + '</ul>') +
      '</div>';
  });
}
function adminSendPush() {
  var t = document.getElementById('push-title').value.trim();
  var c = document.getElementById('push-content').value.trim();
  if (!t || !c) { adminToast('请填写标题和内容', 'warning'); return; }
  adminRequest('/admin/push', { method: 'POST', body: { title: t, content: c } }).then(function(res) {
    if (res.code === 0) {
      adminToast('推送已发送', 'success');
      adminShowPush();
    } else adminToast(res.message || '推送失败', 'error');
  });
}

/* ========== 9. 功能反馈 ========== */

var fbPage = 1;
var fbStatus = 'all';

function adminShowFeedback(page) {
  if (typeof page === 'number') fbPage = page;
  adminRequest('/admin/feedback?page=' + fbPage + '&limit=20&status=' + fbStatus).then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var d = res.data || {};
    var list = d.list || [];
    var rows = list.map(function(f) {
      var statusTag = f.status === 'resolved' ?
        '<span class="tag tag-success">✓ 已处理</span>' :
        '<span class="tag tag-warn">⏳ 待处理</span>';
      return '<tr>' +
        '<td>' + escapeHtml(f.username || '-') + '</td>' +
        '<td><span class="tag tag-info">' + escapeHtml(f.type || '其他') + '</span></td>' +
        '<td style="max-width:300px;">' + escapeHtml(f.content || '').slice(0, 80) +
          ((f.content || '').length > 80 ? '...' : '') + '</td>' +
        '<td>' + statusTag + '</td>' +
        '<td>' + formatTime(f.createdAt) + '</td>' +
        '<td class="action-group">' +
          '<button class="btn btn-sm btn-primary" onclick=\'adminHandleFeedback(' + JSON.stringify(f).replace(/'/g, "&#39;") + ')\">处理</button>' +
          (f.reply ? '<button class="btn btn-sm btn-info" onclick="adminViewFbReply(' + JSON.stringify(String(f.reply).replace(/"/g, '&quot;')) + ')">查看回复</button>' : '') +
        '</td></tr>';
    });
    c.innerHTML = '<div class="card">' +
      '<div class="card-title"><span><span class="card-title-ico">💬</span>功能反馈管理</span>' +
        '<span style="font-size:12px;color:#8395a7;">共 ' + (d.total || 0) + ' 条</span></div>' +
      '<div class="filter-tabs">' +
        '<div class="filter-tab ' + (fbStatus === 'all' ? 'active' : '') + '" onclick="fbStatus=\'all\';fbPage=1;adminShowFeedback(1);">全部</div>' +
        '<div class="filter-tab ' + (fbStatus === 'pending' ? 'active' : '') + '" onclick="fbStatus=\'pending\';fbPage=1;adminShowFeedback(1);">待处理</div>' +
        '<div class="filter-tab ' + (fbStatus === 'resolved' ? 'active' : '') + '" onclick="fbStatus=\'resolved\';fbPage=1;adminShowFeedback(1);">已处理</div>' +
      '</div>' +
      '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>用户</th><th>类型</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="6"><div class="empty-state"><div class="empty-ico">💬</div><div class="empty-text">暂无反馈记录</div></div></td></tr>') +
      '</tbody></table></div></div>';
    var pg = document.createElement('div'); pg.id = 'fb-pg'; c.appendChild(pg);
    if (d.total > 0) renderPagination(pg, fbPage, d.total, 20, function(p) { adminShowFeedback(p); });
  });
}

function adminHandleFeedback(f) {
  var html = '<div style="background:#fafcff;padding:14px;border-radius:10px;margin-bottom:16px;">' +
    '<div style="font-size:12px;color:#8395a7;margin-bottom:6px;">来自 <b style="color:#2c3e50">' + escapeHtml(f.username || '-') + '</b> · ' + escapeHtml(f.type || '') + ' · ' + formatTime(f.createdAt) + '</div>' +
    '<div style="font-size:13.5px;line-height:1.7;white-space:pre-wrap;">' + escapeHtml(f.content || '') + '</div></div>' +
    '<div class="form-group"><label class="form-label">处理状态</label>' +
      '<select id="fb-status" class="form-select">' +
        '<option value="pending" ' + (f.status === 'pending' ? 'selected' : '') + '>⏳ 待处理</option>' +
        '<option value="resolved" ' + (f.status === 'resolved' ? 'selected' : '') + '>✓ 已处理</option>' +
      '</select></div>' +
    '<div class="form-group"><label class="form-label">回复用户</label>' +
      '<textarea id="fb-reply" class="form-textarea small" placeholder="请输入回复内容（用户将看到此回复）...">' + escapeHtml(f.reply || '') + '</textarea></div>';
  showModal('处理反馈 - #' + shortId(f.id), html, function() {
    adminRequest('/admin/feedback/' + f.id, {
      method: 'PUT',
      body: { status: document.getElementById('fb-status').value, reply: document.getElementById('fb-reply').value }
    }).then(function(res) {
      if (res.code === 0) { adminToast('已保存处理结果', 'success'); adminShowFeedback(); }
      else adminToast(res.message || '保存失败', 'error');
    });
  });
}
function adminViewFbReply(text) {
  showModal('管理员回复', '<div style="padding:10px 0;line-height:1.7;white-space:pre-wrap;background:#fff5f5;border-radius:8px;padding:14px;color:#2c3e50;">' + escapeHtml(text) + '</div>');
  document.getElementById('modal-footer').innerHTML = '<button class="btn btn-default" onclick="hideModal()">关闭</button>';
}

/* ========== 10. 操作日志 ========== */

var opPage = 1;
function adminShowOpLogs(page) {
  if (typeof page === 'number') opPage = page;
  adminRequest('/admin/logs/operation?page=' + opPage + '&limit=30').then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var d = res.data || {};
    var list = d.list || [];
    var rows = list.map(function(l) {
      return '<tr><td>' + formatTime(l.time || l.createdAt) + '</td>' +
             '<td>' + escapeHtml(l.user || l.username || '-') + '</td>' +
             '<td>' + escapeHtml(l.action || '-') + '</td>' +
             '<td><span class="tag tag-default">' + escapeHtml(l.ip || '-') + '</span></td></tr>';
    });
    c.innerHTML = '<div class="card">' +
      '<div class="card-title"><span><span class="card-title-ico">⚙️</span>操作日志</span>' +
        '<span style="font-size:12px;color:#8395a7;">共 ' + (d.total || 0) + ' 条</span></div>' +
      '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
        '<th style="width:180px;">时间</th><th>操作人</th><th>动作详情</th><th>IP地址</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="4"><div class="empty-state"><div class="empty-ico">📋</div><div class="empty-text">暂无操作日志</div></div></td></tr>') +
      '</tbody></table></div></div>';
    var pg = document.createElement('div'); pg.id = 'op-pg'; c.appendChild(pg);
    if (d.total > 0) renderPagination(pg, opPage, d.total, 30, function(p) { adminShowOpLogs(p); });
  });
}

/* ========== 11. 注册日志 ========== */

var regPage = 1;
function adminShowRegLogs(page) {
  if (typeof page === 'number') regPage = page;
  adminRequest('/admin/logs/registration?page=' + regPage + '&limit=30').then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var d = res.data || {};
    var list = d.list || [];
    var rows = list.map(function(l) {
      return '<tr><td>' + formatTime(l.time || l.createdAt) + '</td>' +
             '<td><b>' + escapeHtml(l.username || '-') + '</b></td>' +
             '<td>' + escapeHtml(l.phone || '-') + '</td>' +
             '<td><span class="tag tag-default">' + escapeHtml(l.ip || '-') + '</span></td></tr>';
    });
    c.innerHTML = '<div class="card">' +
      '<div class="card-title"><span><span class="card-title-ico">📝</span>注册日志</span>' +
        '<span style="font-size:12px;color:#8395a7;">共 ' + (d.total || 0) + ' 条</span></div>' +
      '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
        '<th style="width:180px;">时间</th><th>用户名</th><th>手机号</th><th>注册IP</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="4"><div class="empty-state"><div class="empty-ico">📝</div><div class="empty-text">暂无注册记录</div></div></td></tr>') +
      '</tbody></table></div></div>';
    var pg = document.createElement('div'); pg.id = 'reg-pg'; c.appendChild(pg);
    if (d.total > 0) renderPagination(pg, regPage, d.total, 30, function(p) { adminShowRegLogs(p); });
  });
}

/* ========== 12. 服务器控制 ========== */

function adminShowServer() {
  adminRequest('/admin/settings').then(function(res) {
    var c = document.getElementById('admin-content');
    var s = (res.code === 0 ? res.data : {}) || {};
    c.innerHTML = '' +
      '<div class="server-grid">' +
        '<div class="server-card"><div class="server-ico maintain">🔧</div>' +
          '<div class="server-title">维护模式</div>' +
          '<div class="server-desc">开启后用户端将显示维护页面</div>' +
          '<label class="adv-switch green"><input type="checkbox" id="srv-mm" ' + (s.maintenanceMode ? 'checked' : '') +
          ' onchange="adminToggleMaintenance(this.checked)"><span class="adv-slider"></span></label>' +
        '</div>' +
        '<div class="server-card"><div class="server-ico restart">🔄</div>' +
          '<div class="server-title">重启服务器</div>' +
          '<div class="server-desc">重启当前服务器进程，服务会短暂中断</div>' +
          '<button class="btn btn-info btn-lg" onclick="adminRestartServer()">🔄 立即重启</button>' +
        '</div>' +
        '<div class="server-card"><div class="server-ico stop">⏹️</div>' +
          '<div class="server-title">停止服务器</div>' +
          '<div class="server-desc">停止后服务将不可用，请谨慎操作</div>' +
          '<button class="btn btn-danger btn-lg" onclick="adminStopServer()">⏹️ 停止服务</button>' +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="card-title"><span><span class="card-title-ico">📊</span>服务器状态信息</span></div>' +
        '<div class="info-grid">' +
          '<div class="info-item"><div class="info-label">运行状态</div><div class="info-value" style="color:#10ac84;">✓ 运行中</div></div>' +
          '<div class="info-item"><div class="info-label">监听端口</div><div class="info-value">' + escapeHtml(s.port || processEnvPort() || '默认') + '</div></div>' +
          '<div class="info-item"><div class="info-label">系统版本</div><div class="info-value">' + escapeHtml(s.appVersion || s.version || 'V4.0.0') + '</div></div>' +
          '<div class="info-item"><div class="info-label">应用名称</div><div class="info-value">' + escapeHtml(s.appName || '一屿视频') + '</div></div>' +
          '<div class="info-item"><div class="info-label">作者信息</div><div class="info-value">一屿视频团队</div></div>' +
          '<div class="info-item"><div class="info-label">维护模式</div><div class="info-value" style="color:' + (s.maintenanceMode ? '#ee5253' : '#10ac84') + ';">' + (s.maintenanceMode ? '🔴 开启' : '🟢 关闭') + '</div></div>' +
        '</div>' +
      '</div>';
  });
}
function processEnvPort() { try { return ''; } catch(e) { return ''; } }

function adminToggleMaintenance(on) {
  adminRequest('/admin/settings', { method: 'PUT', body: { maintenanceMode: !!on } }).then(function(res) {
    if (res.code === 0) adminToast(on ? '维护模式已开启' : '维护模式已关闭', 'success');
    else {
      adminToast(res.message || '操作失败', 'error');
      document.getElementById('srv-mm').checked = !on;
    }
  });
}
function adminRestartServer() {
  showModal('重启确认', '<div style="padding:10px 0;"><p style="margin-bottom:8px;">确定要<b style="color:#2e86de;">重启服务器</b>吗？</p><p style="font-size:12px;color:#ff9f43;">⚠ 重启过程中服务将短暂中断（约10~30秒）</p></div>', function() {
    adminToast('正在发送重启指令...', 'info');
    adminRequest('/admin/server/restart', { method: 'POST' }).then(function(res) {
      if (res.code === 0) adminToast('服务器正在重启', 'success');
      else adminToast(res.message || '重启失败', 'error');
    }).catch(function() { adminToast('指令已发送（连接断开属正常）', 'info'); });
  });
}
function adminStopServer() {
  showModal('停止服务器 - 二次确认',
    '<div style="padding:10px 0;"><p style="margin-bottom:10px;">⚠️ 您即将<b style="color:#ee5253;font-size:15px;">停止服务器</b>，这将导致：</p>' +
    '<ul style="padding-left:22px;line-height:2;color:#576574;font-size:13px;">' +
    '<li>所有用户立即无法访问视频服务</li><li>API全部停止响应</li><li>需要手动到服务器面板重新启动</li></ul>' +
    '<p style="margin-top:12px;color:#ee5253;font-weight:600;">此操作非常危险，请再次确认！</p></div>',
    function() {
      showModal('最终确认', '<p style="padding:14px 0;text-align:center;color:#ee5253;font-weight:600;font-size:15px;">真的要停止服务器吗？<br>此操作不可撤销！</p>', function() {
        adminToast('正在发送停止指令...', 'warning');
        adminRequest('/admin/server/stop', { method: 'POST' }).then(function(res) {
          if (res.code === 0) adminToast('服务器即将停止', 'success');
          else adminToast(res.message || '操作失败', 'error');
        }).catch(function() { adminToast('指令已发送（连接断开属正常）', 'info'); });
      });
      document.getElementById('modal-ok-btn').textContent = '确认停止';
      document.getElementById('modal-ok-btn').className = 'btn btn-danger';
    });
  document.getElementById('modal-ok-btn').textContent = '下一步';
  document.getElementById('modal-ok-btn').className = 'btn btn-danger';
}

/* ========== 13. 系统设置 ========== */

function adminShowSettings() {
  adminRequest('/admin/settings').then(function(res) {
    var c = document.getElementById('admin-content');
    if (res.code !== 0) { c.innerHTML = '<div class="card" style="color:#ee5253">' + escapeHtml(res.message || '加载失败') + '</div>'; return; }
    var s = res.data || {};
    c.innerHTML = '<div class="card" style="max-width:640px;margin:0 auto;">' +
      '<div class="card-title"><span><span class="card-title-ico">⚙️</span>系统参数设置</span></div>' +
      '<div class="form-group"><label class="form-label">应用名称</label>' +
        '<input type="text" id="set-appname" class="form-input" value="' + escapeHtml(s.appName || '一屿视频') + '"></div>' +
      '<div class="form-group"><label class="form-label">版本号</label>' +
        '<input type="text" id="set-version" class="form-input" value="' + escapeHtml(s.appVersion || s.version || '4.0.0') + '"></div>' +
      '<div class="toggle-line"><div class="toggle-text"><div class="tt-name">允许注册新账号</div><div class="tt-desc">关闭后用户端注册入口将失效</div></div>' +
        '<label class="adv-switch blue"><input type="checkbox" id="set-register" ' + (s.allowRegistration !== false ? 'checked' : '') + '><span class="adv-slider"></span></label>' +
      '</div>' +
      '<div class="toggle-line"><div class="toggle-text"><div class="tt-name">维护模式</div><div class="tt-desc">开启后用户端显示维护提示页</div></div>' +
        '<label class="adv-switch green"><input type="checkbox" id="set-maintenance" ' + (s.maintenanceMode ? 'checked' : '') + '><span class="adv-slider"></span></label>' +
      '</div>' +
      '<div style="margin-top:22px;display:flex;gap:10px;">' +
        '<button class="btn btn-primary btn-lg" onclick="adminSaveSettings()">💾 保存设置</button>' +
        '<button class="btn btn-default btn-lg" onclick="adminShowSettings()">↺ 取消更改</button>' +
      '</div></div>';
  });
}
function adminSaveSettings() {
  adminRequest('/admin/settings', {
    method: 'PUT',
    body: {
      appName: document.getElementById('set-appname').value.trim(),
      appVersion: document.getElementById('set-version').value.trim(),
      allowRegistration: document.getElementById('set-register').checked,
      maintenanceMode: document.getElementById('set-maintenance').checked
    }
  }).then(function(res) {
    if (res.code === 0) adminToast('系统设置已保存', 'success');
    else adminToast(res.message || '保存失败', 'error');
  });
}

/* ========== 初始化 ========== */

(function adminInit() {
  if (adminToken) {
    adminRequest('/auth/me').then(function(res) {
      if (res.code === 0 && res.data && res.data.isAdmin) {
        adminUserInfo = res.data;
        document.getElementById('admin-name').textContent = adminUserInfo.username;
        document.getElementById('admin-avatar').textContent =
          (adminUserInfo.username || 'A').charAt(0).toUpperCase();
        showAdminApp();
        adminSwitchPage('dashboard');
      } else {
        adminToken = '';
        localStorage.removeItem('admin_token');
        showLoginView();
        if (res && res.message) adminToast(res.message, 'warning');
      }
    }).catch(function() { showLoginView(); adminToast('连接服务器失败', 'error'); });
  } else {
    showLoginView();
  }
})();
