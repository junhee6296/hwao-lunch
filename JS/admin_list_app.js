import { API_BASE_URL } from './config.js';

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

// ==========================================
// 🔐 1. 관리자 보안 인증 로직 (ADMIN_EMAILS 사용)
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
  if (sessionStorage.getItem('adminAuthVerified') === 'true') {
    showAdminPanel();
    return;
  }
  resetAuthUI();
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

function hideAdminPanel() {
  $('main-content')?.classList.add('hidden');
}

async function requestAdminAuth() {
  const email = $('admin-email')?.value.trim();
  if(!email) return alert('이메일을 입력하세요.');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/request-code`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email })
    });

    if(res.ok) {
      loggedInEmail = email;
      $('step-email')?.classList.add('hidden');
      $('step-code')?.classList.remove('hidden');
      startAuthTimer(180); // 3분 타이머
      alert('✅ 인증번호가 발송되었습니다.');
    } else {
      alert((await res.json()).message);
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function verifyAdminAuth() {
  const code = $('2fa-code')?.value.trim();
  if(!code) return alert('인증번호를 입력하세요.');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/verify-code`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email: loggedInEmail, code })
    });

    if(res.ok) {
      clearInterval(authTimerInterval);
      sessionStorage.setItem('adminAuthVerified', 'true');
      alert('🎉 관리자 인증 성공!');
      showAdminPanel();
    } else {
      const data = await res.json();
      alert(`⚠️ ${data.message}`);
      if (data.action === 'reset') resetAuthUI();
    }
  } catch (e) {
    alert('서버 연결 실패');
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
  if(!e.target.value) return;
  const [, month, day] = e.target.value.split('-');
  const mmdd = month + day;

  if (selectedDailyDates.has(mmdd)) selectedDailyDates.delete(mmdd);
  else selectedDailyDates.add(mmdd);

  syncDatesToText();
  e.target.value = '';
}

// ==========================================
// 👥 3. 명단 데이터 처리 및 렌더링
// ==========================================
async function loadUsers() {
  try {
    const res = await fetch(`${API_BASE_URL}/admin/allowed-users`);
    allUsers = await res.json();
    renderUsers();
  } catch (e) {
    console.error('명단 로드 실패', e);
  }
}

function renderUsers() {
  const search = ($('search-input')?.value || '').toLowerCase();
  const tbody = $('user-list-body');
  if (!tbody) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const today = new Date();
  today.setHours(0,0,0,0);

  let filtered = allUsers.filter(u =>
    u.mealType === currentTab &&
    ((u.name || '').toLowerCase().includes(search) || (u.orgRole || '').toLowerCase().includes(search))
  );
  filtered.sort((a, b) => a.orgRole !== b.orgRole ? (a.orgRole || '').localeCompare(b.orgRole || '', 'ko') : (a.name || '').localeCompare(b.name || '', 'ko'));

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-10 text-center text-gray-400 font-bold">등록된 명단이 없습니다.</td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const originalIdx = allUsers.findIndex(o => o.createdAt === u.createdAt);
    const isExpired = u.endDate < todayStr;

    let dateDisplay = u.endDate;
    if (u.mealType === 'daily' && u.validDates) {
      dateDisplay = u.validDates.map(d => d.substring(5).replace('-', '.')).join(', ');
    }

    const endDateObj = new Date(u.endDate + 'T12:00:00');
    const deleteDateObj = new Date(endDateObj);
    deleteDateObj.setDate(deleteDateObj.getDate() + 5);
    const deleteDateStr = deleteDateObj.toISOString().split('T')[0];
    const diffTime = Math.round((deleteDateObj - today) / (1000 * 60 * 60 * 24));

    let dDayBadge = diffTime <= 5
      ? `<span class="text-red-500 font-bold ml-1">(D-${diffTime})</span>`
      : '<span class="text-gray-400 font-bold ml-1">(여유)</span>';
    if (diffTime === 0) dDayBadge = '<span class="text-red-600 font-black ml-1 text-xs bg-red-100 px-1 rounded">(오늘삭제)</span>';

    const actionButtons = u.mealType === 'monthly'
      ? `<button onclick="window.changePeriod(${originalIdx}, 'shorten')" class="text-xs font-bold text-orange-500 bg-white border px-3 py-1.5 rounded-lg hover:bg-orange-50">단축</button>
         <button onclick="window.changePeriod(${originalIdx}, 'extend')" class="text-xs font-bold text-blue-600 bg-blue-50 border px-3 py-1.5 rounded-lg ml-1 hover:bg-blue-100">연장</button>`
      : `<button onclick="window.editDailyDates(${originalIdx})" class="text-xs font-bold text-blue-600 bg-blue-50 border px-3 py-1.5 rounded-lg hover:bg-blue-100">날짜 변경</button>`;

    return `
      <tr class="hover:bg-blue-50/50 bg-white transition ${isExpired ? 'bg-red-50/30' : ''}">
        <td class="p-4 text-center border-r"><input type="checkbox" class="user-check w-4 h-4" data-index="${originalIdx}"></td>
        <td class="p-4 border-r"><div class="text-xs text-gray-400">${escapeHTML(u.orgRole)}</div><div class="font-bold text-gray-900">${escapeHTML(u.name)}</div></td>
        <td class="p-4 text-center font-mono text-sm text-gray-500 border-r">${u.mealType === 'daily' ? '-' : escapeHTML(u.startDate)}</td>
        <td class="p-4 text-center font-mono text-sm border-r ${isExpired ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'}">${escapeHTML(dateDisplay)}</td>
        <td class="p-4 text-center font-mono text-sm border-r bg-red-50/20 text-gray-600">${escapeHTML(deleteDateStr)} ${dDayBadge}</td>
        <td class="p-4 text-right">${actionButtons} <button onclick="window.deleteUser(${originalIdx})" class="text-xs font-bold text-gray-400 hover:text-red-500 ml-3">삭제</button></td>
      </tr>`;
  }).join('');
}

// ==========================================
// 🚀 4. 초기화 및 이벤트 등록
// ==========================================
export function initAdminList() {
  $('btn-open-admin-auth')?.addEventListener('click', showAuthOverlay);
  $('btn-cancel-auth')?.addEventListener('click', hideAuthOverlay);
  $('btn-close-admin-panel')?.addEventListener('click', hideAdminPanel);
  $('btn-request-auth')?.addEventListener('click', requestAdminAuth);
  $('btn-verify-auth')?.addEventListener('click', verifyAdminAuth);
  $('daily-date-picker')?.addEventListener('change', handleDatePickerChange);
  $('search-input')?.addEventListener('input', renderUsers);

  $('check-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.user-check').forEach(cb => cb.checked = e.target.checked);
  });

  $('btn-add-user')?.addEventListener('click', async () => {
    const orgRole = $('new-org').value.trim();
    const name = $('new-name').value.trim();
    if(!orgRole || !name) return alert('부서와 이름을 입력하세요.');

    let targetDates = [];
    if (currentTab === 'daily') {
      const parts = $('daily-date-text').value.split(',').map(s => s.trim()).filter(s => /^\d{4}$/.test(s));
      if (parts.length === 0) return alert('날짜를 선택하세요.');
      const year = new Date().getFullYear();
      targetDates = parts.map(dVal => `${year}-${dVal.substring(0,2)}-${dVal.substring(2,4)}`);
    }

    const res = await fetch(`${API_BASE_URL}/admin/allowed-users`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ orgRole, name, mealType: currentTab, targetDates })
    });

    if(res.ok) {
      $('new-name').value = '';
      $('daily-date-text').value = '';
      selectedDailyDates.clear();
      loadUsers();
    } else {
      alert((await res.json()).message);
    }
  });

  if (window.location.hash === '#manage') {
    showAuthOverlay();
  }
}

// 🌟 전역 함수 노출 (HTML onclick 대응)
window.switchTab = (tab) => {
  currentTab = tab;
  const isDaily = tab === 'daily';

  $('tab-daily').className = isDaily
    ? 'flex-1 py-4 font-black text-blue-600 border-b-4 border-blue-600 bg-white'
    : 'flex-1 py-4 font-bold text-gray-400 bg-gray-50 hover:bg-gray-100';
  $('tab-monthly').className = !isDaily
    ? 'flex-1 py-4 font-black text-blue-600 border-b-4 border-blue-600 bg-white'
    : 'flex-1 py-4 font-bold text-gray-400 bg-gray-50 hover:bg-gray-100';

  $('daily-date-wrapper')?.classList.toggle('hidden', !isDaily);
  $('monthly-bulk-actions')?.classList.toggle('hidden', isDaily);
  if ($('th-endDate')) $('th-endDate').textContent = isDaily ? '지정 날짜 목록' : '마감 기한';
  if ($('form-title')) $('form-title').textContent = isDaily ? '일식 등록' : '월식 등록';
  if ($('check-all')) $('check-all').checked = false;

  renderUsers();
};

window.changePeriod = async (idx, action) => {
  const res = await fetch(`${API_BASE_URL}/admin/allowed-users/update-period`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ indexes: [idx], action, type: currentTab })
  });
  if (!res.ok) alert((await res.json()).message);
  loadUsers();
};

window.editDailyDates = async (idx) => {
  const user = allUsers[idx];
  const currentStr = user.validDates ? user.validDates.map(d => d.substring(5,7) + d.substring(8,10)).join(', ') : '';
  const newVal = prompt('변경할 날짜들을 입력하세요 (예: 0401, 0405)', currentStr);
  if (newVal === null) return;

  const parts = newVal.split(',').map(s => s.trim()).filter(s => /^\d{4}$/.test(s));
  if (parts.length === 0) return alert('날짜를 하나 이상 입력하세요.');

  const targetDates = parts.map(dVal => `${new Date().getFullYear()}-${dVal.substring(0,2)}-${dVal.substring(2,4)}`);
  const res = await fetch(`${API_BASE_URL}/admin/allowed-users/update-dates`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ index: idx, targetDates })
  });
  if (!res.ok) alert((await res.json()).message);
  loadUsers();
};

window.deleteUser = async (idx) => {
  if(!confirm('삭제하시겠습니까?')) return;
  await fetch(`${API_BASE_URL}/admin/allowed-users`, {
    method: 'DELETE',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ indexes: [idx] })
  });
  loadUsers();
};

window.bulkChange = async (action) => {
  const indexes = Array.from(document.querySelectorAll('.user-check:checked')).map(cb => parseInt(cb.dataset.index, 10));
  if(indexes.length === 0) return alert('대상을 선택하세요.');

  const res = await fetch(`${API_BASE_URL}/admin/allowed-users/update-period`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ indexes, action, type: currentTab })
  });
  if (!res.ok) alert((await res.json()).message);
  loadUsers();
};

window.bulkDelete = async () => {
  const indexes = Array.from(document.querySelectorAll('.user-check:checked')).map(cb => parseInt(cb.dataset.index, 10));
  if(indexes.length === 0) return alert('대상을 선택하세요.');
  if(!confirm('일괄 삭제하시겠습니까?')) return;

  await fetch(`${API_BASE_URL}/admin/allowed-users`, {
    method: 'DELETE',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ indexes })
  });
  loadUsers();
};
