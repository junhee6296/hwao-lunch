import { API_BASE_URL, getTodayStr } from './config.js';

let currentTab = 'daily';
let allUsers = [];
let loggedInEmail = '';
let authTimerInterval = null;
let selectedDailyDates = new Set();

const $ = (id) => document.getElementById(id);

const escapeHTML = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const request = { ...options, credentials: 'same-origin', headers };

  if (request.body && typeof request.body !== 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    request.body = JSON.stringify(request.body);
  }

  return fetch(`${API_BASE_URL}${path}`, request);
}

async function adminFetch(path, options = {}) {
  const res = await apiFetch(path, options);
  if (res.status === 401) {
    showAuthOverlay();
    throw new Error('관리자 인증이 필요합니다.');
  }
  return res;
}

// ==========================================
// 🔐 1. 관리자 보안 인증 로직: 서버 세션 쿠키 기준
// ==========================================
function resetAuthUI() {
  clearInterval(authTimerInterval);
  $('step-code')?.classList.add('hidden');
  $('step-email')?.classList.remove('hidden');
  if ($('2fa-code')) $('2fa-code').value = '';
  if ($('btn-verify-auth')) $('btn-verify-auth').textContent = '인증 확인';
}

function startAuthTimer(durationSec) {
  clearInterval(authTimerInterval);
  const btnVerify = $('btn-verify-auth');
  let timeLeft = durationSec;

  if (btnVerify) {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    btnVerify.textContent = `인증 확인 (${m}:${s < 10 ? '0' : ''}${s})`;
  }

  authTimerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(authTimerInterval);
      alert('⏳ 인증 시간이 만료되었습니다. 다시 시도해 주세요.');
      resetAuthUI();
    } else if (btnVerify) {
      const m = Math.floor(timeLeft / 60);
      const s = timeLeft % 60;
      btnVerify.textContent = `인증 확인 (${m}:${s < 10 ? '0' : ''}${s})`;
    }
  }, 1000);
}

function showAuthOverlay() {
  resetAuthUI();
  $('main-content')?.classList.add('hidden');
  $('auth-overlay')?.classList.remove('hidden');
}

function hideAuthOverlay() {
  clearInterval(authTimerInterval);
  $('auth-overlay')?.classList.add('hidden');
  resetAuthUI();
}

function showAdminPanel() {
  $('auth-overlay')?.classList.add('hidden');
  $('main-content')?.classList.remove('hidden');
  loadUsers();
}

async function checkAdminSession() {
  try {
    const res = await apiFetch('/admin/session');
    const data = await res.json();
    if (res.ok && data.authenticated) {
      loggedInEmail = data.email || '';
      showAdminPanel();
    } else {
      showAuthOverlay();
    }
  } catch (e) {
    showAuthOverlay();
  }
}

async function requestAdminAuth() {
  const email = $('admin-email')?.value.trim();
  if (!email) return alert('이메일을 입력하세요.');

  try {
    const res = await apiFetch('/admin/request-code', {
      method: 'POST',
      body: { email }
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      loggedInEmail = email;
      $('step-email')?.classList.add('hidden');
      $('step-code')?.classList.remove('hidden');
      startAuthTimer(data.expiresIn || 180);
      alert('✅ 인증번호가 발송되었습니다.');
    } else {
      alert(data.message || '인증번호 발송에 실패했습니다.');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function verifyAdminAuth() {
  const code = $('2fa-code')?.value.trim();
  if (!code) return alert('인증번호를 입력하세요.');

  try {
    const res = await apiFetch('/admin/verify-code', {
      method: 'POST',
      body: { email: loggedInEmail, code }
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      clearInterval(authTimerInterval);
      alert('🎉 관리자 인증 성공!');
      showAdminPanel();
    } else {
      alert(`⚠️ ${data.message || '인증에 실패했습니다.'}`);
      if (data.action === 'reset') resetAuthUI();
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function logoutAdmin() {
  try {
    await apiFetch('/admin/logout', { method: 'POST' });
  } catch (e) {
    console.warn('로그아웃 요청 실패:', e);
  } finally {
    loggedInEmail = '';
    allUsers = [];
    showAuthOverlay();
  }
}

// ==========================================
// 📅 2. 일식 다중 날짜 동기화 로직
// ==========================================
function syncDatesToText() {
  const dateText = $('daily-date-text');
  if (!dateText) return;
  dateText.value = Array.from(selectedDailyDates).sort().join(', ');
}

function handleDatePickerChange(e) {
  if (!e.target.value) return;
  const [, month, day] = e.target.value.split('-');
  const mmdd = month + day;

  if (selectedDailyDates.has(mmdd)) selectedDailyDates.delete(mmdd);
  else selectedDailyDates.add(mmdd);

  syncDatesToText();
  e.target.value = '';
}

function mmddToDate(mmdd) {
  const year = new Date().getFullYear();
  const month = mmdd.substring(0, 2);
  const day = mmdd.substring(2, 4);
  return `${year}-${month}-${day}`;
}

// ==========================================
// 👥 3. 명단 데이터 처리 및 렌더링
// ==========================================
async function loadUsers() {
  try {
    const res = await adminFetch('/admin/allowed-users');
    if (!res.ok) throw new Error('명단 조회 실패');
    allUsers = await res.json();
    renderUsers();
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') console.error('명단 로드 실패', e);
  }
}

function renderUsers() {
  const search = ($('search-input')?.value || '').toLowerCase();
  const tbody = $('user-list-body');
  if (!tbody) return;

  const todayStr = getTodayStr();
  const today = new Date(`${todayStr}T00:00:00`);

  let filtered = allUsers.filter(user =>
    user.mealType === currentTab &&
    ((user.name || '').toLowerCase().includes(search) || (user.orgRole || '').toLowerCase().includes(search))
  );

  filtered.sort((a, b) => (
    a.orgRole !== b.orgRole
      ? (a.orgRole || '').localeCompare(b.orgRole || '', 'ko')
      : (a.name || '').localeCompare(b.name || '', 'ko')
  ));

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-10 text-center text-gray-400 font-bold">등록된 명단이 없습니다.</td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(user => {
    const originalIdx = allUsers.findIndex(item => item.id === user.id || item.createdAt === user.createdAt);
    const isExpired = user.endDate < todayStr;

    let dateDisplay = user.endDate;
    if (user.mealType === 'daily' && Array.isArray(user.validDates)) {
      dateDisplay = user.validDates.map(date => date.substring(5).replace('-', '.')).join(', ');
    }

    const endDateObj = new Date(`${user.endDate}T12:00:00`);
    const deleteDateObj = new Date(endDateObj);
    deleteDateObj.setDate(deleteDateObj.getDate() + 5);
    const deleteDateStr = deleteDateObj.toISOString().split('T')[0];
    const diffTime = Math.round((deleteDateObj - today) / (1000 * 60 * 60 * 24));

    let dDayBadge = diffTime <= 5
      ? `<span class="text-red-500 font-bold ml-1">(D-${diffTime})</span>`
      : '<span class="text-gray-400 font-bold ml-1">(여유)</span>';
    if (diffTime === 0) dDayBadge = '<span class="text-red-600 font-black ml-1 text-xs bg-red-100 px-1 rounded">(오늘삭제)</span>';

    const actionButtons = user.mealType === 'monthly'
      ? `<button onclick="window.changePeriod(${originalIdx}, 'shorten')" class="text-xs font-bold text-orange-500 bg-white border px-3 py-1.5 rounded-lg hover:bg-orange-50">단축</button>
         <button onclick="window.changePeriod(${originalIdx}, 'extend')" class="text-xs font-bold text-blue-600 bg-blue-50 border px-3 py-1.5 rounded-lg ml-1 hover:bg-blue-100">연장</button>`
      : `<button onclick="window.editDailyDates(${originalIdx})" class="text-xs font-bold text-blue-600 bg-blue-50 border px-3 py-1.5 rounded-lg hover:bg-blue-100">날짜 변경</button>`;

    return `
      <tr class="hover:bg-blue-50/50 bg-white transition ${isExpired ? 'bg-red-50/30' : ''}">
        <td class="p-4 text-center border-r"><input type="checkbox" class="user-check w-4 h-4" data-index="${originalIdx}"></td>
        <td class="p-4 border-r"><div class="text-xs text-gray-400">${escapeHTML(user.orgRole)}</div><div class="font-bold text-gray-900">${escapeHTML(user.name)}</div></td>
        <td class="p-4 text-center font-mono text-sm text-gray-500 border-r">${user.mealType === 'daily' ? '-' : escapeHTML(user.startDate)}</td>
        <td class="p-4 text-center font-mono text-sm border-r ${isExpired ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'}">${escapeHTML(dateDisplay)}</td>
        <td class="p-4 text-center font-mono text-sm border-r bg-red-50/20 text-gray-600">${escapeHTML(deleteDateStr)} ${dDayBadge}</td>
        <td class="p-4 text-right">${actionButtons} <button onclick="window.deleteUser(${originalIdx})" class="text-xs font-bold text-gray-400 hover:text-red-500 ml-3">삭제</button></td>
      </tr>`;
  }).join('');
}

// ==========================================
// 📥 4. 엑셀 시트 다운로드
// ==========================================
function normalizeDailySheetDate(raw) {
  const value = String(raw || '').trim();
  const compact = value.replace(/[^0-9]/g, '');

  if (!/^\d{8}$/.test(compact)) return null;

  const year = compact.substring(0, 4);
  const month = compact.substring(4, 6);
  const day = compact.substring(6, 8);
  const normalized = `${year}-${month}-${day}`;
  const dateObj = new Date(`${normalized}T12:00:00`);

  if (
    Number.isNaN(dateObj.getTime()) ||
    String(dateObj.getFullYear()) !== year ||
    String(dateObj.getMonth() + 1).padStart(2, '0') !== month ||
    String(dateObj.getDate()).padStart(2, '0') !== day
  ) {
    return null;
  }

  return normalized;
}

function formatDailyPromptDefault() {
  const today = getTodayStr();
  return `${today.substring(0, 4)}-${today.substring(5, 7)}${today.substring(8, 10)}`;
}

function applyExcelStyle(ws, rowCount) {
  if (!ws?.['!ref']) return;
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
  ws['!cols'] = [{wch: 15}, {wch: 20}, {wch: 15}, {wch: 20}];
  ws['!autofilter'] = { ref: `A1:D${rowCount}` };
}

async function exportDailySheet() {
  if (typeof XLSX === 'undefined') return alert('엑셀 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');

  const input = prompt('다운로드할 일별 시트 날짜를 입력하세요 (YYYY-MMDD)', formatDailyPromptDefault());
  if (input === null) return;

  const date = normalizeDailySheetDate(input);
  if (!date) return alert('날짜 형식이 올바르지 않습니다. 예: 2026-0526');

  try {
    const res = await adminFetch(`/admin/events/${date}/attendees`);
    if (!res.ok) throw new Error('데이터 조회 실패');

    const diners = (await res.json()).filter(diner => diner.attended);
    if (diners.length === 0) return alert(`${date}에 다운로드할 식사 기록이 없습니다.`);

    const data = diners
      .sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt))
      .map(diner => ({
        '날짜': date,
        '부서': diner.orgRole || '-',
        '이름': diner.name || '-',
        '시간': diner.scannedAt ? new Date(diner.scannedAt).toLocaleTimeString('ko-KR', {hour12:false}) : '-'
      }));

    const ws = XLSX.utils.json_to_sheet(data);
    applyExcelStyle(ws, data.length + 1);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '일별명단');
    XLSX.writeFile(wb, `식사명단_${date.substring(0, 4)}-${date.substring(5, 7)}${date.substring(8, 10)}.xlsx`);
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') {
      console.error('일별 시트 다운로드 실패:', e);
      alert('일별 시트를 다운로드할 수 없습니다.');
    }
  }
}

async function exportMonthlySheet() {
  if (typeof XLSX === 'undefined') return alert('엑셀 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');

  const month = prompt('조회할 월 입력 (YYYY-MM)', getTodayStr().substring(0, 7));
  if (!month) return;
  if (!/^\d{4}-\d{2}$/.test(month.trim())) return alert('월 형식이 올바르지 않습니다. 예: 2026-05');

  try {
    const res = await adminFetch(`/admin/events/month/${month.trim()}`);
    if (!res.ok) throw new Error('데이터 조회 실패');

    const diners = await res.json();
    if (diners.length === 0) return alert('기록이 없습니다.');

    const data = diners.sort((a,b) => a.date.localeCompare(b.date)).map(diner => ({
      '날짜': diner.date,
      '부서': diner.orgRole || '-',
      '이름': diner.name || '-',
      '시간': diner.scannedAt ? new Date(diner.scannedAt).toLocaleTimeString('ko-KR', {hour12:false}) : '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    applyExcelStyle(ws, data.length + 1);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '월별명단');
    XLSX.writeFile(wb, `식사명단_${month.trim()}.xlsx`);
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') {
      console.error('월별 시트 다운로드 실패:', e);
      alert('월별 시트를 다운로드할 수 없습니다.');
    }
  }
}

// ==========================================
// 🚀 5. 초기화 및 이벤트 등록
// ==========================================
export function initAdminList() {
  $('btn-cancel-auth')?.addEventListener('click', showAuthOverlay);
  $('btn-request-auth')?.addEventListener('click', requestAdminAuth);
  $('btn-verify-auth')?.addEventListener('click', verifyAdminAuth);
  $('btn-admin-logout')?.addEventListener('click', logoutAdmin);
  $('btn-export-daily')?.addEventListener('click', exportDailySheet);
  $('btn-export-monthly')?.addEventListener('click', exportMonthlySheet);
  $('daily-date-picker')?.addEventListener('change', handleDatePickerChange);
  $('search-input')?.addEventListener('input', renderUsers);

  $('check-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.user-check').forEach(cb => cb.checked = e.target.checked);
  });

  $('btn-add-user')?.addEventListener('click', async () => {
    const orgRole = $('new-org')?.value.trim();
    const name = $('new-name')?.value.trim();
    if (!orgRole || !name) return alert('부서와 이름을 입력하세요.');

    let targetDates = [];
    if (currentTab === 'daily') {
      const parts = ($('daily-date-text')?.value || '').split(',').map(s => s.trim()).filter(s => /^\d{4}$/.test(s));
      if (parts.length === 0) return alert('날짜를 선택하세요.');
      targetDates = parts.map(mmddToDate);
    }

    try {
      const res = await adminFetch('/admin/allowed-users', {
        method: 'POST',
        body: { orgRole, name, mealType: currentTab, targetDates }
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if ($('new-name')) $('new-name').value = '';
        if ($('daily-date-text')) $('daily-date-text').value = '';
        selectedDailyDates.clear();
        loadUsers();
      } else {
        alert(data.message || '명단 추가에 실패했습니다.');
      }
    } catch (e) {
      if (e.message !== '관리자 인증이 필요합니다.') alert('서버 연결 실패');
    }
  });

  checkAdminSession();
}

// 🌟 전역 함수 노출 (HTML onclick 대응)
window.switchTab = (tab) => {
  currentTab = tab;
  const isDaily = tab === 'daily';

  if ($('tab-daily')) {
    $('tab-daily').className = isDaily
      ? 'flex-1 py-4 font-black text-blue-600 border-b-4 border-blue-600 bg-white'
      : 'flex-1 py-4 font-bold text-gray-400 bg-gray-50 hover:bg-gray-100';
  }
  if ($('tab-monthly')) {
    $('tab-monthly').className = !isDaily
      ? 'flex-1 py-4 font-black text-blue-600 border-b-4 border-blue-600 bg-white'
      : 'flex-1 py-4 font-bold text-gray-400 bg-gray-50 hover:bg-gray-100';
  }

  $('daily-date-wrapper')?.classList.toggle('hidden', !isDaily);
  $('monthly-bulk-actions')?.classList.toggle('hidden', isDaily);
  if ($('th-endDate')) $('th-endDate').textContent = isDaily ? '지정 날짜 목록' : '마감 기한';
  if ($('form-title')) $('form-title').textContent = isDaily ? '일식 등록' : '월식 등록';
  if ($('check-all')) $('check-all').checked = false;

  renderUsers();
};

window.changePeriod = async (idx, action) => {
  try {
    const res = await adminFetch('/admin/allowed-users/update-period', {
      method: 'POST',
      body: { indexes: [idx], action, type: currentTab }
    });
    if (!res.ok) alert((await res.json()).message);
    loadUsers();
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') alert('기간 변경 실패');
  }
};

window.editDailyDates = async (idx) => {
  const user = allUsers[idx];
  if (!user) return alert('대상을 찾을 수 없습니다.');

  const currentStr = Array.isArray(user.validDates)
    ? user.validDates.map(date => date.substring(5,7) + date.substring(8,10)).join(', ')
    : '';
  const newVal = prompt('변경할 날짜들을 입력하세요 (예: 0401, 0405)', currentStr);
  if (newVal === null) return;

  const parts = newVal.split(',').map(s => s.trim()).filter(s => /^\d{4}$/.test(s));
  if (parts.length === 0) return alert('날짜를 하나 이상 입력하세요.');

  const targetDates = parts.map(mmddToDate);
  try {
    const res = await adminFetch('/admin/allowed-users/update-dates', {
      method: 'POST',
      body: { index: idx, targetDates }
    });
    if (!res.ok) alert((await res.json()).message);
    loadUsers();
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') alert('날짜 변경 실패');
  }
};

window.deleteUser = async (idx) => {
  if (!confirm('삭제하시겠습니까?')) return;
  try {
    const res = await adminFetch('/admin/allowed-users', {
      method: 'DELETE',
      body: { indexes: [idx] }
    });
    if (!res.ok) alert((await res.json()).message);
    loadUsers();
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') alert('삭제 실패');
  }
};

window.bulkChange = async (action) => {
  const indexes = Array.from(document.querySelectorAll('.user-check:checked')).map(cb => Number.parseInt(cb.dataset.index, 10));
  if (indexes.length === 0) return alert('대상을 선택하세요.');

  try {
    const res = await adminFetch('/admin/allowed-users/update-period', {
      method: 'POST',
      body: { indexes, action, type: currentTab }
    });
    if (!res.ok) alert((await res.json()).message);
    loadUsers();
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') alert('일괄 변경 실패');
  }
};

window.bulkDelete = async () => {
  const indexes = Array.from(document.querySelectorAll('.user-check:checked')).map(cb => Number.parseInt(cb.dataset.index, 10));
  if (indexes.length === 0) return alert('대상을 선택하세요.');
  if (!confirm('일괄 삭제하시겠습니까?')) return;

  try {
    const res = await adminFetch('/admin/allowed-users', {
      method: 'DELETE',
      body: { indexes }
    });
    if (!res.ok) alert((await res.json()).message);
    loadUsers();
  } catch (e) {
    if (e.message !== '관리자 인증이 필요합니다.') alert('일괄 삭제 실패');
  }
};
