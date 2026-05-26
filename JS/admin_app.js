import { API_BASE_URL, getTodayStr } from './config.js';

// 🌟 전역 변수: 스캐너 제어 및 상태 공유
window.html5QrCode = null;
window.isScanningAction = false;

let dashboardInitialized = false;

const escapeHTML = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// ==========================================
// 🎨 1. UI 부가 기능 (날짜 색상 & 동적 필터)
// ==========================================
function applyDateColor(dateStr) {
  const dateInput = document.getElementById('date-selector');
  if (!dateInput || !dateStr) return;
  const day = new Date(dateStr).getDay();
  if (day === 0) dateInput.style.color = '#ef4444'; // 일요일
  else if (day === 6) dateInput.style.color = '#3b82f6'; // 토요일
  else dateInput.style.color = '#1e40af'; // 평일
}

function initDeptFilter() {
  const dateSelector = document.getElementById('date-selector');
  if (!dateSelector) return;

  let filterSelect = document.getElementById('dept-filter');
  const dateContainer = dateSelector.parentNode;

  if (!filterSelect && dateContainer) {
    filterSelect = document.createElement('select');
    filterSelect.id = 'dept-filter';
    filterSelect.className = 'bg-white border border-blue-200 text-blue-800 font-bold py-1 px-3 rounded-lg ml-3 outline-none shadow-sm cursor-pointer';
    filterSelect.innerHTML = '<option value="all">부서 전체</option>';
    dateContainer.appendChild(filterSelect);
  }

  if (filterSelect) {
    filterSelect.onchange = () => loadDiners(dateSelector.value || getTodayStr());
  }

  const refreshBtn = document.getElementById('btn-refresh-diners');
  if (refreshBtn) {
    refreshBtn.onclick = () => loadDiners(dateSelector.value || getTodayStr());
  }
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
// 📊 2. 데이터 로드 및 화면 표기 업데이트
// ==========================================
async function loadDiners(date) {
  try {
    const targetDate = date || getTodayStr();
    applyDateColor(targetDate);

    const res = await fetch(`${API_BASE_URL}/events/${targetDate}/attendees`);
    if (!res.ok) throw new Error('데이터를 불러올 수 없습니다.');
    const diners = await res.json();

    updateDeptFilterOptions(diners);

    const filterVal = document.getElementById('dept-filter')?.value || 'all';

    let attendedOnly = diners
      .filter(d => d.attended)
      .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

    const recentDinerEl = document.getElementById('recent-diner');
    if (recentDinerEl) recentDinerEl.textContent = attendedOnly.length > 0 ? attendedOnly[0].name : '-';

    if (filterVal !== 'all') {
      attendedOnly = attendedOnly.filter(d => d.orgRole === filterVal);
    }

    const statCountEl = document.getElementById('stat-count');
    if (statCountEl) statCountEl.textContent = `${attendedOnly.length}명`;

    const tbody = document.getElementById('diner-table-body');
    if (!tbody) return;
    tbody.innerHTML = attendedOnly.map(d => `
      <tr class="hover:bg-gray-50 transition-colors">
        <td class="p-4 text-gray-700 font-medium border-b">${escapeHTML(d.orgRole || '-')}</td>
        <td class="p-4 font-bold text-gray-900 border-b">${escapeHTML(d.name)}</td>
        <td class="p-4 text-center text-green-600 text-sm font-mono border-b">
          ${new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'})}
        </td>
      </tr>
    `).join('');

  } catch (e) {
    console.error('데이터 로드 실패:', e);
  }
}

window.loadDiners = loadDiners;

// ==========================================
// 📷 3. QR 스캐너 제어
// ==========================================
window.startScanner = function(facingMode = 'environment') {
  if (!window.html5QrCode) {
    window.html5QrCode = new Html5Qrcode('reader');
  }

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
        const res = await fetch(`${API_BASE_URL}/qr/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qrToken: decodedText })
        });
        const data = await res.json();

        if (res.ok) {
          msgEl.textContent = `✅ ${data.name}님 확인`;
          msgEl.className = 'text-xl font-bold text-blue-600';
          const today = getTodayStr();
          const dateSelector = document.getElementById('date-selector');
          if (dateSelector) dateSelector.value = today;
          loadDiners(today);
        } else {
          msgEl.textContent = `❌ ${data.message}`;
          msgEl.className = 'text-xl font-bold text-red-500';
        }
      } catch (e) {
        msgEl.textContent = '⚠️ 서버 통신 에러';
        msgEl.className = 'text-xl font-bold text-red-500';
      } finally {
        setTimeout(() => {
          msgEl.textContent = 'QR 코드를 보여주세요';
          msgEl.className = 'text-xl font-bold text-gray-700';
          window.isScanningAction = false;
        }, 2000);
      }
    }
  ).catch(err => console.error('카메라 로드 에러:', err));
};

// ==========================================
// 📥 4. 엑셀 내보내기 로직
// ==========================================
function applyExcelStyle(ws, rowCount) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = ws[XLSX.utils.encode_cell({r: R, c: C})];
      if (!cell) continue;
      cell.s = {
        alignment: { vertical: 'center', horizontal: 'center' },
        border: { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} }
      };
      if (R === 0) {
        cell.s.fill = { fgColor: { rgb: 'EEEEEE' } };
        cell.s.font = { bold: true };
      }
    }
  }
  ws['!cols'] = [{wch: 15}, {wch: 15}, {wch: 15}, {wch: 20}];
  ws['!autofilter'] = { ref: `A1:D${rowCount}` };
}

async function exportDaily() {
  const date = document.getElementById('date-selector')?.value || getTodayStr();
  const res = await fetch(`${API_BASE_URL}/events/${date}/attendees`);
  const diners = (await res.json()).filter(d => d.attended);

  if (diners.length === 0) return alert('식사 기록이 없습니다.');

  const data = diners.map(d => ({
    '날짜': date,
    '부서': d.orgRole,
    '이름': d.name,
    '시간': new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false})
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  applyExcelStyle(ws, data.length + 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일별명단');
  XLSX.writeFile(wb, `식사명단_${date}.xlsx`);
}

async function exportMonthly() {
  const month = prompt('조회할 월 입력 (YYYY-MM)', getTodayStr().substring(0, 7));
  if (!month) return;

  const res = await fetch(`${API_BASE_URL}/events/month/${month}`);
  const diners = await res.json();
  if (diners.length === 0) return alert('기록이 없습니다.');

  const data = diners.sort((a,b) => a.date.localeCompare(b.date)).map(d => ({
    '날짜': d.date,
    '부서': d.orgRole,
    '이름': d.name,
    '시간': d.scannedAt ? new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false}) : '-'
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  applyExcelStyle(ws, data.length + 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '월별명단');
  XLSX.writeFile(wb, `식사명단_${month}.xlsx`);
}

// ==========================================
// 🚀 5. 초기화 및 이벤트 리스너
// ==========================================
function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  const datePicker = document.getElementById('date-selector');
  if (datePicker) {
    datePicker.value = getTodayStr();
    initDeptFilter();
    loadDiners(datePicker.value);
    datePicker.addEventListener('change', (e) => loadDiners(e.target.value));
    document.getElementById('btn-refresh-diners')?.addEventListener('click', () => loadDiners(datePicker.value || getTodayStr()));
  } else {
    loadDiners(getTodayStr());
  }

  document.getElementById('btn-export-daily')?.addEventListener('click', exportDaily);
  document.getElementById('btn-export-monthly')?.addEventListener('click', exportMonthly);

  window.startScanner();
}

document.addEventListener('DOMContentLoaded', initDashboard);
