import { API_BASE_URL, getTodayStr, isWeekend, normalizePhoneLast4 } from './config.js';

let timerInterval;

const nameInput = () => document.getElementById('userName');
const phoneInput = () => document.getElementById('phoneLast4');

// 앱 시작 시 저장된 이름과 전화번호 뒷자리를 자동으로 불러옴
// 예전 버전의 부서 저장값은 더 이상 사용하지 않습니다.
document.addEventListener('DOMContentLoaded', () => {
  const savedName = localStorage.getItem('hwao_lunch_name');
  const savedPhoneLast4 = localStorage.getItem('hwao_lunch_phoneLast4');

  if (savedName) nameInput().value = savedName;
  if (savedPhoneLast4) phoneInput().value = savedPhoneLast4;

  phoneInput()?.addEventListener('input', (e) => {
    e.target.value = normalizePhoneLast4(e.target.value);
  });
});

// ==========================================
// 스마트폰 홈 화면 바로가기(PWA) 설치 로직
// ==========================================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

document.getElementById('btn-add-shortcut')?.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  } else {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) document.getElementById('ios-install-modal').classList.remove('hidden');
    else alert('브라우저 우측 상단 메뉴에서 [홈 화면에 추가] 또는 [앱 설치]를 선택해주세요.');
  }
});

document.getElementById('btn-close-ios-modal')?.addEventListener('click', () => {
  document.getElementById('ios-install-modal').classList.add('hidden');
});

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
  document.getElementById('qr-form-container').classList.add('hidden');
  document.getElementById('qrcode-container').classList.remove('hidden');

  document.getElementById('qr-result-name').textContent = `${name}님 (${phoneLast4})`;

  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  qrDiv.style.opacity = '1';
  new QRCode(qrDiv, { text: token, width: 280, height: 280, colorDark: '#059669' });

  startTimer(expiresAt);
}

function startTimer(expiresAt) {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const diff = Math.floor((expiresAt - Date.now()) / 1000);
    if (diff <= 0) {
      clearInterval(timerInterval);
      document.getElementById('timer').textContent = '00:00 (만료)';
      document.getElementById('qrcode').style.opacity = '0.2';
    } else {
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      document.getElementById('timer').textContent = `0${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }, 1000);
}

document.getElementById('btn-generate-qr').onclick = () => generateLunchQR(false);
document.getElementById('btn-reissue-qr').onclick = () => generateLunchQR(true);
