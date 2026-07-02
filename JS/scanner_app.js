import { API_BASE_URL, getTodayStr } from './config.js';

window.html5QrCode = null;
window.isScanningAction = false;
window.currentScannerFacingMode = 'environment';

const SCANNER_AUDIO = Object.freeze({
  success: '/audio/scansound.mp3',
  fail: '/audio/failsound.mp3'
});

let currentAudio = null;
let currentServiceDate = getTodayStr();
let lastDecodedText = '';
let lastDecodedAt = 0;
let resultResetTimer = null;
let scannerRestartPromise = null;
let orientationRestartTimer = null;
let lastRandomIndex = { success: -1, fail: -1 };
let cameraListCache = null;
let activeCameraId = '';

const SAME_CODE_COOLDOWN_MS = 5000;
const PROCESSING_COOLDOWN_MS = 1300;

const $ = (id) => document.getElementById(id);


function formatScannerDate(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return dateStr || '';
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
}

function addDaysToDateStr(dateStr, amount) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return dateStr || '';
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function isWeekendDateStr(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return false;
  const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekDay === 0 || weekDay === 6;
}

function getUpcomingServiceDates(startDate, count = 3) {
  const dates = [];
  let cursor = startDate;
  let guard = 0;

  while (dates.length < count && guard < 14) {
    if (!isWeekendDateStr(cursor)) dates.push(cursor);
    cursor = addDaysToDateStr(cursor, 1);
    guard += 1;
  }

  return dates;
}

function getRelativeMenuLabel(index, date, dates, baseDate) {
  if (date === baseDate) return '오늘';
  const futureIndex = index - (dates[0] === baseDate ? 1 : 0);
  return ['다음 급식일', '다다음 급식일', '세 번째 급식일'][futureIndex] || `${futureIndex + 1}번째 급식일`;
}

function formatScannerTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderAttendeeList(attendees) {
  const list = $('scanner-attendee-list');
  const count = $('scanner-attendee-count');
  if (count) count.textContent = `${attendees.length}명`;
  if (!list) return;

  list.replaceChildren();
  if (!attendees.length) {
    const empty = document.createElement('p');
    empty.className = 'scanner-attendee-empty';
    empty.textContent = '아직 식사자가 없습니다.';
    list.appendChild(empty);
    return;
  }

  attendees.forEach((attendee) => {
    const row = document.createElement('div');
    row.className = 'scanner-attendee-row';

    const name = document.createElement('span');
    name.className = 'scanner-attendee-name';
    name.textContent = attendee?.name || '-';

    const time = document.createElement('time');
    time.className = 'scanner-attendee-time';
    time.textContent = formatScannerTime(attendee?.scannedAt);

    row.append(name, time);
    list.appendChild(row);
  });
}

function renderUpcomingMenus(daysByDate, dates, baseDate = currentServiceDate) {
  const wrap = $('scanner-menu-days');
  const dateLabel = $('scanner-menu-date');
  if (!wrap) return;

  const safeDates = Array.isArray(dates) ? dates : [];
  if (dateLabel) {
    dateLabel.textContent = safeDates.length
      ? `${formatScannerDate(safeDates[0])}–${formatScannerDate(safeDates[safeDates.length - 1])}`
      : '';
  }

  wrap.replaceChildren();
  safeDates.forEach((date, index) => {
    const day = daysByDate?.[date] || null;
    const menus = Array.isArray(day?.menu) ? day.menu.filter(Boolean) : [];
    const isHoliday = Boolean(day?.holidayName) || menus.includes('공휴일');

    const article = document.createElement('article');
    article.className = `scanner-menu-day${date === baseDate ? ' is-today' : ''}`;

    const header = document.createElement('div');
    header.className = 'scanner-menu-day-head';

    const title = document.createElement('strong');
    title.className = 'scanner-menu-day-title';
    title.textContent = formatScannerDate(date);

    const badge = document.createElement('span');
    badge.className = 'scanner-menu-day-badge';
    badge.textContent = getRelativeMenuLabel(index, date, safeDates, baseDate);

    header.append(title, badge);
    article.appendChild(header);

    if (isHoliday) {
      const holiday = document.createElement('p');
      holiday.className = 'scanner-menu-holiday';
      holiday.textContent = day?.holidayName && day.holidayName !== '공휴일'
        ? `공휴일 · ${day.holidayName}`
        : '공휴일';
      article.appendChild(holiday);
    } else if (menus.length) {
      const list = document.createElement('ul');
      list.className = 'scanner-menu-day-list';
      menus.forEach((menu) => {
        const item = document.createElement('li');
        item.textContent = String(menu);
        list.appendChild(item);
      });
      article.appendChild(list);
    } else {
      const empty = document.createElement('p');
      empty.className = 'scanner-menu-empty';
      empty.textContent = '등록된 식단이 없습니다.';
      article.appendChild(empty);
    }

    wrap.appendChild(article);
  });
}

async function loadUpcomingMenus(date = currentServiceDate) {
  const requestedDate = date;
  const dates = getUpcomingServiceDates(requestedDate, 3);
  const yearMonths = [...new Set(dates.map(item => item.slice(0, 7)))];

  const responses = await Promise.all(yearMonths.map(async (yearMonth) => {
    try {
      const res = await fetch(`${API_BASE_URL}/menu/month/${encodeURIComponent(yearMonth)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`식단표 조회 실패: ${res.status}`);
      return await res.json();
    } catch (error) {
      console.error(`${yearMonth} 식단표 로드 실패:`, error);
      return { days: {} };
    }
  }));

  if (requestedDate !== currentServiceDate) return;
  const mergedDays = {};
  responses.forEach(data => Object.assign(mergedDays, data?.days || {}));
  renderUpcomingMenus(mergedDays, dates, requestedDate);
}

function stopCurrentAudio() {
  if (!currentAudio) return;
  try {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  } catch (_) {
    // 브라우저별 오디오 중지 예외는 무시합니다.
  }
  currentAudio = null;
}

function playScanFeedback(outcome) {
  const src = outcome === 'success' ? SCANNER_AUDIO.success : SCANNER_AUDIO.fail;
  if (!src) return;
  stopCurrentAudio();
  try {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.playsInline = true;
    currentAudio = audio;
    audio.onended = () => { if (currentAudio === audio) currentAudio = null; };
    audio.onerror = () => { if (currentAudio === audio) currentAudio = null; };
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => { if (currentAudio === audio) currentAudio = null; });
    }
  } catch (_) {
    currentAudio = null;
  }
}

async function unlockAudio() {
  try {
    const audio = new Audio(SCANNER_AUDIO.success);
    audio.muted = true;
    audio.volume = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch (_) {
    // 사용자 제스처 전 오디오 제한은 무시합니다.
  }
}

function resetScannerStats() {
  if ($('stat-count')) $('stat-count').textContent = '0명';
  if ($('recent-diner')) $('recent-diner').textContent = '없음';
  renderAttendeeList([]);
}

async function loadScannerStats(date = currentServiceDate) {
  const requestedDate = date;
  try {
    const res = await fetch(`${API_BASE_URL}/scanner/attendees/${encodeURIComponent(requestedDate)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('데이터를 불러올 수 없습니다.');
    const attendees = await res.json();
    if (requestedDate !== currentServiceDate) return;

    const attendedOnly = (Array.isArray(attendees) ? attendees : [])
      .sort((a, b) => new Date(b.scannedAt || 0) - new Date(a.scannedAt || 0));

    if ($('stat-count')) $('stat-count').textContent = `${attendedOnly.length}명`;
    if ($('recent-diner')) $('recent-diner').textContent = attendedOnly[0]?.name || '없음';
    renderAttendeeList(attendedOnly);
  } catch (error) {
    console.error('식수 현황 로드 실패:', error);
  }
}

function checkDateRollover() {
  const today = getTodayStr();
  if (today === currentServiceDate) return false;

  currentServiceDate = today;
  lastDecodedText = '';
  lastDecodedAt = 0;
  window.isScanningAction = false;
  resetScannerStats();
  loadScannerStats(today);
  loadUpcomingMenus(today);
  showScanResult('idle', 'QR 코드를 보여주세요', '새 날짜의 식수 집계를 시작합니다');
  return true;
}

function showScanResult(state, message, subMessage) {
  const panel = $('scan-result-panel');
  const msgEl = $('scan-msg');
  const subMsgEl = $('scan-sub-msg');
  if (!panel || !msgEl || !subMsgEl) return;

  panel.dataset.state = state;
  const guide = document.querySelector('.scan-guide');
  if (guide) guide.dataset.state = state;
  msgEl.textContent = message;
  subMsgEl.textContent = subMessage;

  window.clearTimeout(resultResetTimer);
  if (state !== 'idle') {
    resultResetTimer = window.setTimeout(() => {
      panel.dataset.state = 'idle';
      if (guide) guide.dataset.state = 'idle';
      msgEl.textContent = 'QR 코드를 보여주세요';
      subMsgEl.textContent = '인식 시 자동으로 식사 처리됩니다';
    }, 2600);
  }
}

function calculateScanBox(viewWidth, viewHeight) {
  const visualWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 1;
  const visualHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 1;
  const width = Number(viewWidth) > 0 ? Math.min(Number(viewWidth), visualWidth) : visualWidth;
  const height = Number(viewHeight) > 0 ? Math.min(Number(viewHeight), visualHeight) : visualHeight;
  const isMobile = width <= 680;

  let usableWidth;
  if (isMobile) {
    usableWidth = width * 0.74;
  } else {
    const menuWidth = document.querySelector('.scanner-menu-panel')?.getBoundingClientRect().width || 0;
    const attendeeWidth = document.querySelector('.scanner-attendee-panel')?.getBoundingClientRect().width || 0;
    const statsWidth = document.querySelector('.scanner-mini-stats')?.getBoundingClientRect().width || 0;
    const sideReserve = Math.max(menuWidth, attendeeWidth, statsWidth, 210) + 28;
    usableWidth = width - sideReserve * 2;
  }

  const usableHeight = isMobile
    ? height * 0.48
    : height - (height < 640 ? 138 : 178);
  const available = Math.max(170, Math.min(usableWidth, usableHeight));
  const size = Math.max(170, Math.min(460, Math.floor(available * 0.95)));

  document.documentElement.style.setProperty('--scanner-box-size', `${size}px`);
  return size;
}

async function waitForHtml5Qrcode() {
  for (let i = 0; i < 40; i += 1) {
    if (window.Html5Qrcode) return;
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  throw new Error('html5-qrcode library is not loaded.');
}

function createScannerInstance() {
  if (window.html5QrCode) return window.html5QrCode;

  const constructorConfig = { verbose: false };
  if (window.Html5QrcodeSupportedFormats?.QR_CODE !== undefined) {
    constructorConfig.formatsToSupport = [window.Html5QrcodeSupportedFormats.QR_CODE];
  }
  window.html5QrCode = new window.Html5Qrcode('reader', constructorConfig);
  return window.html5QrCode;
}

async function handleDecodedText(decodedText) {
  const token = String(decodedText || '').trim();
  if (!token) return;

  checkDateRollover();
  const now = Date.now();
  if (token === lastDecodedText && now - lastDecodedAt < SAME_CODE_COOLDOWN_MS) return;
  if (window.isScanningAction) return;

  lastDecodedText = token;
  lastDecodedAt = now;
  window.isScanningAction = true;

  showScanResult('working', 'QR 확인 중', '잠시만 기다려 주세요');

  let outcome = 'fail';
  try {
    const res = await fetch(`${API_BASE_URL}/qr/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrToken: token })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      outcome = 'success';
      showScanResult('success', `${data.name || ''}님 확인`, '식사 처리가 완료되었습니다');
      loadScannerStats(currentServiceDate);
    } else {
      showScanResult('fail', data.message || '처리하지 못했습니다', 'QR을 다시 확인해 주세요');
    }
  } catch (error) {
    console.error('QR 처리 실패:', error);
    showScanResult('fail', '서버 통신 오류', '네트워크 연결을 확인해 주세요');
  } finally {
    playScanFeedback(outcome);
    window.setTimeout(() => {
      window.isScanningAction = false;
    }, PROCESSING_COOLDOWN_MS);
  }
}

const FRONT_CAMERA_LABEL = /(front|user|selfie|facetime|전면|앞쪽|앞 카메라)/i;
const REAR_CAMERA_LABEL = /(back|rear|environment|world|후면|뒤쪽|뒤 카메라)/i;

function detectCameraModeFromLabel(label) {
  const value = String(label || '');
  if (FRONT_CAMERA_LABEL.test(value)) return 'user';
  if (REAR_CAMERA_LABEL.test(value)) return 'environment';
  return '';
}

async function getAvailableCameras(force = false) {
  if (!force && Array.isArray(cameraListCache) && cameraListCache.length) return cameraListCache;
  try {
    const cameras = await window.Html5Qrcode.getCameras();
    cameraListCache = Array.isArray(cameras) ? cameras : [];
  } catch (error) {
    console.warn('카메라 목록 조회 실패:', error);
    cameraListCache = [];
  }
  return cameraListCache;
}

async function detectStartedCameraMode() {
  await new Promise(resolve => window.setTimeout(resolve, 160));
  const video = document.querySelector('#reader video');
  const track = video?.srcObject?.getVideoTracks?.()[0];
  if (!track) return '';
  const settings = track.getSettings?.() || {};
  if (settings.facingMode === 'user' || settings.facingMode === 'environment') return settings.facingMode;
  return detectCameraModeFromLabel(track.label || '');
}

async function buildCameraCandidates(requestedMode, allowFallback) {
  const cameras = await getAvailableCameras();
  const candidates = [
    { source: { facingMode: { ideal: requestedMode } }, mode: requestedMode },
    { source: { facingMode: requestedMode }, mode: requestedMode }
  ];
  const usedIds = new Set();

  const addId = (camera, mode) => {
    if (!camera?.id || usedIds.has(camera.id)) return;
    usedIds.add(camera.id);
    candidates.push({ source: camera.id, mode, cameraId: camera.id });
  };

  const front = cameras.filter(camera => detectCameraModeFromLabel(camera.label) === 'user');
  const rear = cameras.filter(camera => detectCameraModeFromLabel(camera.label) === 'environment');
  const unknown = cameras.filter(camera => !detectCameraModeFromLabel(camera.label));

  if (requestedMode === 'user') {
    front.forEach(camera => addId(camera, 'user'));
    if (!front.length && cameras.length > 1) addId(cameras[cameras.length - 1], 'user');
    unknown.slice().reverse().forEach(camera => addId(camera, 'user'));
    candidates.push({ source: { facingMode: { exact: 'user' } }, mode: 'user' });
    candidates.push({ source: { facingMode: { ideal: 'user' } }, mode: 'user' });
    if (allowFallback) {
      rear.forEach(camera => addId(camera, 'environment'));
      candidates.push({ source: { facingMode: { ideal: 'environment' } }, mode: 'environment' });
    }
  } else {
    rear.forEach(camera => addId(camera, 'environment'));
    if (!rear.length && cameras.length > 1) addId(cameras[0], 'environment');
    unknown.forEach(camera => addId(camera, 'environment'));
    candidates.push({ source: { facingMode: { exact: 'environment' } }, mode: 'environment' });
    candidates.push({ source: { facingMode: { ideal: 'environment' } }, mode: 'environment' });
    if (allowFallback) {
      front.forEach(camera => addId(camera, 'user'));
      candidates.push({ source: { facingMode: { ideal: 'user' } }, mode: 'user' });
    }
  }

  return candidates;
}

window.startScanner = async function startScanner(facingMode = 'environment', allowFallback = true) {
  await waitForHtml5Qrcode();
  const scanner = createScannerInstance();
  const requestedMode = facingMode === 'environment' ? 'environment' : 'user';
  window.currentScannerFacingMode = requestedMode;

  const qrBoxFunction = (viewWidth, viewHeight) => {
    const size = calculateScanBox(viewWidth, viewHeight);
    return { width: size, height: size };
  };

  const config = {
    fps: 18,
    qrbox: qrBoxFunction,
    disableFlip: false,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  const candidates = await buildCameraCandidates(requestedMode, allowFallback);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      await scanner.start(candidate.source, config, handleDecodedText, () => {});
      const detectedMode = await detectStartedCameraMode();
      if (detectedMode && detectedMode !== requestedMode && candidate.mode === requestedMode) {
        console.warn(`요청한 ${requestedMode} 카메라 대신 ${detectedMode} 카메라가 열렸지만, 즉시 스캔할 수 있도록 유지합니다.`);
      }

      const finalMode = detectedMode || candidate.mode;
      window.currentScannerFacingMode = finalMode;
      activeCameraId = candidate.cameraId || '';
      calculateScanBox(window.innerWidth, window.innerHeight);
      window.dispatchEvent(new CustomEvent('scanner-camera-started', {
        detail: { facingMode: finalMode, cameraId: activeCameraId }
      }));
      return true;
    } catch (error) {
      lastError = error;
      console.warn(`카메라 시작 후보 실패 (${candidate.mode}):`, error);
      if (scanner.isScanning) {
        try { await scanner.stop(); } catch (_) {}
      }
    }
  }

  showScanResult('fail', '카메라를 열 수 없습니다', '브라우저 카메라 권한을 확인해 주세요');
  throw lastError || new Error('사용 가능한 카메라가 없습니다.');
};

window.restartScanner = async function restartScanner(facingMode = window.currentScannerFacingMode || 'user') {
  if (scannerRestartPromise) return scannerRestartPromise;

  scannerRestartPromise = (async () => {
    const scanner = createScannerInstance();
    if (scanner.isScanning) {
      try {
        await scanner.stop();
      } catch (error) {
        console.warn('카메라 중지 경고:', error);
      }
    }
    return window.startScanner(facingMode, true);
  })();

  try {
    return await scannerRestartPromise;
  } finally {
    scannerRestartPromise = null;
  }
};

function scheduleOrientationRestart() {
  window.clearTimeout(orientationRestartTimer);
  orientationRestartTimer = window.setTimeout(() => {
    calculateScanBox(window.innerWidth, window.innerHeight);
    if (window.html5QrCode?.isScanning) {
      window.restartScanner(window.currentScannerFacingMode || 'user').catch(() => {});
    }
  }, 360);
}

function initScannerPage() {
  currentServiceDate = getTodayStr();
  resetScannerStats();
  showScanResult('idle', 'QR 코드를 보여주세요', '인식 시 자동으로 식사 처리됩니다');
  calculateScanBox(window.innerWidth, window.innerHeight);

  loadScannerStats(currentServiceDate);
  loadUpcomingMenus(currentServiceDate);
  window.startScanner('environment').catch(() => {});

  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  document.addEventListener('keydown', unlockAudio, { once: true, capture: true });

  window.setInterval(() => {
    checkDateRollover();
    loadScannerStats(currentServiceDate);
  }, 15000);
  window.setInterval(checkDateRollover, 5000);
  window.setInterval(() => loadUpcomingMenus(currentServiceDate), 5 * 60 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkDateRollover();
      loadScannerStats(currentServiceDate);
      loadUpcomingMenus(currentServiceDate);
    }
  });
  window.addEventListener('focus', () => {
    checkDateRollover();
    loadScannerStats(currentServiceDate);
    loadUpcomingMenus(currentServiceDate);
  });
  window.addEventListener('orientationchange', scheduleOrientationRestart);
  window.screen?.orientation?.addEventListener?.('change', scheduleOrientationRestart);
  window.addEventListener('resize', () => calculateScanBox(window.innerWidth, window.innerHeight));
  window.visualViewport?.addEventListener?.('resize', () => calculateScanBox(window.visualViewport.width, window.visualViewport.height));
}

document.addEventListener('DOMContentLoaded', initScannerPage);
