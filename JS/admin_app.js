import { API_BASE_URL, getTodayStr } from './config.js';

// 스캐너 전용 모듈입니다. 관리자 권한/명단 수정/시트 추출은 admin_list_app.js에서만 처리합니다.
window.html5QrCode = null;
window.isScanningAction = false;

let dashboardInitialized = false;

const escapeHTML = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

async function fetchJSON(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const request = { ...options, credentials: 'same-origin', headers };

  if (request.body && typeof request.body !== 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    request.body = JSON.stringify(request.body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, request);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '요청을 처리할 수 없습니다.');
  return data;
}

async function getServerToday() {
  try {
    const data = await fetchJSON('/today');
    return data.today || getTodayStr();
  } catch (e) {
    return getTodayStr();
  }
}

// ==========================================
// 🎨 1. UI 부가 기능
// ==========================================
function applyDateColor(dateStr) {
  const dateInput = document.getElementById('date-selector');
  if (!dateInput || !dateStr) return;
  const day = new Date(`${dateStr}T12:00:00`).getDay();
  if (day === 0) dateInput.style.color = '#ef4444';
  else if (day === 6) dateInput.style.color = '#3b82f6';
  else dateInput.style.color = '#1e40af';
}

function initDeptFilter() {
  const dateSelector = document.getElementById('date-selector');
  if (!dateSelector) return;

  const filterSelect = document.getElementById('dept-filter');
  if (filterSelect) filterSelect.onchange = () => loadDiners(dateSelector.value || getTodayStr());

  const refreshBtn = document.getElementById('btn-refresh-diners');
  if (refreshBtn) refreshBtn.onclick = () => loadDiners(dateSelector.value || getTodayStr());
}

function updateDeptFilterOptions(diners) {
  const filterSelect = document.getElementById('dept-filter');
  if (!filterSelect) return;

  const previousValue = filterSelect.value;
  const depts = [...new Set(diners.map(d => d.orgRole).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));

  filterSelect.innerHTML = '<option value="all">부서 전체</option>';
  depts.forEach(dept => {
    const opt = document.createElement('option');
    opt.value = dept;
    opt.textContent = dept;
    filterSelect.appendChild(opt);
  });

  if ([...filterSelect.options].some(option => option.value === previousValue)) {
    filterSelect.value = previousValue;
  }
}

// ==========================================
// 📊 2. 공개 스캐너용 식사자 조회
// ==========================================
async function loadDiners(date) {
  try {
    const targetDate = date || getTodayStr();
    applyDateColor(targetDate);

    const diners = await fetchJSON(`/scanner/attendees/${targetDate}`);
    updateDeptFilterOptions(diners);

    const filterVal = document.getElementById('dept-filter')?.value || 'all';
    let attendedOnly = diners
      .filter(d => d.attended)
      .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

    const recentDinerEl = document.getElementById('recent-diner');
    if (recentDinerEl) recentDinerEl.textContent = attendedOnly.length > 0 ? attendedOnly[0].name : '-';

    if (filterVal !== 'all') attendedOnly = attendedOnly.filter(d => d.orgRole === filterVal);

    const statCountEl = document.getElementById('stat-count');
    if (statCountEl) statCountEl.textContent = `${attendedOnly.length}명`;

    const tbody = document.getElementById('diner-table-body');
    if (!tbody) return;
    tbody.innerHTML = attendedOnly.length > 0
      ? attendedOnly.map(d => `
        <tr class="hover:bg-gray-50 transition-colors">
          <td class="p-4 text-gray-700 font-medium border-b">${escapeHTML(d.orgRole || '-')}</td>
          <td class="p-4 font-bold text-gray-900 border-b">${escapeHTML(d.name)}</td>
          <td class="p-4 text-center text-green-600 text-sm font-mono border-b">
            ${d.scannedAt ? new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '-'}
          </td>
        </tr>
      `).join('')
      : '<tr><td colspan="3" class="p-10 text-center text-gray-400 font-bold">조회된 식사자가 없습니다.</td></tr>';
  } catch (e) {
    console.error('데이터 로드 실패:', e);
  }
}

window.loadDiners = loadDiners;

// ==========================================
// 📷 3. QR 스캐너 제어
// ==========================================
window.startScanner = function(facingMode = 'environment') {
  if (!window.html5QrCode) window.html5QrCode = new Html5Qrcode('reader');

  const qrBoxFunction = (vw, vh) => {
    const min = Math.min(vw, vh);
    return { width: Math.floor(min * 0.6), height: Math.floor(min * 0.6) };
  };

  return window.html5QrCode.start(
    { facingMode },
    { fps: 12, qrbox: qrBoxFunction, aspectRatio: 1.0 },
    async (decodedText) => {
      if (window.isScanningAction) return;
      window.isScanningAction = true;

      const msgEl = document.getElementById('scan-msg');
      try {
        const data = await fetchJSON('/qr/scan', {
          method: 'POST',
          body: { qrToken: decodedText }
        });

        if (msgEl) {
          msgEl.textContent = `✅ ${data.name}님 확인`;
          msgEl.className = 'text-xl font-bold text-blue-600';
        }

        const today = await getServerToday();
        const dateSelector = document.getElementById('date-selector');
        if (dateSelector) dateSelector.value = today;
        loadDiners(today);
      } catch (e) {
        if (msgEl) {
          msgEl.textContent = `❌ ${e.message}`;
          msgEl.className = 'text-xl font-bold text-red-500';
        }
      } finally {
        setTimeout(() => {
          if (msgEl) {
            msgEl.textContent = 'QR 코드를 보여주세요';
            msgEl.className = 'text-xl font-bold text-gray-700';
          }
          window.isScanningAction = false;
        }, 2000);
      }
    }
  ).catch(err => console.error('카메라 로드 에러:', err));
};

// ==========================================
// 🚀 4. 초기화
// ==========================================
async function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  const today = await getServerToday();
  const datePicker = document.getElementById('date-selector');
  if (datePicker) {
    datePicker.value = today;
    initDeptFilter();
    loadDiners(datePicker.value);
    datePicker.addEventListener('change', (e) => loadDiners(e.target.value));
  } else {
    loadDiners(today);
  }

  window.startScanner();
}

document.addEventListener('DOMContentLoaded', initDashboard);
