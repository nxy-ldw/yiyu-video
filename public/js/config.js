/**
 * 一屿视频 - 全局配置
 * 默认服务器地址 - 用户部署到 Railway 后，把下面的URL改成自己的 Railway 地址即可
 * 也可以在 App 内「我的 - 设置」里修改服务器地址
 */

var DEFAULT_SERVER_URL = 'https://yiyu-video-production.up.railway.app';

function getServerUrl() {
  var saved = localStorage.getItem('yiyu_server_url');
  if (saved) {
    return saved.replace(/\/+$/, '');
  }
  return DEFAULT_SERVER_URL;
}

function isServerConfigured() {
  var saved = localStorage.getItem('yiyu_server_url');
  return !!saved || !!DEFAULT_SERVER_URL;
}

function getApiUrl(path) {
  return getServerUrl() + '/api' + path;
}

function setServerUrl(url) {
  if (url) {
    url = url.replace(/\/+$/, '');
    localStorage.setItem('yiyu_server_url', url);
  } else {
    localStorage.removeItem('yiyu_server_url');
  }
}
