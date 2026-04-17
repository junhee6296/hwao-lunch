import { API_BASE_URL, getTodayStr, isWeekend } from './config.js';

let timerInterval;

// 🌟 앱 시작 시 저장된 부서와 이름을 자동으로 불러옴
document.addEventListener('DOMContentLoaded', () => {
  const savedOrg = localStorage.getItem('hwao_lunch_org');
  const savedName = localStorage.getItem('hwao_lunch_name');
  
  if (savedOrg) document.getElementById('orgRole').value = savedOrg;
  if (savedName) document.getElementById('userName').value = savedName;
});

// PWA 설치 버튼 로직
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // 바탕화면에 추가 안내 버튼 보이기
  document.getElementById('pwa-install-btn').classList.remove('hidden');
});

document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      document.getElementById('pwa-install-btn').classList.add('hidden');
    }
    deferredPrompt = null;
  }
});

async function generateLunchQR(isReissue = false) {
  const today = getTodayStr();
  if (isWeekend(today)) return alert('오늘은 주말입니다. 점심 체크를 운영하지 않습니다.');

  // 입력된 값 가져오기
  const orgRole = document.getElementById('orgRole').value.trim();
  const name = document.getElementById('userName').value.trim();

  if (!orgRole || !name) return alert('부서와 이름을 입력해 주세요.');
  
  // 🌟 성공적으로 입력 후 버튼을 누르면 기기에 정보 영구 저장 (PWA 호환)
  localStorage.setItem('hwao_lunch_org', orgRole);
  localStorage.setItem('hwao_lunch_name', name);

  try {
    const res = await fetch(`${API_BASE_URL}/qr/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: today, orgRole, name })
    });
    const data = await res.json();

    if (res.ok) {
      renderQR(data.qrData, name, orgRole, data.expiresAt);
    } else {
      alert(data.message); // 중복 등 예외 처리 팝업
    }
  } catch (e) { alert('서버 연결 실패'); }
}

function renderQR(token, name, orgRole, expiresAt) {
  document.getElementById('qr-form-container').classList.add('hidden');
  document.getElementById('qrcode-container').classList.remove('hidden');
  
  document.getElementById('qr-result-name').textContent = `[${orgRole}] ${name}님`;

  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  qrDiv.style.opacity = '1';
  new QRCode(qrDiv, { text: token, width: 280, height: 280, colorDark: "#059669" });

  startTimer(expiresAt);
}

function startTimer(expiresAt) {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const diff = Math.floor((expiresAt - Date.now()) / 1000);
    if (diff <= 0) {
      clearInterval(timerInterval);
      document.getElementById('timer').textContent = "00:00 (만료)";
      document.getElementById('qrcode').style.opacity = "0.2";
    } else {
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      document.getElementById('timer').textContent = `0${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }, 1000);
}

document.getElementById('btn-generate-qr').onclick = () => generateLunchQR(false);
// 재발급 시에도 현재 폼(또는 캐싱된) 데이터 기반으로 작동
document.getElementById('btn-reissue-qr').onclick = () => generateLunchQR(true);