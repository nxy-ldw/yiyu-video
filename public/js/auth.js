/* ============================================================
 * 一屿视频 auth.js - 登录/注册鉴权逻辑
 * 全部使用 ES5 兼容写法（var/function），保证 WebView 兼容
 * ============================================================ */

/* ==================== 公共状态 ==================== */

var authState = {
  currentMode: 'login',
  loginAttempts: 0,
  lastAttemptAt: 0,
  registerCooldown: false,
  maintenance: false,
  announcement: null
};

/* ==================== 公共工具函数（和 app.js 保持一致） ==================== */

/**
 * Toast 提示
 * @param {string} msg - 消息内容
 * @param {string} type - 类型 success/error/info
 */
function showToast(msg, type) {
  var toast = document.getElementById('toast');
  if (!toast) {
    alert(msg);
    return;
  }
  type = type || 'info';
  toast.textContent = msg;
  toast.className = 'toast show toast-' + type;
  setTimeout(function () {
    toast.className = 'toast';
  }, 3000);
}

/** HTML 转义 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

/** 手机号脱敏 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || '';
  return phone.substring(0, 3) + '****' + phone.substring(phone.length - 4);
}

/** 校验手机号格式 */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone || '');
}

/** 校验密码强度 */
function checkPasswordStrength(pwd) {
  if (!pwd || pwd.length < 6) {
    return { level: 0, label: '弱', valid: false, msg: '密码至少6位' };
  }
  var score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[^0-9a-zA-Z]/.test(pwd)) score++;

  if (score <= 2) return { level: 1, label: '弱', valid: true, msg: '' };
  if (score <= 4) return { level: 2, label: '中', valid: true, msg: '' };
  return { level: 3, label: '强', valid: true, msg: '' };
}

/* ==================== 封装 API 请求 ==================== */

/** GET */
function authApiGet(path, callback, onError) {
  var headers = {};
  var token = localStorage.getItem('yiyu_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  fetch(getApiUrl(path), { headers: headers })
    .then(function (r) { return r.json(); })
    .then(function (res) { callback && callback(res); })
    .catch(function (e) { onError && onError(e); });
}

/** POST（无 token）*/
function authApiPostPublic(path, body, callback, onError) {
  fetch(getApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
    .then(function (r) { return r.json(); })
    .then(function (res) { callback && callback(res); })
    .catch(function (e) { onError && onError(e); });
}

/* ==================== 页面初始化 ==================== */

function initAuthPage() {
  addGlobalAuthStyles();
  bindLoginInputs();
  bindRegisterInputs();
  bindAuthTabEvents();

  var existingToken = localStorage.getItem('yiyu_token');
  if (existingToken) {
    verifyAndRedirect();
    return;
  }

  checkMaintenanceStatus(function () {
    if (!authState.maintenance) {
      checkAndFetchLoginAnnouncement();
    }
  });
}

/** 已有 Token 的情况：验证并跳转 */
function verifyAndRedirect() {
  authApiGet('/auth/me', function (res) {
    if (res && res.code === 0 && res.data) {
      localStorage.setItem('yiyu_user', JSON.stringify(res.data));
      window.location.href = 'index.html';
    } else {
      localStorage.removeItem('yiyu_token');
      localStorage.removeItem('yiyu_user');
      checkMaintenanceStatus(function () {
        if (!authState.maintenance) {
          checkAndFetchLoginAnnouncement();
        }
      });
    }
  }, function () {
    checkMaintenanceStatus(function () {
      if (!authState.maintenance) {
        checkAndFetchLoginAnnouncement();
      }
    });
  });
}

/* ==================== 维护模式检查 ==================== */

function checkMaintenanceStatus(callback) {
  authApiGet('/status', function (res) {
    if (res && res.code === 0 && res.data && res.data.maintenance) {
      authState.maintenance = true;
      showMaintenanceOverlay(res.data.message || '系统维护中，请稍后再试');
    } else {
      authState.maintenance = false;
      callback && callback();
    }
  }, function () {
    callback && callback();
  });
}

function showMaintenanceOverlay(msg) {
  document.body.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);color:#fff;text-align:center;padding:24px;">' +
    '<div style="font-size:80px;margin-bottom:24px;">🔧</div>' +
    '<h1 style="font-size:26px;margin:0 0 12px;font-weight:700;">系统维护中</h1>' +
    '<p style="font-size:14px;opacity:0.85;line-height:1.7;margin:0 0 28px;max-width:360px;">' +
      escapeHtml(msg || '一屿视频正在进行升级维护，我们正在努力为您提供更好的服务。请稍后再来访问。') +
    '</p>' +
    '<button onclick="location.reload()" style="padding:12px 28px;border:none;border-radius:12px;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:15px;font-weight:600;box-shadow:0 8px 24px rgba(255,107,107,0.35);cursor:pointer;">🔄 重新加载</button>' +
    '<div style="margin-top:40px;font-size:12px;opacity:0.5;">一屿视频 V4.3 · 作者：一屿</div>' +
    '</div>';
}

/* ==================== 登录 / 注册 Tab 切换 ==================== */

function bindAuthTabEvents() {
  var tabs = document.querySelectorAll('.auth-tab');
  for (var i = 0; i < tabs.length; i++) {
    (function (tab) {
      tab.addEventListener('click', function () {
        var mode = tab.getAttribute('data-mode');
        switchMode(mode);
      });
    })(tabs[i]);
  }
}

/**
 * 切换登录/注册模式
 * @param {'login'|'register'} mode
 */
function switchMode(mode) {
  if (authState.maintenance) return;
  authState.currentMode = mode || 'login';

  var tabs = document.querySelectorAll('.auth-tab');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-mode') === mode) {
      tabs[i].classList.add('active');
    } else {
      tabs[i].classList.remove('active');
    }
  }

  var loginForm = document.getElementById('login-form');
  var registerForm = document.getElementById('register-form');

  if (mode === 'register') {
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) {
      registerForm.style.display = 'block';
      registerForm.style.animation = 'fadeSlideIn 0.3s ease';
    }
  } else {
    if (registerForm) registerForm.style.display = 'none';
    if (loginForm) {
      loginForm.style.display = 'block';
      loginForm.style.animation = 'fadeSlideIn 0.3s ease';
    }
  }

  clearAuthErrors();
}

/* ==================== 登录页公告 ==================== */

function checkAndFetchLoginAnnouncement() {
  var card = document.getElementById('login-announcement');
  if (!card) return;

  authApiGet('/announcements/login', function (res) {
    var hasData = res && res.code === 0 && res.data;
    if (hasData && res.data.active && res.data.content) {
      authState.announcement = res.data;
      card.style.display = 'flex';
      var textEl = card.querySelector('.login-announce-text');
      var iconEl = card.querySelector('.login-announce-icon');
      if (iconEl) iconEl.textContent = res.data.icon || '📢';
      if (textEl) textEl.innerHTML = renderAnnouncementContent(res.data);
    } else if (hasData && res.data.active === false) {
      card.style.display = 'none';
    }
  }, function () {
    // 失败时保留默认公告
  });
}

function renderAnnouncementContent(data) {
  var title = data.title || '';
  var content = data.content || '';
  var html = '';
  if (title) {
    html += '<strong style="font-size:13px;color:#ff6b6b;margin-right:6px;">' + escapeHtml(title) + '</strong>';
  }
  html += '<span style="font-size:12px;line-height:1.6;">' + escapeHtml(content) + '</span>';
  if (data.link && data.linkText) {
    html += ' <a href="' + escapeHtml(data.link) + '" target="_blank" style="color:#667eea;font-size:12px;text-decoration:underline;">' + escapeHtml(data.linkText) + '</a>';
  }
  return html;
}

/* ==================== 输入绑定与校验 ==================== */

function bindLoginInputs() {
  var account = document.getElementById('login-account');
  var password = document.getElementById('login-password');
  if (account) {
    account.addEventListener('input', function () {
      clearAuthError('login-account');
    });
    account.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (password) password.focus();
        else doLogin();
      }
    });
  }
  if (password) {
    password.addEventListener('input', function () {
      clearAuthError('login-password');
    });
    password.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doLogin();
      }
    });
  }
}

function bindRegisterInputs() {
  var username = document.getElementById('reg-username');
  var phone = document.getElementById('reg-phone');
  var qq = document.getElementById('reg-qq');
  var password = document.getElementById('reg-password');
  var confirm = document.getElementById('reg-confirm');

  if (username) {
    username.addEventListener('input', function () {
      clearAuthError('reg-username');
      validateUsernameLive(this);
    });
    username.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (phone) phone.focus(); }
    });
  }
  if (phone) {
    phone.addEventListener('input', function () {
      clearAuthError('reg-phone');
      this.value = this.value.replace(/\D/g, '').substring(0, 11);
    });
    phone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (qq) qq.focus(); }
    });
  }
  if (qq) {
    qq.addEventListener('input', function () {
      clearAuthError('reg-qq');
      this.value = this.value.replace(/\D/g, '').substring(0, 15);
    });
    qq.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (password) password.focus(); }
    });
  }
  if (password) {
    password.addEventListener('input', function () {
      clearAuthError('reg-password');
      updatePasswordStrength(this.value);
    });
    password.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (confirm) confirm.focus(); }
    });
  }
  if (confirm) {
    confirm.addEventListener('input', function () {
      clearAuthError('reg-confirm');
    });
    confirm.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doRegister();
      }
    });
  }
}

function validateUsernameLive(input) {
  var val = input.value.trim();
  var hint = getHintFor(input);
  if (!val) return;
  if (val.length < 2) {
    setHint(hint, '用户名至少2个字符', 'error');
  } else if (val.length > 20) {
    setHint(hint, '用户名不能超过20个字符', 'error');
  } else {
    setHint(hint, '', 'ok');
  }
}

function updatePasswordStrength(pwd) {
  var pwdInput = document.getElementById('reg-password');
  if (!pwdInput) return;
  var hint = getHintFor(pwdInput);
  var strength = checkPasswordStrength(pwd);
  if (!pwd) {
    setHint(hint, '', '');
    return;
  }
  if (!strength.valid) {
    setHint(hint, strength.msg, 'error');
    return;
  }
  var colors = { 1: '#ff6b6b', 2: '#ffa726', 3: '#56ab2f' };
  setHint(hint, '密码强度：' + strength.label, 'custom', colors[strength.level] || '#999');
}

function getHintFor(input) {
  if (!input) return null;
  var id = input.id + '-hint';
  var hint = document.getElementById(id);
  if (!hint) {
    hint = document.createElement('div');
    hint.id = id;
    hint.className = 'auth-field-hint';
    hint.style.cssText = 'font-size:11px;margin-top:4px;min-height:14px;';
    var parent = input.parentNode.parentNode;
    if (parent) parent.appendChild(hint);
  }
  return hint;
}

function setHint(hint, text, type, customColor) {
  if (!hint) return;
  hint.textContent = text || '';
  if (!text) { hint.style.color = ''; return; }
  if (type === 'error') hint.style.color = '#ff4444';
  else if (type === 'ok') hint.style.color = '#56ab2f';
  else if (type === 'custom') hint.style.color = customColor || '#999';
  else hint.style.color = '#999';
}

function setAuthError(inputId, msg) {
  var input = document.getElementById(inputId);
  if (input) {
    input.style.borderColor = '#ff4444';
    input.style.boxShadow = '0 0 0 3px rgba(255,68,68,0.12)';
  }
  var hint = getHintFor(input);
  setHint(hint, msg, 'error');
}

function clearAuthError(inputId) {
  var input = document.getElementById(inputId);
  if (input) {
    input.style.borderColor = '';
    input.style.boxShadow = '';
  }
}

function clearAuthErrors() {
  var inputs = document.querySelectorAll('.auth-field input');
  for (var i = 0; i < inputs.length; i++) {
    inputs[i].style.borderColor = '';
    inputs[i].style.boxShadow = '';
    var hint = document.getElementById(inputs[i].id + '-hint');
    if (hint) { hint.textContent = ''; }
  }
}

/* ==================== 登录逻辑 ==================== */

/**
 * 执行登录
 * POST /api/auth/login
 * 成功后存 token + user，跳 index.html
 */
function doLogin() {
  if (authState.maintenance) {
    showToast('系统维护中，暂不可登录', 'error');
    return;
  }

  var accountInput = document.getElementById('login-account');
  var passwordInput = document.getElementById('login-password');
  var btn = document.getElementById('login-btn');

  var account = accountInput ? accountInput.value.trim() : '';
  var password = passwordInput ? passwordInput.value : '';

  var hasError = false;
  if (!account) {
    setAuthError('login-account', '请输入用户名或手机号');
    hasError = true;
  }
  if (!password) {
    setAuthError('login-password', '请输入密码');
    hasError = true;
  } else if (password.length < 6) {
    setAuthError('login-password', '密码至少6位');
    hasError = true;
  }
  if (hasError) return;

  // 防暴力破解：5次错误后 60s 冷却
  var now = Date.now();
  if (authState.loginAttempts >= 5 && (now - authState.lastAttemptAt) < 60000) {
    var remainSec = Math.ceil((60000 - (now - authState.lastAttemptAt)) / 1000);
    showToast('尝试次数过多，请 ' + remainSec + ' 秒后再试', 'error');
    return;
  }
  if ((now - authState.lastAttemptAt) >= 60000) authState.loginAttempts = 0;

  if (btn) {
    btn.disabled = true;
    btn.textContent = '登录中...';
    btn.style.opacity = '0.7';
    btn.style.cursor = 'not-allowed';
  }

  authApiPostPublic('/auth/login', {
    account: account,
    password: password
  }, function (res) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '登 录';
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
    if (!res) {
      showToast('服务器无响应，请稍后重试', 'error');
      return;
    }
    if (res.code !== 0) {
      authState.loginAttempts++;
      authState.lastAttemptAt = Date.now();
      var msg = res.message || '登录失败';
      if (msg.indexOf('账号') > -1 || msg.indexOf('用户') > -1) {
        setAuthError('login-account', msg);
      } else if (msg.indexOf('密码') > -1) {
        setAuthError('login-password', msg);
      } else {
        showToast(msg, 'error');
      }
      if (authState.loginAttempts >= 3) {
        showToast('错误 ' + authState.loginAttempts + ' 次，超过 5 次将被限制 60 秒', 'error');
      }
      return;
    }

    // 登录成功
    var data = res.data || {};
    var token = data.token || res.token;
    var user = data.user || res.user;
    if (!token) {
      showToast('登录数据异常，请重试', 'error');
      return;
    }
    localStorage.setItem('yiyu_token', token);
    if (user) {
      localStorage.setItem('yiyu_user', JSON.stringify(user));
    }
    authState.loginAttempts = 0;

    // 显示登录成功动效
    showLoginSuccessAnimation(function () {
      window.location.href = 'index.html';
    });
  }, function () {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '登 录';
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
    showToast('服务器连接失败，请确认服务器已部署', 'error');
  });
}

function showLoginSuccessAnimation(callback) {
  var overlay = document.createElement('div');
  overlay.id = 'login-success-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.96);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;animation:fadeIn 0.3s ease;';
  overlay.innerHTML =
    '<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#56ab2f,#a8e063);display:flex;align-items:center;justify-content:center;font-size:40px;color:#fff;box-shadow:0 12px 40px rgba(86,171,47,0.35);animation:successPop 0.5s cubic-bezier(0.175,0.885,0.32,1.275);margin-bottom:20px;">✓</div>' +
    '<h2 style="margin:0 0 8px;font-size:22px;color:#1a1a1a;">登录成功</h2>' +
    '<p style="margin:0;color:#666;font-size:14px;">欢迎回来，正在进入首页...</p>';
  document.body.appendChild(overlay);
  setTimeout(function () {
    callback && callback();
  }, 600);
}

/* ==================== 注册逻辑 ==================== */

/**
 * 执行注册
 * POST /api/auth/register
 * 成功后存 token + user，跳 index.html
 */
function doRegister() {
  if (authState.maintenance) {
    showToast('系统维护中，暂不可注册', 'error');
    return;
  }
  if (authState.registerCooldown) {
    showToast('请求过于频繁，请稍后再试', 'error');
    return;
  }

  var usernameInput = document.getElementById('reg-username');
  var phoneInput = document.getElementById('reg-phone');
  var qqInput = document.getElementById('reg-qq');
  var passwordInput = document.getElementById('reg-password');
  var confirmInput = document.getElementById('reg-confirm');
  var btn = document.getElementById('reg-btn');

  var username = usernameInput ? usernameInput.value.trim() : '';
  var phone = phoneInput ? phoneInput.value.trim() : '';
  var qq = qqInput ? qqInput.value.trim() : '';
  var password = passwordInput ? passwordInput.value : '';
  var confirmPassword = confirmInput ? confirmInput.value : '';

  var hasError = false;

  // 用户名校验
  if (!username) {
    setAuthError('reg-username', '请输入用户名');
    hasError = true;
  } else if (username.length < 2) {
    setAuthError('reg-username', '用户名至少2个字符');
    hasError = true;
  } else if (username.length > 20) {
    setAuthError('reg-username', '用户名最多20个字符');
    hasError = true;
  } else if (/[^\u4e00-\u9fa5a-zA-Z0-9_]/.test(username)) {
    setAuthError('reg-username', '只能包含中文、字母、数字和下划线');
    hasError = true;
  }

  // 手机号校验
  if (!phone) {
    setAuthError('reg-phone', '请输入手机号');
    hasError = true;
  } else if (!isValidPhone(phone)) {
    setAuthError('reg-phone', '请输入正确的11位手机号');
    hasError = true;
  }

  // QQ 选填，但填了就校验
  if (qq && !/^[1-9]\d{4,14}$/.test(qq)) {
    setAuthError('reg-qq', 'QQ号格式不正确');
    hasError = true;
  }

  // 密码校验
  var strength = checkPasswordStrength(password);
  if (!password) {
    setAuthError('reg-password', '请输入密码');
    hasError = true;
  } else if (!strength.valid) {
    setAuthError('reg-password', strength.msg);
    hasError = true;
  }

  // 确认密码
  if (!confirmPassword) {
    setAuthError('reg-confirm', '请再次输入密码');
    hasError = true;
  } else if (confirmPassword !== password) {
    setAuthError('reg-confirm', '两次密码输入不一致');
    hasError = true;
  }

  if (hasError) return;

  // 冷却
  authState.registerCooldown = true;
  setTimeout(function () { authState.registerCooldown = false; }, 5000);

  if (btn) {
    btn.disabled = true;
    btn.textContent = '注册中...';
    btn.style.opacity = '0.7';
    btn.style.cursor = 'not-allowed';
  }

  authApiPostPublic('/auth/register', {
    username: username,
    phone: phone,
    qq: qq,
    password: password,
    confirmPassword: confirmPassword
  }, function (res) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '注 册';
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
    if (!res) {
      showToast('服务器无响应，请稍后重试', 'error');
      return;
    }
    if (res.code !== 0) {
      var msg = res.message || '注册失败';
      if (msg.indexOf('用户名') > -1) setAuthError('reg-username', msg);
      else if (msg.indexOf('手机号') > -1 || msg.indexOf('手机') > -1) setAuthError('reg-phone', msg);
      else if (msg.indexOf('密码') > -1) setAuthError('reg-password', msg);
      else showToast(msg, 'error');
      return;
    }

    var data = res.data || {};
    var token = data.token || res.token;
    var user = data.user || res.user;
    if (!token) {
      showToast('注册数据异常，请重试', 'error');
      return;
    }
    localStorage.setItem('yiyu_token', token);
    if (user) localStorage.setItem('yiyu_user', JSON.stringify(user));

    showRegisterSuccessAnimation(username, function () {
      window.location.href = 'index.html';
    });
  }, function () {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '注 册';
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
    showToast('服务器连接失败，请确认服务器已部署', 'error');
  });
}

function showRegisterSuccessAnimation(username, callback) {
  var overlay = document.createElement('div');
  overlay.id = 'register-success-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.96);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;animation:fadeIn 0.3s ease;padding:24px;text-align:center;';
  overlay.innerHTML =
    '<div style="width:90px;height:90px;border-radius:50%;background:linear-gradient(135deg,#f6d365 0%,#fda085 100%);display:flex;align-items:center;justify-content:center;font-size:44px;box-shadow:0 12px 40px rgba(253,160,133,0.35);animation:successPop 0.5s cubic-bezier(0.175,0.885,0.32,1.275);margin-bottom:24px;">🎉</div>' +
    '<h2 style="margin:0 0 10px;font-size:24px;color:#1a1a1a;">注册成功！</h2>' +
    '<p style="margin:0 0 4px;color:#555;font-size:15px;">欢迎加入一屿视频，<strong style="color:#ff6b6b;">' + escapeHtml(username) + '</strong></p>' +
    '<p style="margin:0 0 28px;color:#999;font-size:13px;">精彩影视内容马上就来...</p>' +
    '<div style="width:40px;height:40px;border:3px solid #ff6b6b;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>';
  document.body.appendChild(overlay);
  setTimeout(function () { callback && callback(); }, 1000);
}

/* ==================== 忘记密码 / 辅助功能 ==================== */

/**
 * 忘记密码（弹出提示，可扩展为弹窗表单）
 */
function forgotPassword() {
  var modal = document.createElement('div');
  modal.id = 'forgot-password-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9500;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.onclick = function (e) { if (e.target === modal) closeForgotPassword(); };
  modal.innerHTML =
    '<div style="max-width:400px;width:100%;background:#fff;border-radius:16px;overflow:hidden;" onclick="event.stopPropagation()">' +
    '<div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;">' +
    '<h3 style="margin:0;font-size:17px;">🔐 找回密码</h3>' +
    '<span onclick="closeForgotPassword()" style="cursor:pointer;font-size:18px;color:#999;">✕</span>' +
    '</div>' +
    '<div style="padding:20px;">' +
    '<div style="background:#e3f2fd;border:1px solid #bbdefb;border-radius:10px;padding:12px;margin-bottom:16px;">' +
    '<div style="font-size:13px;color:#1565c0;line-height:1.6;">请使用手机号联系客服重置密码。</div>' +
    '</div>' +
    '<label style="font-size:13px;color:#666;display:block;margin-bottom:6px;">注册手机号</label>' +
    '<input type="tel" id="fp-phone" maxlength="11" placeholder="请输入注册时的手机号" style="width:100%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;box-sizing:border-box;margin-bottom:12px;">' +
    '<div style="display:flex;gap:10px;margin-bottom:16px;">' +
      '<input type="text" id="fp-code" placeholder="短信验证码" style="flex:1;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;box-sizing:border-box;">' +
      '<button id="fp-send-code" onclick="sendForgotCode()" style="padding:12px 16px;border:none;border-radius:10px;background:#f0f0f0;color:#666;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;">获取验证码</button>' +
    '</div>' +
    '<label style="font-size:13px;color:#666;display:block;margin-bottom:6px;">新密码</label>' +
    '<input type="password" id="fp-password" placeholder="请输入新密码（至少6位）" style="width:100%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;box-sizing:border-box;margin-bottom:16px;">' +
    '<button onclick="submitForgotPassword()" style="width:100%;padding:13px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(255,107,107,0.25);">重置密码</button>' +
    '</div></div>';
  document.body.appendChild(modal);
}

var fpCountdown = 0;
function sendForgotCode() {
  var phone = document.getElementById('fp-phone');
  var phoneVal = phone ? phone.value.trim() : '';
  if (!phoneVal || !isValidPhone(phoneVal)) {
    showToast('请输入正确的手机号', 'error');
    return;
  }
  var btn = document.getElementById('fp-send-code');
  if (fpCountdown > 0) return;

  authApiPostPublic('/auth/send-reset-code', { phone: phoneVal }, function (res) {
    if (res && res.code === 0) {
      showToast('验证码已发送', 'success');
      fpCountdown = 60;
      updateFpCountdown();
    } else {
      showToast((res && res.message) || '发送失败', 'error');
    }
  }, function () {
    showToast('服务器连接失败，请确认服务器已部署', 'error');
  });
}

function updateFpCountdown() {
  var btn = document.getElementById('fp-send-code');
  if (!btn) return;
  if (fpCountdown <= 0) {
    btn.textContent = '获取验证码';
    btn.disabled = false;
    btn.style.opacity = '';
    return;
  }
  btn.textContent = fpCountdown + 's 后重发';
  btn.disabled = true;
  btn.style.opacity = '0.5';
  fpCountdown--;
  setTimeout(updateFpCountdown, 1000);
}

function submitForgotPassword() {
  var phone = document.getElementById('fp-phone');
  var code = document.getElementById('fp-code');
  var pwd = document.getElementById('fp-password');
  var phoneVal = phone ? phone.value.trim() : '';
  var codeVal = code ? code.value.trim() : '';
  var pwdVal = pwd ? pwd.value : '';
  if (!isValidPhone(phoneVal)) { showToast('请输入正确的手机号', 'error'); return; }
  if (!codeVal) { showToast('请输入验证码', 'error'); return; }
  if (pwdVal.length < 6) { showToast('密码至少6位', 'error'); return; }

  authApiPostPublic('/auth/reset-password', {
    phone: phoneVal, code: codeVal, password: pwdVal
  }, function (res) {
    if (res && res.code === 0) {
      showToast('密码重置成功，请登录', 'success');
      closeForgotPassword();
      switchMode('login');
      if (document.getElementById('login-account')) document.getElementById('login-account').value = phoneVal;
    } else {
      showToast((res && res.message) || '重置失败', 'error');
    }
  }, function () {
    showToast('服务器连接失败，请确认服务器已部署', 'error');
  });
}

function closeForgotPassword() {
  var m = document.getElementById('forgot-password-modal');
  if (m) m.parentNode.removeChild(m);
  fpCountdown = 0;
}

/* ==================== 微信 / QQ 登录占位 ==================== */

function thirdPartyLogin(type) {
  var nameMap = { wechat: '微信', qq: 'QQ' };
  showToast((nameMap[type] || type) + '登录开发中...');
}

/* ==================== 用户协议查看 ==================== */

function showAgreement(type) {
  type = type || 'user';
  var titleMap = { user: '用户协议', privacy: '隐私政策' };
  var modal = document.createElement('div');
  modal.id = 'agreement-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9500;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.onclick = function (e) { if (e.target === modal) closeAgreement(); };
  modal.innerHTML =
    '<div style="max-width:440px;width:100%;max-height:80vh;background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;" onclick="event.stopPropagation()">' +
    '<div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">' +
    '<h3 style="margin:0;font-size:17px;">📄 ' + (titleMap[type] || '协议') + '</h3>' +
    '<span onclick="closeAgreement()" style="cursor:pointer;font-size:18px;color:#999;">✕</span>' +
    '</div>' +
    '<div style="padding:20px;overflow-y:auto;font-size:13px;color:#555;line-height:1.7;">' +
    buildAgreementContent(type) +
    '</div>' +
    '<div style="padding:12px 20px;border-top:1px solid #f0f0f0;flex-shrink:0;">' +
    '<button onclick="closeAgreement()" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">我已阅读并同意</button>' +
    '</div></div>';
  document.body.appendChild(modal);
}

function buildAgreementContent(type) {
  if (type === 'privacy') {
    return (
      '<h3 style="margin:0 0 8px;font-size:16px;color:#1a1a1a;">一屿视频 隐私政策</h3>' +
      '<p style="margin:0 0 12px;font-size:12px;color:#888;">生效日期：2026年08月08日 &nbsp;&nbsp; 版本号：V1.0</p>' +
      '<p style="margin:0 0 16px;">【概述】感谢您使用「一屿视频」App。我们深知个人信息对您的重要性，您的信赖是我们最宝贵的财富。本隐私政策旨在向您说明我们如何收集、使用、存储、共享和保护您的个人信息。请您务必仔细阅读本政策，特别是加粗的部分。<strong style="color:#ff6b6b;">当您注册、登录或使用本服务时，即表示您已阅读并同意本政策的全部内容。</strong></p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">一、我们收集的信息</strong>' +
      '<p style="margin:0 0 8px;"><strong>1. 注册信息</strong>：当您注册账号时，我们会主动收集您填写的手机号、用户名、密码、QQ号（选填）。其中手机号用于身份识别和账号找回，用户名用于社区展示。</p>' +
      '<p style="margin:0 0 8px;"><strong>2. 使用信息</strong>：在您使用过程中，我们会收集您的搜索关键词、观看历史、收藏记录、下载记录、播放时长、点赞评论等使用数据，用于个性化推荐、内容优化和服务改进。</p>' +
      '<p style="margin:0 0 8px;"><strong>3. 设备信息</strong>：为了安全风控和兼容性优化，我们会被动收集设备型号、操作系统版本、IP地址、设备唯一标识（如Android ID）、网络类型、屏幕分辨率。</p>' +
      '<p style="margin:0 0 8px;"><strong>4. 用户主动上传</strong>：当您修改头像（上传图片）、提交意见反馈（含截图和联系方式）时，我们会保存您上传的内容。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">二、信息的使用目的</strong>' +
      '<p style="margin:0 0 8px;">· 完成用户注册、登录、身份验证和账号安全管理；</p>' +
      '<p style="margin:0 0 8px;">· 向您提供视频搜索、在线播放、下载、历史记录、收藏等核心服务；</p>' +
      '<p style="margin:0 0 8px;">· 根据您的偏好进行影视内容推荐和个性化展示；</p>' +
      '<p style="margin:0 0 8px;">· 检测异常登录和恶意行为，保障账号和服务安全；</p>' +
      '<p style="margin:0 0 8px;">· 开展数据分析和统计，改进产品体验；</p>' +
      '<p style="margin:0 0 8px;">· 客服响应与处理用户反馈。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">三、信息的共享、转让与公开披露</strong>' +
      '<p style="margin:0 0 8px;"><strong>1. 共享原则</strong>：未经您的明确同意，我们不会向任何第三方公司、组织或个人出售或出租您的个人信息。</p>' +
      '<p style="margin:0 0 8px;"><strong>2. 必要共享</strong>：仅在以下情况下，我们可能会在最小必要范围内共享信息：</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 为了完成服务功能委托的合作伙伴（如云服务商、CDN厂商）；</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 依据法律法规、司法或行政机关的强制性要求；</p>' +
      '<p style="margin:0 0 8px;padding-left:16px;">· 为保护我们、用户或公众合法权益所必需的情形。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">四、信息的存储与安全保护</strong>' +
      '<p style="margin:0 0 8px;">我们会将收集的信息存储于中华人民共和国境内的服务器中，采用加密传输（HTTPS/TLS）、访问控制、数据脱敏、操作审计、入侵检测等多种安全措施进行保护。存储期限：</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 账号信息：在您注销账号前持续保存；</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 观看历史、收藏等：保存最近 24 个月，超期自动清理；</p>' +
      '<p style="margin:0 0 8px;padding-left:16px;">· 日志数据：最多保存 180 天。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">五、您的权利</strong>' +
      '<p style="margin:0 0 6px;">您有权对个人信息行使以下权利，可通过「我的 - 设置」或联系客服执行：</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 访问权：查看您的账号资料、历史记录、收藏等；</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 更正权：修改用户名、头像、手机号；</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 删除权：清空历史、收藏、下载记录；</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 撤回同意权：关闭个性化推荐、注销账号；</p>' +
      '<p style="margin:0 0 8px;padding-left:16px;">· 注销账号权：您可随时申请注销账号，注销后除法律法规另有规定外，我们会匿名化或删除您的全部数据。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">六、未成年人保护</strong>' +
      '<p style="margin:0 0 16px;">我们非常重视未成年人信息保护。若您是未满 14 周岁的未成年人，请务必在监护人的陪同下阅读本政策并使用本服务；监护人应加强对未成年人网络行为的监护。若我们发现收集了未成年人信息且未取得监护人同意，将尽快删除。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">七、Cookie 与本地存储</strong>' +
      '<p style="margin:0 0 16px;">我们使用浏览器本地存储（localStorage）保存登录状态、用户偏好、历史记录等信息，以便您下次打开App时自动恢复。您可以通过清除App缓存或在设置中手动清理。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">八、政策的更新</strong>' +
      '<p style="margin:0 0 16px;">本政策可能会不定期更新。更新后的政策将在本页面公布，并会在首页公告或登录页以醒目的方式通知您。若您在政策更新后继续使用服务，即视为同意修改后的条款。</p>' +
      '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">九、联系我们</strong>' +
      '<p style="margin:0 0 8px;">如您对本隐私政策有任何疑问、意见或建议，或需要行使您的权利，请通过以下方式联系我们：</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 作者（数据处理者）：一屿</p>' +
      '<p style="margin:0 0 6px;padding-left:16px;">· 联系渠道：App 内「我的 - 意见反馈」</p>' +
      '<p style="margin:0 0 20px;padding-left:16px;">· 响应时效：一般在 3 个工作日内回复。</p>' +
      '<div style="padding:12px;background:#fff5f5;border-radius:10px;font-size:12px;color:#cc4d4d;line-height:1.8;">※ 本政策最终解释权归一屿视频所有。请您在使用服务前审慎阅读并完全理解全部条款。</div>'
    );
  }
  return (
    '<h3 style="margin:0 0 8px;font-size:16px;color:#1a1a1a;">一屿视频 用户服务协议</h3>' +
    '<p style="margin:0 0 12px;font-size:12px;color:#888;">生效日期：2026年08月08日 &nbsp;&nbsp; 版本号：V1.0</p>' +
    '<p style="margin:0 0 16px;">欢迎您使用「一屿视频」软件及相关服务！为了保障您的合法权益，规范双方的权利义务，请您务必<strong style="color:#ff6b6b;">审慎阅读、充分理解</strong>本《用户服务协议》（以下简称"本协议"）各条款内容，尤其是<strong style="color:#ff6b6b;">免责声明、争议解决</strong>等加粗条款。当您勾选"已阅读并同意"并完成注册登录，或实际使用本服务时，即表示您已阅读、理解并接受本协议的全部内容。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第一条 协议适用主体与范围</strong>' +
    '<p style="margin:0 0 8px;">1.1 本协议是您（以下亦称"用户"）与「一屿视频」运营方（作者：一屿，以下简称"我们"或"运营方"）之间就本软件及服务的使用所订立的协议。</p>' +
    '<p style="margin:0 0 8px;">1.2 本协议条款适用于「一屿视频」提供的一切客户端（Android App、Web 端）及相关服务。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第二条 服务内容</strong>' +
    '<p style="margin:0 0 8px;">2.1 一屿视频是一款<strong>影视内容聚合搜索与播放工具</strong>，通过第三方公开影视资源站的API接口，提供影视资源的搜索、索引和在线播放服务。</p>' +
    '<p style="margin:0 0 8px;">2.2 本软件不直接制作、存储、上传任何视频内容，所展示的视频均来源于合作的第三方资源站（如非凡资源、量子资源、暴风资源等），版权归原版权方所有。</p>' +
    '<p style="margin:0 0 8px;">2.3 服务内容包括但不限于：用户注册登录、视频搜索、在线播放、历史记录、收藏、下载管理、个性化推荐、用户资料编辑、会员服务、意见反馈等。</p>' +
    '<p style="margin:0 0 8px;">2.4 我们<strong>保留随时变更、中止或终止部分或全部服务的权利</strong>，届时会通过公告或推送的方式提前通知。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第三条 账号注册与管理</strong>' +
    '<p style="margin:0 0 8px;">3.1 注册条件：您确认在完成注册时已具备与您的民事行为能力相适应的民事行为能力；未成年人需由监护人陪同注册并同意本协议。</p>' +
    '<p style="margin:0 0 8px;">3.2 注册方式：支持「用户名 + 密码」「手机号 + 密码」注册，可选绑定QQ号。您应提供<strong>真实、准确、完整</strong>的注册资料，并在资料变更时及时更新。</p>' +
    '<p style="margin:0 0 8px;">3.3 账号安全：您应妥善保管账号和密码，对账号下的所有登录、操作、消费行为承担全部责任。发现账号异常请立即通过「意见反馈」联系客服处理，因您保管不善造成的损失由您自行承担。</p>' +
    '<p style="margin:0 0 8px;">3.4 资料修改规则：普通用户对头像、用户名的修改设有<strong>30 天冷却期</strong>，VIP会员用户无冷却；账号一旦创建，注册手机号不可随意变更。</p>' +
    '<p style="margin:0 0 8px;">3.5 账号禁止转让、出借、买卖、继承；如发现非本人使用，我们有权采取冻结、封禁措施。</p>' +
    '<p style="margin:0 0 8px;">3.6 账号注销：您可随时通过「我的 - 设置 - 注销账号」申请注销。注销后账号信息将在合理期限内匿名化或删除，且<strong>无法恢复</strong>。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第四条 会员服务（VIP）</strong>' +
    '<p style="margin:0 0 8px;">4.1 会员权益：本软件提供会员（VIP）服务，具体权益以购买页面为准，当前包含但不限于：资料修改无冷却、高级个性化推荐、专属会员标识、无广告浏览等。</p>' +
    '<p style="margin:0 0 8px;">4.2 会员开通：会员身份由管理员在后台进行设置或调整，具体方式以页面说明为准。</p>' +
    '<p style="margin:0 0 8px;">4.3 会员有效期：会员到期后权益自动终止，如需续期请联系管理员。</p>' +
    '<p style="margin:0 0 8px;">4.4 会员服务一经生效，非因法律规定或本协议明确约定的情形，不支持退款或返还。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第五条 用户行为规范</strong>' +
    '<p style="margin:0 0 6px;">5.1 您承诺合法、合理、善意地使用本服务，不得从事以下行为：</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 发布、传播违反法律法规、社会主义核心价值观、公序良俗的内容；</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 利用本服务侵犯任何第三方的著作权、商标权、隐私权、名誉权等合法权益；</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 恶意注册账号、刷榜、刷量、刷分、盗用他人账号；</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 通过爬虫、机器人、抓包等工具抓取数据或干扰服务正常运行；</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 传播病毒、木马、钓鱼链接、恶意代码；</p>' +
    '<p style="margin:0 0 8px;padding-left:16px;">· 其他可能损害我们、第三方或社会公共利益的行为。</p>' +
    '<p style="margin:0 0 8px;">5.2 若违反本条，我们有权根据情节严重程度采取<strong>警告、限制功能、冻结账号、封禁账号</strong>等措施，情节严重者移交司法机关。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第六条 知识产权</strong>' +
    '<p style="margin:0 0 8px;">6.1 本软件的源代码、界面设计、文字、图片、动画、商标、Logo 等全部知识产权归一屿视频（作者：一屿）所有，受《著作权法》《商标法》等法律保护。</p>' +
    '<p style="margin:0 0 8px;">6.2 用户仅获得<strong>个人、非商业、不可转让、非独占</strong>的使用许可，不得对软件进行反向工程、反编译、破解、二次分发、商用化运营。</p>' +
    '<p style="margin:0 0 8px;">6.3 第三方视频内容版权归原版权方所有，如版权方认为本软件内容侵犯了其合法权益，请通过「意见反馈」联系我们，我们将依法及时处理。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第七条 服务的变更、中断与终止</strong>' +
    '<p style="margin:0 0 8px;">7.1 我们可能根据业务需要对服务内容进行调整、升级、迁移，或对软件版本进行更新。</p>' +
    '<p style="margin:0 0 8px;">7.2 如发生以下情形，我们有权<strong>暂停或终止服务</strong>，并不承担违约责任：</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 因不可抗力（地震、战争、网络攻击、政策变动）导致服务无法提供的；</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 用户违反本协议被封禁账号的；</p>' +
    '<p style="margin:0 0 8px;padding-left:16px;">· 服务器维护、升级、迁移期间（会提前发布维护公告）。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第八条 免责声明</strong>' +
    '<p style="margin:0 0 8px;"><strong style="color:#ff6b6b;">8.1 本软件提供的影视内容全部来源于第三方公开资源站，我们不对内容的合法性、准确性、完整性、时效性提供任何保证。</strong>如您对内容有任何异议或发现涉嫌侵权内容，请直接联系资源站或通过我们转达。</p>' +
    '<p style="margin:0 0 8px;"><strong style="color:#ff6b6b;">8.2 本服务按"现状"和"可提供"状态提供，在法律允许的最大范围内，我们不对服务的适销性、适用性、非侵权性做任何明示或默示担保。</strong></p>' +
    '<p style="margin:0 0 8px;">8.3 因第三方资源站故障、线路中断、内容下线导致的播放失败或内容缺失，我们不承担责任，但会尽力更换可用线路。</p>' +
    '<p style="margin:0 0 8px;">8.4 因您自身原因（如设备故障、网络中断、密码泄露）造成的损失，由您自行承担。</p>' +
    '<p style="margin:0 0 8px;">8.5 对您使用本服务产生的<strong>间接损失、附带损失、利润损失、商誉损失</strong>，我们不承担赔偿责任。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第九条 协议修改</strong>' +
    '<p style="margin:0 0 8px;">9.1 我们可根据国家法律法规变化或运营需要对本协议进行修改，修改后的协议将在登录页/首页公布，并提供7日的异议期。</p>' +
    '<p style="margin:0 0 16px;">9.2 若您在异议期届满后继续使用服务，视为您同意修改后的协议；若不同意，请停止使用并注销账号。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第十条 法律适用与争议解决</strong>' +
    '<p style="margin:0 0 8px;">10.1 本协议的<strong>订立、生效、履行、解释及争议解决均适用中华人民共和国大陆地区法律（不包括冲突法规则）。</strong></p>' +
    '<p style="margin:0 0 16px;">10.2 因本协议引起的争议，双方应友好协商解决；协商不成的，任何一方均可向<strong>运营方所在地有管辖权的人民法院</strong>提起诉讼。</p>' +
    '<strong style="display:block;margin:14px 0 6px;font-size:14px;color:#1a1a1a;">第十一条 联系与反馈</strong>' +
    '<p style="margin:0 0 8px;">如您对本协议有任何疑问、意见或建议，可通过以下渠道联系我们：</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· App 内「我的 - 意见反馈」；</p>' +
    '<p style="margin:0 0 6px;padding-left:16px;">· 管理员后台反馈管理模块。</p>' +
    '<div style="margin-top:18px;padding:14px;background:linear-gradient(135deg,#fff5f5,#fff8e8);border-radius:12px;border:1px solid #ffd8d0;">' +
    '  <div style="font-size:13px;color:#cc4d4d;font-weight:600;margin-bottom:6px;">💡 温馨提示</div>' +
    '  <div style="font-size:12px;color:#8c5a55;line-height:1.8;">请您在使用「一屿视频」服务前，务必完整阅读并充分理解本协议及《隐私政策》的全部内容。点击「同意」或使用服务，即视为您完全同意。<br>© 2026 一屿视频 版权所有 · 作者：一屿</div>' +
    '</div>'
  );
}

function closeAgreement() {
  var m = document.getElementById('agreement-modal');
  if (m) m.parentNode.removeChild(m);
}

/* ==================== 记住账号 / 密码显示切换 ==================== */

/**
 * 初始化记住账号功能和密码显示切换
 * 在 bindLoginInputs/bindRegisterInputs 之后调用
 */
function enhanceLoginFormFeatures() {
  // 登录表单：记住账号
  var loginAccount = document.getElementById('login-account');
  if (loginAccount) {
    var saved = localStorage.getItem('yiyu_saved_account');
    if (saved) {
      loginAccount.value = saved;
      var rememberCheckbox = ensureRememberCheckbox();
      if (rememberCheckbox) rememberCheckbox.checked = true;
    }
  }

  // 为密码输入框添加显示切换
  addPasswordToggle('login-password');
  addPasswordToggle('reg-password');
  addPasswordToggle('reg-confirm');
  addPasswordToggle('fp-password');
}

function ensureRememberCheckbox() {
  var loginForm = document.getElementById('login-form');
  if (!loginForm) return null;
  var exist = document.getElementById('remember-account-check');
  if (exist) return exist;
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:4px 0 14px;';
  wrapper.innerHTML =
    '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#666;cursor:pointer;user-select:none;">' +
    '<input type="checkbox" id="remember-account-check" style="accent-color:#ff6b6b;cursor:pointer;">记住账号' +
    '</label>' +
    '<span onclick="forgotPassword()" style="font-size:12px;color:#ff6b6b;cursor:pointer;">忘记密码？</span>';
  var submitBtn = loginForm.querySelector('#login-btn');
  if (submitBtn && submitBtn.parentNode) {
    submitBtn.parentNode.insertBefore(wrapper, submitBtn);
  } else {
    loginForm.appendChild(wrapper);
  }
  var check = document.getElementById('remember-account-check');
  if (check) {
    check.addEventListener('change', function () {
      var accInput = document.getElementById('login-account');
      if (!accInput) return;
      if (this.checked) {
        localStorage.setItem('yiyu_saved_account', accInput.value.trim());
      } else {
        localStorage.removeItem('yiyu_saved_account');
      }
    });
  }
  return check;
}

function addPasswordToggle(inputId) {
  var input = document.getElementById(inputId);
  if (!input || input.parentNode.querySelector('.pwd-toggle-btn')) return;
  // 创建切换按钮
  var btn = document.createElement('span');
  btn.className = 'pwd-toggle-btn';
  btn.textContent = '👁️';
  btn.setAttribute('data-show', '0');
  btn.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:14px;opacity:0.6;user-select:none;transition:opacity 0.2s;';
  btn.onmouseenter = function () { this.style.opacity = '1'; };
  btn.onmouseleave = function () { this.style.opacity = '0.6'; };
  btn.onclick = function () {
    var show = this.getAttribute('data-show') === '1';
    if (show) {
      input.type = 'password';
      this.textContent = '👁️';
      this.setAttribute('data-show', '0');
    } else {
      input.type = 'text';
      this.textContent = '🙈';
      this.setAttribute('data-show', '1');
    }
  };
  var fieldInput = input.parentNode;
  if (fieldInput) {
    fieldInput.style.position = 'relative';
    // 增加右边padding避免文字被遮挡
    input.style.paddingRight = '38px';
    fieldInput.appendChild(btn);
  }
}

/* ==================== 浏览器兼容与环境检测 ==================== */

/**
 * 检测运行环境，提示兼容性问题
 */
function detectEnvironment() {
  var issues = [];
  // localStorage 检测
  try {
    localStorage.setItem('__test_key__', '1');
    localStorage.removeItem('__test_key__');
  } catch (e) {
    issues.push('本地存储(localStorage)不可用，可能无法正常登录');
  }
  // fetch 检测
  if (typeof fetch !== 'function') {
    issues.push('浏览器不支持 fetch API，建议升级浏览器');
  }
  // Promise 检测
  if (typeof Promise === 'undefined') {
    issues.push('浏览器不支持 Promise，建议升级浏览器');
  }
  // JSON
  if (typeof JSON === 'undefined') {
    issues.push('浏览器不支持 JSON 对象，环境异常');
  }
  // WebView 检测
  var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
  var isWebView = /wv|WebView|Android.*AppleWebKit(?!.*Version)/i.test(ua);
  if (isWebView) {
    authState.isWebView = true;
  }
  if (issues.length) {
    try {
      var tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#fff3cd;color:#856404;font-size:12px;padding:8px 16px;z-index:99998;text-align:center;line-height:1.5;';
      tip.innerHTML = '⚠️ ' + issues.join('；') + '';
      document.body.appendChild(tip);
      setTimeout(function () {
        tip.style.transition = 'opacity 0.8s';
        tip.style.opacity = '0';
        setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 1000);
      }, 6000);
    } catch (e) { }
  }
}

/**
 * 检测并提示网络状态
 */
function bindNetworkStatus() {
  try {
    if (window.addEventListener) {
      window.addEventListener('offline', function () {
        showToast('网络已断开，请检查网络连接', 'error');
      });
      window.addEventListener('online', function () {
        showToast('网络已恢复', 'success');
      });
    }
  } catch (e) { }
}

/* ==================== 表单动画与视觉增强 ==================== */

/**
 * 给登录表单容器加浮动图标背景动画
 */
function addFloatingBgDecor() {
  try {
    var page = document.querySelector('.login-page');
    if (!page) return;
    if (page.querySelector('.auth-bg-decor')) return;
    var decor = document.createElement('div');
    decor.className = 'auth-bg-decor';
    decor.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;';
    var icons = ['🎬', '🎭', '🎥', '🎞️', '📽️', '🎵', '🎨', '✨'];
    var iconsHtml = '';
    for (var i = 0; i < 14; i++) {
      var size = 18 + Math.random() * 36;
      var left = Math.random() * 100;
      var top = Math.random() * 100;
      var delay = Math.random() * 8;
      var duration = 10 + Math.random() * 12;
      var opacity = 0.06 + Math.random() * 0.08;
      var icon = icons[i % icons.length];
      iconsHtml +=
        '<span style="position:absolute;left:' + left + '%;top:' + top + '%;font-size:' + size + 'px;opacity:' + opacity + ';animation:floatUpDown ' + duration + 's ease-in-out ' + delay + 's infinite;">' + icon + '</span>';
    }
    decor.innerHTML = iconsHtml;
    // 加动画
    var extraAnim = document.createElement('style');
    extraAnim.textContent =
      '@keyframes floatUpDown { 0%,100% { transform:translateY(0) rotate(0deg); } 50% { transform:translateY(-18px) rotate(8deg);} }' +
      '.login-page { position:relative; z-index:1; }';
    document.head.appendChild(extraAnim);
    page.style.position = 'relative';
    page.insertBefore(decor, page.firstChild);
  } catch (e) { }
}

/**
 * 保存账号（在登录成功时调用）
 */
function saveAccountIfRemember() {
  try {
    var cb = document.getElementById('remember-account-check');
    var input = document.getElementById('login-account');
    if (cb && cb.checked && input) {
      localStorage.setItem('yiyu_saved_account', input.value.trim());
    }
  } catch (e) { }
}

// 在 doLogin 成功时记住账号
(function wrapLoginSuccessSave() {
  var origDoLogin = doLogin;
  // 通过 setInterval 监听登录成功的 overlay 元素
  setInterval(function () {
    var overlay = document.getElementById('login-success-overlay');
    if (overlay && !overlay.dataset.savedAccount) {
      overlay.dataset.savedAccount = '1';
      saveAccountIfRemember();
    }
  }, 80);
})();

/* ==================== 调试 & 开发辅助（生产环境也无害） ==================== */

/**
 * 输出版本和环境信息到 console
 */
function logRuntimeInfo() {
  try {
    var ua = (navigator && navigator.userAgent) ? navigator.userAgent : 'Unknown';
    var info = [
      '',
      '======================================',
      '  一屿视频 V4.3 · 作者：一屿',
      '  Auth 模块加载完成',
      '======================================',
      '  环境: ' + (authState.isWebView ? 'WebView App' : 'Browser'),
      '  UA长度: ' + ua.length,
      '  API Base: ' + (typeof getApiUrl === 'function' ? getApiUrl('/test').replace('/api/test', '') : 'N/A'),
      '======================================'
    ];
    // 兼容 console
    if (window.console && console.log) {
      for (var i = 0; i < info.length; i++) console.log(info[i]);
    }
  } catch (e) { }
}

/**
 * 防止表单重复提交（全局）
 */
var globalLastSubmitAt = {};
function throttleSubmit(key, waitMs) {
  var now = Date.now();
  if (globalLastSubmitAt[key] && now - globalLastSubmitAt[key] < waitMs) {
    return false;
  }
  globalLastSubmitAt[key] = now;
  return true;
}

// 对 doLogin / doRegister 加入额外节流保护
(function protectAuthSubmits() {
  var origDoLogin = doLogin;
  var origDoRegister = doRegister;
  doLogin = function () {
    if (!throttleSubmit('doLogin', 800)) {
      showToast('操作过于频繁，请稍候', 'error');
      return;
    }
    return origDoLogin.apply(this, arguments);
  };
  doRegister = function () {
    if (!throttleSubmit('doRegister', 1500)) {
      showToast('操作过于频繁，请稍候', 'error');
      return;
    }
    return origDoRegister.apply(this, arguments);
  };
})();

/* ==================== 扩展：访客浏览（免登录试用，可选） ==================== */

/**
 * 允许游客体验：使用演示 token 进入首页浏览
 */
function guestBrowse() {
  if (!confirm('将以游客身份浏览，部分功能受限。是否继续？')) return;
  // 临时演示 token
  localStorage.setItem('yiyu_token', 'guest_demo_mode');
  localStorage.setItem('yiyu_user', JSON.stringify({
    id: 0,
    username: '游客用户',
    phone: '',
    isVip: false,
    isGuest: true
  }));
  showToast('正在进入游客模式...');
  setTimeout(function () {
    window.location.href = 'index.html';
  }, 500);
}

/**
 * 注入“游客体验”入口按钮
 */
function injectGuestButton() {
  try {
    var page = document.querySelector('.login-page');
    if (!page) return;
    if (page.querySelector('.guest-entry-btn')) return;
    var bottom = page.querySelector('.login-bottom-author');
    var btn = document.createElement('div');
    btn.className = 'guest-entry-btn';
    btn.style.cssText = 'text-align:center;margin:16px 0 8px;';
    btn.innerHTML =
      '<button onclick="guestBrowse()" style="background:transparent;border:1px solid #ff6b6b;color:#ff6b6b;padding:8px 22px;border-radius:20px;font-size:12px;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background=\'#fff1f0\';" onmouseout="this.style.background=\'transparent\';">👀 游客体验，免登录浏览</button>';
    if (bottom && bottom.parentNode) {
      bottom.parentNode.insertBefore(btn, bottom);
    } else {
      page.appendChild(btn);
    }
  } catch (e) { }
}

/* ==================== 初始化包装 ==================== */

(function wrapInitAuthPage() {
  var origInit = initAuthPage;
  initAuthPage = function () {
    detectEnvironment();
    bindNetworkStatus();
    // 先调用原始初始化
    origInit();
    // 后加增强功能
    setTimeout(function () {
      enhanceLoginFormFeatures();
      ensureRememberCheckbox();
      addFloatingBgDecor();
      logRuntimeInfo();
    }, 0);
  };
})();

/* ==================== 全局样式注入 ==================== */

function addGlobalAuthStyles() {
  try {
    var style = document.createElement('style');
    style.textContent =
      '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }' +
      '@keyframes fadeSlideIn { from { opacity:0; transform:translateY(8px);} to {opacity:1; transform:translateY(0);} }' +
      '@keyframes successPop { 0% { transform:scale(0);} 70% { transform:scale(1.1);} 100% { transform:scale(1);} }' +
      '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }' +
      '.toast { position:fixed; bottom:60px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:#fff; padding:10px 20px; border-radius:20px; font-size:13px; z-index:99999; opacity:0; transition:opacity 0.3s; pointer-events:none; max-width:80%; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.3);}' +
      '.toast.show { opacity:1; }' +
      '.toast-success { background:linear-gradient(135deg,#56ab2f,#a8e063); }' +
      '.toast-error { background:linear-gradient(135deg,#ee0979,#ff6a00); }' +
      '.toast-info { background:rgba(0,0,0,0.82); }' +
      '.auth-field input:focus { outline:none; border-color:#ff6b6b; box-shadow:0 0 0 3px rgba(255,107,107,0.12);}' +
      '.auth-submit-btn:disabled { opacity:0.6; cursor:not-allowed; }' +
      '#login-form, #register-form { animation: fadeSlideIn 0.35s ease; }';
    document.head.appendChild(style);
  } catch (e) { }
}

/* ==================== 额外：本地存储清理与兼容 ==================== */

/**
 * 修复旧版本 localStorage 字段不兼容问题
 */
function fixLegacyStorage() {
  try {
    var oldKeys = ['token', 'user', 'yiyutoken', 'yiyu-user'];
    var mapped = [
      { old: 'token', new: 'yiyu_token' },
      { old: 'user', new: 'yiyu_user' },
      { old: 'yiyutoken', new: 'yiyu_token' }
    ];
    for (var i = 0; i < mapped.length; i++) {
      var ov = localStorage.getItem(mapped[i].old);
      if (ov && !localStorage.getItem(mapped[i]['new'])) {
        localStorage.setItem(mapped[i]['new'], ov);
      }
    }
    // 清理损坏数据
    var corrupted = localStorage.getItem('yiyu_user');
    if (corrupted) {
      try { JSON.parse(corrupted); } catch (e) {
        localStorage.removeItem('yiyu_user');
      }
    }
  } catch (e) { }
}

fixLegacyStorage();

/* ==================== DOMContentLoaded 入口 ==================== */

document.addEventListener('DOMContentLoaded', initAuthPage);

/* ==================== 文件结束 ==================== */
