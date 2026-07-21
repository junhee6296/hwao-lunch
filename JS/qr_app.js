const { API_BASE_URL, getTodayStr, isWeekend, normalizePhoneLast4, escapeHTML } = globalThis.LunchCheckConfig;

let timerInterval;
let deferredPrompt;
let currentQRToken = '';
let currentQRName = '';
let currentQRPhoneLast4 = '';
let currentQRExpiresAt = 0;
let menuModalScrollY = 0;
let currentQRColor = '#000000';

const $ = (id) => document.getElementById(id);
const nameInput = () => $('userName');
const phoneInput = () => $('phoneLast4');


if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function resetPageTop() {
  window.requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
}

function schedulePageTopReset() {
  [0, 80, 240].forEach(delay => window.setTimeout(resetPageTop, delay));
}

window.addEventListener('pageshow', schedulePageTopReset);

const formatKoreanDate = (dateStr) => {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}월 ${day}일(${weekday})`;
};

const getCurrentMonth = () => getTodayStr().slice(0, 7);


function syncModalViewportHeight() {
  const height = Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
  if (height > 0) document.documentElement.style.setProperty('--modal-viewport-height', `${height}px`);
}

function ensureModalPortals() {
  ['menu-modal', 'ios-install-modal'].forEach(id => {
    const modal = $(id);
    if (modal && modal.parentElement !== document.body) document.body.appendChild(modal);
  });
}

syncModalViewportHeight();
window.visualViewport?.addEventListener('resize', syncModalViewportHeight);
window.addEventListener('orientationchange', () => window.setTimeout(syncModalViewportHeight, 120));

// 앱 시작 시 저장된 이름과 전화번호 뒷자리를 자동으로 불러옴
// 예전 버전의 부서 저장값은 더 이상 사용하지 않습니다.
function safeStorageGet(key) {
  try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
}

function safeStorageSet(key, value) {
  try {
    const text = String(value || '').trim();
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch (_) {}
}

function restoreSavedUserInputs() {
  const savedName = safeStorageGet('hwao_lunch_name');
  const savedPhoneLast4 = normalizePhoneLast4(safeStorageGet('hwao_lunch_phoneLast4'));
  const nameEl = nameInput();
  const phoneEl = phoneInput();

  if (nameEl && !nameEl.value && savedName) nameEl.value = savedName;
  if (phoneEl && !phoneEl.value && savedPhoneLast4) phoneEl.value = savedPhoneLast4;
}

function bindUserInputPersistence() {
  const nameEl = nameInput();
  const phoneEl = phoneInput();

  nameEl?.addEventListener('input', (event) => {
    safeStorageSet('hwao_lunch_name', event.target.value);
  });

  phoneEl?.addEventListener('input', (event) => {
    const value = normalizePhoneLast4(event.target.value);
    event.target.value = value;
    safeStorageSet('hwao_lunch_phoneLast4', value);
  });
}

function initQRPage() {
  restoreSavedUserInputs();
  bindUserInputPersistence();

  if ($('menu-month')) $('menu-month').value = getCurrentMonth();
  ['lunchcheck_permanent_qr_enabled', 'lunchcheck_permanent_qr_warning_confirmed', 'lunchcheck_permanent_qr_cache_v1'].forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  ensureModalPortals();
  bindQRPageEvents();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  schedulePageTopReset();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQRPage, { once: true });
} else {
  initQRPage();
}
window.addEventListener('pageshow', restoreSavedUserInputs);

function getOptimalQRSize() {
  const container = $('qrcode-container');
  const qrDiv = $('qrcode');
  const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const landscape = viewportWidth > viewportHeight;
  const containerWidth = container?.clientWidth || viewportWidth;
  const shellPadding = landscape ? 44 : 56;
  const byWidth = Math.max(180, Math.min(420, containerWidth - shellPadding));
  const byViewportWidth = Math.max(180, Math.min(420, viewportWidth - (landscape ? 72 : 48)));
  const byHeight = Math.max(180, Math.min(420, Math.floor(viewportHeight * (landscape ? 0.48 : 0.34))));
  const framePadding = qrDiv ? parseInt(getComputedStyle(qrDiv).paddingLeft || '0', 10) * 2 : 32;
  return Math.max(180, Math.min(byWidth, byViewportWidth, byHeight) - framePadding);
}

function applyRenderedQRElementStyles() {
  const qrDiv = $('qrcode');
  if (!qrDiv) return;
  qrDiv.setAttribute('data-darkreader-ignore', '');
  qrDiv.style.background = '#ffffff';
  qrDiv.style.backgroundColor = '#ffffff';
  qrDiv.style.colorScheme = 'only light';
  qrDiv.style.forcedColorAdjust = 'none';
  qrDiv.style.filter = 'none';
  qrDiv.style.mixBlendMode = 'normal';

  qrDiv.querySelectorAll('*').forEach(node => {
    node.setAttribute('data-darkreader-ignore', '');
    node.style.colorScheme = 'only light';
    node.style.forcedColorAdjust = 'none';
    node.style.filter = 'none';
    node.style.mixBlendMode = 'normal';
  });

  const renderedNodes = qrDiv.querySelectorAll('canvas, img, table');
  renderedNodes.forEach(node => {
    node.style.width = '100%';
    node.style.height = '100%';
    node.style.maxWidth = '100%';
    node.style.maxHeight = '100%';
    node.style.display = 'block';
    node.style.margin = '0 auto';
    node.style.objectFit = 'contain';
    node.style.background = '#ffffff';
    node.style.backgroundColor = '#ffffff';
    node.setAttribute('data-darkreader-ignore', '');
    if (node.tagName === 'TABLE') {
      node.style.borderCollapse = 'collapse';
      node.style.borderSpacing = '0';
    }
  });
}

function freezeQRCodeAsOpaqueImage() {
  const qrDiv = $('qrcode');
  const sourceCanvas = qrDiv?.querySelector('canvas');
  if (!qrDiv || !sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return;

  try {
    const opaqueCanvas = document.createElement('canvas');
    opaqueCanvas.width = sourceCanvas.width;
    opaqueCanvas.height = sourceCanvas.height;
    const context = opaqueCanvas.getContext('2d', { alpha: false });
    if (!context) return;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, opaqueCanvas.width, opaqueCanvas.height);
    context.drawImage(sourceCanvas, 0, 0);

    const image = new Image();
    image.alt = '점심 식사 QR 코드';
    image.draggable = false;
    image.decoding = 'sync';
    image.setAttribute('data-darkreader-ignore', '');
    image.setAttribute('data-lunchcheck-qr-image', 'true');
    image.src = opaqueCanvas.toDataURL('image/png');
    qrDiv.replaceChildren(image);
  } catch (_) {
    // 일부 구형 브라우저에서는 canvas 변환이 제한될 수 있어 원본 QR을 그대로 유지합니다.
  }
}

function renderQRToContainer(token) {
  const qrDiv = $('qrcode');
  if (!qrDiv) return;
  const size = getOptimalQRSize();
  qrDiv.setAttribute('data-darkreader-ignore', '');
  qrDiv.setAttribute('data-lunchcheck-qr', 'true');
  qrDiv.innerHTML = '';
  qrDiv.style.setProperty('--qr-render-size', `${size}px`);
  qrDiv.style.opacity = '1';
  if (typeof window.QRCode !== 'function') {
    alert('QR 생성 스크립트를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 새로고침해 주세요.');
    resetToForm();
    return;
  }

  new QRCode(qrDiv, {
    text: token,
    width: size,
    height: size,
    colorDark: currentQRColor,
    colorLight: '#ffffff',
    correctLevel: window.QRCode?.CorrectLevel?.H ?? 2
  });
  freezeQRCodeAsOpaqueImage();
  applyRenderedQRElementStyles();
}

function rerenderCurrentQR() {
  if (!$('qrcode-container')?.classList.contains('hidden') && currentQRToken) {
    renderQRToContainer(currentQRToken);
  }
}

window.addEventListener('resize', () => {
  window.clearTimeout(window.__lunchcheckQRResizeTimer);
  window.__lunchcheckQRResizeTimer = window.setTimeout(rerenderCurrentQR, 120);
});
window.addEventListener('orientationchange', () => window.setTimeout(rerenderCurrentQR, 220));

// ==========================================
// 스마트폰 홈 화면 바로가기(PWA) 설치 로직
// ==========================================
const isStandaloneMode = () => (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

function detectInstallContext() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const isIOS = /iPad|iPhone|iPod/i.test(ua)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua);
  const isEdge = /Edg/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua) && isIOS;
  const restrictedBrowsers = [
    ['네이버 앱 내부 브라우저', /NAVER|NaverSearchApp/i],
    ['카카오톡 내부 브라우저', /KAKAOTALK/i],
    ['인스타그램 내부 브라우저', /Instagram/i],
    ['페이스북 내부 브라우저', /FBAN|FBAV/i],
    ['LINE 내부 브라우저', /Line\//i],
    ['다음 앱 내부 브라우저', /DaumApps/i]
  ];
  const restricted = restrictedBrowsers.find(([, pattern]) => pattern.test(ua));
  let os = 'desktop';
  if (isIOS) os = 'ios';
  else if (isAndroid) os = 'android';

  let name = '현재 브라우저';
  if (restricted) name = restricted[0];
  else if (isSamsung) name = '삼성 인터넷';
  else if (isEdge) name = 'Microsoft Edge';
  else if (isChrome) name = 'Chrome';
  else if (isSafari) name = 'Safari';

  return {
    os,
    restricted: Boolean(restricted),
    name,
    canUseNativePrompt: Boolean(deferredPrompt) && !isIOS && !restricted,
    officialGuideUrl: isIOS
      ? 'https://support.apple.com/ko-kr/guide/iphone/iph42ab2f3a7/ios'
      : 'https://support.google.com/chrome/answer/9658361?hl=ko'
  };
}

function updateInstallButtonState() {
  const button = $('btn-add-shortcut');
  if (!button) return;
  if (isStandaloneMode()) {
    button.innerHTML = '설치 완료';
    button.setAttribute('aria-label', '이미 앱으로 설치됨');
    button.dataset.installed = 'true';
  } else {
    const context = detectInstallContext();
    button.innerHTML = context.os === 'ios' ? '홈 화면<br>추가' : '앱 설치';
    button.setAttribute('aria-label', context.os === 'ios' ? '홈 화면에 추가' : '앱 설치');
    delete button.dataset.installed;
  }
}

function lockInstallOverlay() {
  document.documentElement.classList.add('install-guide-open');
  document.body.classList.add('install-guide-open');
}

function unlockInstallOverlay() {
  document.documentElement.classList.remove('install-guide-open');
  document.body.classList.remove('install-guide-open');
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setHTML(id, value) {
  const element = $(id);
  if (element) element.innerHTML = value;
}

function applyInstallGuideContent(context) {
  const guideLink = $('browser-official-guide');
  if (guideLink) guideLink.href = context.officialGuideUrl;

  if (context.os === 'ios') {
    $('install-guide-icon')?.setAttribute('src', '/img/shareicon.png');
    setText('install-guide-title', '홈 화면에 추가');
    setText('install-guide-subtitle', 'iPhone과 iPad는 Safari 공유 메뉴에서 추가합니다.');
    setText('install-step-1-title', '공유 버튼 누르기');
    setHTML('install-step-1-body', 'Safari 화면의 <b>하단 또는 상단</b>에서 공유 버튼을 탭하세요.');
    setText('install-step-2-title', '홈 화면에 추가 선택');
    setHTML('install-step-2-body', '목록을 아래로 내려 <b>홈 화면에 추가</b>를 누른 뒤 추가를 완료하세요.');
    setHTML('install-guide-note', '공유 버튼 위치는 iOS 버전과 화면 크기에 따라 달라질 수 있습니다. 항목이 보이지 않으면 공유 메뉴를 아래로 더 내려보세요.');
    if (guideLink) guideLink.textContent = 'Apple 공식 안내';
    return;
  }

  $('install-guide-icon')?.setAttribute('src', '/img/icon.png?v=20260701-emergency-fallback');
  if (context.os === 'android') {
    setText('install-guide-title', '앱 설치');
    setText('install-guide-subtitle', 'Android에서는 브라우저 메뉴에서 Lunch Check를 앱처럼 설치할 수 있습니다.');
    setText('install-step-1-title', 'Chrome 또는 삼성 인터넷으로 열기');
    setHTML('install-step-1-body', '주소창 옆 또는 화면 오른쪽 위의 <b>⋮ 메뉴</b>를 여세요.');
    setText('install-step-2-title', '앱 설치 찾기');
    setHTML('install-step-2-body', '<b>앱 설치</b>, <b>홈 화면에 추가</b>, 또는 <b>페이지를 앱으로 설치</b>를 선택하세요.');
    setHTML('install-guide-note', '설치 버튼이 바로 뜨면 이 안내창 없이 브라우저 설치창이 먼저 열립니다. 메뉴에 항목이 없다면 Chrome에서 다시 열어주세요.');
    if (guideLink) guideLink.textContent = 'Chrome 설치 안내';
    return;
  }

  setText('install-guide-title', 'PC에서 앱 설치');
  setText('install-guide-subtitle', 'Chrome 또는 Edge에서 Lunch Check를 데스크톱 앱처럼 설치할 수 있습니다.');
  setText('install-step-1-title', '주소창의 설치 아이콘 찾기');
  setHTML('install-step-1-body', '주소창 오른쪽의 <b>설치 아이콘</b>을 누르거나 브라우저 메뉴를 여세요.');
  setText('install-step-2-title', '앱 설치 선택');
  setHTML('install-step-2-body', 'Chrome은 <b>저장 및 공유 &gt; 페이지를 앱으로 설치</b>, Edge는 <b>앱 &gt; 이 사이트를 앱으로 설치</b>를 선택하세요.');
  setHTML('install-guide-note', '회사 PC나 일부 브라우저 설정에서는 설치 항목이 숨겨질 수 있습니다. 이 경우 Chrome 또는 Edge 최신 버전에서 다시 시도해 주세요.');
  if (guideLink) guideLink.textContent = 'Chrome 설치 안내';
}

function openInstallGuide(context = detectInstallContext()) {
  ensureModalPortals();
  syncModalViewportHeight();
  applyInstallGuideContent(context);
  const external = $('external-browser-section');
  external?.classList.toggle('hidden', !context.restricted);
  if ($('external-browser-hint') && context.restricted) {
    $('external-browser-hint').textContent = `${context.name}에서는 앱 설치가 제한될 수 있습니다. 주소를 복사해 Chrome, Safari, Edge 같은 일반 브라우저에서 다시 열어주세요.`;
  }
  lockInstallOverlay();
  $('ios-install-modal')?.classList.remove('hidden');
  $('ios-install-panel')?.scrollTo({ top: 0, behavior: 'auto' });
}

function closeInstallGuide() {
  $('ios-install-modal')?.classList.add('hidden');
  unlockInstallOverlay();
}

async function copyCurrentPageUrl() {
  const url = new URL('/qr.html', window.location.origin).href;
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    copied = document.execCommand('copy');
    textarea.remove();
  }
  const button = $('btn-copy-page-link');
  if (button) {
    const original = button.textContent;
    button.textContent = copied ? '주소 복사 완료' : '주소를 길게 눌러 복사하세요';
    window.setTimeout(() => { button.textContent = original; }, 1800);
  }
  if (!copied) window.prompt('아래 주소를 복사해 다른 브라우저에서 열어주세요.', url);
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;
  updateInstallButtonState();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  closeInstallGuide();
  updateInstallButtonState();
});

const standaloneMediaQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
standaloneMediaQuery?.addEventListener?.('change', updateInstallButtonState);
standaloneMediaQuery?.addListener?.(updateInstallButtonState);

async function handleAddShortcutClick() {
  if (isStandaloneMode()) {
    alert('이미 앱으로 설치되어 실행 중입니다.');
    return;
  }

  const context = detectInstallContext();
  if (context.canUseNativePrompt) {
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') updateInstallButtonState();
    else openInstallGuide(context);
    return;
  }

  openInstallGuide(context);
}

function handleInstallModalBackdropClick(event) {
  if (event.target === $('ios-install-modal')) closeInstallGuide();
}

function handleInstallModalTouchMove(event) {
  if (!event.target.closest('#ios-install-panel')) event.preventDefault();
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape' && !$('ios-install-modal')?.classList.contains('hidden')) closeInstallGuide();
}

document.addEventListener('keydown', handleDocumentKeydown);
document.addEventListener('DOMContentLoaded', updateInstallButtonState);
window.addEventListener('pageshow', updateInstallButtonState);

// ==========================================
// 식단표 보기
// ==========================================
function renderOriginItem(item) {
  const text = String(item || '').trim();
  const colonIndex = text.indexOf(':');
  if (colonIndex > 0) {
    const menuName = text.slice(0, colonIndex).trim();
    const origin = text.slice(colonIndex + 1).trim();
    return `<span class="menu-origin-chip"><strong>${escapeHTML(menuName)}</strong><em>${escapeHTML(origin)}</em></span>`;
  }
  return `<span class="menu-origin-chip"><em>${escapeHTML(text)}</em></span>`;
}

function renderMenuMonth(data) {
  const list = $('menu-list');
  if (!list) return;
  const days = data?.days || {};
  const dates = Object.keys(days).sort();

  if (dates.length === 0) {
    list.innerHTML = `
      <div class="text-center py-12 text-slate-700">
        <div class="text-4xl mb-3">🍽️</div>
        <p class="font-black">등록된 식단표가 없습니다.</p>
        <p class="text-sm mt-2 text-slate-500">관리자 페이지에서 해당 월 식단표 이미지를 업로드해 주세요.</p>
      </div>`;
    return;
  }

  const today = getTodayStr();
  list.innerHTML = dates.map(date => {
    const day = days[date] || {};
    const menus = Array.isArray(day.menu) ? day.menu : [];
    const origins = Array.isArray(day.origins) ? day.origins : [];
    const isHoliday = menus.includes('공휴일') || Boolean(day.holidayName);
    const isToday = date === today;
    return `
      <article class="menu-day-card ${isToday ? 'ring-4 ring-slate-300' : ''}">
        <div class="flex items-start justify-between gap-3 mb-3">
          <h4 class="text-lg font-black text-slate-900">${escapeHTML(formatKoreanDate(date))}</h4>
          <div class="flex gap-1 flex-wrap justify-end">${isToday ? '<span class="menu-pill">오늘</span>' : ''}${isHoliday ? '<span class="menu-pill">공휴일</span>' : ''}</div>
        </div>
        <div class="mb-3">
          <div class="text-xs font-black text-slate-600 mb-1">메뉴</div>
          ${isHoliday ? `<p class="text-red-600 font-black">공휴일${day.holidayName && day.holidayName !== '공휴일' ? ` <span class="text-sm text-red-400">(${escapeHTML(day.holidayName)})</span>` : ''}</p>` : (menus.length ? `<ul class="grid grid-cols-1 sm:grid-cols-2 gap-1 text-gray-900 font-bold">${menus.map(item => `<li>• ${escapeHTML(item)}</li>`).join('')}</ul>` : '<p class="text-gray-400 text-sm">추출된 메뉴가 없습니다.</p>')}
        </div>
        <div class="${isHoliday ? 'hidden' : ''}">
          <div class="text-xs font-black text-slate-600 mb-1">원산지</div>
          ${origins.length ? `<div class="flex flex-col gap-1">${origins.map(renderOriginItem).join('')}</div>` : '<p class="text-gray-400 text-sm">추출된 원산지가 없습니다.</p>'}
        </div>
      </article>`;
  }).join('');

  setTimeout(() => {
    const todayCard = list.querySelector('.ring-4');
    if (!todayCard) return;
    const targetTop = Math.max(0, todayCard.offsetTop - list.offsetTop - 12);
    list.scrollTo({ top: targetTop, behavior: 'auto' });
  }, 80);
}

async function loadMenuMonth(monthValue = $('menu-month')?.value || getCurrentMonth()) {
  const list = $('menu-list');
  if (!/^\d{4}-\d{2}$/.test(monthValue)) return alert('식단표 월 형식이 올바르지 않습니다.');
  if (list) list.innerHTML = '<div class="text-center text-slate-600 font-bold py-10">식단표를 불러오는 중입니다.</div>';

  try {
    const res = await fetch(`${API_BASE_URL}/menu/month/${monthValue}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) return alert(data.message || '식단표 조회 실패');
    renderMenuMonth(data);
  } catch (e) {
    if (list) list.innerHTML = '<div class="text-center text-red-500 font-bold py-10">식단표를 불러오지 못했습니다.</div>';
  }
}

function openMenuModal() {
  ensureModalPortals();
  syncModalViewportHeight();
  if ($('menu-month')) $('menu-month').value = getCurrentMonth();
  document.documentElement.classList.add('menu-modal-open');
  document.body.classList.add('menu-modal-open');
  $('menu-modal')?.classList.remove('hidden');
  $('menu-list')?.scrollTo({ top: 0, behavior: 'auto' });
  loadMenuMonth(getCurrentMonth());
}

function closeMenuModal() {
  $('menu-modal')?.classList.add('hidden');
  document.documentElement.classList.remove('menu-modal-open');
  document.body.classList.remove('menu-modal-open');
}

function handleMenuModalBackdropClick(event) {
  if (event.target === $('menu-modal')) closeMenuModal();
}

function handleMenuModalTouchMove(event) {
  if (!event.target.closest('#menu-modal-panel')) event.preventDefault();
}

// ==========================================
// QR 발급
// ==========================================
async function generateLunchQR(isReissue = false) {
  const today = getTodayStr();
  if (isWeekend(today)) return alert('오늘은 주말입니다. 점심 체크를 운영하지 않습니다.');

  let name;
  let phoneLast4;

  if (isReissue) {
    restoreSavedUserInputs();
    name = safeStorageGet('hwao_lunch_name') || nameInput()?.value?.trim() || '';
    phoneLast4 = normalizePhoneLast4(safeStorageGet('hwao_lunch_phoneLast4') || phoneInput()?.value || '');
  } else {
    name = nameInput().value.trim();
    phoneLast4 = normalizePhoneLast4(phoneInput().value);
    phoneInput().value = phoneLast4;

    if (!name) return alert('이름을 입력해 주세요.');
    if (!/^\d{4}$/.test(phoneLast4)) return alert('전화번호 뒷자리는 숫자 4자리로 입력해 주세요.');

    safeStorageSet('hwao_lunch_name', name);
    safeStorageSet('hwao_lunch_phoneLast4', phoneLast4);
  }

  if (!name || !/^\d{4}$/.test(phoneLast4)) {
    resetToForm();
    return alert('이름과 전화번호 뒷자리를 다시 입력해 주세요.');
  }

  try {
    const res = await fetch(`${API_BASE_URL}/qr/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phoneLast4 })
    });
    const data = await res.json();

    if (res.ok) renderQR(data.qrData, name, phoneLast4, data.expiresAt);
    else alert(data.message);
  } catch (e) {
    alert('서버 연결 실패');
  }
}

function renderQR(token, name, phoneLast4, expiresAt) {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  currentQRToken = token;
  currentQRName = name;
  currentQRPhoneLast4 = phoneLast4;
  currentQRExpiresAt = Number(expiresAt || 0);
  currentQRColor = '#000000';
  $('qr-form-container')?.classList.add('hidden');
  $('qrcode-container')?.classList.remove('hidden');

  $('qr-result-name').textContent = `${name}님 (${phoneLast4})`;
  renderQRToContainer(token);

  const validityText = $('qr-validity-text');
  if (validityText) {
    validityText.innerHTML = '이 QR은 <span id="timer" class="text-red-500 font-black">15:00</span> 동안 유효합니다.';
  }
  startTimer(expiresAt);
  schedulePageTopReset();
}

function startTimer(expiresAt) {
  clearInterval(timerInterval);
  const updateTimer = () => {
    const diff = Math.floor((Number(expiresAt || 0) - Date.now()) / 1000);
    if (diff <= 0) {
      clearInterval(timerInterval);
      $('timer').textContent = '00:00 (만료)';
      $('qrcode').style.opacity = '0.28';
      return;
    }
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function resetToForm() {
  clearInterval(timerInterval);
  currentQRToken = '';
  currentQRName = '';
  currentQRPhoneLast4 = '';
  currentQRExpiresAt = 0;
  $('qrcode-container')?.classList.add('hidden');
  $('qr-form-container')?.classList.remove('hidden');
  if ($('qrcode')) $('qrcode').innerHTML = '';
  schedulePageTopReset();
}

function bindOnce(element, eventName, handler, options) {
  if (!element) return;
  const key = `lunchcheckBound_${eventName}_${handler.name || 'anonymous'}`;
  if (element.dataset && element.dataset[key]) return;
  element.addEventListener(eventName, handler, options);
  if (element.dataset) element.dataset[key] = 'true';
}

function bindQRPageEvents() {
  bindOnce($('btn-add-shortcut'), 'click', handleAddShortcutClick);
  bindOnce($('btn-copy-page-link'), 'click', copyCurrentPageUrl);
  bindOnce($('btn-close-ios-modal'), 'click', closeInstallGuide);
  bindOnce($('ios-install-modal'), 'click', handleInstallModalBackdropClick);
  bindOnce($('ios-install-modal'), 'touchmove', handleInstallModalTouchMove, { passive: false });

  bindOnce($('btn-open-menu'), 'click', openMenuModal);
  bindOnce($('btn-load-menu'), 'click', () => loadMenuMonth());
  bindOnce($('btn-close-menu'), 'click', closeMenuModal);
  bindOnce($('menu-modal'), 'click', handleMenuModalBackdropClick);
  bindOnce($('menu-modal'), 'touchmove', handleMenuModalTouchMove, { passive: false });

  bindOnce($('btn-generate-qr'), 'click', () => generateLunchQR(false));
  bindOnce($('btn-reissue-qr'), 'click', () => generateLunchQR(true));
  bindOnce($('btn-back-to-form'), 'click', resetToForm);
}
