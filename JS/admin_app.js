import { API_BASE_URL, getTodayStr } from './config.js';

// 🌟 camera.js와 공유하기 위한 전역 변수 설정
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

  const res = await fetch(`${API_BASE_URL}/admin/request-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  });
  
  const data = await res.json();
  
  if (res.ok) {
    loggedInEmail = email;
    document.getElementById('step-email').classList.add('hidden');
    document.getElementById('step-code').classList.remove('hidden');
    alert('✅ 메일로 인증번호가 발송되었습니다.');
  } else { 
    alert(`⚠️ ${data.message}`); 
    emailInput.value = '';
    emailInput.focus();
  }
}

async function verifyAuthCode() {
  const codeInput = document.getElementById('adminCode');
  const code = codeInput.value.trim();
  if(!code) return alert('인증번호를 입력해주세요.');

  const res = await fetch(`${API_BASE_URL}/admin/verify-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: loggedInEmail, code })
  });

  if (res.ok) {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    initDashboard();
  } else {
    alert(`⚠️ 인증번호가 틀렸습니다.`);
    codeInput.value = '';
    codeInput.focus();
  }
}

// ==========================================
// 📊 2. 데이터 로드 및 통계 처리
// ==========================================
async function loadDiners(date) {
  const res = await fetch(`${API_BASE_URL}/events/date/${date}`);
  const diners = await res.json();
  
  const tbody = document.getElementById('diner-table-body');
  tbody.innerHTML = '';
  
  let count = 0;
  // 최신순 정렬
  const attendedOnly = diners.filter(d => d.attended).sort((a,b) => new Date(b.scannedAt) - new Date(a.scannedAt));

  attendedOnly.forEach(d => {
    count++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-4 text-gray-700 font-medium">${d.orgRole}</td>
      <td class="p-4 font-bold text-gray-900">${d.name}</td>
      <td class="p-4 text-center text-gray-500 text-sm font-mono">${new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false, hour:'2-digit', minute:'2-digit'})}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('stat-count').textContent = `${count}명`;
  document.getElementById('recent-diner').textContent = attendedOnly[0]?.name || '-';
}

// ==========================================
// 📷 3. 🌟 QR 스캐너 시작 함수 (전역 노출)
// ==========================================
window.startScanner = function(facingMode = "environment") {
  // 인스턴스가 없으면 새로 생성하여 전역 변수에 저장
  if (!window.html5QrCode) {
    window.html5QrCode = new Html5Qrcode("reader");
  }
  
  const qrBoxFunction = function(videoWidth, videoHeight) {
      const minEdge = Math.min(videoWidth, videoHeight);
      return { width: Math.floor(minEdge * 0.6), height: Math.floor(minEdge * 0.6) }; 
  };

  return window.html5QrCode.start(
    { facingMode: facingMode }, 
    { fps: 10, qrbox: qrBoxFunction }, 
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
          msgEl.textContent = `✅ ${data.name}님 확인되었습니다.`;
          msgEl.className = "text-xl lg:text-2xl font-bold text-blue-600";
          loadDiners(document.getElementById('date-selector').value);
        } else {
          msgEl.textContent = `❌ ${data.message}`;
          msgEl.className = "text-xl lg:text-2xl font-bold text-red-500";
        }
      } catch (e) {
        msgEl.textContent = "⚠️ 서버 통신 에러";
      } finally {
        setTimeout(() => {
          msgEl.textContent = "QR 코드를 보여주세요";
          msgEl.className = "text-xl lg:text-2xl font-bold text-gray-700";
          window.isScanningAction = false;
        }, 2000);
      }
    }
  ).catch(err => {
    console.error("카메라 시작 실패:", err);
  });
}

// ==========================================
// 📥 4. 엑셀 다운로드 (기존 로직 유지)
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
}

// ==========================================
// 🚀 5. 초기화 및 이벤트 리스너
// ==========================================
function initDashboard() {
  const datePicker = document.getElementById('date-selector');
  datePicker.value = getTodayStr();
  loadDiners(datePicker.value);
  
  // 🌟 전역 함수 호출
  window.startScanner();

  datePicker.addEventListener('change', (e) => loadDiners(e.target.value));

  document.getElementById('btn-export-daily')?.addEventListener('click', async () => {
    const date = datePicker.value;
    const res = await fetch(`${API_BASE_URL}/events/date/${date}`);
    const diners = await res.json();
    const attendedOnly = diners.filter(d => d.attended);
    
    if (attendedOnly.length === 0) return alert('기록이 없습니다.');

    const excelData = attendedOnly.map(d => ({
      '날짜': date, '부서': d.orgRole, '이름': d.name, 
      '시간': new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false})
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    applyExcelStyle(ws, excelData.length + 1);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "일별명단");
    XLSX.writeFile(wb, `식사명단_${date}.xlsx`);
  });

  document.getElementById('btn-export-monthly')?.addEventListener('click', async () => {
    const month = prompt("조회할 월 (YYYY-MM)", getTodayStr().substring(0, 7));
    if (!month) return;
    const res = await fetch(`${API_BASE_URL}/events/month/${month}`);
    const diners = await res.json();
    if (diners.length === 0) return alert('기록이 없습니다.');

    const excelData = diners.map(d => ({
      '날짜': d.date, '부서': d.orgRole, '이름': d.name, 
      '시간': new Date(d.scannedAt).toLocaleTimeString('ko-KR', {hour12:false})
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    applyExcelStyle(ws, excelData.length + 1);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "월별명단");
    XLSX.writeFile(wb, `식사명단_${month}.xlsx`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-request-code')?.addEventListener('click', requestAuthCode);
  document.getElementById('btn-verify-code')?.addEventListener('click', verifyAuthCode);
});