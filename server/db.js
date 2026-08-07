const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(name, defaultVal) {
  const fp = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(fp)) return defaultVal;
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
  catch (e) { return defaultVal; }
}

function writeJSON(name, data) {
  ensureDir();
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === verify;
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function initDB() {
  ensureDir();

  const users = readJSON('users', []);
  const adminExists = users.some(u => u.username === 'yiyuwenhua' && u.isAdmin);
  if (!adminExists) {
    users.push({
      id: genToken(),
      username: 'yiyuwenhua',
      phone: '17712328993',
      qq: '2947543703',
      password: hashPassword('lch20070717'),
      level: 'admin',
      isAdmin: true,
      isBanned: false,
      createdAt: new Date().toISOString()
    });
    writeJSON('users', users);
  }

  const settings = readJSON('settings', null);
  if (!settings) {
    writeJSON('settings', {
      maintenanceMode: false,
      appName: '一屿视频',
      appVersion: '4.3.0',
      appVersionName: 'V4.3',
      appVersionCode: 43,
      appPackageName: 'yiyu-video-v4.3.apk',
      allowRegistration: true
    });
  } else {
    const oldVersions = ['3.0.0', '4.0.0', 'V4.0'];
    if (!settings.appVersion || oldVersions.includes(settings.appVersion)) {
      settings.appVersion = '4.3.0';
    }
    if (!settings.appVersionName || oldVersions.includes(settings.appVersionName)) {
      settings.appVersionName = 'V4.3';
    }
    if (!settings.appVersionCode || Number(settings.appVersionCode) < 43) {
      settings.appVersionCode = 43;
    }
    if (!settings.appPackageName) {
      settings.appPackageName = 'yiyu-video-v4.3.apk';
    }
    writeJSON('settings', settings);
  }

  const announcements = readJSON('announcements', null);
  if (!announcements) {
    writeJSON('announcements', {
      home: { content: '欢迎使用一屿视频，海量影视资源等你发现！', active: true },
      login: { content: '欢迎来到一屿视频，请登录或注册账号', active: true },
      push: []
    });
  }

  readJSON('feedback', []);
  readJSON('operationLogs', []);
  readJSON('registrationLogs', []);
}

module.exports = {
  readJSON,
  writeJSON,
  hashPassword,
  verifyPassword,
  genToken,
  initDB
};
