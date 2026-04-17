import { API_BASE_URL, getTodayStr } from './config.js';

let html5QrCode;
let loggedInEmail = '';

// ==========================================
// 1. 관리자 로그인 로직 (팝업 경고 및 3회 오류 처리)
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
    // 🌟 이메일 불일치 경고 팝업
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
  
  const data = await res.json();

  if (res.ok) {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    initDashboard();
  } else { 
    // 🌟 인증번호 불일치 및 3회 초과 경고 팝업
    alert(`⚠️ ${data.message}`); 
    codeInput.value = '';
    codeInput.focus();

    // 🌟 3회 초과 시 이메일 입력창으로 돌아가기
    if(data.action === 'reset') {
      document.getElementById('step-code').classList.add('hidden');
      document.getElementById('step-email').classList.remove('hidden');
    }
  }
}

// 2. 대시보드 초기화 (이하 로직 기존과 동일)
function initDashboard() {
  const datePicker = document.getElementById('date-selector');
  datePicker.value = getTodayStr();
  loadDiners(datePicker.value);
  startScanner();

  datePicker.onchange = (e) => {
    const day = new Date(e.target.value).getDay();
    if (day === 0 || day === 6) {
      alert('주말(토/일)은 식사 명단 조회가 불가능합니다.');
      datePicker.value = getTodayStr(); 
    }
    loadDiners(datePicker.value);
  };
}

async function loadDiners(date) {
  const res = await fetch(`${API_BASE_URL}/events/${date}/attendees`);
  const diners = await res.json();
  const attendedDiners = diners.filter(d => d.attended).sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

  document.getElementById('diner-table-body').innerHTML = attendedDiners.map(d => {
    const role = d.orgRole || '-';
    const name = d.name || '알수없음';
    const time = d.scannedAt ? new Date(d.scannedAt).toLocaleTimeString('ko-KR') : '-';
    return `<tr><td class="p-4">${role}</td><td class="p-4 font-bold">${name}</td><td class="p-4 text-center text-green-600 font-bold">${time}</td></tr>`;
  }).join('');
  
  document.getElementById('stat-count').textContent = `${attendedDiners.length}명`;

  if (attendedDiners.length > 0) {
    document.getElementById('recent-diner').textContent = `[${attendedDiners[0].orgRole || '-'}] ${attendedDiners[0].name || '알수없음'}`;
  } else {
    document.getElementById('recent-diner').textContent = "-";
  }
}

let isScanningAction = false;
function startScanner() {
  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 300 }, async (decodedText) => {
    if (isScanningAction) return;
    isScanningAction = true;
    
    const res = await fetch(`${API_BASE_URL}/qr/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken: decodedText })
    });
    const result = await res.json();
    const scanMsg = document.getElementById('scan-msg');

    if (res.ok) {
      scanMsg.textContent = `✅ [${result.orgRole || '-'}] ${result.name || '알수없음'}님 등록되었습니다!`;
      scanMsg.className = "text-4xl font-black text-green-600";
      loadDiners(document.getElementById('date-selector').value);
    } else {
      scanMsg.textContent = `❌ ${result.message}`;
      scanMsg.className = "text-3xl font-bold text-red-500";
    }

    setTimeout(() => {
      scanMsg.textContent = "QR 코드를 카메라에 보여주세요";
      scanMsg.className = "text-3xl font-bold text-gray-400";
      isScanningAction = false;
    }, 3000);
  });
}

const formatTime = (isoString) => isoString ? new Date(isoString).toLocaleTimeString('ko-KR') : '-';
function applyExcelStyle(ws, rowCount) {
  ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 22 }];
  ['A1', 'B1', 'C1', 'D1'].forEach(cell => {
    if (ws[cell]) {
      ws[cell].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "000000" } }, alignment: { horizontal: "center", vertical: "center" } };
    }
  });
  for (let i = 2; i <= rowCount; i++) {
    const cellA = ws['A' + i];
    if (cellA) cellA.s = { font: { bold: true }, fill: { fgColor: { rgb: "FFF2CC" } }, alignment: { horizontal: "center", vertical: "center" } };
    ['B', 'C', 'D'].forEach(col => {
      if (ws[col + i]) ws[col + i].s = { alignment: { horizontal: "center", vertical: "center" } };
    });
  }
  ws['!autofilter'] = { ref: `A1:C${rowCount}` };
}

document.getElementById('btn-export-daily')?.addEventListener('click', async () => {
  const date = document.getElementById('date-selector').value;
  const res = await fetch(`${API_BASE_URL}/events/${date}/attendees`);
  const diners = await res.json();
  const attendedOnly = diners.filter(d => d.attended);
  if (attendedOnly.length === 0) return alert('다운로드할 명단이 없습니다.');
  
  const excelData = attendedOnly.map(d => ({
    '날짜': date, '부서': d.orgRole || '-', '이름': d.name || '-', '스캔 시간': formatTime(d.scannedAt)
  }));
  const ws = XLSX.utils.json_to_sheet(excelData);
  applyExcelStyle(ws, excelData.length + 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "일별명단");
  XLSX.writeFile(wb, `화성오산교육청_일별명단_${date}.xlsx`);
});

document.getElementById('btn-export-monthly')?.addEventListener('click', async () => {
  const defaultMonth = getTodayStr().substring(0, 7); 
  const yearMonth = prompt("다운로드할 연도와 월을 입력하세요 (형식: YYYY-MM)", defaultMonth);
  if (!yearMonth) return;

  const res = await fetch(`${API_BASE_URL}/events/month/${yearMonth}`);
  const diners = await res.json();
  if (diners.length === 0) return alert('해당 월의 식사 기록이 없습니다.');
  
  diners.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return new Date(a.scannedAt) - new Date(b.scannedAt);
  });

  const excelData = diners.map(d => ({
    '날짜': d.date, '부서': d.orgRole || '-', '이름': d.name || '-', '스캔 시간': formatTime(d.scannedAt)
  }));
  const ws = XLSX.utils.json_to_sheet(excelData);
  applyExcelStyle(ws, excelData.length + 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "월별명단");
  XLSX.writeFile(wb, `화성오산교육청_월별통계_${yearMonth}.xlsx`);
});

document.getElementById('btn-request-code').onclick = requestAuthCode;
document.getElementById('btn-verify-code').onclick = verifyAuthCode;