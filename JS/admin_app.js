// JS/admin_app.js
import { API_BASE_URL, getTodayStr } from './config.js';

// 🌟 전역 변수: html5QrCode 인스턴스와 상태 관리
window.html5QrCode = null;
window.isScanningAction = false;
let loggedInEmail = '';

// ==========================================
// 🔐 1. 관리자 보안 인증 (로그인)
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
      initDashboard();
    } else {
      alert('⚠️ 인증번호가 일치하지 않습니다.');
    }
  } catch (e) { alert('서버 연결 실패'); }
}

// ==========================================
// 📊 2. 데이터 로드 및 통계 업데이트
// ==========================================
async function loadDiners(date) {
  try {
    const res = await fetch(`${API_BASE_URL}/events/date/${date}`);
    const diners = await res.json();
    
    const tbody = document.getElementById('diner-table-body');
    tbody.innerHTML = '';
    
    let count = 0;
    const sortedDiners = diners
      .filter(d => d.attended)
      .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

    sortedDiners.forEach(d => {
      count++;
      const tr = document.createElement('tr');
      tr.className = "hover:bg-gray-50 transition-colors";
      tr.innerHTML = `
        <td class="p-4 text-gray-700 font-medium border-b">${d.orgRole}</td>
        <td class="p-4 font-bold text-gray-900 border-b">${d.name}</td>
        <td class="p-4 text-center text-gray-500 text-sm font-mono border-b">
          ${new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false, hour:'2-digit', minute:'2-digit'})}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('stat-count').textContent = `${count}명`;
    document.getElementById('recent-diner').textContent = sortedDiners[0]?.name || '-';
  } catch (e) { console.error("데이터 로드 실패", e); }
}

// ==========================================
// 📷 3. QR 스캐너 제어 (window 전역 노출)
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
          loadDiners(document.getElementById('date-selector').value);
        } else {
          msgEl.textContent = `❌ ${data.message}`;
          msgEl.className = "text-xl font-bold text-red-500";
        }
      } catch (e) { msgEl.textContent = "⚠️ 서버 통신 에러"; }
      
      setTimeout(() => {
        msgEl.textContent = "QR 코드를 보여주세요";
        msgEl.className = "text-xl font-bold text-gray-700";
        window.isScanningAction = false;
      }, 2000);
    }
  );
};

// ==========================================
// 📥 4. 엑셀 내보내기 로직 (스타일 포함)
// ==========================================
function applyExcelStyle(ws, rowCount) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = ws[XLSX.utils.encode_cell({r: R, c: C})];
      if (!cell) continue;
      cell.s = {
        alignment: { vertical: "center", horizontal: "center" },
        border: {
          top: { style: "thin" }, bottom: { style: "thin" },
          left: { style: "thin" }, right: { style: "thin" }
        }
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
  const res = await fetch(`${API_BASE_URL}/events/date/${date}`);
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
// 🚀 5. 초기화 및 이벤트 리스너
// ==========================================
function initDashboard() {
  const datePicker = document.getElementById('date-selector');
  datePicker.value = getTodayStr();
  loadDiners(datePicker.value);
  window.startScanner();

  datePicker.addEventListener('change', (e) => loadDiners(e.target.value));
  document.getElementById('btn-export-daily').onclick = exportDaily;
  document.getElementById('btn-export-monthly').onclick = exportMonthly;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-request-code').onclick = requestAuthCode;
  document.getElementById('btn-verify-code').onclick = verifyAuthCode;
});