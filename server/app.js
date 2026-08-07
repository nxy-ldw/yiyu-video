const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('./db');

db.initDB();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ============== 默认数据源 ==============
const DEFAULT_SOURCES = [
  { key: 'ffzy', name: '非凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8/', playFrom: 'ffm3u8', enabled: true },
  { key: 'lzi', name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8/', playFrom: 'lzm3u8', enabled: true },
  { key: 'bfzy', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod/from/bfzym3u8/', playFrom: 'bfzym3u8', enabled: true }
];

function getSources() {
  const custom = db.readJSON('sources', null);
  if (custom && Array.isArray(custom) && custom.length > 0) {
    return custom;
  }
  // 初始化默认
  db.writeJSON('sources', DEFAULT_SOURCES);
  return DEFAULT_SOURCES;
}

function getEnabledSources() {
  return getSources().filter(s => s.enabled !== false);
}

function getSourceMap() {
  const map = {};
  getSources().forEach(s => { map[s.key] = s; });
  return map;
}

// ============== 基础工具 ==============
function fetchUrl(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json,text/html,*/*' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function buildSourceUrl(sourceKey, params) {
  const source = getSourceMap()[sourceKey];
  if (!source) return null;
  const qs = new URLSearchParams(params).toString();
  return source.api + (qs ? '?' + qs : '');
}

function logOperation(action, user, ip) {
  const logs = db.readJSON('operationLogs', []);
  logs.unshift({ id: db.genToken(), action, user: user || '系统', ip: ip || '', time: new Date().toISOString() });
  if (logs.length > 1000) logs.length = 1000;
  db.writeJSON('operationLogs', logs);
}

function logRegistration(userId, username, phone, ip) {
  const logs = db.readJSON('registrationLogs', []);
  logs.unshift({ id: db.genToken(), userId, username, phone, ip: ip || '', time: new Date().toISOString() });
  if (logs.length > 1000) logs.length = 1000;
  db.writeJSON('registrationLogs', logs);
}

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ code: 401, message: '请先登录' });
  const sessions = db.readJSON('sessions', []);
  const session = sessions.find(s => s.token === token);
  if (!session) return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === session.userId);
  if (!user) return res.status(401).json({ code: 401, message: '用户不存在' });
  if (user.isBanned) return res.status(403).json({ code: 403, message: '账号已被封禁' });
  req.user = user;
  next();
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ code: 403, message: '无管理员权限' });
    next();
  });
}

function getIP(req) {
  return req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || (req.connection && req.connection.remoteAddress) || '';
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

// ============== VIP 真实活跃判定（解决后台和前端显示不一致的问题） ==============
// 规则：
//  - isVip=true 且 vipExpireAt 为空/null/undefined → 永久VIP（有效）
//  - isVip=true 且 vipExpireAt 有值 → 还未过期才算
//  - 其他情况：非VIP
function isVipActive(user) {
  if (!user || !user.isVip) return false;
  if (!user.vipExpireAt) return true;
  const exp = new Date(user.vipExpireAt).getTime();
  if (isNaN(exp)) return true;
  return exp > Date.now();
}
// 计算VIP剩余天数
function vipDaysLeft(user) {
  if (!user || !user.isVip) return 0;
  if (!user.vipExpireAt) return -1; // -1代表永久
  const ms = new Date(user.vipExpireAt).getTime() - Date.now();
  if (isNaN(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}
// 统一用户输出：保证 level 是数字、VIP判定前后台一致
function normalizeLevel(lv) {
  if (typeof lv === 'number' && !isNaN(lv) && lv > 0) return Math.floor(lv);
  const n = parseInt(lv, 10);
  if (!isNaN(n) && n > 0) return n;
  return 1;
}
function sanitizeUser(user, { withSensitive = false } = {}) {
  if (!user) return null;
  // 修复老用户 'normal' 字符串 / null / 其他脏值 的等级问题
  if (typeof user.level !== 'number' || isNaN(user.level) || user.level < 1) {
    user.level = normalizeLevel(user.level);
  }
  const vipActive = isVipActive(user);
  const vipDays = vipDaysLeft(user);
  const base = {
    id: user.id,
    username: user.username || '',
    phone: user.phone || '',
    qq: user.qq || '',
    avatar: user.avatar || '',
    nickname: user.nickname || '',
    level: normalizeLevel(user.level),
    levelLabel: levelToLabel(user.level, !!user.isAdmin),
    isVip: !!user.isVip,
    vipExpireAt: user.vipExpireAt || null,
    vipLevel: parseInt(user.vipLevel, 10) || 0,
    // ⭐ 新增：真实VIP活跃状态 & 剩余天数 → 前端和后台统一显示
    vipActive: vipActive,
    vipDaysLeft: vipDays,
    isAdmin: !!user.isAdmin,
    isBanned: !!user.isBanned,
    lastEditProfileAt: user.lastEditProfileAt || null,
    createdAt: user.createdAt || null
  };
  if (withSensitive) return base;
  return base;
}
function levelToLabel(lv, isAdmin) {
  const n = normalizeLevel(lv);
  if (isAdmin || n >= 99) return 'Lv.99 超级管理员';
  const map = {
    1: 'Lv.1 普通用户',
    2: 'Lv.2 青铜会员',
    3: 'Lv.3 白银会员',
    4: 'Lv.4 黄金会员',
    5: 'Lv.5 铂金会员',
    6: 'Lv.6 钻石会员'
  };
  if (map[n]) return map[n];
  if (n >= 7 && n <= 98) return 'Lv.' + n + ' 资深会员';
  return 'Lv.1 普通用户';
}

// ============== 状态接口 ==============
app.get('/api/status', (req, res) => {
  const settings = db.readJSON('settings', {});
  res.json({ code: 0, data: {
    maintenance: settings.maintenanceMode || false,
    appName: settings.appName || '一屿视频',
    appVersion: settings.appVersion || '4.4.0',
    author: '一屿'
  }});
});

// ============== 广告接口（首页Banner、我的页面广告） ==============
app.get('/api/ads/banner', (req, res) => {
  const ads = db.readJSON('ads', {});
  const banners = (ads.banners || []).filter(b => b.active !== false);
  res.json({ code: 0, data: banners });
});

app.get('/api/ads/mine', (req, res) => {
  const ads = db.readJSON('ads', {});
  res.json({ code: 0, data: ads.mineAd || { title: '', content: '', image: '', link: '', active: false } });
});

// ============== 认证接口 ==============
app.post('/api/auth/register', (req, res) => {
  const { username, phone, qq, password, confirmPassword } = req.body;
  if (!username || !phone || !qq || !password) {
    return res.json({ code: 1, message: '请填写所有必填字段' });
  }
  if (password !== confirmPassword) return res.json({ code: 1, message: '两次密码不一致' });
  if (password.length < 6) return res.json({ code: 1, message: '密码至少6位' });
  if (!/^1[3-9]\d{9}$/.test(phone)) return res.json({ code: 1, message: '手机号格式不正确' });
  if (username.length < 2) return res.json({ code: 1, message: '用户名至少2位' });

  const users = db.readJSON('users', []);
  if (users.some(u => u.username === username)) return res.json({ code: 1, message: '用户名已存在' });
  if (users.some(u => u.phone === phone)) return res.json({ code: 1, message: '手机号已注册' });

  const settings = db.readJSON('settings', {});
  if (settings.allowRegistration === false) return res.json({ code: 1, message: '管理员已关闭注册' });

  const newUser = {
    id: db.genToken(),
    username, phone, qq,
    password: db.hashPassword(password),
    avatar: '',
    level: 1,
    isVip: false,
    vipExpireAt: null,
    vipLevel: 0,
    nickname: null,
    isAdmin: false,
    isBanned: false,
    lastEditProfileAt: null,
    history: [],
    favorites: [],
    downloads: [],
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  // 直接规范化一次（写回持久化）避免读取时仍为脏数据
  newUser.level = normalizeLevel(newUser.level);
  db.writeJSON('users', users);

  logRegistration(newUser.id, username, phone, getIP(req));

  const token = db.genToken();
  const sessions = db.readJSON('sessions', []);
  sessions.push({ token, userId: newUser.id, createdAt: new Date().toISOString() });
  db.writeJSON('sessions', sessions);

  logOperation('用户注册', username, getIP(req));

  const sUser = sanitizeUser(newUser);
  res.json({
    code: 0, message: '注册成功',
    data: {
      token,
      user: sUser
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { account, password } = req.body;
  if (!account || !password) return res.json({ code: 1, message: '请输入账号和密码' });
  const users = db.readJSON('users', []);
  const user = users.find(u => u.username === account || u.phone === account);
  if (!user) return res.json({ code: 1, message: '账号不存在' });
  if (user.isBanned) return res.json({ code: 1, message: '账号已被封禁，请联系管理员' });
  if (!db.verifyPassword(password, user.password)) return res.json({ code: 1, message: '密码错误' });

  // 兼容老用户: level字符串/异常值 -> 规范化并回写
  let needWriteBack = false;
  if (typeof user.level !== 'number' || isNaN(user.level) || user.level < 1) {
    user.level = normalizeLevel(user.level);
    needWriteBack = true;
  }
  if (needWriteBack) db.writeJSON('users', users);

  const token = db.genToken();
  const sessions = db.readJSON('sessions', []);
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  db.writeJSON('sessions', sessions);

  logOperation('用户登录', user.username, getIP(req));

  res.json({
    code: 0, message: '登录成功',
    data: {
      token,
      user: sanitizeUser(user)
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  let sessions = db.readJSON('sessions', []);
  sessions = sessions.filter(s => s.token !== token);
  db.writeJSON('sessions', sessions);
  res.json({ code: 0, message: '已退出登录' });
});

// ============== 注销账号（用户自己删除自己） ==============
app.delete('/api/auth/me', authMiddleware, (req, res) => {
  if (req.user.isAdmin) {
    return res.json({ code: 1, message: '管理员账号不允许注销，请联系其他管理员操作' });
  }
  const { confirmUsername } = req.body || {};
  if (confirmUsername && String(confirmUsername).trim() !== String(req.user.username || '')) {
    return res.json({ code: 1, message: '确认用户名不匹配' });
  }
  const uid = req.user.id;
  const uname = req.user.username;

  let users = db.readJSON('users', []);
  users = users.filter(u => u.id !== uid);
  db.writeJSON('users', users);

  // 清除该用户所有 session
  let sessions = db.readJSON('sessions', []);
  sessions = sessions.filter(s => s.userId !== uid);
  db.writeJSON('sessions', sessions);

  logOperation(`用户自行注销账号 ${uname}`, uname, getIP(req));
  res.json({ code: 0, message: '账号已注销，所有数据已清除。期待您再次光临！' });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    code: 0,
    data: sanitizeUser(req.user)
  });
});

// ============== 用户资料编辑（30天冷却，VIP无冷却） ==============
app.put('/api/user/profile', authMiddleware, (req, res) => {
  const { username, avatar } = req.body;
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });

  // 检查冷却时间
  const isVip = !!user.isVip;
  const lastEdit = user.lastEditProfileAt ? new Date(user.lastEditProfileAt) : null;
  const now = new Date();
  if (!isVip && lastEdit) {
    const diffDays = (now - lastEdit) / (1000 * 60 * 60 * 24);
    if (diffDays < 30) {
      const remain = Math.ceil(30 - diffDays);
      return res.json({ code: 1, message: `修改资料冷却中，还需 ${remain} 天（VIP无冷却）` });
    }
  }

  let changed = false;
  if (username !== undefined && username !== user.username) {
    if (username.length < 2) return res.json({ code: 1, message: '用户名至少2位' });
    if (users.some(u => u.id !== user.id && u.username === username)) {
      return res.json({ code: 1, message: '用户名已被使用' });
    }
    user.username = username;
    changed = true;
  }
  if (avatar !== undefined) {
    user.avatar = avatar || '';
    changed = true;
  }

  if (changed) {
    user.lastEditProfileAt = new Date().toISOString();
    db.writeJSON('users', users);
    logOperation('修改个人资料', user.username, getIP(req));
  }

  res.json({
    code: 0, message: '修改成功',
    data: sanitizeUser(user)
  });
});

// ============== 用户历史、收藏、下载 ==============
// 历史记录接口 ⭐ 增加 list+total 格式，并兼容老的 req.user.history 为空数组不返回data情况
app.get('/api/user/history', authMiddleware, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const list = Array.isArray(req.user.history) ? req.user.history : [];
  const total = list.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  const start = (p - 1) * lim;
  // 前端 app.js 既接受 res.data=数组 也接受 res.data={list,total,page} → 统一返回富对象
  res.json({
    code: 0,
    data: {
      list: list.slice(start, start + lim),
      total: total,
      page: p,
      limit: lim
    }
  });
});

// 单条删除历史: DELETE /api/user/history/:id
app.delete('/api/user/history/:recordId', authMiddleware, (req, res) => {
  const rid = req.params.recordId;
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (!user.history) user.history = [];
  const before = user.history.length;
  user.history = user.history.filter(h => {
    const hId = h.id || h.recordId || (h.sourceKey + '_' + h.vodId + '_' + (h.episodeIndex || 0));
    return String(hId) !== String(rid);
  });
  const changed = user.history.length !== before;
  if (changed) db.writeJSON('users', users);
  res.json({ code: 0, message: changed ? '已删除该条历史' : '未找到该记录', removed: changed });
});

app.post('/api/user/history', authMiddleware, (req, res) => {
  const { vodId, sourceKey, title, cover, episode, episodeName, lineName, episodeIndex, progress } = req.body;
  if (!vodId || !sourceKey) return res.json({ code: 1, message: '参数缺失' });
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (!user.history) user.history = [];
  const rid = sourceKey + '_' + vodId + '_' + (typeof episodeIndex === 'number' ? episodeIndex : 0);
  // 去重并置顶
  user.history = user.history.filter(h => {
    const hId = h.id || h.recordId || (h.sourceKey + '_' + h.vodId + '_' + (h.episodeIndex || 0));
    return String(hId) !== String(rid);
  });
  user.history.unshift({
    id: rid,
    recordId: rid,
    vodId, sourceKey,
    title: title || '',
    cover: cover || '',
    episode: episode || episodeName || '',
    episodeIndex: typeof episodeIndex === 'number' ? episodeIndex : 0,
    episodeName: episodeName || '',
    lineName: lineName || '',
    progress: Math.max(0, Math.min(100, parseFloat(progress) || 0)),
    watchedAt: new Date().toISOString()
  });
  if (user.history.length > 500) user.history.length = 500;
  db.writeJSON('users', users);
  res.json({ code: 0, message: '已记录观看历史', data: { id: rid } });
});

app.delete('/api/user/history', authMiddleware, (req, res) => {
  const { vodId, sourceKey } = req.query;
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (vodId && sourceKey) {
    user.history = (user.history || []).filter(h => !(h.vodId === vodId && h.sourceKey === sourceKey));
  } else {
    user.history = [];
  }
  db.writeJSON('users', users);
  res.json({ code: 0, message: '已删除历史记录' });
});

app.get('/api/user/favorites', authMiddleware, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const list = Array.isArray(req.user.favorites) ? req.user.favorites : [];
  const total = list.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  const start = (p - 1) * lim;
  res.json({
    code: 0,
    data: {
      list: list.slice(start, start + lim),
      total: total,
      page: p,
      limit: lim
    }
  });
});

app.post('/api/user/favorites', authMiddleware, (req, res) => {
  const { vodId, sourceKey, title, cover, remarks } = req.body;
  if (!vodId || !sourceKey) return res.json({ code: 1, message: '参数缺失' });
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (!user.favorites) user.favorites = [];
  const exists = user.favorites.find(f => f.vodId === vodId && f.sourceKey === sourceKey);
  if (exists) return res.json({ code: 1, message: '已收藏过了' });
  user.favorites.unshift({
    vodId, sourceKey, title: title || '', cover: cover || '',
    remarks: remarks || '', addedAt: new Date().toISOString()
  });
  db.writeJSON('users', users);
  logOperation('添加收藏', user.username, getIP(req));
  res.json({ code: 0, message: '收藏成功' });
});

app.delete('/api/user/favorites', authMiddleware, (req, res) => {
  // 兼容 query (?vodId=&sourceKey=) 和 body {vodId,sourceKey} 两种传参
  const vodId = (req.query && req.query.vodId) || (req.body && req.body.vodId);
  const sourceKey = (req.query && req.query.sourceKey) || (req.body && req.body.sourceKey);
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (vodId && sourceKey) {
    user.favorites = (user.favorites || []).filter(f => !(f.vodId === vodId && f.sourceKey === sourceKey));
  } else {
    user.favorites = [];
  }
  db.writeJSON('users', users);
  res.json({ code: 0, message: '已取消收藏' });
});

app.get('/api/user/downloads', authMiddleware, (req, res) => {
  res.json({ code: 0, data: req.user.downloads || [] });
});

app.post('/api/user/downloads', authMiddleware, (req, res) => {
  const { vodId, sourceKey, title, cover, episode, url } = req.body;
  if (!vodId || !sourceKey) return res.json({ code: 1, message: '参数缺失' });
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (!user.downloads) user.downloads = [];
  user.downloads.unshift({
    vodId, sourceKey, title: title || '', cover: cover || '',
    episode: episode || '', url: url || '',
    status: 'completed', addedAt: new Date().toISOString()
  });
  db.writeJSON('users', users);
  res.json({ code: 0, message: '已记录下载' });
});

app.delete('/api/user/downloads/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (id === 'all') {
    user.downloads = [];
  } else {
    user.downloads = (user.downloads || []).filter(d => d.vodId !== id);
  }
  db.writeJSON('users', users);
  res.json({ code: 0, message: '已删除' });
});

// ============== 公告 ==============
app.get('/api/announcements/home', (req, res) => {
  const ann = db.readJSON('announcements', {});
  res.json({ code: 0, data: ann.home || { content: '', active: false } });
});

app.get('/api/announcements/login', (req, res) => {
  const ann = db.readJSON('announcements', {});
  res.json({ code: 0, data: ann.login || { content: '', active: false } });
});

// ============== 反馈 ==============
app.post('/api/feedback', authMiddleware, (req, res) => {
  const { content, type, contact } = req.body;
  if (!content || !content.trim()) return res.json({ code: 1, message: '请输入反馈内容' });
  const feedback = db.readJSON('feedback', []);
  feedback.unshift({
    id: db.genToken(), userId: req.user.id, username: req.user.username,
    content: content.trim(), type: type || '功能反馈',
    contact: contact || '', status: 'pending', reply: '',
    createdAt: new Date().toISOString()
  });
  db.writeJSON('feedback', feedback);
  logOperation('提交反馈', req.user.username, getIP(req));
  res.json({ code: 0, message: '反馈已提交，感谢您的支持！' });
});

app.get('/api/feedback/mine', authMiddleware, (req, res) => {
  const feedback = db.readJSON('feedback', []).filter(f => f.userId === req.user.id);
  res.json({ code: 0, data: feedback });
});

// ============== 视频核心接口（用户端不暴露数据源） ==============
function mapVodItem(v, sourceKey) {
  return {
    id: v.vod_id, sourceKey,
    title: v.vod_name || '',
    cover: v.vod_pic || '',
    remarks: v.vod_remarks || '',
    category: v.type_name || '',
    year: v.vod_year || '',
    area: v.vod_area || '',
    actor: v.vod_actor || '',
    director: v.vod_director || '',
    score: v.vod_score || '',
    lang: v.vod_lang || '',
    content: v.vod_content || v.vod_blurb || ''
  };
}

// 多源聚合列表
async function fetchAggregatedList(params) {
  const sources = getEnabledSources();
  const { t = '', pg = 1, wd = '', className = '', area = '', year = '', order = '' } = params;
  const all = [];
  const errors = [];
  await Promise.all(sources.map(async (source) => {
    try {
      const q = { ac: 'detail', pg: String(pg) };
      if (t) q.t = t;
      if (wd) q.wd = wd;
      if (className) q.class = className;
      if (area) q.area = area;
      if (year) q.year = year;
      if (order) q.order = order;
      const r = await fetchUrl(buildSourceUrl(source.key, q), 12000);
      const json = JSON.parse(r.body);
      (json.list || []).forEach(v => all.push(mapVodItem(v, source.key)));
    } catch (e) { errors.push(`${source.name}: ${e.message}`); }
  }));
  // 去重
  const seen = new Set();
  const dedup = all.filter(v => {
    const key = v.title + '_' + (v.year || '') + '_' + (v.category || '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return { list: dedup, errors };
}

// 首页各栏目数据
app.get('/api/home/sections', async (req, res) => {
  try {
    const sources = getEnabledSources();
    const sections = {};

    // 辅助：取某分类列表
    const fetchByType = async (typeIds, limit = 12) => {
      let list = [];
      for (const source of sources) {
        for (const tid of typeIds) {
          try {
            if (list.length >= limit) break;
            const r = await fetchUrl(buildSourceUrl(source.key, { ac: 'detail', t: String(tid), pg: '1', h: '24' }), 10000);
            const json = JSON.parse(r.body);
            (json.list || []).forEach(v => {
              if (list.length < limit) list.push(mapVodItem(v, source.key));
            });
          } catch (e) {}
        }
        if (list.length >= limit) break;
      }
      // 去重
      const seen = new Set();
      return list.filter(v => {
        const k = v.title + '_' + (v.year || '');
        if (seen.has(k)) return false; seen.add(k); return true;
      }).slice(0, limit);
    };

    // 推荐新剧（综合最新）
    let newest = [];
    for (const source of sources) {
      try {
        const r = await fetchUrl(buildSourceUrl(source.key, { ac: 'detail', pg: '1', h: '24' }), 10000);
        const json = JSON.parse(r.body);
        (json.list || []).slice(0, 18).forEach(v => newest.push(mapVodItem(v, source.key)));
      } catch (e) {}
    }
    const s1 = new Set();
    sections.newRecommend = newest.filter(v => { const k = v.title; if (s1.has(k)) return false; s1.add(k); return true; }).slice(0, 12);

    // 国外热映（area 过滤）
    let foreign = [];
    for (const source of sources) {
      try {
        const r = await fetchUrl(buildSourceUrl(source.key, { ac: 'detail', pg: '1' }), 10000);
        const json = JSON.parse(r.body);
        (json.list || []).forEach(v => {
          const item = mapVodItem(v, source.key);
          const ar = (item.area || '');
          if (ar.includes('美国') || ar.includes('韩国') || ar.includes('日本') || ar.includes('欧美') || ar.includes('英国') || ar.includes('泰国')) {
            foreign.push(item);
          }
        });
      } catch (e) {}
    }
    const s2 = new Set();
    sections.foreignHot = foreign.filter(v => { const k = v.title; if (s2.has(k)) return false; s2.add(k); return true; }).slice(0, 12);

    // 电视剧（国产剧 + 港台剧）
    sections.tvDramas = await fetchByType(['4', '11', '12', '13', '14'], 12);
    // 电影
    sections.movies = await fetchByType(['1', '2', '3', '5', '6', '7', '8', '9', '10'], 12);
    // 综艺
    sections.variety = await fetchByType(['19', '20'], 12);
    // 动漫
    sections.anime = await fetchByType(['21', '22', '23', '24', '25', '26'], 12);

    res.json({ code: 0, data: sections });
  } catch (e) {
    res.json({ code: 1, message: e.message, data: {} });
  }
});

// 排行榜
app.get('/api/rankings', async (req, res) => {
  const { type = 'hot' } = req.query;
  const sources = getEnabledSources();
  let list = [];
  const orderMap = {
    hot: 'vod_hits',       // 热播榜
    soar: 'vod_hits_day',  // 飙升榜
    search: 'vod_hits_week', // 热搜榜（近似用周点击）
    new: 'vod_addtime',    // 新片榜
    tv: '',                // 电视剧榜
    movie: '',             // 电影榜
    anime: ''              // 动漫榜
  };

  // 不同类型的分类ID
  const typeMap = {
    tv: ['4', '11', '12', '13', '14'],
    movie: ['1', '2', '3', '5', '6', '7', '8', '9', '10'],
    anime: ['21', '22', '23', '24', '25', '26']
  };

  try {
    for (const source of sources) {
      try {
        let params = { ac: 'detail', pg: '1' };
        const order = orderMap[type];
        if (order && (type === 'hot' || type === 'soar' || type === 'search' || type === 'new')) {
          params.order = order;
        }
        // 具体榜分类
        const tids = typeMap[type];
        if (tids) {
          for (const tid of tids) {
            try {
              params.t = tid;
              const r = await fetchUrl(buildSourceUrl(source.key, params), 10000);
              const json = JSON.parse(r.body);
              (json.list || []).slice(0, 15).forEach(v => list.push(mapVodItem(v, source.key)));
            } catch (e) {}
          }
        } else {
          const r = await fetchUrl(buildSourceUrl(source.key, params), 10000);
          const json = JSON.parse(r.body);
          (json.list || []).slice(0, 15).forEach(v => list.push(mapVodItem(v, source.key)));
        }
      } catch (e) {}
    }
    const seen = new Set();
    list = list.filter(v => {
      const k = v.title + '_' + (v.year || '');
      if (seen.has(k)) return false; seen.add(k); return true;
    }).slice(0, 30);
    res.json({ code: 0, data: list });
  } catch (e) { res.json({ code: 1, message: e.message, data: [] }); }
});

// 筛选接口
const FILTER_CATEGORIES = [
  { key: 'all', name: '全部', ids: [] },
  { key: 'drama', name: '连续剧', ids: ['4', '11', '12', '13', '14'] },
  { key: 'movie', name: '电影', ids: ['1', '2', '3', '5', '6', '7', '8', '9', '10'] },
  { key: 'variety', name: '综艺', ids: ['19', '20'] },
  { key: 'anime', name: '动漫', ids: ['21', '22', '23', '24', '25', '26'] },
  { key: 'short', name: '短剧', ids: ['30', '31'] }
];

const FILTER_GENRES = ['全部', '爱情', '喜剧', '悬疑', '犯罪', '古装', '动作', '科幻', '恐怖', '剧情', '战争', '家庭', '奇幻', '动画', '武侠', '历史', '惊悚', '冒险'];
const FILTER_AREAS = ['全部', '内地', '香港', '台湾', '美国', '韩国', '日本', '欧美', '英国', '泰国', '印度', '其他'];
const FILTER_YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2010-2017', '2000-2009', '更早'];
const FILTER_SORTS = [
  { key: 'hot', name: '最热' },
  { key: 'score', name: '评分' },
  { key: 'new', name: '最新上线' }
];

app.get('/api/filter/options', (req, res) => {
  res.json({
    code: 0, data: {
      categories: FILTER_CATEGORIES,
      genres: FILTER_GENRES,
      areas: FILTER_AREAS,
      years: FILTER_YEARS,
      sorts: FILTER_SORTS
    }
  });
});

app.get('/api/filter', async (req, res) => {
  const { category = 'all', genre = '全部', area = '全部', year = '全部', sort = 'hot', pg = 1 } = req.query;
  try {
    const sources = getEnabledSources();
    const cat = FILTER_CATEGORIES.find(c => c.key === category) || FILTER_CATEGORIES[0];
    let list = [];
    const sortOrder = { hot: 'vod_hits', score: 'vod_score', new: 'vod_addtime' }[sort] || 'vod_hits';

    const params = { ac: 'detail', pg: String(pg), order: sortOrder };
    if (genre && genre !== '全部') params.class = genre;
    if (area && area !== '全部') params.area = area;
    if (year && year !== '全部') {
      if (year.includes('-')) {
        const [s, e] = year.split('-');
        params.year = s + '-' + e;
      } else if (year === '更早') {
        params.year = '0-2000';
      } else {
        params.year = year;
      }
    }

    if (cat.ids.length === 0) {
      // 全部：拉取默认
      for (const source of sources) {
        try {
          const r = await fetchUrl(buildSourceUrl(source.key, params), 10000);
          const json = JSON.parse(r.body);
          (json.list || []).forEach(v => list.push(mapVodItem(v, source.key)));
        } catch (e) {}
      }
    } else {
      for (const tid of cat.ids) {
        for (const source of sources) {
          try {
            const p = { ...params, t: String(tid) };
            const r = await fetchUrl(buildSourceUrl(source.key, p), 10000);
            const json = JSON.parse(r.body);
            (json.list || []).forEach(v => list.push(mapVodItem(v, source.key)));
          } catch (e) {}
        }
      }
    }
    const seen = new Set();
    list = list.filter(v => {
      const k = v.title + '_' + (v.year || '');
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    res.json({ code: 0, data: { list, page: parseInt(pg) } });
  } catch (e) { res.json({ code: 1, message: e.message, data: { list: [] } }); }
});

// 搜索
app.get('/api/search', async (req, res) => {
  const { wd, pg = 1 } = req.query;
  if (!wd) return res.json({ code: 1, message: '请输入搜索关键词', data: { list: [] } });
  const result = await fetchAggregatedList({ wd, pg });
  res.json({ code: 0, data: { list: result.list, total: result.list.length, errors: result.errors } });
});

// 详情
function parsePlayUrl(playFrom, playUrl) {
  if (!playUrl) return [];
  const fromList = (playFrom || '').split('$$$');
  const urlGroups = playUrl.split('$$$');
  return fromList.map((fromName, idx) => {
    const groupUrl = urlGroups[idx] || '';
    const episodes = groupUrl.split('#').filter(s => s).map(ep => {
      const parts = ep.split('$');
      return { name: parts[0] || '第1集', url: parts[1] || parts[0] };
    }).filter(ep => ep.url);
    return { lineName: fromName || ('线路' + (idx + 1)), episodes };
  }).filter(g => g.episodes.length > 0);
}

app.get('/api/detail', async (req, res) => {
  const { source, id } = req.query;
  if (!id) return res.json({ code: 1, message: '缺少视频ID', data: null });
  const sourceKey = source || 'ffzy';
  try {
    const r = await fetchUrl(buildSourceUrl(sourceKey, { ac: 'detail', ids: String(id) }));
    const json = JSON.parse(r.body);
    const v = (json.list || [])[0];
    if (!v) return res.json({ code: 404, message: '视频不存在', data: null });
    res.json({
      code: 0,
      data: {
        id: v.vod_id, sourceKey, title: v.vod_name || '', sub: v.vod_sub || '',
        cover: v.vod_pic || '', remarks: v.vod_remarks || '', category: v.type_name || '',
        year: v.vod_year || '', area: v.vod_area || '', lang: v.vod_lang || '',
        actor: v.vod_actor || '', director: v.vod_director || '', score: v.vod_score || '',
        content: v.vod_content || v.vod_blurb || '',
        playLines: parsePlayUrl(v.vod_play_from, v.vod_play_url)
      }
    });
  } catch (e) { res.json({ code: 1, message: e.message, data: null }); }
});

// ============== 管理员：数据源管理 ==============
app.get('/api/admin/sources', adminMiddleware, (req, res) => {
  res.json({ code: 0, data: getSources() });
});

app.put('/api/admin/sources', adminMiddleware, (req, res) => {
  const { sources } = req.body;
  if (!Array.isArray(sources)) return res.json({ code: 1, message: '参数错误' });
  db.writeJSON('sources', sources);
  logOperation('更新数据源配置', req.user.username, getIP(req));
  res.json({ code: 0, message: '数据源已更新', data: getSources() });
});

// ============== 管理员：广告管理 ==============
app.get('/api/admin/ads', adminMiddleware, (req, res) => {
  res.json({ code: 0, data: db.readJSON('ads', { banners: [], mineAd: {} }) });
});

app.put('/api/admin/ads/banners', adminMiddleware, (req, res) => {
  const { banners } = req.body;
  const ads = db.readJSON('ads', { banners: [], mineAd: {} });
  ads.banners = Array.isArray(banners) ? banners : [];
  db.writeJSON('ads', ads);
  logOperation('更新Banner广告', req.user.username, getIP(req));
  res.json({ code: 0, message: 'Banner广告已更新' });
});

app.put('/api/admin/ads/mine', adminMiddleware, (req, res) => {
  const { mineAd } = req.body;
  const ads = db.readJSON('ads', { banners: [], mineAd: {} });
  ads.mineAd = mineAd || {};
  db.writeJSON('ads', ads);
  logOperation('更新我的页面广告', req.user.username, getIP(req));
  res.json({ code: 0, message: '广告已更新' });
});

// ============== 管理员：仪表盘 ==============
app.get('/api/admin/dashboard', adminMiddleware, (req, res) => {
  const users = db.readJSON('users', []);
  const feedback = db.readJSON('feedback', []);
  const opLogs = db.readJSON('operationLogs', []);
  const regLogs = db.readJSON('registrationLogs', []);
  res.json({
    code: 0, data: {
      totalUsers: users.filter(u => !u.isAdmin).length,
      totalAdmins: users.filter(u => u.isAdmin).length,
      vipUsers: users.filter(u => u.isVip).length,
      bannedUsers: users.filter(u => u.isBanned).length,
      pendingFeedback: feedback.filter(f => f.status === 'pending').length,
      totalFeedback: feedback.length,
      todayLogins: opLogs.filter(l => l.action === '用户登录' && isToday(l.time)).length,
      todayRegistrations: regLogs.filter(l => isToday(l.time)).length,
      recentLogs: opLogs.slice(0, 10),
      recentRegistrations: regLogs.slice(0, 10)
    }
  });
});

// ============== 管理员：用户管理 ==============
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const { keyword, page = 1, limit = 20 } = req.query;
  let users = db.readJSON('users', []).filter(u => !u.isAdmin);
  if (keyword) {
    const kw = keyword.toLowerCase();
    users = users.filter(u => (u.username || '').toLowerCase().includes(kw) || (u.phone || '').includes(kw) || (u.qq || '').includes(kw));
  }
  const total = users.length;
  const start = (page - 1) * limit;
  const list = users.slice(start, start + parseInt(limit)).map(u => ({
    id: u.id, username: u.username, phone: u.phone, qq: u.qq,
    level: u.level, isVip: !!u.isVip, vipExpireAt: u.vipExpireAt,
    isBanned: u.isBanned, createdAt: u.createdAt
  }));
  res.json({ code: 0, data: { list, total, page: parseInt(page), limit: parseInt(limit) } });
});

app.put('/api/admin/users/:id', adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { phone, qq, level, isVip, vipExpireAt, password, isBanned, isAdmin, nickname, vipLevel } = req.body;
  const users = db.readJSON('users', []);
  const user = users.find(u => u.id === id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });

  const changes = [];
  const setField = (name, val, label) => {
    if (val !== undefined && user[name] !== val) {
      user[name] = val;
      changes.push(label + '=' + (typeof val === 'boolean' ? (val ? '是' : '否') : String(val || '-').slice(0, 24)));
    }
  };

  if (phone !== undefined) {
    const p = (phone || '').toString().trim();
    if (p && !/^[0-9\-+ ]{5,20}$/.test(p)) return res.json({ code: 1, message: '手机号格式不正确（5-20位数字或+ - 空格）' });
    setField('phone', p || null, '手机号');
  }
  if (qq !== undefined) {
    const q = (qq || '').toString().trim();
    if (q && !/^[1-9][0-9]{4,14}$/.test(q)) return res.json({ code: 1, message: 'QQ号格式不正确（5-15位数字，首字符非0）' });
    setField('qq', q || null, 'QQ号');
  }
  if (level !== undefined) {
    const lv = Math.max(1, Math.min(99, parseInt(level, 10) || 1));
    setField('level', lv, '等级');
  }
  if (nickname !== undefined) {
    setField('nickname', (nickname || '').toString().trim() || null, '昵称');
  }
  if (vipLevel !== undefined) {
    const vl = Math.max(0, Math.min(9, parseInt(vipLevel, 10) || 0));
    setField('vipLevel', vl, 'VIP等级');
  }
  if (isVip !== undefined) {
    const v = !!isVip;
    if (!v && user.vipExpireAt) user.vipExpireAt = null;
    setField('isVip', v, 'VIP会员');
  }
  if (vipExpireAt !== undefined) {
    let t = null;
    if (vipExpireAt) {
      const d = new Date(vipExpireAt);
      if (isNaN(d.getTime())) return res.json({ code: 1, message: 'VIP到期时间格式不正确' });
      t = d.toISOString();
    }
    if (t && user.isVip === false) user.isVip = true;
    setField('vipExpireAt', t, 'VIP到期');
  }
  if (isBanned !== undefined) setField('isBanned', !!isBanned, '封禁状态');
  if (isAdmin !== undefined && user.id !== req.user.id) {
    setField('isAdmin', !!isAdmin, '管理员权限');
    if (isAdmin) user.level = Math.max(user.level || 1, 99);
  } else if (isAdmin !== undefined && user.id === req.user.id) {
    return res.json({ code: 1, message: '不能修改自己的管理员状态' });
  }
  if (password) {
    const pwd = String(password);
    if (pwd.length < 6) return res.json({ code: 1, message: '新密码长度不能少于6位' });
    user.password = db.hashPassword(pwd);
    changes.push('重置密码');
  }

  db.writeJSON('users', users);
  logOperation(`修改用户 ${user.username}` + (changes.length ? ` 字段[${changes.join(', ')}]` : ''), req.user.username, getIP(req));
  res.json({ code: 0, message: '修改成功', data: { updated: changes.length, fields: changes } });
});

app.delete('/api/admin/users/:id', adminMiddleware, (req, res) => {
  const { id } = req.params;
  let users = db.readJSON('users', []);
  const user = users.find(u => u.id === id);
  if (!user) return res.json({ code: 1, message: '用户不存在' });
  if (user.isAdmin) return res.json({ code: 1, message: '不能删除管理员' });
  users = users.filter(u => u.id !== id);
  db.writeJSON('users', users);
  logOperation(`删除用户 ${user.username}`, req.user.username, getIP(req));
  res.json({ code: 0, message: '删除成功' });
});

// ============== 管理员：反馈 ==============
app.get('/api/admin/feedback', adminMiddleware, (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let feedback = db.readJSON('feedback', []);
  if (status) feedback = feedback.filter(f => f.status === status);
  const total = feedback.length;
  const start = (page - 1) * limit;
  res.json({ code: 0, data: { list: feedback.slice(start, start + parseInt(limit)), total, page: parseInt(page) } });
});

app.put('/api/admin/feedback/:id', adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { status, reply } = req.body;
  const feedback = db.readJSON('feedback', []);
  const item = feedback.find(f => f.id === id);
  if (!item) return res.json({ code: 1, message: '反馈不存在' });
  if (status !== undefined) item.status = status;
  if (reply !== undefined) item.reply = reply;
  db.writeJSON('feedback', feedback);
  logOperation(`处理反馈`, req.user.username, getIP(req));
  res.json({ code: 0, message: '处理成功' });
});

// ============== 管理员：公告 ==============
app.get('/api/admin/announcements', adminMiddleware, (req, res) => {
  res.json({ code: 0, data: db.readJSON('announcements', {}) });
});

app.put('/api/admin/announcements/home', adminMiddleware, (req, res) => {
  const { content, active } = req.body;
  const ann = db.readJSON('announcements', {});
  ann.home = { content: content || '', active: active !== undefined ? active : true };
  db.writeJSON('announcements', ann);
  logOperation('更新首页公告', req.user.username, getIP(req));
  res.json({ code: 0, message: '更新成功' });
});

app.put('/api/admin/announcements/login', adminMiddleware, (req, res) => {
  const { content, active } = req.body;
  const ann = db.readJSON('announcements', {});
  ann.login = { content: content || '', active: active !== undefined ? active : true };
  db.writeJSON('announcements', ann);
  logOperation('更新登录页公告', req.user.username, getIP(req));
  res.json({ code: 0, message: '更新成功' });
});

// ============== 管理员：推送通知 ==============
app.post('/api/admin/push', adminMiddleware, (req, res) => {
  const { title, content } = req.body;
  const ann = db.readJSON('announcements', {});
  if (!ann.push) ann.push = [];
  ann.push.unshift({ id: db.genToken(), title: title || '通知', content: content || '', time: new Date().toISOString() });
  if (ann.push.length > 100) ann.push.length = 100;
  db.writeJSON('announcements', ann);
  logOperation(`推送通知: ${title}`, req.user.username, getIP(req));
  res.json({ code: 0, message: '推送成功' });
});

// ============== 管理员：日志 ==============
app.get('/api/admin/logs/operation', adminMiddleware, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const logs = db.readJSON('operationLogs', []);
  const start = (page - 1) * limit;
  res.json({ code: 0, data: { list: logs.slice(start, start + parseInt(limit)), total: logs.length, page: parseInt(page) } });
});

app.get('/api/admin/logs/registration', adminMiddleware, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const logs = db.readJSON('registrationLogs', []);
  const start = (page - 1) * limit;
  res.json({ code: 0, data: { list: logs.slice(start, start + parseInt(limit)), total: logs.length, page: parseInt(page) } });
});

// ============== 管理员：系统设置 ==============
app.get('/api/admin/settings', adminMiddleware, (req, res) => {
  res.json({ code: 0, data: db.readJSON('settings', {}) });
});

app.put('/api/admin/settings', adminMiddleware, (req, res) => {
  const { maintenanceMode, allowRegistration, appName, appVersion } = req.body;
  const settings = db.readJSON('settings', {});
  if (maintenanceMode !== undefined) settings.maintenanceMode = maintenanceMode;
  if (allowRegistration !== undefined) settings.allowRegistration = allowRegistration;
  if (appName !== undefined) settings.appName = appName;
  if (appVersion !== undefined) settings.appVersion = appVersion;
  db.writeJSON('settings', settings);
  logOperation(`更新系统设置`, req.user.username, getIP(req));
  res.json({ code: 0, message: '设置已更新' });
});

// ============== 管理员：服务器控制 ==============
app.post('/api/admin/server/restart', adminMiddleware, (req, res) => {
  logOperation('重启服务器', req.user.username, getIP(req));
  res.json({ code: 0, message: '服务器正在重启...（Railway将自动重新拉起实例）' });
  setTimeout(() => process.exit(0), 500);
});

app.post('/api/admin/server/stop', adminMiddleware, (req, res) => {
  logOperation('停止服务器', req.user.username, getIP(req));
  res.json({ code: 0, message: '服务器已停止（Railway可能自动重启，请前往Railway控制台关闭服务）' });
  setTimeout(() => process.exit(1), 500);
});

// ============== 静态页 ==============
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ code: 404, message: '接口不存在' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('');
  console.log('   一屿视频 V4.0 服务器启动成功！');
  console.log('   作者：一屿文化工作室');
  console.log('');
  console.log(`   端口: ${PORT}`);
  console.log(`   访问: http://localhost:${PORT}`);
  console.log(`   管理后台: http://localhost:${PORT}/admin`);
  console.log('');
  console.log('   管理员账号: yiyuwenhua');
  console.log('');
  console.log('========================================');
});
