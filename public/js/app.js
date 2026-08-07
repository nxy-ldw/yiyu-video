/* ============================================================
 * 一屿视频 app.js - 主应用逻辑
 * 全部使用 ES5 兼容写法（var/function），保证 WebView 兼容
 * ============================================================ */

/* ==================== 公共状态 State ==================== */
var state = {
  currentPage: 'home',
  filter: { category: 'all', genre: '全部', area: '全部', year: '全部', sort: 'hot', pg: 1 },
  rankType: 'hot',
  user: null,
  token: null,
  banners: [],
  bannerIdx: 0,
  bannerTimer: null,
  detail: null,
  detailLineIdx: 0,
  detailEpIdx: 0,
  player: null,
  hls: null,
  playSpeed: 1.0,
  floatingInfo: null,
  searchHistory: [],
  watchedEpisodes: {},
  maintenanceMode: false
};

/* ==================== 公共工具函数 ==================== */

/** Toast 提示：3秒自动消失 */
function showToast(msg, type) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  type = type || 'info';
  toast.textContent = msg;
  toast.className = 'toast show toast-' + type;
  setTimeout(function () {
    toast.className = 'toast';
  }, 3000);
}

/** 页面跳转：home/filter/rank/mine */
function goPage(pageName) {
  switchTab(pageName);
}

/** 检查登录状态，未登录跳转 login.html */
function checkLogin() {
  var token = localStorage.getItem('yiyu_token');
  if (!token) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

/** 获取鉴权 Header */
function getAuthHeader() {
  var token = localStorage.getItem('yiyu_token');
  return { 'Authorization': 'Bearer ' + (token || '') };
}

/** HTML 转义 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

/** 手机号脱敏 131****1234 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || '';
  return phone.substring(0, 3) + '****' + phone.substring(phone.length - 4);
}

/** 格式化日期 */
function formatDate(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 格式化秒数为 MM:SS 或 HH:MM:SS */
function formatTime(sec) {
  sec = Math.floor(sec || 0);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  var mm = String(m).padStart(2, '0');
  var ss = String(s).padStart(2, '0');
  if (h > 0) {
    return String(h).padStart(2, '0') + ':' + mm + ':' + ss;
  }
  return mm + ':' + ss;
}

/** 判断是否为 m3u8 */
function isM3u8(url) {
  return url && /\.m3u8(\?|$)/i.test(url);
}

/** 封装 GET 请求 */
function apiGet(path, callback, onError) {
  var headers = getAuthHeader();
  fetch(getApiUrl(path), { headers: headers })
    .then(function (r) { return r.json(); })
    .then(function (res) { callback && callback(res); })
    .catch(function (e) { onError && onError(e); });
}

/** 封装 POST 请求 */
function apiPost(path, body, callback, onError) {
  var headers = getAuthHeader();
  headers['Content-Type'] = 'application/json';
  fetch(getApiUrl(path), {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body || {})
  })
    .then(function (r) { return r.json(); })
    .then(function (res) { callback && callback(res); })
    .catch(function (e) { onError && onError(e); });
}

/** 封装 PUT 请求 */
function apiPut(path, body, callback, onError) {
  var headers = getAuthHeader();
  headers['Content-Type'] = 'application/json';
  fetch(getApiUrl(path), {
    method: 'PUT',
    headers: headers,
    body: JSON.stringify(body || {})
  })
    .then(function (r) { return r.json(); })
    .then(function (res) { callback && callback(res); })
    .catch(function (e) { onError && onError(e); });
}

/** 封装 DELETE 请求（兼容带body，用于需要传参的删除接口） */
function apiDelete(path, body, callback, onError) {
  // 允许 3 参数调用：apiDelete(path, callback, onError)
  if (typeof body === 'function') {
    onError = callback;
    callback = body;
    body = null;
  }
  var headers = getAuthHeader();
  var init = { method: 'DELETE', headers: headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  fetch(getApiUrl(path), init)
    .then(function (r) { return r.json(); })
    .then(function (res) { callback && callback(res); })
    .catch(function (e) { onError && onError(e); });
}

/* ==================== 初始化 & 路由 & 维护模式 ==================== */

/** 应用入口初始化 */
function initApp() {
  state.token = localStorage.getItem('yiyu_token') || null;
  var userStr = localStorage.getItem('yiyu_user');
  state.user = userStr ? JSON.parse(userStr) : null;
  state.searchHistory = JSON.parse(localStorage.getItem('yiyu_search_history') || '[]');
  state.watchedEpisodes = JSON.parse(localStorage.getItem('yiyu_watched') || '{}');

  if (!state.token) {
    window.location.href = 'login.html';
    return;
  }

  checkMaintenance(function () {
    verifyToken(function () {
      bindTabEvents();
      bindFilterChipEvents();
      bindRankTabEvents();
      bindSearchInputEvents();
      switchTab('home');
    });
  });
}

/** 检查维护模式 */
function checkMaintenance(callback) {
  apiGet('/status', function (res) {
    if (res && res.code === 0 && res.data && res.data.maintenance) {
      showMaintenanceModal(res.data.message || '系统维护中，请稍后再试');
      state.maintenanceMode = true;
    } else {
      state.maintenanceMode = false;
      callback && callback();
    }
  }, function () {
    callback && callback();
  });
}

/** 显示维护弹窗 */
function showMaintenanceModal(msg) {
  var modal = document.createElement('div');
  modal.id = 'maintenance-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML =
    '<div style="background:#fff;border-radius:16px;padding:32px 24px;max-width:360px;width:100%;text-align:center;">' +
    '<div style="font-size:72px;margin-bottom:16px;">🔧</div>' +
    '<h2 style="font-size:22px;margin:0 0 12px;color:#1a1a1a;">系统维护中</h2>' +
    '<p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 24px;">' + escapeHtml(msg || '一屿视频正在升级维护，请稍后再来访问。') + '</p>' +
    '<button onclick="location.reload()" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:15px;font-weight:600;">我知道了</button>' +
    '</div>';
  document.body.appendChild(modal);
}

/** 验证 Token 有效性 */
function verifyToken(callback) {
  apiGet('/auth/me', function (res) {
    if (res && res.code === 0 && res.data) {
      state.user = res.data;
      localStorage.setItem('yiyu_user', JSON.stringify(state.user));
      callback && callback();
    } else {
      clearAuthAndRedirect();
    }
  }, function () {
    callback && callback();
  });
}

/** 清空鉴权并跳转登录 */
function clearAuthAndRedirect() {
  localStorage.removeItem('yiyu_token');
  localStorage.removeItem('yiyu_user');
  state.token = null;
  state.user = null;
  window.location.href = 'login.html';
}

/** 绑定底部 Tab 事件 */
function bindTabEvents() {
  var tabs = document.querySelectorAll('#tab-bar .tab-item');
  for (var i = 0; i < tabs.length; i++) {
    (function (tab) {
      tab.addEventListener('click', function (e) {
        e.stopPropagation();
        var t = tab.getAttribute('data-tab');
        switchTab(t);
      });
    })(tabs[i]);
  }
}

/** Tab 切换 */
function switchTab(tabName) {
  if (state.maintenanceMode) return;

  state.currentPage = tabName;

  var tabs = document.querySelectorAll('#tab-bar .tab-item');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-tab') === tabName) {
      tabs[i].classList.add('active');
    } else {
      tabs[i].classList.remove('active');
    }
  }

  var pages = document.querySelectorAll('.page');
  for (var j = 0; j < pages.length; j++) {
    if (pages[j].id === 'page-' + tabName) {
      pages[j].classList.add('active');
    } else {
      pages[j].classList.remove('active');
    }
  }

  window.scrollTo(0, 0);

  switch (tabName) {
    case 'home':
      loadHome();
      break;
    case 'filter':
      loadFilterOptions();
      break;
    case 'rank':
      loadRankings(state.rankType);
      break;
    case 'mine':
      loadMine();
      break;
  }
}

/* ==================== 首页逻辑 loadHome() ==================== */

function loadHome() {
  loadHomeAnnouncement();
  loadHomeBanner();
  loadHomeSections();
}

/** 顶部公告跑马灯 */
function loadHomeAnnouncement() {
  var bar = document.querySelector('.announcement-bar .announcement-text span');
  if (!bar) return;
  apiGet('/announcements/home', function (res) {
    if (res && res.code === 0 && res.data && res.data.active && res.data.content) {
      bar.textContent = res.data.content;
    }
  });
}

/** Banner 轮播 */
function loadHomeBanner() {
  apiGet('/ads/banner', function (res) {
    var banners = (res && res.code === 0 && res.data) ? res.data : [];
    state.banners = banners && banners.length ? banners : getDefaultBanners();
    renderBanners();
    startBannerTimer();
  }, function () {
    state.banners = getDefaultBanners();
    renderBanners();
    startBannerTimer();
  });
}

/** 默认 Banner 占位图 */
function getDefaultBanners() {
  return [
    { id: 'd1', image: '', title: '欢迎使用一屿视频', link: null, gradient: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)' },
    { id: 'd2', image: '', title: '海量影视 · 每日更新', link: null, gradient: 'linear-gradient(135deg,#f093fb 0%,#f5576c 100%)' },
    { id: 'd3', image: '', title: '高清流畅 · 极速播放', link: null, gradient: 'linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)' }
  ];
}

/** 渲染 Banner */
function renderBanners() {
  var slider = document.getElementById('banner-slider');
  var dotsBox = document.getElementById('banner-dots');
  if (!slider || !dotsBox) return;

  var html = '';
  for (var i = 0; i < state.banners.length; i++) {
    var b = state.banners[i];
    var coverStyle = b.image
      ? 'background-image:url(\'' + escapeHtml(b.image) + '\');background-size:cover;background-position:center;'
      : 'background:' + (b.gradient || 'linear-gradient(135deg,#667eea,#764ba2)') + ';';
    var clickStr = b.id ? "openBannerDetail(" + i + ")" : '';
    html +=
      '<div class="banner-item ' + (i === 0 ? 'active' : '') + '" onclick="' + clickStr + '" style="' + coverStyle + '">' +
      '<div class="banner-overlay"><div class="banner-title">' + escapeHtml(b.title || '欢迎使用一屿视频') + '</div></div>' +
      '</div>';
  }
  slider.innerHTML = html;

  var dotsHtml = '';
  for (var j = 0; j < state.banners.length; j++) {
    dotsHtml += '<span class="banner-dot ' + (j === 0 ? 'active' : '') + '" onclick="jumpBanner(' + j + ')"></span>';
  }
  dotsBox.innerHTML = dotsHtml;
  state.bannerIdx = 0;
}

function openBannerDetail(i) {
  var b = state.banners[i];
  if (!b) return;
  if (b.link && /^https?:\/\//.test(b.link)) {
    window.open(b.link, '_blank');
    return;
  }
  if (b.vodId) {
    openDetail(b.vodId, b.sourceKey || '');
  }
}

function jumpBanner(idx) {
  state.bannerIdx = idx;
  updateBannerView();
  resetBannerTimer();
}

function updateBannerView() {
  var items = document.querySelectorAll('#banner-slider .banner-item');
  var dots = document.querySelectorAll('#banner-dots .banner-dot');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', i === state.bannerIdx);
  }
  for (var j = 0; j < dots.length; j++) {
    dots[j].classList.toggle('active', j === state.bannerIdx);
  }
}

function startBannerTimer() {
  stopBannerTimer();
  state.bannerTimer = setInterval(function () {
    if (state.banners.length <= 1) return;
    state.bannerIdx = (state.bannerIdx + 1) % state.banners.length;
    updateBannerView();
  }, 3000);
}

function stopBannerTimer() {
  if (state.bannerTimer) {
    clearInterval(state.bannerTimer);
    state.bannerTimer = null;
  }
}

function resetBannerTimer() {
  startBannerTimer();
}

/** 各栏目数据 */
function loadHomeSections() {
  var rows = {
    'row-new': document.getElementById('row-new'),
    'row-foreign': document.getElementById('row-foreign'),
    'row-tv': document.getElementById('row-tv'),
    'row-movie': document.getElementById('row-movie'),
    'row-variety': document.getElementById('row-variety'),
    'row-anime': document.getElementById('row-anime')
  };
  for (var k in rows) {
    if (rows[k]) rows[k].innerHTML = buildSectionSkeleton(4);
  }

  apiGet('/home/sections', function (res) {
    var data = (res && res.code === 0 && res.data) ? res.data : {};
    renderSection('row-new', data.newRecommend || []);
    renderSection('row-foreign', data.foreignHot || []);
    renderSection('row-tv', data.tvDramas || []);
    renderSection('row-movie', data.movies || []);
    renderSection('row-variety', data.variety || []);
    renderSection('row-anime', data.anime || []);
  }, function () {
    for (var k2 in rows) {
      if (rows[k2]) rows[k2].innerHTML = '';
    }
  });
}

function buildSectionSkeleton(n) {
  var h = '';
  for (var i = 0; i < (n || 4); i++) {
    h +=
      '<div class="video-card skeleton">' +
      '<div class="video-cover" style="background:#eee;"></div>' +
      '<div class="video-info-card"><div style="height:14px;background:#eee;border-radius:4px;margin-bottom:6px;"></div><div style="height:12px;background:#eee;border-radius:4px;width:60%;"></div></div>' +
      '</div>';
  }
  return h;
}

function renderSection(rowId, list) {
  var row = document.getElementById(rowId);
  if (!row) return;
  if (!list || !list.length) {
    row.innerHTML = '<div style="padding:20px;color:#999;font-size:13px;">暂无内容</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < list.length && i < 12; i++) {
    html += renderVideoCard(list[i]);
  }
  row.innerHTML = html;
}

/** 渲染视频横滑卡片 */
function renderVideoCard(v) {
  if (!v) return '';
  var cover = v.cover || '';
  var score = v.score ? Number(v.score) : 0;
  var remarks = v.remarks || v.status || '';
  var title = v.title || '';
  var onclickStr = "openDetail('" + escapeHtml(v.id || '') + "','" + escapeHtml(v.sourceKey || '') + "')";

  return (
    '<div class="video-card" onclick="' + onclickStr + '">' +
      '<div class="video-cover" style="width:110px;height:150px;position:relative;border-radius:8px;overflow:hidden;background:#f0f0f0;">' +
        (cover ? '<img src="' + escapeHtml(cover) + '" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.style.display=\'none\'">' : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#e0e0e0,#f5f5f5);display:flex;align-items:center;justify-content:center;font-size:28px;">🎬</div>') +
        (score > 0 ? '<span style="position:absolute;top:6px;right:6px;background:linear-gradient(135deg,#ff6b6b,#ff8e53);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;box-shadow:0 2px 6px rgba(255,107,107,0.4);">' + score.toFixed(1) + '</span>' : '') +
        (remarks ? '<span style="position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;max-width:90%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">' + escapeHtml(remarks) + '</span>' : '') +
      '</div>' +
      '<div class="video-info-card" style="margin-top:6px;">' +
        '<div class="video-card-title" style="font-size:13px;color:#1a1a1a;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;min-height:34px;">' + escapeHtml(title) + '</div>' +
      '</div>' +
    '</div>'
  );
}

/** 从首页 section 的更多按钮跳到筛选页 */
function filterJump(category) {
  state.filter.category = category || 'all';
  switchTab('filter');
}

/* ==================== 筛选页逻辑 ==================== */

function loadFilterOptions() {
  var grid = document.getElementById('filter-grid');
  if (grid) grid.innerHTML = buildGridSkeleton(8);

  apiGet('/filter/options', function (res) {
    var data = (res && res.code === 0 && res.data) ? res.data : null;
    if (data) {
      renderFilterChips(data);
    }
    applyFilter();
  }, function () {
    applyFilter();
  });
}

function renderFilterChips(data) {
  var categories = data.categories || [{ id: 'all', name: '全部' }, { id: 'tv', name: '连续剧' }, { id: 'movie', name: '电影' }, { id: 'variety', name: '综艺' }, { id: 'anime', name: '动漫' }, { id: 'short', name: '短剧' }];
  var genres = data.genres || ['全部', '爱情', '喜剧', '悬疑', '犯罪', '古装', '动作', '科幻', '恐怖', '剧情', '战争', '家庭', '奇幻', '武侠', '历史', '惊悚', '冒险'];
  var areas = data.areas || ['全部', '内地', '香港', '台湾', '美国', '韩国', '日本', '欧美', '英国', '泰国', '印度', '其他'];
  var years = data.years || ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2010-2019', '更早'];
  var sorts = data.sorts || [{ key: 'hot', name: '最热' }, { key: 'score', name: '评分' }, { key: 'new', name: '最新上线' }];

  var container = document.querySelector('.filter-tabs-container');
  if (!container) return;

  var typeHtml = buildChipRow('类型', 'category', categories, function (c) { return { v: c.id || c.key || c, n: c.name || c }; });
  var genreHtml = buildChipRow('题材', 'genre', genres, function (g) { return { v: g, n: g }; });
  var areaHtml = buildChipRow('地区', 'area', areas, function (a) { return { v: a, n: a }; });
  var yearHtml = buildChipRow('年份', 'year', years, function (y) { return { v: y, n: y }; });
  var sortHtml = buildChipRow('排序', 'sort', sorts, function (s) { return { v: s.key || s, n: s.name || s }; });

  container.innerHTML = typeHtml + genreHtml + areaHtml + yearHtml + sortHtml;
  bindFilterChipEvents();
}

function buildChipRow(label, filterKey, arr, mapFn) {
  var html = '<div class="filter-tabs-row"><span class="filter-label">' + label + '</span>';
  for (var i = 0; i < arr.length; i++) {
    var item = mapFn(arr[i]);
    var activeVal = state.filter[filterKey] || '';
    var isActive = String(item.v) === String(activeVal) || (filterKey !== 'sort' && item.v === '' && activeVal === '全部');
    if (!isActive && filterKey === 'category' && item.v === 'all' && activeVal === 'all') isActive = true;
    if (!isActive && filterKey === 'sort' && item.v === activeVal) isActive = true;
    html += '<span class="filter-chip' + (isActive ? ' active' : '') + '" data-filter="' + filterKey + '" data-value="' + escapeHtml(String(item.v)) + '">' + escapeHtml(item.n) + '</span>';
  }
  html += '</div>';
  return html;
}

function bindFilterChipEvents() {
  var chips = document.querySelectorAll('.filter-tabs-container .filter-chip');
  for (var i = 0; i < chips.length; i++) {
    (function (chip) {
      chip.addEventListener('click', function () {
        var f = chip.getAttribute('data-filter');
        var v = chip.getAttribute('data-value');
        updateFilterState(f, v, chip);
        applyFilter();
      });
    })(chips[i]);
  }
}

function updateFilterState(key, value, chipEl) {
  if (key === 'category') {
    state.filter.category = value || 'all';
  } else if (key === 'genre') {
    state.filter.genre = value || '全部';
  } else if (key === 'area') {
    state.filter.area = value || '全部';
  } else if (key === 'year') {
    state.filter.year = value || '全部';
  } else if (key === 'sort') {
    state.filter.sort = value || 'hot';
  }
  if (chipEl) {
    var siblings = chipEl.parentNode.querySelectorAll('.filter-chip');
    for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove('active');
    chipEl.classList.add('active');
  }
  state.filter.pg = 1;
}

function applyFilter() {
  var grid = document.getElementById('filter-grid');
  if (!grid) return;
  grid.innerHTML = buildGridSkeleton(8);

  var params = [];
  if (state.filter.category && state.filter.category !== 'all') params.push('category=' + encodeURIComponent(state.filter.category));
  if (state.filter.genre && state.filter.genre !== '全部') params.push('genre=' + encodeURIComponent(state.filter.genre));
  if (state.filter.area && state.filter.area !== '全部') params.push('area=' + encodeURIComponent(state.filter.area));
  if (state.filter.year && state.filter.year !== '全部') params.push('year=' + encodeURIComponent(state.filter.year));
  params.push('sort=' + encodeURIComponent(state.filter.sort || 'hot'));
  params.push('pg=' + (state.filter.pg || 1));
  params.push('ps=24');

  var qs = params.join('&');
  apiGet('/filter' + (qs ? '?' + qs : ''), function (res) {
    var list = (res && res.code === 0 && res.data && res.data.list) ? res.data.list : (res && res.data && res.data.length ? res.data : []);
    renderFilterGrid(list);
  }, function () {
    grid.innerHTML = buildEmptyGrid();
  });
}

function buildGridSkeleton(n) {
  var h = '';
  for (var i = 0; i < n; i++) {
    h +=
      '<div class="video-card skeleton">' +
      '<div class="video-cover" style="background:#eee;border-radius:8px;height:180px;"></div>' +
      '<div style="padding:8px 2px;"><div style="height:14px;background:#eee;border-radius:4px;margin-bottom:6px;"></div><div style="height:12px;background:#eee;border-radius:4px;width:60%;"></div></div>' +
      '</div>';
  }
  return h;
}

function buildEmptyGrid() {
  return '<div style="grid-column:span 2;padding:60px 20px;text-align:center;"><div style="font-size:48px;margin-bottom:12px;">📭</div><div style="color:#999;font-size:14px;">暂无符合条件的内容</div></div>';
}

function renderFilterGrid(list) {
  var grid = document.getElementById('filter-grid');
  if (!grid) return;
  if (!list || !list.length) {
    grid.innerHTML = buildEmptyGrid();
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += renderVideoCard(list[i]);
  }
  grid.innerHTML = html;
}

/* ==================== 排行榜页 ==================== */

function bindRankTabEvents() {
  var tabs = document.querySelectorAll('#rank-tabs .rank-tab');
  for (var i = 0; i < tabs.length; i++) {
    (function (tab) {
      tab.addEventListener('click', function () {
        var t = tab.getAttribute('data-rank');
        state.rankType = t || 'hot';
        var allTabs = document.querySelectorAll('#rank-tabs .rank-tab');
        for (var j = 0; j < allTabs.length; j++) {
          allTabs[j].classList.toggle('active', allTabs[j].getAttribute('data-rank') === state.rankType);
        }
        loadRankings(state.rankType);
      });
    })(tabs[i]);
  }
}

function loadRankings(type) {
  type = type || state.rankType || 'hot';
  var listEl = document.getElementById('rank-list');
  if (!listEl) return;
  listEl.innerHTML = buildRankSkeleton(6);

  apiGet('/rankings?type=' + encodeURIComponent(type), function (res) {
    var list = (res && res.code === 0 && res.data) ? (res.data.list || res.data) : [];
    renderRankList(list);
  }, function () {
    listEl.innerHTML = buildEmptyRank();
  });
}

function buildRankSkeleton(n) {
  var h = '';
  for (var i = 0; i < n; i++) {
    h +=
      '<div style="display:flex;gap:12px;padding:12px 16px;background:#fff;border-radius:12px;margin-bottom:10px;">' +
      '<div style="width:30px;"></div>' +
      '<div style="width:90px;height:120px;background:#eee;border-radius:8px;"></div>' +
      '<div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:6px 0;">' +
      '<div style="height:16px;background:#eee;border-radius:4px;width:80%;"></div>' +
      '<div style="height:12px;background:#eee;border-radius:4px;width:40%;"></div>' +
      '<div style="height:12px;background:#eee;border-radius:4px;width:60%;"></div>' +
      '</div></div>';
  }
  return h;
}

function buildEmptyRank() {
  return '<div style="padding:60px 20px;text-align:center;"><div style="font-size:48px;margin-bottom:12px;">🏆</div><div style="color:#999;font-size:14px;">暂无排行榜数据</div></div>';
}

function renderRankList(list) {
  var listEl = document.getElementById('rank-list');
  if (!listEl) return;
  if (!list || !list.length) {
    listEl.innerHTML = buildEmptyRank();
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += renderRankItem(list[i], i + 1);
  }
  listEl.innerHTML = html;
}

function renderRankItem(v, rank) {
  if (!v) return '';
  var cover = v.cover || '';
  var title = v.title || '';
  var score = v.score ? Number(v.score) : 0;
  var category = v.category || v.type || '';
  var rankClass = '';
  var rankIcon = '';
  if (rank === 1) { rankClass = 'rank-1'; rankIcon = '🥇'; }
  else if (rank === 2) { rankClass = 'rank-2'; rankIcon = '🥈'; }
  else if (rank === 3) { rankClass = 'rank-3'; rankIcon = '🥉'; }

  var onclickStr = "openDetail('" + escapeHtml(v.id || '') + "','" + escapeHtml(v.sourceKey || '') + "')";

  return (
    '<div class="rank-item" onclick="' + onclickStr + '" style="display:flex;gap:12px;padding:12px 16px;background:#fff;border-radius:12px;margin-bottom:10px;align-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.04);">' +
      '<div class="rank-num ' + rankClass + '" style="width:30px;text-align:center;font-weight:800;font-size:18px;">' + (rankIcon ? rankIcon : rank) + '</div>' +
      '<div style="width:90px;height:120px;flex-shrink:0;border-radius:8px;overflow:hidden;position:relative;background:#f0f0f0;">' +
        (cover ? '<img src="' + escapeHtml(cover) + '" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.style.display=\'none\'">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;">🎬</div>') +
      '</div>' +
      '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;">' +
        '<div style="font-size:15px;font-weight:600;color:#1a1a1a;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;">' + escapeHtml(title) + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
          (score > 0 ? '<span style="color:#ff6b6b;font-weight:700;font-size:15px;">⭐ ' + score.toFixed(1) + '</span>' : '') +
          (category ? '<span style="font-size:12px;color:#fff;background:linear-gradient(135deg,#667eea,#764ba2);padding:2px 8px;border-radius:10px;">' + escapeHtml(category) + '</span>' : '') +
        '</div>' +
        (v.remarks ? '<div style="font-size:12px;color:#888;">' + escapeHtml(v.remarks) + '</div>' : '') +
      '</div>' +
    '</div>'
  );
}

/* ==================== 我的页面 ==================== */

function loadMine() {
  if (!checkLogin()) return;

  if (!state.user) {
    showMineLoginBtn();
    return;
  }
  renderMineUserCard();
  loadMineAdBanner();
}

function showMineLoginBtn() {
  var page = document.getElementById('page-mine');
  if (!page) return;
  page.innerHTML =
    '<div style="padding:80px 24px;text-align:center;">' +
    '<div style="font-size:72px;margin-bottom:20px;">👤</div>' +
    '<h2 style="font-size:20px;margin:0 0 12px;color:#1a1a1a;">请先登录</h2>' +
    '<p style="color:#888;font-size:14px;margin:0 0 28px;line-height:1.5;">登录后可以收藏影片、查看历史记录<br>同步观看进度到云端</p>' +
    '<button onclick="window.location.href=\'login.html\'" style="width:100%;max-width:280px;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:16px;font-weight:600;box-shadow:0 8px 20px rgba(255,107,107,0.3);">立即登录</button>' +
    '</div>';
}

function renderMineUserCard() {
  var card = document.querySelector('.user-card');
  if (!card) return;
  var u = state.user || {};
  // ⭐ 统一 VIP 判定：以服务端返回的 vipActive 为准（解决后台显示非会员用户显示会员的bug）
  var realVip = !!u.vipActive;
  var level = u.levelLabel || ('Lv.' + (u.level || 1) + ' 普通用户');

  var avatarEl = card.querySelector('.mine-avatar');
  var nameEl = document.getElementById('mine-username');
  var phoneEl = document.getElementById('mine-phone');
  var levelEl = document.getElementById('mine-level');
  var vipBadge = document.getElementById('mine-vip-badge');
  var editBtn = card.querySelector('.edit-profile-btn');

  if (avatarEl) {
    if (u.avatar) {
      avatarEl.innerHTML = '<img src="' + escapeHtml(u.avatar) + '" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">';
      avatarEl.style.cssText = 'width:80px;height:80px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f0f0f0;cursor:pointer;';
      avatarEl.onclick = function () { triggerEditAvatar(); };
    } else {
      avatarEl.innerHTML = '👤';
      avatarEl.style.cssText = 'width:80px;height:80px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:40px;cursor:pointer;';
      avatarEl.onclick = function () { triggerEditAvatar(); };
    }
  }
  if (nameEl) {
    var vipIcon = realVip ? ' <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:8px;background:linear-gradient(135deg,#f6d365,#fda085);color:#fff;font-size:11px;font-weight:700;vertical-align:middle;">👑 VIP</span>' : '';
    nameEl.innerHTML = escapeHtml(u.username || '一屿用户') + vipIcon;
  }
  if (vipBadge) {
    vipBadge.style.display = realVip ? 'inline-block' : 'none';
  }
  if (levelEl) {
    levelEl.textContent = '⭐ ' + level;
  }
  if (phoneEl) {
    phoneEl.textContent = maskPhone(u.phone || '');
  }
  if (editBtn) {
    editBtn.setAttribute('onclick', 'showEditProfileModal()');
    editBtn.textContent = '编辑资料';
  }

  // 历史观看数量徽标
  var hBadge = document.getElementById('history-badge');
  try {
    var h = u.history || [];
    if (hBadge && h && h.length > 0) {
      hBadge.textContent = h.length;
      hBadge.style.display = 'inline-block';
    } else if (hBadge) {
      hBadge.style.display = 'none';
    }
  } catch (e) { }

  bindMineMenuEvents();
}

function triggerEditAvatar() {
  showEditProfileModal();
}

/** 我的页面 - 广告位 */
function loadMineAdBanner() {
  var banner = document.querySelector('.mine-ad-banner');
  if (!banner) return;
  apiGet('/api/ads/mine', function () { }, function () { });
  apiGet('/ads/mine', function (res) {
    if (res && res.code === 0 && res.data && res.data.active) {
      var d = res.data;
      banner.innerHTML = escapeHtml(d.title || d.content || '');
      banner.style.cursor = 'pointer';
      banner.onclick = function () {
        if (d.link) {
          if (/^https?:\/\//.test(d.link)) window.open(d.link, '_blank');
        }
      };
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }, function () {
    banner.style.display = 'block';
  });
}

function bindMineMenuEvents() {
  var items = document.querySelectorAll('#page-mine .menu-item');
  if (!items.length) return;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var text = (item.querySelector('.menu-text') || {}).textContent || '';
    if (text.indexOf('历史') > -1) item.setAttribute('onclick', 'openHistoryPage()');
    else if (text.indexOf('收藏') > -1) item.setAttribute('onclick', 'openFavoritesPage()');
    else if (text.indexOf('下载') > -1) item.setAttribute('onclick', 'openDownloadsPage()');
    else if (text.indexOf('反馈') > -1) item.setAttribute('onclick', 'showFeedbackModal()');
    else if (text.indexOf('设置') > -1) item.setAttribute('onclick', 'showSettingModal()');
  }
}

/* ---------- 编辑资料弹窗 ---------- */

var editProfileFileInput = null;

function showEditProfileModal() {
  if (!checkLogin()) return;
  var u = state.user || {};
  var lastEdit = u.lastEditProfileAt ? new Date(u.lastEditProfileAt).getTime() : 0;
  var now = Date.now();
  var diffDays = Math.floor((now - lastEdit) / 86400000);
  var cooldownDays = u.isVip ? 0 : 30;
  var canEdit = u.isVip || !lastEdit || diffDays >= cooldownDays;

  var modal = document.createElement('div');
  modal.id = 'edit-profile-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.onclick = function (e) { if (e.target === modal) closeEditProfileModal(); };
  modal.innerHTML =
    '<div class="modal-content" style="max-width:400px;width:100%;background:#fff;border-radius:16px;overflow:hidden;" onclick="event.stopPropagation()">' +
    '<div class="modal-header" style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;">' +
    '<h3 style="font-size:17px;margin:0;">✏️ 编辑资料</h3>' +
    '<span class="modal-close" style="cursor:pointer;font-size:18px;color:#999;" onclick="closeEditProfileModal()">✕</span>' +
    '</div>' +
    '<div class="modal-body" style="padding:20px;">' +
      (canEdit ? '' : '<div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:10px 12px;font-size:12px;color:#d46b08;margin-bottom:16px;">⏳ 修改资料冷却中（' + (cooldownDays - diffDays) + '天后可再次修改），VIP用户无冷却限制</div>') +
      '<div style="text-align:center;margin-bottom:20px;">' +
        '<div id="ep-avatar-preview" style="width:90px;height:90px;border-radius:50%;margin:0 auto 10px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:' + (u.avatar ? '#f0f0f0' : 'linear-gradient(135deg,#ff6b6b,#ff8e8e)') + ';font-size:' + (u.avatar ? '' : '44px') + ';color:#fff;cursor:pointer;" onclick="document.getElementById(\'ep-avatar-input\').click()">' +
          (u.avatar ? '<img src="' + escapeHtml(u.avatar) + '" id="ep-avatar-img" style="width:100%;height:100%;object-fit:cover;">' : '👤') +
        '</div>' +
        '<div style="font-size:12px;color:#666;">点击头像可更换图片</div>' +
        '<input type="file" id="ep-avatar-input" accept="image/*" style="display:none;" onchange="handleEditAvatarChange(this)">' +
      '</div>' +
      '<label class="setting-label" style="font-size:13px;color:#666;display:block;margin-bottom:6px;">用户名</label>' +
      '<input type="text" class="setting-input" id="ep-username" value="' + escapeHtml(u.username || '') + '" placeholder="请输入用户名" style="width:100%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;box-sizing:border-box;margin-bottom:16px;">' +
      '<button class="auth-submit-btn" id="ep-save-btn" style="width:100%;padding:13px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:15px;font-weight:600;' + (canEdit ? '' : 'opacity:0.5;cursor:not-allowed;') + '" ' + (canEdit ? 'onclick="saveEditProfile()"' : 'disabled') + '>保存修改</button>' +
    '</div></div>';
  document.body.appendChild(modal);
}

function handleEditAvatarChange(input) {
  if (!input || !input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 5 * 1024 * 1024) {
    showToast('图片不能超过 5MB', 'error');
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var base64 = e.target.result;
    var preview = document.getElementById('ep-avatar-preview');
    if (preview) {
      preview.style.background = '#f0f0f0';
      preview.innerHTML = '<img src="' + base64 + '" style="width:100%;height:100%;object-fit:cover;">';
      preview.setAttribute('data-base64', base64);
    }
  };
  reader.readAsDataURL(file);
}

function closeEditProfileModal() {
  var m = document.getElementById('edit-profile-modal');
  if (m) m.parentNode.removeChild(m);
}

function saveEditProfile() {
  if (!checkLogin()) return;
  var usernameInput = document.getElementById('ep-username');
  var preview = document.getElementById('ep-avatar-preview');
  var username = usernameInput ? usernameInput.value.trim() : '';
  var avatarBase64 = preview ? preview.getAttribute('data-base64') || '' : '';

  if (!username) {
    showToast('请输入用户名', 'error');
    return;
  }
  if (username.length < 2 || username.length > 20) {
    showToast('用户名长度需在2-20个字符之间', 'error');
    return;
  }

  var btn = document.getElementById('ep-save-btn');
  if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }

  var body = { username: username };
  if (avatarBase64) body.avatar = avatarBase64;

  apiPut('/user/profile', body, function (res) {
    if (res && res.code === 0) {
      showToast('资料修改成功', 'success');
      if (res.data) {
        state.user = res.data;
        localStorage.setItem('yiyu_user', JSON.stringify(state.user));
      } else if (res.user) {
        state.user = res.user;
        localStorage.setItem('yiyu_user', JSON.stringify(state.user));
      } else {
        state.user.username = username;
        if (avatarBase64) state.user.avatar = avatarBase64;
        state.user.lastEditProfileAt = new Date().toISOString();
        localStorage.setItem('yiyu_user', JSON.stringify(state.user));
      }
      closeEditProfileModal();
      renderMineUserCard();
    } else {
      showToast((res && res.message) || '保存失败', 'error');
      if (btn) { btn.textContent = '保存修改'; btn.disabled = false; }
    }
  }, function () {
    showToast('网络错误，请稍后重试', 'error');
    if (btn) { btn.textContent = '保存修改'; btn.disabled = false; }
  });
}

/* ---------- 历史观看子页 ---------- */

function openHistoryPage() {
  if (!checkLogin()) return;
  buildSubPage('history', '历史观看', function () {
    loadHistoryList();
  });
}

function loadHistoryList() {
  var container = document.getElementById('subpage-content');
  if (!container) return;
  container.innerHTML = buildSubListSkeleton(6);
  apiGet('/user/history', function (res) {
    var list = (res && res.code === 0 && res.data) ? (res.data.list || res.data) : [];
    renderHistoryList(list);
  }, function () {
    container.innerHTML = buildSubEmpty('⏱️', '暂无观看记录');
  });
}

function renderHistoryList(list) {
  var container = document.getElementById('subpage-content');
  if (!container) return;
  var clearBtn = document.getElementById('subpage-action');
  if (clearBtn) clearBtn.onclick = function () {
    if (!list.length) return;
    if (confirm('确定清空全部历史记录？')) clearAllHistory();
  };
  if (!list || !list.length) {
    container.innerHTML = buildSubEmpty('⏱️', '暂无观看记录');
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += renderHistoryItem(list[i]);
  }
  container.innerHTML = html;
  bindHistorySwipe();
}

function renderHistoryItem(h) {
  if (!h) return '';
  var v = h.video || h;
  var id = v.id || h.vodId;
  var sourceKey = v.sourceKey || h.sourceKey;
  var title = v.title || h.title;
  var cover = v.cover || h.cover;
  var progress = h.watchProgress || h.progress;
  var ep = h.episodeName || '';
  var ts = h.watchedAt || h.updatedAt;
  var onclickStr = "clickHistoryItem('" + escapeHtml(id) + "','" + escapeHtml(sourceKey) + "','" + escapeHtml(h.id || h.recordId || '') + "')";
  return (
    '<div class="history-item" data-record-id="' + escapeHtml(h.id || h.recordId || '') + '" style="display:flex;gap:12px;padding:12px;background:#fff;border-radius:12px;margin-bottom:10px;position:relative;overflow:hidden;">' +
      '<div class="history-delete-btn" onclick="deleteHistoryItem(\'' + escapeHtml(h.id || h.recordId || '') + '\',event)" style="position:absolute;right:0;top:0;height:100%;width:70px;background:linear-gradient(135deg,#ff4444,#cc0000);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;transform:translateX(100%);transition:transform 0.3s;">删除</div>' +
      '<div class="history-swipe-content" onclick="' + onclickStr + '" style="display:flex;gap:12px;width:100%;cursor:pointer;">' +
        '<div style="width:90px;height:120px;flex-shrink:0;border-radius:8px;overflow:hidden;background:#f0f0f0;">' +
          (cover ? '<img src="' + escapeHtml(cover) + '" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;">🎬</div>') +
        '</div>' +
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">' +
          '<div style="font-size:15px;font-weight:600;color:#1a1a1a;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + escapeHtml(title) + '</div>' +
          (ep ? '<div style="font-size:12px;color:#ff6b6b;">📺 ' + escapeHtml(ep) + '</div>' : '') +
          (progress ? '<div style="height:4px;background:#f0f0f0;border-radius:2px;overflow:hidden;"><div style="height:100%;background:linear-gradient(90deg,#ff6b6b,#ff8e53);width:' + Math.min(100, progress) + '%;"></div></div>' : '') +
          (ts ? '<div style="font-size:12px;color:#999;margin-top:auto;">🕐 ' + escapeHtml(formatDate(ts)) + '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function clickHistoryItem(id, sourceKey, recordId) {
  openDetail(id, sourceKey);
}

function bindHistorySwipe() {
  var items = document.querySelectorAll('.history-item');
  for (var i = 0; i < items.length; i++) {
    (function (item) {
      var startX = 0;
      var content = item.querySelector('.history-swipe-content');
      var delBtn = item.querySelector('.history-delete-btn');
      if (!content || !delBtn) return;
      content.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; });
      content.addEventListener('touchend', function (e) {
        var dx = (e.changedTouches[0].clientX - startX);
        if (dx < -40) {
          content.style.transform = 'translateX(-70px)';
          delBtn.style.transform = 'translateX(0)';
        } else if (dx > 40) {
          content.style.transform = '';
          delBtn.style.transform = 'translateX(100%)';
        }
      });
    })(items[i]);
  }
}

function deleteHistoryItem(recordId, ev) {
  if (ev) ev.stopPropagation();
  if (!recordId) return;
  if (!confirm('确定删除这条记录？')) return;
  apiDelete('/user/history/' + encodeURIComponent(recordId), function (res) {
    if (!res || res.code === 0) {
      showToast('已删除', 'success');
      loadHistoryList();
    } else {
      showToast(res.message || '删除失败', 'error');
    }
  }, function () {
    showToast('网络错误', 'error');
  });
}

function clearAllHistory() {
  apiDelete('/user/history', function (res) {
    if (!res || res.code === 0) {
      showToast('历史记录已清空', 'success');
      loadHistoryList();
    } else {
      showToast(res.message || '清空失败', 'error');
    }
  }, function () {
    showToast('网络错误', 'error');
  });
}

/* ---------- 我的收藏子页 ---------- */

function openFavoritesPage() {
  if (!checkLogin()) return;
  buildSubPage('favorites', '我的收藏', function () {
    loadFavoritesList();
  });
}

function loadFavoritesList() {
  var container = document.getElementById('subpage-content');
  if (!container) return;
  container.innerHTML = buildSubListSkeleton(8);
  apiGet('/user/favorites', function (res) {
    var list = (res && res.code === 0 && res.data) ? (res.data.list || res.data) : [];
    renderFavoritesList(list);
  }, function () {
    container.innerHTML = buildSubEmpty('⭐', '还没有收藏任何视频');
  });
}

function renderFavoritesList(list) {
  var container = document.getElementById('subpage-content');
  if (!container) return;
  if (!list || !list.length) {
    container.innerHTML = buildSubEmpty('⭐', '还没有收藏任何视频');
    return;
  }
  container.innerHTML = '';
  var grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:12px;';
  for (var i = 0; i < list.length; i++) {
    grid.appendChild(renderFavoriteCard(list[i]));
  }
  container.appendChild(grid);
}

function renderFavoriteCard(f) {
  var v = f.video || f;
  var id = v.id || f.vodId;
  var sourceKey = v.sourceKey || f.sourceKey;
  var favId = f.id || f.favId || (sourceKey + '_' + id);
  var title = v.title || f.title;
  var cover = v.cover || f.cover;
  var remarks = v.remarks || f.remarks;
  var score = v.score || f.score;
  score = score ? Number(score) : 0;

  var el = document.createElement('div');
  el.style.cssText = 'background:#fff;border-radius:12px;overflow:hidden;position:relative;box-shadow:0 2px 8px rgba(0,0,0,0.05);';
  el.innerHTML =
    '<span class="fav-delete-x" style="position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;z-index:2;">✕</span>' +
    '<div class="fav-card-inner" style="cursor:pointer;">' +
      '<div style="aspect-ratio:110/150;background:#f0f0f0;position:relative;">' +
        (cover ? '<img src="' + escapeHtml(cover) + '" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:32px;">🎬</div>') +
        (score > 0 ? '<span style="position:absolute;top:6px;left:6px;background:linear-gradient(135deg,#ff6b6b,#ff8e53);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">⭐ ' + score.toFixed(1) + '</span>' : '') +
        (remarks ? '<span style="position:absolute;bottom:6px;left:6px;right:6px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">' + escapeHtml(remarks) + '</span>' : '') +
      '</div>' +
      '<div style="padding:8px;">' +
        '<div style="font-size:13px;color:#1a1a1a;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;min-height:34px;">' + escapeHtml(title) + '</div>' +
      '</div>' +
    '</div>';

  var delX = el.querySelector('.fav-delete-x');
  delX.addEventListener('click', function (e) {
    e.stopPropagation();
    deleteFavorite(favId, id, sourceKey);
  });
  var inner = el.querySelector('.fav-card-inner');
  inner.addEventListener('click', function () {
    openDetail(id, sourceKey);
  });
  return el;
}

function deleteFavorite(favId, vodId, sourceKey) {
  if (!confirm('取消收藏？')) return;
  var path = '/user/favorites/' + encodeURIComponent(favId);
  if (!favId || favId.indexOf('_') > -1) {
    path = '/user/favorites?sourceKey=' + encodeURIComponent(sourceKey || '') + '&vodId=' + encodeURIComponent(vodId || '');
  }
  apiDelete(path, function (res) {
    if (!res || res.code === 0) {
      showToast('已取消收藏', 'success');
      loadFavoritesList();
    } else {
      showToast(res.message || '操作失败', 'error');
    }
  }, function () {
    showToast('网络错误', 'error');
  });
}

/* ---------- 我的下载子页 ---------- */

function openDownloadsPage() {
  if (!checkLogin()) return;
  buildSubPage('downloads', '我的下载', function () {
    loadDownloadsList();
  });
}

function loadDownloadsList() {
  var container = document.getElementById('subpage-content');
  if (!container) return;
  container.innerHTML = buildSubListSkeleton(6);
  apiGet('/user/downloads', function (res) {
    var list = (res && res.code === 0 && res.data) ? (res.data.list || res.data) : [];
    if (!list || !list.length) {
      container.innerHTML = buildSubEmpty('📥', '暂无下载记录');
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      html +=
        '<div style="display:flex;gap:12px;padding:12px;background:#fff;border-radius:12px;margin-bottom:10px;">' +
        '<div style="width:60px;height:80px;border-radius:8px;overflow:hidden;background:#f0f0f0;flex-shrink:0;">' +
          (d.cover ? '<img src="' + escapeHtml(d.cover) + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">🎬</div>') +
        '</div>' +
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">' +
          '<div style="font-size:14px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(d.title || '视频') + '</div>' +
          '<div style="font-size:12px;color:#888;">' + escapeHtml(d.episode || '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="flex:1;height:4px;background:#f0f0f0;border-radius:2px;"><div style="height:100%;background:linear-gradient(90deg,#56ab2f,#a8e063);width:' + (d.progress || 100) + '%;"></div></div>' +
            '<span style="font-size:11px;color:#888;">' + (d.size || '') + '</span>' +
          '</div>' +
        '</div></div>';
    }
    container.innerHTML = html;
  }, function () {
    container.innerHTML = buildSubEmpty('📥', '暂无下载记录');
  });
}

/* ---------- 子页通用 ---------- */

function buildSubPage(key, title, onReady) {
  var old = document.getElementById('sub-page-' + key);
  if (old) { old.style.display = 'flex'; onReady && onReady(); return; }

  var page = document.createElement('div');
  page.id = 'sub-page-' + key;
  page.style.cssText = 'position:fixed;inset:0;background:#f5f6fa;z-index:8500;display:flex;flex-direction:column;';
  page.innerHTML =
    '<div style="background:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #f0f0f0;">' +
      '<span onclick="closeSubPage(\'' + key + '\')" style="cursor:pointer;font-size:24px;color:#333;">‹</span>' +
      '<h3 style="flex:1;margin:0;font-size:17px;">' + escapeHtml(title) + '</h3>' +
      '<span id="subpage-action" style="cursor:pointer;font-size:13px;color:#ff6b6b;font-weight:600;">' + (key === 'history' ? '清空全部' : '') + '</span>' +
    '</div>' +
    '<div id="subpage-content" style="flex:1;overflow-y:auto;padding:16px;"></div>';
  document.body.appendChild(page);
  onReady && onReady();
}

function closeSubPage(key) {
  var p = document.getElementById('sub-page-' + key);
  if (p) p.style.display = 'none';
}

function buildSubEmpty(icon, text) {
  return '<div style="padding:80px 20px;text-align:center;"><div style="font-size:56px;margin-bottom:16px;">' + icon + '</div><div style="color:#999;font-size:14px;">' + escapeHtml(text) + '</div></div>';
}

function buildSubListSkeleton(n) {
  var h = '';
  for (var i = 0; i < n; i++) {
    h +=
      '<div style="display:flex;gap:12px;padding:12px;background:#fff;border-radius:12px;margin-bottom:10px;">' +
      '<div style="width:90px;height:120px;background:#eee;border-radius:8px;"></div>' +
      '<div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:6px 0;">' +
      '<div style="height:14px;background:#eee;border-radius:4px;width:80%;"></div>' +
      '<div style="height:12px;background:#eee;border-radius:4px;width:40%;"></div>' +
      '<div style="height:12px;background:#eee;border-radius:4px;width:60%;"></div>' +
      '</div></div>';
  }
  return h;
}

/* ---------- 意见反馈弹窗 ---------- */

function showFeedbackModal() {
  if (!checkLogin()) return;
  var modal = document.createElement('div');
  modal.id = 'feedback-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.onclick = function (e) { if (e.target === modal) closeFeedbackModal(); };
  modal.innerHTML =
    '<div style="max-width:420px;width:100%;background:#fff;border-radius:16px;overflow:hidden;" onclick="event.stopPropagation()">' +
    '<div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;">' +
    '<h3 style="font-size:17px;margin:0;">📝 意见反馈</h3>' +
    '<span onclick="closeFeedbackModal()" style="cursor:pointer;font-size:18px;color:#999;">✕</span>' +
    '</div>' +
    '<div style="padding:20px;">' +
      '<label style="font-size:13px;color:#666;display:block;margin-bottom:6px;">反馈类型</label>' +
      '<select id="fb-type" style="width:100%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;margin-bottom:16px;appearance:none;background:#fff;">' +
      '<option value="功能反馈">功能反馈</option>' +
      '<option value="播放问题">播放问题</option>' +
      '<option value="内容投诉">内容投诉</option>' +
      '<option value="其他">其他</option>' +
      '</select>' +
      '<label style="font-size:13px;color:#666;display:block;margin-bottom:6px;">联系方式（选填）</label>' +
      '<input type="text" id="fb-contact" placeholder="手机号或QQ，方便我们联系您" style="width:100%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;box-sizing:border-box;margin-bottom:16px;">' +
      '<label style="font-size:13px;color:#666;display:block;margin-bottom:6px;">反馈内容</label>' +
      '<textarea id="fb-content" rows="5" placeholder="请详细描述您遇到的问题或建议..." style="width:100%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;box-sizing:border-box;resize:none;margin-bottom:16px;"></textarea>' +
      '<button id="fb-submit-btn" onclick="submitFeedback()" style="width:100%;padding:13px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff6b6b,#ff8e8e);color:#fff;font-size:15px;font-weight:600;">提交反馈</button>' +
    '</div></div>';
  document.body.appendChild(modal);
}

function closeFeedbackModal() {
  var m = document.getElementById('feedback-modal');
  if (m) m.parentNode.removeChild(m);
}

function submitFeedback() {
  var typeEl = document.getElementById('fb-type');
  var contactEl = document.getElementById('fb-contact');
  var contentEl = document.getElementById('fb-content');
  var btn = document.getElementById('fb-submit-btn');
  var type = typeEl ? typeEl.value : '功能反馈';
  var contact = contactEl ? contactEl.value.trim() : '';
  var content = contentEl ? contentEl.value.trim() : '';
  if (!content) {
    showToast('请填写反馈内容', 'error');
    return;
  }
  if (content.length < 5) {
    showToast('反馈内容至少5个字', 'error');
    return;
  }
  if (btn) { btn.textContent = '提交中...'; btn.disabled = true; }
  apiPost('/feedback', { type: type, content: content, contact: contact }, function (res) {
    if (res && res.code === 0) {
      showToast('反馈已提交，感谢您的支持！', 'success');
      closeFeedbackModal();
    } else {
      showToast((res && res.message) || '提交失败', 'error');
      if (btn) { btn.textContent = '提交反馈'; btn.disabled = false; }
    }
  }, function () {
    showToast('网络错误，请稍后重试', 'error');
    if (btn) { btn.textContent = '提交反馈'; btn.disabled = false; }
  });
}

/* ---------- 设置弹窗 ---------- */

function showSettingModal() {
  var modal = document.getElementById('setting-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  var input = document.getElementById('setting-server-input');
  var cur = document.getElementById('setting-current-server');
  if (input) input.value = (typeof getServerUrl === 'function' ? getServerUrl() : '') || '';
  if (cur) cur.textContent = (typeof getServerUrl === 'function' ? getServerUrl() : '') || '默认服务器';

  var body = modal.querySelector('.modal-body');
  if (body && body.querySelector('.setting-version-info')) return;
  var infoHtml =
    '<div style="border-top:1px solid #f0f0f0;padding-top:14px;margin-top:14px;">' +
    '<button class="auth-submit-btn" onclick="clearAppCache()" style="width:100%;padding:12px;border:none;border-radius:10px;background:#f0f0f0;color:#333;font-size:14px;font-weight:600;margin-bottom:14px;">🗑️ 清除缓存</button>' +
    '<div class="setting-version-info" style="text-align:center;padding:12px 0 0;border-top:1px dashed #eee;">' +
    '<div style="font-size:13px;color:#999;">版本号 V4.3 · 作者：一屿</div>' +
    '<div style="font-size:11px;color:#bbb;margin-top:4px;">© 2026 一屿视频 All Rights Reserved</div>' +
    '</div></div>';
  if (body) body.insertAdjacentHTML('beforeend', infoHtml);
}

function closeSettingModal() {
  var m = document.getElementById('setting-modal');
  if (m) m.style.display = 'none';
}

function saveSettingServer() {
  var input = document.getElementById('setting-server-input');
  var url = input ? input.value.trim() : '';
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
  if (typeof setServerUrl === 'function') setServerUrl(url || '');
  var cur = document.getElementById('setting-current-server');
  if (cur) cur.textContent = (typeof getServerUrl === 'function' ? getServerUrl() : '') || '默认服务器';
  showToast('服务器地址已保存', 'success');
}

function clearAppCache() {
  if (!confirm('确定清除缓存？这将清空搜索记录等本地缓存数据。')) return;
  localStorage.removeItem('yiyu_search_history');
  localStorage.removeItem('yiyu_watched');
  state.searchHistory = [];
  state.watchedEpisodes = {};
  if (navigator.serviceWorker) {
    try {
      caches.keys().then(function (keys) {
        for (var i = 0; i < keys.length; i++) caches.delete(keys[i]);
      });
    } catch (e) {}
  }
  showToast('缓存已清除', 'success');
}

function doLogout() {
  if (!confirm('确定退出登录？')) return;
  localStorage.removeItem('yiyu_token');
  localStorage.removeItem('yiyu_user');
  state.token = null;
  state.user = null;
  showToast('已退出登录', 'success');
  setTimeout(function () {
    window.location.href = 'login.html';
  }, 500);
}

/* ==================== 详情页 openDetail ==================== */

function openDetail(id, sourceKey) {
  if (!id) return;
  state.detail = null;
  state.detailLineIdx = 0;
  state.detailEpIdx = 0;

  var page = document.getElementById('page-detail');
  if (!page) return;
  page.classList.add('show');
  page.style.transform = 'translateX(0)';
  page.style.transition = 'transform 0.3s ease';
  page.style.display = 'block';

  var content = page.querySelector('.detail-content');
  if (content) content.scrollTop = 0;

  showDetailLoading();
  apiGet('/detail?source=' + encodeURIComponent(sourceKey || '') + '&id=' + encodeURIComponent(id), function (res) {
    var data = (res && res.code === 0) ? (res.data || res.video) : null;
    if (data) {
      state.detail = data;
      state.detail.id = id;
      state.detail.sourceKey = sourceKey || data.sourceKey || '';
      renderDetailPage(data);
    } else {
      hideDetailLoading();
      showToast((res && res.message) || '详情加载失败', 'error');
      setTimeout(function () { closeDetail(); }, 1000);
    }
  }, function () {
    hideDetailLoading();
    showToast('网络错误，请稍后重试', 'error');
    setTimeout(function () { closeDetail(); }, 1000);
  });

  checkFavoriteStatus(id, sourceKey);
}

function showDetailLoading() {
  var page = document.getElementById('page-detail');
  if (!page) return;
  var old = page.querySelector('.detail-loading-mask');
  if (old) return;
  var mask = document.createElement('div');
  mask.className = 'detail-loading-mask';
  mask.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,0.95);z-index:10;display:flex;align-items:center;justify-content:center;';
  mask.innerHTML = '<div style="text-align:center;"><div style="width:40px;height:40px;border:3px solid #ff6b6b;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;"></div><div style="color:#666;font-size:13px;">加载中...</div></div>';
  page.appendChild(mask);
}

function hideDetailLoading() {
  var page = document.getElementById('page-detail');
  if (!page) return;
  var mask = page.querySelector('.detail-loading-mask');
  if (mask) mask.parentNode.removeChild(mask);
}

function renderDetailPage(v) {
  hideDetailLoading();
  var coverImg = document.getElementById('detail-cover-img');
  if (coverImg) {
    if (v.cover) {
      coverImg.src = v.cover;
      coverImg.style.display = 'block';
    } else {
      coverImg.style.display = 'none';
      coverImg.parentNode.style.background = 'linear-gradient(135deg,#667eea,#764ba2)';
    }
  }
  var titleEl = document.getElementById('detail-title');
  if (titleEl) titleEl.textContent = v.title || '';
  var scoreEl = document.getElementById('detail-score');
  if (scoreEl) scoreEl.textContent = v.score ? Number(v.score).toFixed(1) : '--';

  var tagsEl = document.getElementById('detail-tags');
  if (tagsEl) {
    var tags = [];
    if (v.category) tags.push(v.category);
    if (v.area) tags.push(v.area);
    if (v.year) tags.push(String(v.year));
    if (v.genre) {
      var arr = (typeof v.genre === 'string') ? v.genre.split(/[,，/]/) : v.genre;
      for (var i = 0; i < arr.length; i++) if (arr[i]) tags.push(arr[i]);
    }
    tagsEl.innerHTML = tags.slice(0, 6).map(function (t) {
      return '<span class="detail-tag">' + escapeHtml(t.trim()) + '</span>';
    }).join('');
  }

  var descEl = document.getElementById('detail-desc');
  if (descEl) {
    descEl.textContent = v.content || v.blurb || v.intro || '暂无简介';
    descEl.style.webkitLineClamp = '3';
    descEl.style.display = '-webkit-box';
    descEl.style.webkitBoxOrient = 'vertical';
    descEl.style.overflow = 'hidden';
    var expandBtn = document.querySelector('.detail-desc-expand');
    if (expandBtn) expandBtn.textContent = '展开全部 ▼';
  }

  renderCast(v.actors || v.cast || []);
  renderPlayLines(v.playLines || v.lines || []);
}

function renderCast(actors) {
  var list = document.querySelector('.cast-list');
  if (!list) return;
  if (!actors || !actors.length) {
    list.innerHTML = '<div style="padding:12px;color:#999;font-size:13px;">暂无演员信息</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < actors.length; i++) {
    var a = actors[i];
    var name = a.name || '';
    var role = a.role || '';
    var avatar = a.avatar || a.photo || '';
    html +=
      '<div class="cast-item">' +
      '<div class="cast-avatar" style="width:56px;height:56px;border-radius:50%;overflow:hidden;background:#f0f0f0;">' +
        (avatar ? '<img src="' + escapeHtml(avatar) + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;">👤</div>') +
      '</div>' +
      '<div class="cast-name" style="font-size:12px;color:#1a1a1a;margin-top:6px;text-align:center;">' + escapeHtml(name) + '</div>' +
      (role ? '<div class="cast-role" style="font-size:10px;color:#999;text-align:center;">饰 ' + escapeHtml(role) + '</div>' : '') +
      '</div>';
  }
  list.innerHTML = html;
}

function renderPlayLines(lines) {
  var tabsEl = document.getElementById('detail-line-tabs');
  var epsEl = document.getElementById('detail-episodes');
  if (!lines || !lines.length) {
    if (tabsEl) tabsEl.innerHTML = '<div style="padding:12px;color:#999;font-size:13px;">暂无播放线路</div>';
    if (epsEl) epsEl.innerHTML = '';
    return;
  }
  if (tabsEl) {
    var tabsHtml = '';
    for (var i = 0; i < lines.length; i++) {
      tabsHtml += '<div class="line-tab ' + (i === state.detailLineIdx ? 'active' : '') + '" onclick="switchDetailLine(' + i + ')">' + escapeHtml(lines[i].lineName || ('线路' + (i + 1))) + '</div>';
    }
    tabsEl.innerHTML = tabsHtml;
  }
  renderDetailEpisodes(lines[state.detailLineIdx] || { episodes: [] });
}

function switchDetailLine(idx) {
  state.detailLineIdx = idx;
  state.detailEpIdx = 0;
  renderPlayLines((state.detail && state.detail.playLines) || (state.detail && state.detail.lines) || []);
}

function renderDetailEpisodes(line) {
  var epsEl = document.getElementById('detail-episodes');
  if (!epsEl) return;
  var episodes = (line && line.episodes) || [];
  var watchKey = (state.detail && (state.detail.sourceKey || '') + '_' + (state.detail.id || '')) || '';
  var watched = state.watchedEpisodes[watchKey] || [];

  if (!episodes.length) {
    epsEl.innerHTML = '<div style="padding:12px;color:#999;font-size:13px;">暂无可播放剧集</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < episodes.length; i++) {
    var ep = episodes[i];
    var isActive = (i === state.detailEpIdx);
    var isWatched = watched.indexOf(i) > -1;
    html += '<div class="episode-item' + (isActive ? ' active' : '') + (isWatched ? ' watched' : '') + '" onclick="playDetailEpisode(' + i + ')" style="background:' + (isWatched && !isActive ? '#fff1f0' : '') + ';">' + escapeHtml(ep.name || ('第' + (i + 1) + '集')) + '</div>';
  }
  epsEl.innerHTML = html;
}

function playDetailEpisode(epIdx) {
  state.detailEpIdx = epIdx;
  var lines = (state.detail && state.detail.playLines) || (state.detail && state.detail.lines) || [];
  var line = lines[state.detailLineIdx] || { episodes: [] };
  var ep = (line.episodes || [])[epIdx];
  if (!ep || !ep.url) {
    showToast('播放地址无效，请切换线路', 'error');
    return;
  }
  renderDetailEpisodes(line);
  recordWatchHistory(state.detail.id, state.detail.sourceKey, ep, line);
  openPlayer(ep.url, (state.detail.title || '') + ' · ' + (ep.name || ('第' + (epIdx + 1) + '集')), state.detail.id, state.detail.sourceKey, epIdx);
}

function openPlayerFromDetail() {
  if (!state.detail) {
    showToast('详情加载中...');
    return;
  }
  var lines = (state.detail.playLines || state.detail.lines || []);
  if (!lines.length || !lines[0].episodes || !lines[0].episodes.length) {
    showToast('暂无可播放源', 'error');
    return;
  }
  playDetailEpisode(state.detailEpIdx);
}

function toggleDesc() {
  var descEl = document.getElementById('detail-desc');
  var btn = document.querySelector('.detail-desc-expand');
  if (!descEl) return;
  if (descEl.style.webkitLineClamp === '3' || !descEl.dataset.expanded) {
    descEl.style.webkitLineClamp = 'unset';
    descEl.style.display = 'block';
    descEl.dataset.expanded = '1';
    if (btn) btn.textContent = '收起 ▲';
  } else {
    descEl.style.webkitLineClamp = '3';
    descEl.style.display = '-webkit-box';
    delete descEl.dataset.expanded;
    if (btn) btn.textContent = '展开全部 ▼';
  }
}

function closeDetail() {
  var page = document.getElementById('page-detail');
  if (!page) return;
  page.style.transition = 'transform 0.3s ease';
  page.style.transform = 'translateX(100%)';
  setTimeout(function () {
    page.style.display = 'none';
    page.classList.remove('show');
  }, 300);
}

/* ---------- 收藏状态 ---------- */

function checkFavoriteStatus(id, sourceKey) {
  var btn = document.getElementById('detail-fav-btn');
  if (btn) {
    btn.classList.remove('favorited');
    var icon = btn.querySelector('.detail-action-icon');
    if (icon) icon.textContent = '☆';
    var spans = btn.querySelectorAll('span');
    if (spans[1]) spans[1].textContent = '收藏';
  }
  apiGet('/user/favorites', function (res) {
    var list = (res && res.code === 0 && res.data) ? (res.data.list || res.data) : [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var fid = f.vodId || f.id;
      var fsk = f.sourceKey;
      if (String(fid) === String(id) && (!sourceKey || !fsk || fsk === sourceKey)) {
        markDetailFavorited();
        return;
      }
    }
  });
}

function markDetailFavorited() {
  var btn = document.getElementById('detail-fav-btn');
  if (!btn) return;
  btn.classList.add('favorited');
  btn.style.background = 'linear-gradient(135deg,#f6d365,#fda085)';
  btn.style.color = '#fff';
  var icon = btn.querySelector('.detail-action-icon');
  if (icon) icon.textContent = '⭐';
  var spans = btn.querySelectorAll('span');
  if (spans[1]) spans[1].textContent = '已收藏';
}

function unmarkDetailFavorited() {
  var btn = document.getElementById('detail-fav-btn');
  if (!btn) return;
  btn.classList.remove('favorited');
  btn.style.background = '';
  btn.style.color = '';
  var icon = btn.querySelector('.detail-action-icon');
  if (icon) icon.textContent = '☆';
  var spans = btn.querySelectorAll('span');
  if (spans[1]) spans[1].textContent = '收藏';
}

function toggleFav() {
  if (!checkLogin()) return;
  if (!state.detail) return;
  var id = state.detail.id;
  var sourceKey = state.detail.sourceKey || '';
  var btn = document.getElementById('detail-fav-btn');
  var isFav = btn ? btn.classList.contains('favorited') : false;
  if (isFav) {
    // 不弹确认框，直接取消收藏，无大弹窗仅Toast（解决收藏弹窗太大问题）
    apiDelete('/user/favorites', { sourceKey: sourceKey, vodId: id }, function (res) {
      if (!res || res.code === 0) {
        unmarkDetailFavorited();
        showToast('已取消收藏', 'success');
      } else {
        showToast(res.message || '取消失败', 'error');
      }
    }, function () { showToast('网络错误', 'error'); });
  } else {
    apiPost('/user/favorites', {
      vodId: id,
      sourceKey: sourceKey,
      title: state.detail.title,
      cover: state.detail.cover,
      remarks: state.detail.remarks,
      score: state.detail.score
    }, function (res) {
      if (res && res.code === 0) {
        markDetailFavorited();
        // 无大弹窗，仅轻提示
        showToast('收藏成功 ⭐', 'success');
      } else if (res && res.code === 1 && /已收藏/.test(res.message || '')) {
        markDetailFavorited();
      } else {
        showToast((res && res.message) || '收藏失败', 'error');
      }
    }, function () { showToast('网络错误', 'error'); });
  }
}

// 我的收藏里删除：不弹confirm，直接操作（解决大弹窗问题）
function deleteFavorite(favId, vodId, sourceKey) {
  var path = '/user/favorites';
  var body = { sourceKey: sourceKey || '', vodId: vodId || '' };
  if (favId && favId.indexOf('_') === -1) {
    // 如果有独立 id 也用 body 透传兼容
    body.favId = favId;
  }
  apiDelete(path, body, function (res) {
    if (!res || res.code === 0) {
      showToast('已取消收藏', 'success');
      loadFavoritesList();
    } else {
      showToast(res.message || '操作失败', 'error');
    }
  }, function () {
    showToast('网络错误', 'error');
  });
}

function shareVideo() {
  var v = state.detail;
  if (!v) return;
  var text = '《' + (v.title || '') + '》- 一屿视频';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () {
      showToast('分享信息已复制', 'success');
    }).catch(function () {
      showToast('已复制分享信息');
    });
  } else {
    showToast('已复制分享信息');
  }
}

function recordWatchHistory(vodId, sourceKey, ep, line) {
  var body = {
    vodId: vodId,
    sourceKey: sourceKey || '',
    episodeIndex: state.detailEpIdx,
    episodeName: ep.name || ('第' + (state.detailEpIdx + 1) + '集'),
    lineName: line.lineName || '',
    progress: 0
  };
  apiPost('/user/history', body, function () { });

  var watchKey = (sourceKey || '') + '_' + (vodId || '');
  if (!state.watchedEpisodes[watchKey]) state.watchedEpisodes[watchKey] = [];
  if (state.watchedEpisodes[watchKey].indexOf(state.detailEpIdx) === -1) {
    state.watchedEpisodes[watchKey].push(state.detailEpIdx);
    localStorage.setItem('yiyu_watched', JSON.stringify(state.watchedEpisodes));
  }
}

/* ==================== 播放页 openPlayer ==================== */

function openPlayer(url, title, vodId, sourceKey, episode) {
  if (!url) {
    showToast('播放地址无效', 'error');
    return;
  }
  var page = document.getElementById('page-player');
  if (!page) return;
  page.style.display = 'flex';

  var titleEl = document.getElementById('player-title');
  if (titleEl) titleEl.textContent = title || '播放';

  state.floatingInfo = { url: url, title: title, vodId: vodId, sourceKey: sourceKey, episode: episode };

  var video = document.getElementById('main-video-player');
  if (!video) return;
  if (state.hls) { try { state.hls.destroy(); } catch (e) { } state.hls = null; }
  state.player = video;

  if (isM3u8(url) && window.Hls && Hls.isSupported()) {
    state.hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, enableWorker: true });
    state.hls.loadSource(url);
    state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED, function () {
      video.play().catch(function () { });
    });
    state.hls.on(Hls.Events.ERROR, function (ev, data) {
      if (data && data.fatal) {
        showToast('播放出错，请尝试切换线路', 'error');
      }
    });
  } else {
    video.src = url;
    var onLoaded = function () {
      video.play().catch(function () { });
      video.removeEventListener('loadedmetadata', onLoaded);
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', function () {
      showToast('播放失败，请尝试切换线路', 'error');
    });
  }

  bindPlayerEvents(video);
  updatePlayerLineTabs();
  updatePlayerEpisodes();
  updateFloatingPlayer();
}

function bindPlayerEvents(video) {
  var playBtn = document.getElementById('player-play-btn');
  var curTime = document.getElementById('player-cur-time');
  var totalTime = document.getElementById('player-total-time');
  var progressFill = document.getElementById('player-progress-fill');
  var progressBar = document.querySelector('.player-progress-bar');

  if (playBtn) {
    playBtn.textContent = '⏸';
    playBtn.onclick = togglePlay;
  }

  video.ontimeupdate = function () {
    if (curTime) curTime.textContent = formatTime(video.currentTime);
    if (totalTime) totalTime.textContent = formatTime(video.duration);
    var pct = video.duration ? (video.currentTime / video.duration * 100) : 0;
    if (progressFill) progressFill.style.width = pct + '%';
  };

  video.onpause = function () { if (playBtn) playBtn.textContent = '▶'; };
  video.onplay = function () { if (playBtn) playBtn.textContent = '⏸'; };
  video.onended = function () { if (playBtn) playBtn.textContent = '▶'; };

  if (progressBar) {
    progressBar.onclick = function (e) {
      var rect = progressBar.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var pct = Math.max(0, Math.min(1, x / rect.width));
      if (video.duration) video.currentTime = pct * video.duration;
    };
  }
}

function togglePlay() {
  var video = state.player || document.getElementById('main-video-player');
  if (!video) return;
  if (video.paused) video.play().catch(function () { });
  else video.pause();
}

function cycleSpeed() {
  var video = state.player || document.getElementById('main-video-player');
  if (!video) return;
  var speeds = [1, 1.25, 1.5, 2];
  var cur = state.playSpeed || 1;
  var idx = speeds.indexOf(cur);
  idx = (idx + 1) % speeds.length;
  state.playSpeed = speeds[idx];
  video.playbackRate = state.playSpeed;
  var label = document.querySelector('.player-speed-label');
  if (label) label.textContent = state.playSpeed.toFixed(2).replace(/\.?0+$/, '') + 'x';
  showToast('倍速: ' + state.playSpeed + 'x');
}

function showPlayer() {
  var page = document.getElementById('page-player');
  if (page && state.floatingInfo) {
    page.style.display = 'flex';
  }
}

function closePlayer() {
  var page = document.getElementById('page-player');
  var video = state.player || document.getElementById('main-video-player');
  if (video) {
    try { video.pause(); } catch (e) { }
  }
  if (state.hls) { try { state.hls.destroy(); } catch (e) { } state.hls = null; }
  if (page) page.style.display = 'none';
  updateFloatingPlayer();
}

function updateFloatingPlayer() {
  var fp = document.getElementById('floating-player');
  if (!fp) return;
  if (!state.floatingInfo) {
    fp.style.display = 'none';
    return;
  }
  fp.style.display = 'flex';
  var info = state.floatingInfo;
  fp.innerHTML =
    '<span style="font-size:18px;margin-right:8px;">▶</span>' +
    '<span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;">' + escapeHtml(info.title || '') + '</span>' +
    '<span onclick="event.stopPropagation();closePlayerDirect()" style="margin-left:8px;cursor:pointer;padding:4px;">✕</span>';
}

function closePlayerDirect() {
  var video = state.player || document.getElementById('main-video-player');
  if (video) try { video.pause(); } catch (e) { }
  if (state.hls) { try { state.hls.destroy(); } catch (e) { } state.hls = null; }
  state.floatingInfo = null;
  var page = document.getElementById('page-player');
  if (page) page.style.display = 'none';
  var fp = document.getElementById('floating-player');
  if (fp) fp.style.display = 'none';
}

function updatePlayerLineTabs() {
  var lines = (state.detail && (state.detail.playLines || state.detail.lines)) || [];
  var container = document.querySelector('.player-line-switch');
  if (!container) return;
  if (!lines.length) { container.innerHTML = ''; return; }
  var html = '';
  for (var i = 0; i < lines.length; i++) {
    html += '<span class="player-line-btn ' + (i === state.detailLineIdx ? 'active' : '') + '" onclick="switchPlayerLine(' + i + ')">' + escapeHtml(lines[i].lineName || ('线路' + (i + 1))) + '</span>';
  }
  container.innerHTML = html;
}

function switchPlayerLine(idx) {
  state.detailLineIdx = idx;
  state.detailEpIdx = 0;
  updatePlayerLineTabs();
  updatePlayerEpisodes();
  var lines = (state.detail && (state.detail.playLines || state.detail.lines)) || [];
  var line = lines[idx];
  if (line && line.episodes && line.episodes[0]) {
    var ep = line.episodes[0];
    openPlayer(ep.url, (state.detail.title || '') + ' · ' + (ep.name || '第1集'), state.detail.id, state.detail.sourceKey, 0);
  }
}

function updatePlayerEpisodes() {
  var container = document.querySelector('.player-episodes');
  if (!container) return;
  var lines = (state.detail && (state.detail.playLines || state.detail.lines)) || [];
  var line = lines[state.detailLineIdx] || { episodes: [] };
  var eps = line.episodes || [];
  if (!eps.length) { container.innerHTML = ''; return; }
  var html = '';
  for (var i = 0; i < eps.length; i++) {
    html += '<div class="player-ep-item ' + (i === state.detailEpIdx ? 'active' : '') + '" onclick="playPlayerEpisode(' + i + ')">' + escapeHtml(eps[i].name || String(i + 1)) + '</div>';
  }
  container.innerHTML = html;
}

function playPlayerEpisode(idx) {
  var lines = (state.detail && (state.detail.playLines || state.detail.lines)) || [];
  var line = lines[state.detailLineIdx] || { episodes: [] };
  var ep = (line.episodes || [])[idx];
  if (!ep || !ep.url) return;
  state.detailEpIdx = idx;
  updatePlayerEpisodes();
  recordWatchHistory(state.detail.id, state.detail.sourceKey, ep, line);
  openPlayer(ep.url, (state.detail.title || '') + ' · ' + (ep.name || ('第' + (idx + 1) + '集')), state.detail.id, state.detail.sourceKey, idx);
}

function showEpisodeModal() {
  var info = document.querySelector('.player-info-panel');
  if (info) info.scrollIntoView({ behavior: 'smooth' });
}

/* ==================== 搜索功能 ==================== */

function showSearchModal() {
  var modal = document.getElementById('search-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  var input = document.getElementById('search-modal-input');
  if (input) {
    input.value = '';
    setTimeout(function () { input.focus(); }, 100);
  }
  renderHotSearch();
}

function closeSearchModal() {
  var modal = document.getElementById('search-modal');
  if (modal) modal.style.display = 'none';
}

function bindSearchInputEvents() {
  var input = document.getElementById('search-modal-input');
  if (!input) return;
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch();
  });
}

function renderHotSearch() {
  var modal = document.getElementById('search-modal');
  if (!modal) return;
  var hotBox = modal.querySelector('.modal-body > div:nth-child(4)');
  if (hotBox) return;
  var body = modal.querySelector('.modal-body');
  if (!body) return;
  var historyHtml = '';
  if (state.searchHistory && state.searchHistory.length) {
    historyHtml =
      '<div style="margin-top:18px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
      '<div style="font-size:13px;color:#666;font-weight:600;">📜 搜索历史</div>' +
      '<span onclick="clearSearchHistory()" style="font-size:11px;color:#999;cursor:pointer;">清空</span>' +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
      state.searchHistory.map(function (kw) {
        return '<span class="filter-chip" onclick="searchKeyword(\'' + escapeHtml(kw).replace(/'/g, "\\'") + '\')">' + escapeHtml(kw) + '</span>';
      }).join('') +
      '</div></div>';
  }
  body.insertAdjacentHTML('beforeend',
    '<div id="search-result-box" style="margin-top:18px;display:none;"></div>' +
    historyHtml
  );
}

function clearSearchHistory() {
  state.searchHistory = [];
  localStorage.removeItem('yiyu_search_history');
  showToast('历史记录已清空');
  var modal = document.getElementById('search-modal');
  if (modal) {
    var input = document.getElementById('search-modal-input');
    modal.remove();
    showSearchModal();
  }
}

function searchKeyword(kw) {
  var input = document.getElementById('search-modal-input');
  if (input) input.value = kw;
  doSearch();
}

function doSearch() {
  var input = document.getElementById('search-modal-input');
  var keyword = input ? input.value.trim() : '';
  if (!keyword) {
    showToast('请输入搜索内容');
    return;
  }
  if (state.searchHistory.indexOf(keyword) === -1) {
    state.searchHistory.unshift(keyword);
    if (state.searchHistory.length > 10) state.searchHistory.pop();
    localStorage.setItem('yiyu_search_history', JSON.stringify(state.searchHistory));
  }

  var resultBox = document.getElementById('search-result-box');
  if (!resultBox) {
    var body = document.querySelector('#search-modal .modal-body');
    if (body) {
      resultBox = document.createElement('div');
      resultBox.id = 'search-result-box';
      resultBox.style.marginTop = '18px';
      body.appendChild(resultBox);
    }
  }
  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.innerHTML = '<div style="text-align:center;padding:20px;"><div style="width:28px;height:28px;border:3px solid #ff6b6b;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto;"></div></div>';
  }

  apiGet('/search?wd=' + encodeURIComponent(keyword), function (res) {
    var list = (res && res.code === 0 && res.data) ? (res.data.list || res.data) : [];
    renderSearchResults(list, keyword);
  }, function () {
    if (resultBox) resultBox.innerHTML = '<div style="text-align:center;padding:30px;color:#999;font-size:13px;">搜索失败，请稍后重试</div>';
  });
}

function renderSearchResults(list, keyword) {
  var resultBox = document.getElementById('search-result-box');
  if (!resultBox) return;
  if (!list || !list.length) {
    resultBox.innerHTML =
      '<div style="text-align:center;padding:40px 20px;">' +
      '<div style="font-size:40px;margin-bottom:10px;">🔍</div>' +
      '<div style="color:#999;font-size:13px;">没有找到「' + escapeHtml(keyword) + '」相关的视频</div>' +
      '</div>';
    return;
  }
  var html =
    '<div style="font-size:13px;color:#666;margin-bottom:10px;">共找到 <strong style="color:#ff6b6b;">' + list.length + '</strong> 个结果</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px;max-height:40vh;overflow-y:auto;">';
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    html +=
      '<div onclick="openDetailFromSearch(\'' + escapeHtml(v.id || '') + '\',\'' + escapeHtml(v.sourceKey || '') + '\')" style="display:flex;gap:10px;padding:10px;background:#f8f8fa;border-radius:10px;cursor:pointer;">' +
      '<div style="width:50px;height:70px;border-radius:6px;overflow:hidden;background:#eee;flex-shrink:0;">' +
        (v.cover ? '<img src="' + escapeHtml(v.cover) + '" style="width:100%;height:100%;object-fit:cover;">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;">🎬</div>') +
      '</div>' +
      '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">' +
        '<div style="font-size:14px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(v.title || '') + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          (v.score ? '<span style="font-size:11px;color:#ff6b6b;">⭐' + Number(v.score).toFixed(1) + '</span>' : '') +
          (v.category ? '<span style="font-size:11px;color:#667eea;padding:1px 6px;background:#eef0ff;border-radius:6px;">' + escapeHtml(v.category) + '</span>' : '') +
          (v.year ? '<span style="font-size:11px;color:#666;">' + v.year + '</span>' : '') +
        '</div>' +
        (v.remarks ? '<div style="font-size:11px;color:#888;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">' + escapeHtml(v.remarks) + '</div>' : '') +
      '</div>' +
      '</div>';
  }
  html += '</div>';
  resultBox.innerHTML = html;
}

/* ================================================================
 * 新增 & 修复函数：倍速、全屏、线路切换、上下一集、搜索整页、
 * 注销账号、历史观看、性能缓存等
 * ================================================================ */

/* ---------- 播放控制：倍速（下拉无弹窗） ---------- */
function setPlaySpeed(rate) {
  var video = state.player || document.getElementById('main-video-player');
  if (!video) return;
  var r = parseFloat(rate);
  if (isNaN(r) || r <= 0) r = 1;
  state.playSpeed = r;
  try { video.playbackRate = r; } catch (e) { }
  var sel = document.getElementById('player-speed-select');
  if (sel) {
    for (var i = 0; i < sel.options.length; i++) {
      if (Math.abs(parseFloat(sel.options[i].value) - r) < 0.01) {
        sel.selectedIndex = i; break;
      }
    }
  }
  // 不再 showToast — 解决「倍速弹窗」问题
}

// 兼容老的 cycleSpeed 调用（但不再弹 Toast）
function cycleSpeed() {
  var video = state.player || document.getElementById('main-video-player');
  if (!video) return;
  var speeds = [1, 1.25, 1.5, 2];
  var cur = state.playSpeed || 1;
  var idx = speeds.indexOf(cur);
  idx = (idx + 1) % speeds.length;
  setPlaySpeed(speeds[idx]);
}

/* ---------- 播放控制：全屏（真实 requestFullscreen，不再弹窗） ---------- */
function toggleFullscreen() {
  var video = state.player || document.getElementById('main-video-player');
  var wrap = document.getElementById('page-player');
  var target = video || wrap || document.documentElement;
  try {
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
      if (target.requestFullscreen) target.requestFullscreen();
      else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
      else if (target.msRequestFullscreen) target.msRequestFullscreen();
      else if (video && video.webkitEnterFullscreen) {
        // iOS Safari <video> only
        video.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.msExitFullscreen) document.msExitFullscreen();
    }
  } catch (e) {
    showToast('当前浏览器不支持全屏', 'error');
  }
}

/* ---------- 播放控制：上下一集（真实切换，不再弹窗） ---------- */
function playPrevEpisode() {
  if (!state.detail) { showToast('暂无剧集信息', 'error'); return; }
  var idx = state.detailEpIdx - 1;
  if (idx < 0) { showToast('已经是第一集了'); return; }
  playPlayerEpisode(idx);
}

function playNextEpisode() {
  if (!state.detail) { showToast('暂无剧集信息', 'error'); return; }
  var lines = (state.detail.playLines || state.detail.lines || []);
  var line = lines[state.detailLineIdx] || { episodes: [] };
  var eps = line.episodes || [];
  var idx = state.detailEpIdx + 1;
  if (idx >= eps.length) { showToast('已经是最后一集了'); return; }
  playPlayerEpisode(idx);
}

/* ---------- 播放控制：线路切换（真实切换，不再弹窗） ---------- */
function toggleLinesPanel() {
  var sec = document.getElementById('player-lines-section');
  if (!sec) {
    // 滚动到选集区替代
    var info = document.querySelector('.player-info-panel');
    if (info) info.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  sec.classList.toggle('collapsed');
  if (!sec.classList.contains('collapsed')) {
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function switchLine(idx) {
  // 兼容 switchLine / switchPlayerLine 两种命名
  switchPlayerLine(idx);
}

/* ---------- 播放：线路 & 剧集 与播放器联动更新 ---------- */
var _origUpdatePlayerLineTabs = updatePlayerLineTabs;
updatePlayerLineTabs = function () {
  _origUpdatePlayerLineTabs && _origUpdatePlayerLineTabs();
  // 再额外把 button 都补齐 data-line-idx / onclick，避免 render 后点击无效
  var container = document.getElementById('player-line-switch');
  if (!container) return;
  var lines = (state.detail && (state.detail.playLines || state.detail.lines)) || [];
  var btns = container.querySelectorAll('.player-line-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].setAttribute('data-line-idx', String(i));
    (function (btn, idx) {
      btn.onclick = function () { switchPlayerLine(idx); };
    })(btns[i], Math.min(i, lines.length - 1 >= 0 ? lines.length - 1 : i));
  }
};

/* ---------- 播放页选集：也要补真实绑定 onclick（防止模板没绑定） ---------- */
var _origUpdatePlayerEpisodes = updatePlayerEpisodes;
updatePlayerEpisodes = function () {
  _origUpdatePlayerEpisodes && _origUpdatePlayerEpisodes();
  var container = document.querySelector('.player-episodes');
  if (!container) return;
  var items = container.querySelectorAll('.player-ep-item');
  for (var i = 0; i < items.length; i++) {
    (function (it, idx) {
      it.onclick = function () { playPlayerEpisode(idx); };
    })(items[i], i);
  }
};

/* ---------- 详情页线路 tabs：补事件绑定，解决线路切换无法使用 ---------- */
function _bindDetailLineClicks() {
  var tabsEl = document.getElementById('detail-line-tabs');
  if (!tabsEl) return;
  var tabs = tabsEl.querySelectorAll('.line-tab');
  for (var i = 0; i < tabs.length; i++) {
    (function (t, idx) {
      t.onclick = function () { switchDetailLine(idx); };
    })(tabs[i], i);
  }
}
var _origRenderPlayLines = renderPlayLines;
renderPlayLines = function (lines) {
  _origRenderPlayLines && _origRenderPlayLines(lines);
  _bindDetailLineClicks();
  // 同步更新播放页线路&剧集
  updatePlayerLineTabs();
  updatePlayerEpisodes();
};

/* ---------- 详情页剧集：补事件绑定 ---------- */
var _origRenderDetailEpisodes = renderDetailEpisodes;
renderDetailEpisodes = function (line) {
  _origRenderDetailEpisodes && _origRenderDetailEpisodes(line);
  var epsEl = document.getElementById('detail-episodes');
  if (!epsEl) return;
  var items = epsEl.querySelectorAll('.episode-item');
  for (var i = 0; i < items.length; i++) {
    (function (it, idx) {
      it.onclick = function () { playDetailEpisode(idx); };
    })(items[i], i);
  }
};

/* ================================================================
 * 搜索整页（showSearchModal 废弃，使用 openSearchPage）
 * ================================================================ */

function openSearchPage() {
  // 先切换到搜索页
  var allPages = document.querySelectorAll('.page');
  for (var i = 0; i < allPages.length; i++) allPages[i].classList.remove('active');
  var pg = document.getElementById('page-search');
  if (pg) pg.classList.add('active');
  state.currentPage = 'search';

  // 底部 tab 不高亮（搜索不属于4个tab）
  var tabs = document.querySelectorAll('#tab-bar .tab-item');
  for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');

  window.scrollTo(0, 0);
  renderSearchHistoryTags();
  var input = document.getElementById('search-page-input');
  if (input) { input.value = ''; setTimeout(function () { try { input.focus(); } catch (e) { } }, 80); }
  // 默认显示热门&历史，隐藏结果
  var hotSec = document.getElementById('search-hot-section');
  var resSec = document.getElementById('search-results');
  if (hotSec) hotSec.style.display = 'block';
  if (resSec) resSec.style.display = 'none';
}

function renderSearchHistoryTags() {
  var sec = document.getElementById('search-history-section');
  var box = document.getElementById('search-history-tags');
  if (!sec || !box) return;
  if (!state.searchHistory || !state.searchHistory.length) {
    sec.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  sec.style.display = 'block';
  var html = '';
  for (var i = 0; i < state.searchHistory.length; i++) {
    var kw = state.searchHistory[i];
    html += '<span class="search-hot-tag" onclick="searchKeyword(\'' + escapeHtml(kw).replace(/'/g, '\\\'') + '\')">' + escapeHtml(kw) + '</span>';
  }
  box.innerHTML = html;
}

function clearSearchHistory() {
  state.searchHistory = [];
  localStorage.removeItem('yiyu_search_history');
  renderSearchHistoryTags();
  showToast('搜索历史已清空', 'success');
}

function searchKeyword(kw) {
  var input = document.getElementById('search-page-input');
  if (input) input.value = kw;
  doSearchPage();
}

function doSearchPage() {
  var input = document.getElementById('search-page-input');
  var keyword = input ? input.value.trim() : '';
  if (!keyword) { showToast('请输入搜索内容'); return; }
  // 写入历史
  if (state.searchHistory.indexOf(keyword) === -1) {
    state.searchHistory.unshift(keyword);
    if (state.searchHistory.length > 10) state.searchHistory.pop();
    localStorage.setItem('yiyu_search_history', JSON.stringify(state.searchHistory));
  }
  renderSearchHistoryTags();

  var hotSec = document.getElementById('search-hot-section');
  var resSec = document.getElementById('search-results');
  var grid = document.getElementById('search-grid');
  var loading = document.getElementById('search-loading');
  if (hotSec) hotSec.style.display = 'none';
  if (resSec) resSec.style.display = 'block';
  if (grid) grid.innerHTML = buildGridSkeleton(8);
  if (loading) { loading.style.display = 'block'; loading.textContent = '搜索中...'; }

  // 性能：缓存最近一次搜索关键词，避免重复请求
  if (!state._searchCache) state._searchCache = {};
  var cacheKey = 'kw_' + keyword;
  if (state._searchCache[cacheKey]) {
    renderSearchGridResults(state._searchCache[cacheKey], keyword);
    return;
  }

  apiGet('/search?wd=' + encodeURIComponent(keyword), function (res) {
    var list = (res && res.code === 0 && res.data) ? (res.data.list || res.data) : [];
    try { state._searchCache[cacheKey] = list; } catch (e) { }
    renderSearchGridResults(list, keyword);
  }, function () {
    if (loading) loading.textContent = '';
    if (grid) grid.innerHTML = '<div style="grid-column:span 2;padding:60px 20px;text-align:center;"><div style="font-size:48px;margin-bottom:12px;">📡</div><div style="color:#999;font-size:14px;">搜索失败，请检查网络</div></div>';
  });
}

function renderSearchGridResults(list, keyword) {
  var grid = document.getElementById('search-grid');
  var loading = document.getElementById('search-loading');
  if (!grid) return;
  if (loading) loading.style.display = 'none';
  if (!list || !list.length) {
    grid.innerHTML =
      '<div style="grid-column:span 2;padding:60px 20px;text-align:center;">' +
      '<div style="font-size:48px;margin-bottom:12px;">🔍</div>' +
      '<div style="color:#999;font-size:14px;">没有找到「' + escapeHtml(keyword || '') + '」相关的视频</div>' +
      '</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += renderVideoCard(list[i]);
  }
  grid.innerHTML = html;
}

// 兼容原 showSearchModal / doSearch / closeSearchModal 调用（但全部走新的整页搜索）
function showSearchModal() { openSearchPage(); }
function closeSearchModal() { switchTab('home'); }
function doSearch() { doSearchPage(); }

// 重写 bindSearchInputEvents 为搜索页输入框绑定事件
function bindSearchInputEvents() {
  var input = document.getElementById('search-page-input');
  if (input) return; // 整页搜索在HTML直接绑定了 Enter，无需额外绑定
}

/* ================================================================
 * 历史观看：修复无法显示问题（额外兼容 history 空数组显示、
 * 从 {list,total} 结构读取、子页展示）
 * ================================================================ */

function loadHistoryList() {
  var container = document.getElementById('subpage-content');
  if (!container) return;
  container.innerHTML = buildSubListSkeleton(6);
  apiGet('/user/history?limit=100', function (res) {
    var data = (res && res.code === 0 && res.data) ? res.data : null;
    var list = [];
    if (data) {
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data.list)) list = data.list;
    }
    renderHistoryList(list);
  }, function () {
    container.innerHTML = buildSubEmpty('⏱️', '暂无观看记录');
  });
}

function renderHistoryList(list) {
  var container = document.getElementById('subpage-content');
  if (!container) return;
  var clearBtn = document.getElementById('subpage-action');
  if (clearBtn) clearBtn.onclick = function () {
    if (!list || !list.length) return;
    if (confirm('确定清空全部历史记录？')) clearAllHistory();
  };
  if (!list || !list.length) {
    container.innerHTML = buildSubEmpty('⏱️', '暂无观看记录，快去看片吧~');
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += renderHistoryItem(list[i]);
  }
  container.innerHTML = html;
  bindHistorySwipe();
}

function clickHistoryItem(id, sourceKey, recordId) {
  openDetail(id, sourceKey);
  // 关闭子页（历史）
  closeSubPage('history');
}

/* ================================================================
 * 注销账号（用户在「我的」页面或设置中可注销）
 * ================================================================ */

function showDeleteAccountModal() {
  if (!checkLogin()) return;
  if (state.user && state.user.isAdmin) {
    showToast('管理员账号不允许注销，请联系其他管理员操作', 'error');
    return;
  }
  var modal = document.createElement('div');
  modal.id = 'delete-account-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9200;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.onclick = function (e) { if (e.target === modal) closeDeleteAccountModal(); };
  var username = (state.user && state.user.username) || '';
  modal.innerHTML =
    '<div style="max-width:400px;width:100%;background:#fff;border-radius:16px;overflow:hidden;" onclick="event.stopPropagation()">' +
    '<div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;">' +
    '<h3 style="font-size:17px;margin:0;color:#d4380d;">🚫 注销账号</h3>' +
    '<span onclick="closeDeleteAccountModal()" style="cursor:pointer;font-size:18px;color:#999;">✕</span>' +
    '</div>' +
    '<div style="padding:20px;">' +
      '<div style="background:#fff1f0;border:1px solid #ffa39e;border-radius:10px;padding:12px 14px;color:#cf1322;font-size:13px;line-height:1.6;margin-bottom:16px;">⚠️ 账号注销后将永久删除所有个人数据，包括历史记录、收藏、会员权益等，且无法恢复，请谨慎操作！</div>' +
      '<label style="font-size:13px;color:#666;display:block;margin-bottom:6px;">请输入用户名以确认注销</label>' +
      '<input type="text" id="del-confirm-input" placeholder="请输入用户名：' + escapeHtml(username) + '" style="width:100%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:14px;box-sizing:border-box;margin-bottom:16px;">' +
      '<div style="display:flex;gap:10px;">' +
        '<button onclick="closeDeleteAccountModal()" style="flex:1;padding:13px;border:1px solid #e5e5e5;border-radius:10px;background:#fff;color:#555;font-size:14px;font-weight:600;cursor:pointer;">再想想</button>' +
        '<button id="del-submit-btn" onclick="submitDeleteAccount()" style="flex:1;padding:13px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff4444,#cc0000);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">确认注销</button>' +
      '</div>' +
    '</div></div>';
  document.body.appendChild(modal);
  setTimeout(function () {
    var inp = document.getElementById('del-confirm-input');
    if (inp) try { inp.focus(); } catch (e) { }
  }, 100);
}

function closeDeleteAccountModal() {
  var m = document.getElementById('delete-account-modal');
  if (m && m.parentNode) m.parentNode.removeChild(m);
}

function submitDeleteAccount() {
  if (!checkLogin()) return;
  var inp = document.getElementById('del-confirm-input');
  var val = inp ? inp.value.trim() : '';
  var username = (state.user && state.user.username) || '';
  if (val !== username) {
    showToast('用户名输入不一致，请重新输入', 'error');
    return;
  }
  var btn = document.getElementById('del-submit-btn');
  if (btn) { btn.textContent = '处理中...'; btn.disabled = true; btn.style.opacity = '0.6'; }
  // DELETE /api/auth/me 带 body 传 confirmUsername（用我们升级后的 apiDelete 带 body）
  apiDelete('/auth/me', { confirmUsername: val }, function (res) {
    if (res && res.code === 0) {
      showToast((res.message || '账号已注销') + '，再见！', 'success');
      closeDeleteAccountModal();
      localStorage.removeItem('yiyu_token');
      localStorage.removeItem('yiyu_user');
      localStorage.removeItem('yiyu_search_history');
      localStorage.removeItem('yiyu_watched');
      state.token = null; state.user = null;
      setTimeout(function () { window.location.href = 'login.html'; }, 1200);
    } else {
      showToast((res && res.message) || '注销失败', 'error');
      if (btn) { btn.textContent = '确认注销'; btn.disabled = false; btn.style.opacity = '1'; }
    }
  }, function () {
    showToast('网络错误，请稍后重试', 'error');
    if (btn) { btn.textContent = '确认注销'; btn.disabled = false; btn.style.opacity = '1'; }
  });
}

/* ================================================================
 * 性能优化：首页栏目、筛选、排行榜、详情加本地缓存，加快加载速度
 * ================================================================ */

function _cacheGet(key, maxAgeMs) {
  try {
    var raw = localStorage.getItem('yiyu_cache_' + key);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    if (!obj || !obj.t) return null;
    if (maxAgeMs > 0 && (Date.now() - obj.t) > maxAgeMs) return null;
    return obj.d;
  } catch (e) { return null; }
}
function _cacheSet(key, data) {
  try {
    localStorage.setItem('yiyu_cache_' + key, JSON.stringify({ t: Date.now(), d: data }));
  } catch (e) { /* storage quota */ }
}

// 包装 loadHomeSections：首屏立即读缓存渲染，再请求后端覆盖
var _origLoadHomeSections = loadHomeSections;
loadHomeSections = function () {
  var rows = {
    'row-new': document.getElementById('row-new'),
    'row-foreign': document.getElementById('row-foreign'),
    'row-tv': document.getElementById('row-tv'),
    'row-movie': document.getElementById('row-movie'),
    'row-variety': document.getElementById('row-variety'),
    'row-anime': document.getElementById('row-anime')
  };
  // 先渲染缓存（没有则展示骨架）
  var cached = _cacheGet('home_sections', 5 * 60 * 1000);
  if (cached) {
    renderSection('row-new', cached.newRecommend || []);
    renderSection('row-foreign', cached.foreignHot || []);
    renderSection('row-tv', cached.tvDramas || []);
    renderSection('row-movie', cached.movies || []);
    renderSection('row-variety', cached.variety || []);
    renderSection('row-anime', cached.anime || []);
  } else {
    for (var k in rows) {
      if (rows[k]) rows[k].innerHTML = buildSectionSkeleton(4);
    }
  }
  apiGet('/home/sections', function (res) {
    var data = (res && res.code === 0 && res.data) ? res.data : {};
    _cacheSet('home_sections', data);
    renderSection('row-new', data.newRecommend || []);
    renderSection('row-foreign', data.foreignHot || []);
    renderSection('row-tv', data.tvDramas || []);
    renderSection('row-movie', data.movies || []);
    renderSection('row-variety', data.variety || []);
    renderSection('row-anime', data.anime || []);
  }, function () {
    if (!cached) {
      for (var k2 in rows) {
        if (rows[k2]) rows[k2].innerHTML = '';
      }
    }
  });
};

/* ================================================================
 * switchTab：兼容搜索整页（page-search 不属于4个tab，也能切换）
 * ================================================================ */
var _origSwitchTab = switchTab;
switchTab = function (tabName) {
  if (tabName === 'search') { openSearchPage(); return; }
  _origSwitchTab && _origSwitchTab(tabName);
};

/* ================================================================
 * openPlayer：同步倍速下拉 selected 值；播放成功后补播
 * 放线路/剧集联动更新（解决打开播放器 🔀 无法切换线路）
 * ================================================================ */
var _origOpenPlayer = openPlayer;
openPlayer = function (url, title, vodId, sourceKey, episode) {
  _origOpenPlayer && _origOpenPlayer(url, title, vodId, sourceKey, episode);
  // 同步倍速到下拉
  var sel = document.getElementById('player-speed-select');
  if (sel) {
    for (var i = 0; i < sel.options.length; i++) {
      if (Math.abs(parseFloat(sel.options[i].value) - (state.playSpeed || 1)) < 0.01) {
        sel.selectedIndex = i; break;
      }
    }
  }
  // 打开播放器时重新渲染线路按钮，解决线路切换无法使用
  setTimeout(function () {
    updatePlayerLineTabs();
    updatePlayerEpisodes();
  }, 50);
};

// bindSearchInputEvents 兜底：页面加载时把搜索热词区也重写为真实事件
function _rewriteHotTagClicks() {
  try {
    var tags = document.querySelectorAll('#search-hot-tags .search-hot-tag');
    for (var i = 0; i < tags.length; i++) {
      (function (t) {
        t.addEventListener('click', function (e) {
          e.stopPropagation();
          var kw = t.textContent || t.innerText || '';
          if (kw) searchKeyword(kw);
        });
      })(tags[i]);
    }
  } catch (e) { }
}
setTimeout(_rewriteHotTagClicks, 0);

/* ================================================================
 * END 新增 & 修复函数
 * ================================================================ */

function openDetailFromSearch(id, sourceKey) {
  openDetail(id, sourceKey);
}

/* ==================== DOMContentLoaded 入口 ==================== */

(function addGlobalStyles() {
  try {
    var style = document.createElement('style');
    style.textContent =
      '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }' +
      '#page-detail { display:none; position:fixed; inset:0; background:#fff; z-index:7500; transform:translateX(100%); overflow-y:auto; }' +
      '#page-detail.show { transform:translateX(0); }' +
      '#page-player { display:none; position:fixed; inset:0; background:#000; z-index:8000; flex-direction:column; }' +
      '.toast { position:fixed; bottom:120px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:#fff; padding:10px 20px; border-radius:20px; font-size:13px; z-index:99999; opacity:0; transition:opacity 0.3s; pointer-events:none; max-width:80%; text-align:center; }' +
      '.toast.show { opacity:1; }' +
      '.toast-success { background:linear-gradient(135deg,#56ab2f,#a8e063); }' +
      '.toast-error { background:linear-gradient(135deg,#ee0979,#ff6a00); }' +
      '.toast-info { background:rgba(0,0,0,0.8); }' +
      '.floating-player { position:fixed; bottom:70px; right:16px; width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg,#ff6b6b,#ff8e53); color:#fff; display:none; align-items:center; justify-content:center; z-index:7000; box-shadow:0 6px 18px rgba(255,107,107,0.45); cursor:pointer; font-size:24px; padding:0 12px; }' +
      '.episode-item.watched { color:#ff6b6b; }' +
      '.modal { position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:9500; display:flex; align-items:center; justify-content:center; padding:20px; }' +
      '.modal-content { background:#fff; border-radius:16px; width:100%; overflow:hidden; }' +
      '.modal-header { padding:16px 20px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between; }' +
      '.modal-header h3 { margin:0; font-size:17px; }' +
      '.modal-close { cursor:pointer; font-size:18px; color:#999; }' +
      '.modal-body { padding:20px; }' +
      '.setting-label { font-size:13px; color:#666; display:block; margin-bottom:6px; }' +
      '.setting-desc { font-size:11px; color:#999; margin:0 0 8px; }' +
      '.setting-input { width:100%; padding:12px; border:1px solid #eee; border-radius:10px; font-size:14px; box-sizing:border-box; margin-bottom:12px; }' +
      '.auth-submit-btn { width:100%; padding:14px; border:none; border-radius:12px; background:linear-gradient(135deg,#ff6b6b,#ff8e8e); color:#fff; font-size:16px; font-weight:600; cursor:pointer; box-shadow:0 8px 20px rgba(255,107,107,0.25); margin-top:8px; }';
    document.head.appendChild(style);
  } catch (e) { }
})();

document.addEventListener('DOMContentLoaded', initApp);

/* ==================== 文件结束 ==================== */
