import { API_BASE_URL, globalState } from './config.js';
import { loadEventsForDashboard } from './events.js';

let authTimerInterval;

function startAuthTimer(elementId, durationSec) {
  clearInterval(authTimerInterval);
  const timerEl = document.getElementById(elementId);
  let timeLeft = durationSec;
  timerEl.classList.remove('text-gray-400');
  
  authTimerInterval = setInterval(() => {
    timeLeft--;
    if(timeLeft <= 0) {
      clearInterval(authTimerInterval);
      timerEl.textContent = "00:00 (만료)";
      timerEl.classList.add('text-gray-400');
    } else {
      const m = Math.floor(timeLeft / 60);
      const s = timeLeft % 60;
      timerEl.textContent = `0${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }, 1000);
}

export function initAuth() {
  const btnRequest = document.getElementById('btn-request-code');
  const btnVerify = document.getElementById('btn-verify-code');

  if (!btnRequest) return;

  btnRequest.addEventListener('click', async () => {
    const email = document.getElementById('adminEmail').value.trim();
    if (!email) return alert('이메일을 입력해주세요.');
    
    btnRequest.textContent = '발송 중...';
    try {
      const res = await fetch(`${API_BASE_URL}/admin/request-code`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ email, type: 'login' }) 
    });
      if (res.ok) {
        globalState.loggedInEmail = email; 
        document.getElementById('step-email').classList.add('hidden');
        document.getElementById('step-code').classList.remove('hidden');
        startAuthTimer('auth-timer', 180); 
      } else {
        alert((await res.json()).message);
        btnRequest.textContent = '인증번호 요청';
      }
    } catch (e) {
      alert('서버와 연결할 수 없습니다.');
      btnRequest.textContent = '인증번호 요청';
    }
  });

  btnVerify.addEventListener('click', async () => {
    const code = document.getElementById('adminCode').value.trim();
    if (!code) return alert('인증번호를 입력해주세요.');

    try {
      const res = await fetch(`${API_BASE_URL}/admin/verify-code`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: globalState.loggedInEmail, code })
      });
      if (res.ok) {
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        loadEventsForDashboard(); 
      } else {
        alert((await res.json()).message);
      }
    } catch (e) {
      alert('서버 에러');
    }
  });
}