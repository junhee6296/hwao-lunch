import { API_BASE_URL, getTodayStr } from './config.js';

window.html5QrCode = null;
window.isScanningAction = false;
window.currentScannerFacingMode = 'user';

const DEFAULT_AUDIO_MANIFEST = Object.freeze({
  scan: '/audio/scansound.mp3',
  success: [
    '/audio/success/voice_1.mp3',
    '/audio/success/voice_2.mp3',
    '/audio/success/voice_3.mp3',
    '/audio/success/voice_4.mp3',
    '/audio/success/voice_5.mp3',
    '/audio/success/voice_6.mp3',
    '/audio/success/voice_7.mp3'
  ],
  fail: [
    '/audio/fail/fail_1.mp3',
    '/audio/fail/fail_2.mp3',
    '/audio/fail/fail_3.mp3',
    '/audio/fail/fail_4.mp3'
  ]
});

const fallbackTexts = Object.freeze({
  success: ['맛있게 드세요', '점심 맛있게 드세요', '식사 맛있게 하세요', '좋은 점심 되세요'],
  fail: ['처리하지 못했습니다', '다시 확인해 주세요', 'QR 코드를 다시 보여주세요']
});

let audioManifest = {
  scan: DEFAULT_AUDIO_MANIFEST.scan,
  success: [...DEFAULT_AUDIO_MANIFEST.success],
  fail: [...DEFAULT_AUDIO_MANIFEST.fail]
};
let currentAudio = null;
let currentAudioFinish = null;
let audioSequenceId = 0;
let audioUnlocked = false;
let currentServiceDate = getTodayStr();
let lastDecodedText = '';
let lastDecodedAt = 0;
let resultResetTimer = null;
let scannerRestartPromise = null;
let orientationRestartTimer = null;
let lastRandomIndex = { success: -1, fail: -1 };

const SAME_CODE_COOLDOWN_MS = 5000;
const PROCESSING_COOLDOWN_MS = 1300;

const $ = (id) => document.getElementById(id);


function formatScannerDate(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return dateStr || '';
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
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

function renderTodayMenu(day, date) {
  const list = $('scanner-menu-list');
  const empty = $('scanner-menu-empty');
  const dateLabel = $('scanner-menu-date');
  if (dateLabel) dateLabel.textContent = formatScannerDate(date);
  if (!list || !empty) return;

  list.replaceChildren();
  empty.className = 'scanner-menu-empty';

  const menus = Array.isArray(day?.menu) ? day.menu.filter(Boolean) : [];
  const isHoliday = Boolean(day?.holidayName) || menus.includes('공휴일');

  if (isHoliday) {
    empty.className = 'scanner-menu-holiday';
    empty.textContent = day?.holidayName && day.holidayName !== '공휴일'
      ? `공휴일 · ${day.holidayName}`
      : '공휴일';
    empty.hidden = false;
    return;
  }

  if (!menus.length) {
    empty.textContent = '등록된 오늘 식단이 없습니다.';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  menus.forEach((menu) => {
    const item = document.createElement('li');
    item.textContent = String(menu);
    list.appendChild(item);
  });
}

async function loadTodayMenu(date = currentServiceDate) {
  const requestedDate = date;
  const yearMonth = String(requestedDate).slice(0, 7);
  try {
    const res = await fetch(`${API_BASE_URL}/menu/month/${encodeURIComponent(yearMonth)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('식단표를 불러올 수 없습니다.');
    const data = await res.json();
    if (requestedDate !== currentServiceDate) return;
    renderTodayMenu(data?.days?.[requestedDate] || null, requestedDate);
  } catch (error) {
    console.error('오늘 식단 로드 실패:', error);
    if (requestedDate !== currentServiceDate) return;
    renderTodayMenu(null, requestedDate);
  }
}

function pickRandomAudio(type) {
  const items = Array.isArray(audioManifest[type]) ? audioManifest[type] : [];
  if (!items.length) return '';
  if (items.length === 1) return items[0];

  let index = Math.floor(Math.random() * items.length);
  if (index === lastRandomIndex[type]) index = (index + 1) % items.length;
  lastRandomIndex[type] = index;
  return items[index];
}

function speakFallback(type) {
  if (!('speechSynthesis' in window)) return;
  const texts = fallbackTexts[type] || ['확인되었습니다'];
  const text = texts[Math.floor(Math.random() * texts.length)];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 1.02;
  utterance.pitch = type === 'fail' ? 0.92 : 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function stopCurrentAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (_) {
      // 재생 종료 중 발생하는 브라우저별 예외는 무시합니다.
    }
  }
  if (typeof currentAudioFinish === 'function') currentAudioFinish(false);
  currentAudio = null;
  currentAudioFinish = null;
}

function playAudioFile(src, sequenceId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!src || sequenceId !== audioSequenceId) return resolve(false);

    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.playsInline = true;
    let settled = false;
    let timer = null;

    const finish = (played) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      audio.onended = null;
      audio.onerror = null;
      audio.onabort = null;
      if (currentAudio === audio) {
        currentAudio = null;
        currentAudioFinish = null;
      }
      resolve(Boolean(played));
    };

    currentAudio = audio;
    currentAudioFinish = finish;
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.onabort = () => finish(false);
    timer = window.setTimeout(() => finish(false), timeoutMs);

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => finish(false));
    }
  });
}

function beginScanAudio() {
  audioSequenceId += 1;
  const sequenceId = audioSequenceId;
  stopCurrentAudio();
  return {
    sequenceId,
    scanPromise: playAudioFile(audioManifest.scan, sequenceId, 5000)
  };
}

async function finishScanAudio(sequence, outcome) {
  await sequence.scanPromise;
  if (sequence.sequenceId !== audioSequenceId) return;

  const outcomeSrc = pickRandomAudio(outcome);
  const played = await playAudioFile(outcomeSrc, sequence.sequenceId);
  if (!played && sequence.sequenceId === audioSequenceId) speakFallback(outcome);
}

async function loadAudioManifest() {
  try {
    const res = await fetch(`${API_BASE_URL}/scanner/audio-manifest`, { cache: 'no-store' });
    if (!res.ok) throw new Error('audio manifest unavailable');
    const data = await res.json();
    audioManifest = {
      scan: typeof data.scan === 'string' && data.scan ? data.scan : DEFAULT_AUDIO_MANIFEST.scan,
      success: Array.isArray(data.success) && data.success.length ? data.success : [...DEFAULT_AUDIO_MANIFEST.success],
      fail: Array.isArray(data.fail) && data.fail.length ? data.fail : [...DEFAULT_AUDIO_MANIFEST.fail]
    };
  } catch (_) {
    audioManifest = {
      scan: DEFAULT_AUDIO_MANIFEST.scan,
      success: [...DEFAULT_AUDIO_MANIFEST.success],
      fail: [...DEFAULT_AUDIO_MANIFEST.fail]
    };
  }

  const allSources = [audioManifest.scan, ...audioManifest.success, ...audioManifest.fail].filter(Boolean);
  allSources.forEach((src) => {
    try {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = src;
      audio.load();
    } catch (_) {
      // 일부 브라우저는 명시적 사용자 입력 전 preload를 제한합니다.
    }
  });
}

async function unlockAudio() {
  if (audioUnlocked || !audioManifest.scan) return;
  audioUnlocked = true;
  try {
    const audio = new Audio(audioManifest.scan);
    audio.muted = true;
    audio.volume = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch (_) {
    audioUnlocked = false;
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
  loadTodayMenu(today);
  showScanResult('idle', 'QR 코드를 보여주세요', '새 날짜의 식수 집계를 시작합니다');
  return true;
}

function showScanResult(state, message, subMessage) {
  const panel = $('scan-result-panel');
  const msgEl = $('scan-msg');
  const subMsgEl = $('scan-sub-msg');
  if (!panel || !msgEl || !subMsgEl) return;

  panel.dataset.state = state;
  msgEl.textContent = message;
  subMsgEl.textContent = subMessage;

  window.clearTimeout(resultResetTimer);
  if (state !== 'idle') {
    resultResetTimer = window.setTimeout(() => {
      panel.dataset.state = 'idle';
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

  const isNarrow = width < 900;
  const sidePanelReserve = isNarrow ? 0 : Math.min(330, Math.max(200, width * 0.235));
  const usableWidth = isNarrow ? width * 0.58 : width - sidePanelReserve * 2 - 56;
  const usableHeight = height - (height < 640 ? 128 : 176);
  const available = Math.max(180, Math.min(usableWidth, usableHeight));
  const size = Math.max(180, Math.min(460, Math.floor(available * 0.94)));

  document.documentElement.style.setProperty('--scanner-box-size', `${size}px`);
  return size;
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

  const audioSequence = beginScanAudio();
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
    finishScanAudio(audioSequence, outcome);
    window.setTimeout(() => {
      window.isScanningAction = false;
    }, PROCESSING_COOLDOWN_MS);
  }
}

window.startScanner = async function startScanner(facingMode = 'user', allowFallback = true) {
  const scanner = createScannerInstance();
  const requestedMode = facingMode === 'environment' ? 'environment' : 'user';

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

  try {
    await scanner.start(
      { facingMode: requestedMode },
      config,
      handleDecodedText,
      () => {}
    );
    window.currentScannerFacingMode = requestedMode;
    calculateScanBox(window.innerWidth, window.innerHeight);
    window.dispatchEvent(new CustomEvent('scanner-camera-started', { detail: { facingMode: requestedMode } }));
    return true;
  } catch (error) {
    console.error(`카메라 시작 실패 (${requestedMode}):`, error);
    if (allowFallback) {
      const fallbackMode = requestedMode === 'user' ? 'environment' : 'user';
      return window.startScanner(fallbackMode, false);
    }
    showScanResult('fail', '카메라를 열 수 없습니다', '브라우저 카메라 권한을 확인해 주세요');
    throw error;
  }
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

  loadAudioManifest();
  loadScannerStats(currentServiceDate);
  loadTodayMenu(currentServiceDate);
  window.startScanner('user').catch(() => {});

  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  document.addEventListener('keydown', unlockAudio, { once: true, capture: true });

  window.setInterval(() => {
    checkDateRollover();
    loadScannerStats(currentServiceDate);
  }, 15000);
  window.setInterval(checkDateRollover, 5000);
  window.setInterval(() => loadTodayMenu(currentServiceDate), 5 * 60 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkDateRollover();
      loadScannerStats(currentServiceDate);
      loadTodayMenu(currentServiceDate);
    }
  });
  window.addEventListener('focus', () => {
    checkDateRollover();
    loadScannerStats(currentServiceDate);
    loadTodayMenu(currentServiceDate);
  });
  window.addEventListener('orientationchange', scheduleOrientationRestart);
  window.screen?.orientation?.addEventListener?.('change', scheduleOrientationRestart);
  window.addEventListener('resize', () => calculateScanBox(window.innerWidth, window.innerHeight));
  window.visualViewport?.addEventListener?.('resize', () => calculateScanBox(window.visualViewport.width, window.visualViewport.height));
}

document.addEventListener('DOMContentLoaded', initScannerPage);
