import { API_BASE_URL, getTodayStr } from './config.js';

// 🌟 전역 변수: 스캐너 제어 및 상태 공유
window.html5QrCode = null;
window.isScanningAction = false;
let loggedInEmail = '';

// ==========================================
// 🔐 1. 보안 로그인 로직
// ==========================================
async function requestAuthCode() {
  const emailInput = document.getElementById('adminEmail');
  const email = emailInput.value.trim();
  if(!email) return alert('이메일 주소를 입력해주세요.');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/request-code`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    const data = await res.json();
    
    if (res.ok) {
      loggedInEmail = email;
      document.getElementById('step-email').classList.add('hidden');
      document.getElementById('step-code').classList.remove('hidden');
      alert('✅ 인증 메일이 발송되었습니다.');
    } else { 
      alert(`⚠️ ${data.message}`); 
    }
  } catch (e) { alert('서버 연결 실패'); }
}

async function verifyAuthCode() {
  const codeInput = document.getElementById('adminCode');
  const code = codeInput.value.trim();
  if(!code) return alert('인증번호를 입력해주세요.');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/verify-code`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: loggedInEmail, code })
    });
    if (res.ok) {
      document.getElementById('auth-overlay').classList.add('hidden');
      document.getElementById('main-content').classList.remove('hidden');
      initDashboard(); // 인증 성공 시 대시보드 로드
    } else {
      alert('⚠️ 인증번호가 일치하지 않습니다.');
    }
  } catch (e) { alert('서버 연결 실패'); }
}

// ==========================================
// 🎨 2. UI 부가 기능 (날짜 색상 & 동적 필터)
// ==========================================
// 날짜에 따른 텍스트 색상 변경 (토: 파랑, 일: 빨강)
function applyDateColor(dateStr) {
  const dateInput = document.getElementById('date-selector');
  if (!dateInput) return;
  const day = new Date(dateStr).getDay();
  if (day === 0) dateInput.style.color = '#ef4444'; // 일요일 (빨강)
  else if (day === 6) dateInput.style.color = '#3b82f6'; // 토요일 (파랑)
  else dateInput.style.color = '#1e40af'; // 평일 (진한 파랑)
}

// HTML 수정 없이 부서 필터를 날짜 옆에 동적으로 생성
function initDeptFilter() {
  const dateContainer = document.getElementById('date-selector').parentNode;
  if (!document.getElementById('dept-filter')) {
    const filterSelect = document.createElement('select');
    filterSelect.id = 'dept-filter';
    filterSelect.className = "bg-white border border-blue-200 text-blue-800 font-bold py-1 px-3 rounded-lg ml-3 outline-none shadow-sm cursor-pointer";
    filterSelect.innerHTML = '<option value="all">부서 전체</option>';
    filterSelect.onchange = () => loadDiners(document.getElementById('date-selector').value);
    dateContainer.appendChild(filterSelect);
  }
}

// 스캔된 데이터를 바탕으로 필터 옵션(부서 목록) 자동 업데이트
function updateDeptFilterOptions(diners) {
  const filterSelect = document.getElementById('dept-filter');
  if (!filterSelect) return;
  const existingOptions = Array.from(filterSelect.options).map(o => o.value);
  const depts = [...new Set(diners.map(d => d.orgRole))].filter(Boolean);

  depts.forEach(dept => {
    if (!existingOptions.includes(dept)) {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      filterSelect.appendChild(opt);
    }
  });
}

// ==========================================
// 📊 3. 데이터 로드 및 화면 표기 업데이트
// ==========================================
async function loadDiners(date) {
  try {
    applyDateColor(date); // 선택된 날짜 색상 적용

    const res = await fetch(`${API_BASE_URL}/events/${date}/attendees`);
    if (!res.ok) throw new Error("데이터를 불러올 수 없습니다.");
    const diners = await res.json();
    
    updateDeptFilterOptions(diners); // 필터에 등록된 부서 추가
    
    const filterVal = document.getElementById('dept-filter')?.value || 'all';

    // 출석자만 추려내고 최신 스캔 순(역순)으로 정렬
    let attendedOnly = diners
      .filter(d => d.attended)
      .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

    // 🌟 복구: '최근 식사자' 표기 (필터 적용 전 실제 가장 최근 사람)
    document.getElementById('recent-diner').textContent = attendedOnly.length > 0 ? attendedOnly[0].name : '-';

    // 부서 필터링이 적용된 경우 리스트 축소
    if (filterVal !== 'all') {
      attendedOnly = attendedOnly.filter(d => d.orgRole === filterVal);
    }

    // 🌟 복구: '오늘 현재 식수' 표기
    document.getElementById('stat-count').textContent = `${attendedOnly.length}명`;

    // 🌟 복구: 리스트 테이블 렌더링
    const tbody = document.getElementById('diner-table-body');
    tbody.innerHTML = attendedOnly.map(d => `
      <tr class="hover:bg-gray-50 transition-colors">
        <td class="p-4 text-gray-700 font-medium border-b">${d.orgRole || '-'}</td>
        <td class="p-4 font-bold text-gray-900 border-b">${d.name}</td>
        <td class="p-4 text-center text-green-600 text-sm font-mono border-b">
          ${new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'})}
        </td>
      </tr>
    `).join('');

  } catch (e) { 
    console.error("데이터 로드 실패:", e); 
  }
}

// ==========================================
// 📷 4. QR 스캐너 제어
// ==========================================
window.startScanner = function(facingMode = "environment") {
  if (!window.html5QrCode) {
    window.html5QrCode = new Html5Qrcode("reader");
  }
  
  const qrBoxFunction = (vw, vh) => {
    const min = Math.min(vw, vh);
    return { width: Math.floor(min * 0.6), height: Math.floor(min * 0.6) };
  };

  return window.html5QrCode.start(
    { facingMode: facingMode }, 
    { fps: 12, qrbox: qrBoxFunction, aspectRatio: 1.0 }, 
    async (decodedText) => {
      // 중복 스캔 방지
      if (window.isScanningAction) return;
      window.isScanningAction = true;

      const msgEl = document.getElementById('scan-msg');
      try {
        const res = await fetch(`${API_BASE_URL}/qr/scan`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qrToken: decodedText })
        });
        const data = await res.json();

        if (res.ok) {
          msgEl.textContent = `✅ ${data.name}님 확인`;
          msgEl.className = "text-xl font-bold text-blue-600";
          // 🌟 성공 시 즉시 목록 및 카운트 새로고침
          loadDiners(document.getElementById('date-selector').value);
        } else {
          msgEl.textContent = `❌ ${data.message}`;
          msgEl.className = "text-xl font-bold text-red-500";
        }
      } catch (e) { 
        msgEl.textContent = "⚠️ 서버 통신 에러"; 
        msgEl.className = "text-xl font-bold text-red-500";
      } finally {
        setTimeout(() => {
          msgEl.textContent = "QR 코드를 보여주세요";
          msgEl.className = "text-xl font-bold text-gray-700";
          window.isScanningAction = false;
        }, 2000);
      }
    }
  ).catch(err => console.error("카메라 로드 에러:", err));
};

// ==========================================
// 📥 5. 엑셀 내보내기 로직 (유지)
// ==========================================
function applyExcelStyle(ws, rowCount) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = ws[XLSX.utils.encode_cell({r: R, c: C})];
      if (!cell) continue;
      cell.s = {
        alignment: { vertical: "center", horizontal: "center" },
        border: { top: {style:"thin"}, bottom: {style:"thin"}, left: {style:"thin"}, right: {style:"thin"} }
      };
      if (R === 0) {
        cell.s.fill = { fgColor: { rgb: "EEEEEE" } };
        cell.s.font = { bold: true };
      }
    }
  }
  ws['!cols'] = [{wch: 15}, {wch: 15}, {wch: 15}, {wch: 20}];
}

async function exportDaily() {
  const date = document.getElementById('date-selector').value;
  const res = await fetch(`${API_BASE_URL}/events/${date}/attendees`);
  const diners = (await res.json()).filter(d => d.attended);
  
  if (diners.length === 0) return alert('식사 기록이 없습니다.');

  const data = diners.map(d => ({
    '날짜': date, '부서': d.orgRole, '이름': d.name, 
    '시간': new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false})
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  applyExcelStyle(ws, data.length + 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "일별명단");
  XLSX.writeFile(wb, `식사명단_${date}.xlsx`);
}

async function exportMonthly() {
  const month = prompt("조회할 월 입력 (YYYY-MM)", getTodayStr().substring(0, 7));
  if (!month) return;

  const res = await fetch(`${API_BASE_URL}/events/month/${month}`);
  const diners = await res.json();
  if (diners.length === 0) return alert('기록이 없습니다.');

  const data = diners.sort((a,b) => a.date.localeCompare(b.date)).map(d => ({
    '날짜': d.date, '부서': d.orgRole, '이름': d.name, 
    '시간': d.scannedAt ? new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false}) : '-'
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  applyExcelStyle(ws, data.length + 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "월별명단");
  XLSX.writeFile(wb, `식사명단_${month}.xlsx`);
}

// ==========================================
// 🚀 6. 초기화 및 이벤트 리스너
// ==========================================
function initDashboard() {
  initDeptFilter(); // 날짜 옆에 필터 생성
  
  const datePicker = document.getElementById('date-selector');
  datePicker.value = getTodayStr();
  loadDiners(datePicker.value);
  window.startScanner();

  datePicker.addEventListener('change', (e) => loadDiners(e.target.value));
  document.getElementById('btn-export-daily')?.addEventListener('click', exportDaily);
  document.getElementById('btn-export-monthly')?.addEventListener('click', exportMonthly);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-request-code')?.addEventListener('click', requestAuthCode);
  document.getElementById('btn-verify-code')?.addEventListener('click', verifyAuthCode);
  
  // 세션 확인 (새로고침 시 로그인 유지)
  if(sessionStorage.getItem('scannerAuthVerified') === 'true') {
    document.getElementById('auth-overlay')?.classList.add('hidden');
    document.getElementById('main-content')?.classList.remove('hidden');
    initDashboard();
  }
});