import { API_BASE_URL, getTodayStr, isWeekend } from './config.js';

let timerInterval;

// 앱 시작 시 저장된 부서와 이름을 자동으로 불러옴
document.addEventListener('DOMContentLoaded', () => {
  const savedOrg = localStorage.getItem('hwao_lunch_org');
  const savedName = localStorage.getItem('hwao_lunch_name');
  
  if (savedOrg) document.getElementById('orgRole').value = savedOrg;
  if (savedName) document.getElementById('userName').value = savedName;
});

// ==========================================
// 🌟 스마트폰 홈 화면 바로가기(PWA) 설치 로직
// ==========================================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e; // 안드로이드 환경에서 설치 프롬프트 보관
});

document.getElementById('btn-add-shortcut')?.addEventListener('click', async () => {
  if (deferredPrompt) {
    // 1. 안드로이드: 시스템 설치 팝업 바로 띄우기
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('바로가기 설치 수락됨');
    }
    deferredPrompt = null;
  } else {
    // 2. 아이폰(iOS) 또는 브라우저에서 직접 지원하지 않는 경우 가이드 띄우기
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      alert('🍎 아이폰(iOS) 바로가기 추가 방법:\n\n1. 화면 하단의 [공유] 아이콘(네모에 위로 향한 화살표)을 누르세요.\n2. 메뉴를 올려서 [홈 화면에 추가]를 선택해주세요.');
    } else {
      alert('🤖 안드로이드 바로가기 추가 방법:\n\n1. 브라우저 우측 상단의 메뉴(점 3개)를 누르세요.\n2. [홈 화면에 추가] 또는 [앱 설치]를 선택해주세요.');
    }
  }
});
// ==========================================

async function generateLunchQR(isReissue = false) {
  const today = getTodayStr();
  if (isWeekend(today)) return alert('오늘은 주말입니다. 점심 체크를 운영하지 않습니다.');

  let orgRole, name;

  if (isReissue) {
    orgRole = localStorage.getItem('hwao_lunch_org');
    name = localStorage.getItem('hwao_lunch_name');
  } else {
    orgRole = document.getElementById('orgRole').value.trim();
    name = document.getElementById('userName').value.trim();
    if (!orgRole || !name) return alert('부서와 이름을 입력해 주세요.');
    
    // 성공적으로 입력했으면 정보 저장
    localStorage.setItem('hwao_lunch_org', orgRole);
    localStorage.setItem('hwao_lunch_name', name);
  }

  try {
    const res = await fetch(`${API_BASE_URL}/qr/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: today, orgRole, name })
    });
    const data = await res.json();

    if (res.ok) {
      renderQR(data.qrData, name, orgRole, data.expiresAt);
    } else {
      alert(data.message);
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
document.getElementById('btn-reissue-qr').onclick = () => generateLunchQR(true);