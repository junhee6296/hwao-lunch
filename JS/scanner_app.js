import { API_BASE_URL, getTodayStr, escapeHTML } from './config.js';

window.html5QrCode = null;
window.isScanningAction = false;

const audioSets = {
  delicious: [
    '/audio/delicious_m_1.mp3',
    '/audio/delicious_m_2.mp3',
    '/audio/delicious_f_1.mp3',
    '/audio/delicious_f_2.mp3'
  ],
  dupe: [
    '/audio/dupe1.mp3',
    '/audio/dupe2.mp3'
  ]
};

const fallbackTexts = {
  delicious: ['맛있게 드세요', '점심 맛있게 드세요', '식사 맛있게 하세요', '좋은 점심 되세요'],
  dupe: ['이미 처리됐습니다', '중복 처리입니다']
};

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function speakFallback(type) {
  if (!('speechSynthesis' in window)) return;
  const text = pickRandom(fallbackTexts[type] || ['확인되었습니다']);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 1.02;
  utterance.pitch = type === 'dupe' ? 0.9 : 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function playTTS(type) {
  const src = pickRandom(audioSets[type] || []);
  if (!src) return speakFallback(type);

  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.onerror = () => speakFallback(type);
  audio.play().catch(() => speakFallback(type));
}

function applyDateColor(dateStr) {
  const dateInput = document.getElementById('date-selector');
  if (!dateInput) return;
  const [year, month, day] = dateStr.split('-').map(Number);
  const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekDay === 0) dateInput.style.color = '#ef4444';
  else if (weekDay === 6) dateInput.style.color = '#3b82f6';
  else dateInput.style.color = '#1e40af';
}

async function loadDiners(date) {
  try {
    applyDateColor(date);
    const res = await fetch(`${API_BASE_URL}/scanner/attendees/${date}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('데이터를 불러올 수 없습니다.');

    const attendedOnly = (await res.json()).sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

    document.getElementById('recent-diner').textContent = attendedOnly.length > 0 ? attendedOnly[0].name : '-';
    document.getElementById('stat-count').textContent = `${attendedOnly.length}명`;

    const tbody = document.getElementById('diner-table-body');
    tbody.innerHTML = attendedOnly.map(d => `
      <tr class="hover:bg-gray-50 transition-colors">
        <td class="p-4 font-bold text-gray-900 border-b">${escapeHTML(d.name)}</td>
        <td class="p-4 text-center text-green-600 text-sm font-mono border-b">
          ${d.scannedAt ? new Date(d.scannedAt).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('데이터 로드 실패:', e);
  }
}

window.startScanner = function(facingMode = 'environment') {
  if (!window.html5QrCode) window.html5QrCode = new Html5Qrcode('reader');

  const qrBoxFunction = (vw, vh) => {
    const min = Math.min(vw, vh);
    const box = Math.max(220, Math.floor(min * 0.72));
    return { width: box, height: box };
  };

  return window.html5QrCode.start(
    { facingMode },
    { fps: 15, qrbox: qrBoxFunction, aspectRatio: 1.0 },
    async (decodedText) => {
      if (window.isScanningAction) return;
      window.isScanningAction = true;

      const msgEl = document.getElementById('scan-msg');
      const subMsgEl = document.getElementById('scan-sub-msg');
      try {
        const res = await fetch(`${API_BASE_URL}/qr/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qrToken: decodedText })
        });
        const data = await res.json();

        if (res.ok) {
          msgEl.textContent = `✅ ${data.name}님 확인`;
          subMsgEl.textContent = '식사 명단에 등록되었습니다';
          msgEl.className = 'text-xl lg:text-2xl font-bold text-blue-600';
          playTTS('delicious');
          loadDiners(document.getElementById('date-selector').value);
        } else {
          msgEl.textContent = `❌ ${data.message}`;
          subMsgEl.textContent = '다시 확인해 주세요';
          msgEl.className = 'text-xl lg:text-2xl font-bold text-red-500';
          if (data.code === 'DUPLICATE') playTTS('dupe');
        }
      } catch (e) {
        msgEl.textContent = '⚠️ 서버 통신 에러';
        subMsgEl.textContent = '네트워크를 확인해 주세요';
        msgEl.className = 'text-xl lg:text-2xl font-bold text-red-500';
      } finally {
        setTimeout(() => {
          msgEl.textContent = 'QR 코드를 보여주세요';
          subMsgEl.textContent = '인식 시 자동으로 식사 명단에 등록됩니다';
          msgEl.className = 'text-xl lg:text-2xl font-bold text-gray-700';
          window.isScanningAction = false;
        }, 2000);
      }
    }
  ).catch(err => console.error('카메라 로드 에러:', err));
};

function initScannerPage() {
  const datePicker = document.getElementById('date-selector');
  datePicker.value = getTodayStr();
  loadDiners(datePicker.value);
  window.startScanner();

  datePicker.addEventListener('change', (e) => loadDiners(e.target.value));
  document.getElementById('btn-refresh-diners')?.addEventListener('click', () => loadDiners(datePicker.value));
  setInterval(() => loadDiners(datePicker.value), 15000);
}

document.addEventListener('DOMContentLoaded', initScannerPage);
