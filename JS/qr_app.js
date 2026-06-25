import { API_BASE_URL, getTodayStr, isWeekend, normalizePhoneLast4, escapeHTML } from './config.js';

let timerInterval;
let deferredPrompt;
let currentQRToken = '';
let currentQRName = '';
let currentQRPhoneLast4 = '';
let currentQRExpiresAt = 0;
let menuModalScrollY = 0;

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

// 앱 시작 시 저장된 이름과 전화번호 뒷자리를 자동으로 불러옴
// 예전 버전의 부서 저장값은 더 이상 사용하지 않습니다.
document.addEventListener('DOMContentLoaded', () => {
  const savedName = localStorage.getItem('hwao_lunch_name');
  const savedPhoneLast4 = localStorage.getItem('hwao_lunch_phoneLast4');

  if (savedName && nameInput()) nameInput().value = savedName;
  if (savedPhoneLast4 && phoneInput()) phoneInput().value = savedPhoneLast4;

  phoneInput()?.addEventListener('input', (e) => {
    e.target.value = normalizePhoneLast4(e.target.value);
  });

  if ($('menu-month')) $('menu-month').value = getCurrentMonth();
  schedulePageTopReset();
});


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
  const nodes = qrDiv.querySelectorAll('canvas, img, table');
  nodes.forEach(node => {
    node.style.width = '100%';
    node.style.height = '100%';
    node.style.maxWidth = '100%';
    node.style.maxHeight = '100%';
    node.style.display = 'block';
    node.style.margin = '0 auto';
    node.style.objectFit = 'contain';
    node.style.background = '#ffffff';
    if (node.tagName === 'TABLE') {
      node.style.borderCollapse = 'collapse';
      node.style.borderSpacing = '0';
    }
  });
}

function renderQRToContainer(token) {
  const qrDiv = $('qrcode');
  if (!qrDiv) return;
  const size = getOptimalQRSize();
  qrDiv.innerHTML = '';
  qrDiv.style.setProperty('--qr-render-size', `${size}px`);
  qrDiv.style.opacity = '1';
  new QRCode(qrDiv, {
    text: token,
    width: size,
    height: size,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: window.QRCode?.CorrectLevel?.H ?? 2
  });
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
const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroidDevice = () => /Android/i.test(navigator.userAgent || '');
const isStandaloneMode = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
let currentInstallContext = null;

function detectInstallContext() {
  const ua = navigator.userAgent || '';
  const ios = isIOSDevice();
  const android = isAndroidDevice();
  const ipad = ios && (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const inAppPatterns = [
    ['NAVER', /NAVER|NaverSearchApp/i, '네이버 앱 내부 브라우저'],
    ['KAKAOTALK', /KAKAOTALK/i, '카카오톡 내부 브라우저'],
    ['Instagram', /Instagram/i, '인스타그램 내부 브라우저'],
    ['Facebook', /FBAN|FBAV/i, '페이스북 내부 브라우저'],
    ['LINE', /Line\//i, 'LINE 내부 브라우저'],
    ['Daum', /DaumApps/i, '다음 앱 내부 브라우저']
  ];
  const inApp = inAppPatterns.find(([, pattern]) => pattern.test(ua));
  if (inApp) {
    return {
      key: `inapp-${inApp[0].toLowerCase()}`,
      name: inApp[2],
      mode: 'external',
      position: 'top-right',
      symbol: '•••',
      stepTitle: '외부 브라우저로 열기',
      locatorTitle: '이 근처의 메뉴를 누르세요',
      locatorText: '메뉴에서 “외부 브라우저로 열기” 또는 “기본 브라우저로 열기”를 찾으세요.',
      actionHint: '<b>••• / 메뉴</b>를 누르고 <b>외부 브라우저로 열기</b>를 선택하세요.',
      menuHint: 'Chrome, Safari, Samsung Internet, Edge 등에서 다시 연 뒤 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 선택하세요.',
      supportTitle: '이 브라우저에서는 홈 화면 추가가 제한될 수 있습니다.',
      supportDescription: '주소를 복사하거나 외부 브라우저로 연 뒤 다시 시도하는 것이 가장 확실합니다.',
      externalHint: '네이버·카카오톡 같은 앱 내부 브라우저는 홈 화면 추가 메뉴가 없거나 제한될 수 있습니다. 아래 “주소 복사”를 누른 뒤 Chrome, Safari, Samsung Internet 또는 Edge에서 열어주세요.'
    };
  }

  if (/SamsungBrowser/i.test(ua)) {
    return {
      key: 'samsung', name: 'Samsung Internet', mode: 'menu', position: 'bottom-right', symbol: '☰',
      stepTitle: '오른쪽 아래 메뉴 열기',
      locatorTitle: '오른쪽 아래 메뉴를 누르세요',
      locatorText: '☰ 메뉴에서 “페이지 추가” 또는 “앱 설치”를 찾으세요.',
      actionHint: '화면 <b>오른쪽 아래의 ☰ 메뉴</b>를 누르세요.',
      menuHint: '<b>페이지 추가</b>, <b>홈 화면</b>, 또는 <b>앱 설치</b>를 선택하세요.',
      supportTitle: 'Samsung Internet 메뉴 위치를 표시합니다.',
      supportDescription: '화면 오른쪽 아래 메뉴에서 홈 화면 추가 관련 항목을 찾을 수 있습니다.'
    };
  }

  if (/EdgiOS/i.test(ua)) {
    return {
      key: 'edge-ios', name: 'Microsoft Edge', mode: 'menu', position: 'bottom-right', symbol: '•••',
      stepTitle: '오른쪽 아래 메뉴 열기',
      locatorTitle: '오른쪽 아래 ••• 메뉴를 누르세요',
      locatorText: '메뉴에서 “홈 화면에 추가” 또는 “공유”를 찾으세요.',
      actionHint: '화면 <b>오른쪽 아래의 ••• 메뉴</b>를 누르세요.',
      menuHint: '<b>홈 화면에 추가</b>가 보이면 선택하세요. 없으면 <b>공유</b> 항목도 확인하세요.',
      supportTitle: 'Edge의 메뉴 위치를 표시합니다.',
      supportDescription: '브라우저 버전에 따라 메뉴 이름이나 위치가 조금 다를 수 있습니다.'
    };
  }

  if (/CriOS/i.test(ua)) {
    return {
      key: 'chrome-ios', name: 'Chrome', mode: 'menu', position: 'bottom-right', symbol: '•••',
      stepTitle: '오른쪽 아래 메뉴 열기',
      locatorTitle: '오른쪽 아래 ••• 메뉴를 누르세요',
      locatorText: '메뉴 또는 공유 목록에서 “홈 화면에 추가”를 찾으세요.',
      actionHint: '화면 <b>오른쪽 아래의 ••• 메뉴</b>를 누르세요.',
      menuHint: '<b>홈 화면에 추가</b> 또는 <b>공유</b>를 선택한 뒤 홈 화면 추가 항목을 찾으세요.',
      supportTitle: 'Chrome의 메뉴 위치를 표시합니다.',
      supportDescription: 'iPhone의 Chrome 버전에 따라 공유 목록을 한 번 더 열어야 할 수 있습니다.'
    };
  }

  if (/FxiOS/i.test(ua)) {
    return {
      key: 'firefox-ios', name: 'Firefox', mode: 'menu', position: 'bottom-right', symbol: '☰',
      stepTitle: '오른쪽 아래 메뉴 열기',
      locatorTitle: '오른쪽 아래 메뉴를 누르세요',
      locatorText: '메뉴에서 “공유” 또는 “홈 화면에 추가”를 찾으세요.',
      actionHint: '화면 <b>오른쪽 아래의 메뉴</b>를 누르세요.',
      menuHint: '<b>공유</b> 또는 <b>홈 화면에 추가</b> 항목을 선택하세요.',
      supportTitle: 'Firefox의 메뉴 위치를 표시합니다.',
      supportDescription: '버전에 따라 메뉴 아이콘 모양이 ☰ 또는 •••로 보일 수 있습니다.'
    };
  }

  if (ios && /Safari/i.test(ua)) {
    return {
      key: 'safari-ios', name: ipad ? 'Safari (iPad)' : 'Safari', mode: 'menu', position: ipad ? 'top-right' : 'bottom-center', symbol: '공유',
      stepTitle: '공유 버튼 열기',
      locatorTitle: ipad ? '오른쪽 위 공유 버튼을 누르세요' : '화면 아래쪽 공유 버튼을 누르세요',
      locatorText: '공유 목록을 아래로 내려 “홈 화면에 추가”를 선택하세요.',
      actionHint: ipad ? '화면 <b>오른쪽 위의 공유 버튼</b>을 누르세요.' : '주소창 주변 또는 화면 <b>아래쪽의 공유 버튼</b>을 누르세요.',
      menuHint: '공유 목록을 아래로 내려 <b>홈 화면에 추가</b>를 누르세요. 보이지 않으면 목록 아래의 <b>동작 편집</b>을 확인하세요.',
      supportTitle: 'Safari의 공유 버튼 위치를 표시합니다.',
      supportDescription: '공유 목록 안에서 홈 화면에 추가를 선택하면 됩니다.',
      officialUrl: 'https://support.apple.com/ko-kr/guide/iphone/iph42ab2f3a7/ios',
      officialLabel: 'Apple 공식 안내 보기'
    };
  }

  if (/EdgA/i.test(ua)) {
    return {
      key: 'edge-android', name: 'Microsoft Edge', mode: 'menu', position: 'bottom-center', symbol: '☰',
      stepTitle: '아래쪽 메뉴 열기',
      locatorTitle: '화면 아래쪽 메뉴를 누르세요',
      locatorText: '메뉴에서 “앱 설치” 또는 “휴대폰에 추가”를 찾으세요.',
      actionHint: '화면 <b>아래쪽의 메뉴 버튼</b>을 누르세요.',
      menuHint: '<b>앱 설치</b>, <b>홈 화면에 추가</b>, 또는 <b>휴대폰에 추가</b>를 선택하세요.',
      supportTitle: 'Edge 메뉴 위치를 표시합니다.',
      supportDescription: '설치 가능 상태에서는 앱 설치 항목이 표시됩니다.'
    };
  }

  if (/Whale/i.test(ua)) {
    return {
      key: 'whale', name: '네이버 웨일', mode: 'menu', position: 'bottom-right', symbol: '☰',
      stepTitle: '오른쪽 아래 메뉴 열기',
      locatorTitle: '오른쪽 아래 메뉴를 누르세요',
      locatorText: '홈 화면 추가 또는 바로가기 추가 항목을 찾으세요.',
      actionHint: '화면 <b>오른쪽 아래의 메뉴</b>를 누르세요.',
      menuHint: '<b>홈 화면에 추가</b> 또는 <b>바로가기 추가</b>를 선택하세요.',
      supportTitle: '웨일 메뉴 위치를 표시합니다.',
      supportDescription: '해당 항목이 보이지 않으면 주소를 복사해 Chrome 또는 Samsung Internet에서 다시 열어주세요.'
    };
  }

  if (/Firefox/i.test(ua) && android) {
    return {
      key: 'firefox-android', name: 'Firefox', mode: 'menu', position: 'top-right', symbol: '•••',
      stepTitle: '오른쪽 위 메뉴 열기',
      locatorTitle: '오른쪽 위 ••• 메뉴를 누르세요',
      locatorText: '메뉴에서 “설치” 또는 “홈 화면에 추가”를 찾으세요.',
      actionHint: '화면 <b>오른쪽 위의 ••• 메뉴</b>를 누르세요.',
      menuHint: '<b>설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요.',
      supportTitle: 'Firefox 메뉴 위치를 표시합니다.',
      supportDescription: '설치 항목이 없다면 주소 복사 후 Chrome이나 Samsung Internet에서 다시 시도하세요.'
    };
  }

  if (/Chrome/i.test(ua) && android) {
    return {
      key: 'chrome-android', name: 'Chrome', mode: 'menu', position: 'top-right', symbol: '⋮',
      stepTitle: '오른쪽 위 메뉴 열기',
      locatorTitle: '오른쪽 위 ⋮ 메뉴를 누르세요',
      locatorText: '메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택하세요.',
      actionHint: '화면 <b>오른쪽 위의 ⋮ 메뉴</b>를 누르세요.',
      menuHint: '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요.',
      supportTitle: 'Chrome 메뉴 위치를 표시합니다.',
      supportDescription: '설치 조건을 충족하면 메뉴에 앱 설치 항목이 나타납니다.'
    };
  }

  return {
    key: 'generic', name: '현재 브라우저', mode: 'menu', position: 'top-right', symbol: '•••',
    stepTitle: '브라우저 메뉴 열기',
    locatorTitle: '화면 가장자리의 메뉴를 찾으세요',
    locatorText: '•••, ⋮, ☰, 공유 아이콘 중 하나를 누른 뒤 홈 화면 추가를 찾으세요.',
    actionHint: '주소창 주변이나 화면 가장자리의 <b>••• / ⋮ / ☰ / 공유 메뉴</b>를 누르세요.',
    menuHint: '<b>홈 화면에 추가</b>, <b>앱 설치</b>, 또는 <b>바로가기 추가</b>를 선택하세요.',
    supportTitle: '브라우저 메뉴 위치를 안내합니다.',
    supportDescription: '메뉴가 보이지 않으면 주소를 복사해 Chrome, Safari, Samsung Internet 또는 Edge에서 다시 열어주세요.'
  };
}

function updateInstallButtonState() {
  const button = $('btn-add-shortcut');
  if (!button) return;

  if (isStandaloneMode()) {
    button.innerHTML = '✅ 홈 화면에<br>추가됨';
    button.setAttribute('aria-label', '이미 홈 화면에 추가됨');
    button.dataset.installed = 'true';
  } else {
    button.innerHTML = '📲 홈 화면<br>바로가기 추가';
    button.setAttribute('aria-label', '홈 화면 바로가기 추가');
    delete button.dataset.installed;
  }
}

function applyInstallGuideContext(context) {
  currentInstallContext = context || detectInstallContext();
  const ctx = currentInstallContext;
  if ($('ios-browser-name')) $('ios-browser-name').textContent = ctx.name;
  if ($('browser-menu-symbol')) $('browser-menu-symbol').textContent = ctx.symbol;
  if ($('browser-menu-step-title')) $('browser-menu-step-title').textContent = ctx.stepTitle;
  if ($('ios-browser-action-hint')) $('ios-browser-action-hint').innerHTML = ctx.actionHint;
  if ($('install-menu-item-hint')) $('install-menu-item-hint').innerHTML = ctx.menuHint;
  if ($('install-support-title')) $('install-support-title').textContent = ctx.supportTitle;
  if ($('install-support-description')) $('install-support-description').textContent = ctx.supportDescription;

  const banner = $('install-support-banner');
  if (banner) {
    banner.className = ctx.mode === 'external'
      ? 'rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-left mb-4'
      : 'rounded-2xl border-2 border-blue-100 bg-blue-50 p-4 text-left mb-4';
  }

  const external = $('external-browser-section');
  external?.classList.toggle('hidden', ctx.mode !== 'external');
  if ($('external-browser-hint') && ctx.externalHint) $('external-browser-hint').textContent = ctx.externalHint;

  const official = $('browser-official-guide');
  if (official) {
    if (ctx.officialUrl) {
      official.href = ctx.officialUrl;
      official.textContent = ctx.officialLabel || '공식 안내 보기';
      official.classList.remove('hidden');
      official.classList.add('inline-flex');
    } else {
      official.classList.add('hidden');
      official.classList.remove('inline-flex');
    }
  }

  const locatorButton = $('btn-show-browser-menu-guide');
  if (locatorButton) locatorButton.textContent = ctx.mode === 'external' ? '외부 브라우저 메뉴 위치 표시' : `${ctx.symbol} 메뉴 위치 표시`;
}

function openInstallGuide(context = detectInstallContext()) {
  applyInstallGuideContext(context);
  $('ios-install-modal')?.classList.remove('hidden');
}

function hideBrowserMenuLocator() {
  $('browser-menu-locator')?.classList.add('hidden');
}

function showBrowserMenuLocator(context = detectInstallContext()) {
  currentInstallContext = context;
  const locator = $('browser-menu-locator');
  if (!locator) return openInstallGuide(context);
  locator.dataset.position = context.position || 'top-right';
  if ($('browser-locator-symbol')) $('browser-locator-symbol').textContent = context.symbol || '•••';
  if ($('browser-menu-locator-title')) $('browser-menu-locator-title').textContent = context.locatorTitle || '이 근처의 메뉴를 찾으세요';
  if ($('browser-menu-locator-text')) $('browser-menu-locator-text').textContent = context.locatorText || '메뉴에서 홈 화면 추가를 선택하세요.';
  locator.classList.remove('hidden');
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

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  hideBrowserMenuLocator();
  $('ios-install-modal')?.classList.add('hidden');
  updateInstallButtonState();
});

window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateInstallButtonState);

$('btn-add-shortcut')?.addEventListener('click', async () => {
  if (isStandaloneMode()) {
    alert('이미 홈 화면에서 앱으로 실행 중입니다.');
    return;
  }

  if (deferredPrompt) {
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') updateInstallButtonState();
    return;
  }

  const context = detectInstallContext();
  if (context.mode === 'external') {
    openInstallGuide(context);
  } else {
    showBrowserMenuLocator(context);
  }
});

$('btn-show-browser-menu-guide')?.addEventListener('click', () => {
  const context = currentInstallContext || detectInstallContext();
  $('ios-install-modal')?.classList.add('hidden');
  window.setTimeout(() => showBrowserMenuLocator(context), 80);
});
$('btn-copy-page-link')?.addEventListener('click', copyCurrentPageUrl);
$('btn-close-ios-modal')?.addEventListener('click', () => $('ios-install-modal')?.classList.add('hidden'));
$('btn-close-browser-locator')?.addEventListener('click', hideBrowserMenuLocator);
$('btn-open-install-guide')?.addEventListener('click', () => {
  hideBrowserMenuLocator();
  openInstallGuide(currentInstallContext || detectInstallContext());
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    hideBrowserMenuLocator();
    $('ios-install-modal')?.classList.add('hidden');
  }
});

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
  if ($('menu-month')) $('menu-month').value = getCurrentMonth();
  menuModalScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.documentElement.classList.add('menu-modal-open');
  document.body.classList.add('menu-modal-open');
  document.body.style.top = `-${menuModalScrollY}px`;
  $('menu-modal')?.classList.remove('hidden');
  $('menu-list')?.scrollTo({ top: 0, behavior: 'auto' });
  loadMenuMonth(getCurrentMonth());
}

function closeMenuModal() {
  $('menu-modal')?.classList.add('hidden');
  document.documentElement.classList.remove('menu-modal-open');
  document.body.classList.remove('menu-modal-open');
  document.body.style.top = '';
  window.scrollTo(0, menuModalScrollY);
}

$('btn-open-menu')?.addEventListener('click', openMenuModal);
$('btn-load-menu')?.addEventListener('click', () => loadMenuMonth());
$('btn-close-menu')?.addEventListener('click', closeMenuModal);
$('menu-modal')?.addEventListener('click', (e) => {
  if (e.target === $('menu-modal')) closeMenuModal();
});

// ==========================================
// QR 발급
// ==========================================
async function generateLunchQR(isReissue = false) {
  const today = getTodayStr();
  if (isWeekend(today)) return alert('오늘은 주말입니다. 점심 체크를 운영하지 않습니다.');

  let name;
  let phoneLast4;

  if (isReissue) {
    name = localStorage.getItem('hwao_lunch_name') || '';
    phoneLast4 = localStorage.getItem('hwao_lunch_phoneLast4') || '';
  } else {
    name = nameInput().value.trim();
    phoneLast4 = normalizePhoneLast4(phoneInput().value);
    phoneInput().value = phoneLast4;

    if (!name) return alert('이름을 입력해 주세요.');
    if (!/^\d{4}$/.test(phoneLast4)) return alert('전화번호 뒷자리는 숫자 4자리로 입력해 주세요.');

    localStorage.setItem('hwao_lunch_name', name);
    localStorage.setItem('hwao_lunch_phoneLast4', phoneLast4);
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

  $('qr-form-container')?.classList.add('hidden');
  $('qrcode-container')?.classList.remove('hidden');

  $('qr-result-name').textContent = `${name}님 (${phoneLast4})`;
  renderQRToContainer(token);
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

$('btn-generate-qr')?.addEventListener('click', () => generateLunchQR(false));
$('btn-reissue-qr')?.addEventListener('click', () => generateLunchQR(true));
$('btn-back-to-form')?.addEventListener('click', resetToForm);
