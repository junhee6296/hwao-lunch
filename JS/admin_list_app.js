const { API_BASE_URL, getTodayStr, normalizePhoneLast4, escapeHTML } = globalThis.LunchCheckConfig;

let currentTab = 'daily';
let allUsers = [];
let loggedInEmail = '';
let authTimerInterval = null;
let requestCooldownInterval = null;
let selectedDailyDates = new Set();
let importRows = [];
let importMeta = null;
let currentMenuMonthData = null;
let adminListInitialized = false;

const $ = (id) => document.getElementById(id);

function setDevCodeHint(devCode) {
  const hint = $('auth-dev-code-hint');
  if (!hint) return;
  const code = String(devCode || '').trim();
  hint.textContent = code ? `개발용 인증번호: ${code}` : '';
  hint.classList.toggle('hidden', !code);
}

const pad2 = value => String(value).padStart(2, '0');
const escapeAttr = escapeHTML;

function resetAuthUI() {
  clearInterval(authTimerInterval);
  $('step-code')?.classList.add('hidden');
  $('step-email')?.classList.remove('hidden');
  if ($('2fa-code')) $('2fa-code').value = '';
  setDevCodeHint('');
  if ($('btn-verify-auth')) $('btn-verify-auth').textContent = '인증 확인';
}

function startAuthTimer(durationSec) {
  clearInterval(authTimerInterval);
  const btnVerify = $('btn-verify-auth');
  let timeLeft = durationSec;
  if (btnVerify) btnVerify.textContent = `인증 확인 (3:00)`;

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

function startRequestCooldown(seconds) {
  clearInterval(requestCooldownInterval);
  const btn = $('btn-request-auth');
  if (!btn) return;
  let left = Number(seconds || 30);
  btn.disabled = true;
  btn.textContent = `재요청 가능 ${left}초`;
  requestCooldownInterval = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(requestCooldownInterval);
      btn.disabled = false;
      btn.textContent = '인증번호 발송';
    } else {
      btn.textContent = `재요청 가능 ${left}초`;
    }
  }, 1000);
}

function showMain(email) {
  loggedInEmail = email || loggedInEmail;
  clearInterval(authTimerInterval);
  $('auth-overlay')?.classList.add('hidden');
  $('main-content')?.classList.remove('hidden');
  if ($('admin-email-label')) {
    $('admin-email-label').textContent = loggedInEmail;
    $('admin-email-label').classList.toggle('hidden', !loggedInEmail);
  }
  setupImportSelectors();
  setupMenuSelectors();
  loadUsers();
}

function showAuth() {
  $('main-content')?.classList.add('hidden');
  $('auth-overlay')?.classList.remove('hidden');
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    showAuth();
    throw new Error('관리자 인증이 필요합니다.');
  }
  return res;
}

async function readApiJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { message: text.slice(0, 300) || '서버 응답 형식이 올바르지 않습니다.' };
  }
}

async function checkAdminSession() {
  try {
    const res = await fetch(`${API_BASE_URL}/admin/me`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return showAuth();
    const data = await res.json();
    showMain(data.email);
  } catch (e) {
    showAuth();
  }
}

async function requestAdminAuth() {
  const email = $('admin-email').value.trim();
  if (!email) return alert('이메일을 입력하세요.');

  const btn = $('btn-request-auth');
  btn.disabled = true;
  btn.textContent = '발송 중...';

  try {
    const res = await fetch(`${API_BASE_URL}/admin/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (res.ok) {
      loggedInEmail = email;
      $('step-email').classList.add('hidden');
      $('step-code').classList.remove('hidden');
      const devCode = data.devCode ? String(data.devCode) : '';
      setDevCodeHint(devCode);
      $('2fa-code')?.focus();
      alert(devCode ? `개발 환경용 인증번호: ${devCode}\n3분 안에 입력해주세요.` : '✅ 인증번호가 발송되었습니다. 3분 안에 입력해주세요.');
      startAuthTimer(data.expiresInSeconds || 180);
      startRequestCooldown(data.cooldownSeconds || 30);
    } else {
      if (data.devCode) {
        loggedInEmail = email;
        $('step-email')?.classList.add('hidden');
        $('step-code')?.classList.remove('hidden');
        setDevCodeHint(String(data.devCode));
        $('2fa-code')?.focus();
        startAuthTimer(data.expiresInSeconds || 180);
      }
      alert(`⚠️ ${data.message}`);
      if (data.retryAfter) startRequestCooldown(data.retryAfter);
      else {
        btn.disabled = false;
        btn.textContent = '인증번호 발송';
      }
    }
  } catch (e) {
    alert('서버 연결 실패');
    btn.disabled = false;
    btn.textContent = '인증번호 발송';
  }
}

async function verifyAdminAuth() {
  const code = $('2fa-code').value.trim();
  if (!code) return alert('인증번호를 입력하세요.');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: loggedInEmail, code })
    });
    const data = await res.json();

    if (res.ok) {
      alert('🎉 관리자 인증에 성공했습니다.');
      showMain(data.email || loggedInEmail);
    } else {
      alert(`⚠️ ${data.message}`);
      if (data.action === 'reset') resetAuthUI();
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function logout() {
  try {
    await apiFetch(`${API_BASE_URL}/admin/logout`, { method: 'POST' });
  } catch (e) {
    // 이미 세션이 없을 수 있음
  }
  location.reload();
}

function syncDatesToText() {
  const dateText = $('daily-date-text');
  if (dateText) dateText.value = Array.from(selectedDailyDates).sort().join(', ');
}

function parseDailyDatesFromText() {
  const raw = $('daily-date-text').value;
  const currentYear = getTodayStr().slice(0, 4);
  const pieces = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const dates = [];

  pieces.forEach(piece => {
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(piece);
    if (match) return dates.push(piece);

    match = /^(\d{2})(\d{2})$/.exec(piece);
    if (match) return dates.push(`${currentYear}-${match[1]}-${match[2]}`);

    match = /^(\d{4})(\d{2})(\d{2})$/.exec(piece);
    if (match) return dates.push(`${match[1]}-${match[2]}-${match[3]}`);
  });

  return [...new Set(dates)].sort();
}

function handleDatePickerChange(e) {
  if (!e.target.value) return;
  if (selectedDailyDates.has(e.target.value)) selectedDailyDates.delete(e.target.value);
  else selectedDailyDates.add(e.target.value);
  syncDatesToText();
  e.target.value = '';
}

async function loadUsers() {
  try {
    const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users`, { cache: 'no-store' });
    const users = await res.json();
    allUsers = users.map((u, index) => ({ ...u, _index: index }));
    renderUsers();
  } catch (e) {
    console.error('명단 로드 실패', e);
  }
}

function renderUsers() {
  const search = $('search-input').value.toLowerCase().trim();
  const tbody = $('user-list-body');
  const todayStr = getTodayStr();

  const today = new Date(`${todayStr}T00:00:00Z`);
  let filtered = allUsers.filter(u => {
    const haystack = `${u.name} ${u.phoneLast4}`.toLowerCase();
    return u.mealType === currentTab && haystack.includes(search);
  });

  filtered.sort((a, b) => a.phoneLast4 !== b.phoneLast4 ? a.phoneLast4.localeCompare(b.phoneLast4) : a.name.localeCompare(b.name, 'ko'));

  tbody.innerHTML = filtered.map(u => {
    const isExpired = u.endDate < todayStr;
    let dateDisplay = u.endDate;
    if (u.mealType === 'daily' && Array.isArray(u.validDates)) {
      dateDisplay = u.validDates.map(d => d.substring(5).replace('-', '.')).join(', ');
    }

    const endDateObj = new Date(`${u.endDate}T00:00:00Z`);
    const deleteDateObj = new Date(endDateObj);
    deleteDateObj.setUTCDate(deleteDateObj.getUTCDate() + 5);
    const deleteDateStr = `${deleteDateObj.getUTCFullYear()}-${pad2(deleteDateObj.getUTCMonth() + 1)}-${pad2(deleteDateObj.getUTCDate())}`;
    const diffTime = Math.round((deleteDateObj - today) / (1000 * 60 * 60 * 24));

    let dDayBadge = diffTime <= 5 ? `<span class="text-red-500 font-bold ml-1">(D-${diffTime})</span>` : `<span class="text-gray-400 font-bold ml-1">(여유)</span>`;
    if (diffTime === 0) dDayBadge = '<span class="text-red-600 font-black ml-1 text-xs bg-red-100 px-1 rounded">(오늘삭제)</span>';

    const paymentBadge = u.paymentStatus === '미입금'
      ? '<span class="inline-flex ml-2 text-[11px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-full">미입금</span>'
      : '';

    const actionButtons = u.mealType === 'monthly'
      ? `<button type="button" data-user-action="change-period" data-index="${u._index}" data-period-action="shorten" class="text-xs font-bold text-orange-500 bg-white border px-3 py-1.5 rounded-lg hover:bg-orange-50">단축</button>
         <button type="button" data-user-action="change-period" data-index="${u._index}" data-period-action="extend" class="text-xs font-bold text-blue-600 bg-blue-50 border px-3 py-1.5 rounded-lg ml-1 hover:bg-blue-100">연장</button>`
      : `<button type="button" data-user-action="edit-daily-dates" data-index="${u._index}" class="text-xs font-bold text-blue-600 bg-blue-50 border px-3 py-1.5 rounded-lg hover:bg-blue-100">날짜 변경</button>`;

    return `
      <tr class="hover:bg-blue-50/50 transition ${isExpired ? 'bg-red-50/30' : 'bg-white'}">
        <td class="p-4 text-center border-r"><input type="checkbox" class="user-check w-4 h-4" data-index="${u._index}"></td>
        <td class="p-4 border-r"><div class="text-xs text-gray-400 font-mono">${escapeHTML(u.phoneLast4)}</div><div class="font-bold text-gray-900">${escapeHTML(u.name)}${paymentBadge}</div></td>
        <td class="p-4 text-center font-mono text-sm text-gray-500 border-r">${u.mealType === 'daily' ? '-' : escapeHTML(u.startDate)}</td>
        <td class="p-4 text-center font-mono text-sm border-r ${isExpired ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'}">${escapeHTML(dateDisplay)}</td>
        <td class="p-4 text-center font-mono text-sm border-r bg-red-50/20 text-gray-600">${escapeHTML(deleteDateStr)} ${dDayBadge}</td>
        <td class="p-4 text-right">
          <button type="button" data-user-action="edit-info" data-index="${u._index}" class="text-xs font-bold text-gray-700 bg-white border px-3 py-1.5 rounded-lg hover:bg-gray-50">정보 수정</button>
          ${actionButtons}
          <button type="button" data-user-action="delete-user" data-index="${u._index}" class="text-xs font-bold text-gray-400 hover:text-red-500 ml-3">삭제</button>
        </td>
      </tr>`;
  }).join('');
}

async function addUser() {
  const phoneLast4 = normalizePhoneLast4($('new-phone').value);
  const name = $('new-name').value.trim();
  $('new-phone').value = phoneLast4;

  if (!/^\d{4}$/.test(phoneLast4)) return alert('전화번호 뒷자리는 숫자 4자리로 입력하세요.');
  if (!name) return alert('이름을 입력하세요.');

  let targetDates = [];
  if (currentTab === 'daily') {
    targetDates = parseDailyDatesFromText();
    if (targetDates.length === 0) return alert('날짜를 선택하거나 YYYY-MM-DD 또는 MMDD 형식으로 입력하세요.');
  }

  const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneLast4, name, mealType: currentTab, targetDates })
  });
  const data = await res.json();
  if (res.ok) {
    $('new-name').value = '';
    $('new-phone').value = '';
    $('daily-date-text').value = '';
    selectedDailyDates.clear();
    loadUsers();
  } else alert(data.message);
}

function applyExcelStyle(ws, rowCount) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) continue;
      cell.s = {
        alignment: { vertical: 'center', horizontal: 'center' },
        border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
      };
      if (R === 0) {
        cell.s.fill = { fgColor: { rgb: 'EEEEEE' } };
        cell.s.font = { bold: true };
      }
    }
  }
  ws['!cols'] = [{ wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 20 }];
  ws['!autofilter'] = { ref: `A1:D${rowCount}` };
}

function parseDailySheetDate(input) {
  const raw = String(input || '').trim();
  let match = /^(\d{4})-(\d{2})(\d{2})$/.exec(raw);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) return raw;
  return null;
}

async function exportDaily() {
  const today = getTodayStr();
  const defaultValue = `${today.slice(0, 4)}-${today.slice(5, 7)}${today.slice(8, 10)}`;
  const raw = prompt('일별 시트 날짜 입력 (YYYY-MMDD)', defaultValue);
  if (!raw) return;
  const date = parseDailySheetDate(raw);
  if (!date) return alert('날짜 형식은 YYYY-MMDD입니다. 예: 2026-0526');

  const res = await apiFetch(`${API_BASE_URL}/admin/events/${date}/attendees`, { cache: 'no-store' });
  const diners = await res.json();
  if (!res.ok) return alert(diners.message || '조회 실패');
  if (diners.length === 0) return alert('해당 날짜의 식사 기록이 없습니다.');

  const data = diners.map(d => ({
    '날짜': date,
    '전화번호 뒷자리': d.phoneLast4,
    '이름': d.name,
    '시간': d.scannedAt ? new Date(d.scannedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'
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
  if (!/^\d{4}-\d{2}$/.test(month)) return alert('월 형식은 YYYY-MM입니다.');

  const res = await apiFetch(`${API_BASE_URL}/admin/events/month/${month}`, { cache: 'no-store' });
  const diners = await res.json();
  if (!res.ok) return alert(diners.message || '조회 실패');
  if (diners.length === 0) return alert('기록이 없습니다.');

  const data = diners.sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    '날짜': d.date,
    '전화번호 뒷자리': d.phoneLast4,
    '이름': d.name,
    '시간': d.scannedAt ? new Date(d.scannedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  applyExcelStyle(ws, data.length + 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '월별명단');
  XLSX.writeFile(wb, `식사명단_${month}.xlsx`);
}

function populateYearMonthSelects(yearSelect, monthSelect) {
  if (!yearSelect || !monthSelect || yearSelect.options.length > 0) return;

  const thisYear = Number(getTodayStr().slice(0, 4));
  for (let year = thisYear - 1; year <= thisYear + 2; year++) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = `${year}년`;
    if (year === thisYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }

  const thisMonth = Number(getTodayStr().slice(5, 7));
  for (let month = 1; month <= 12; month++) {
    const opt = document.createElement('option');
    opt.value = String(month);
    opt.textContent = `${month}월`;
    if (month === thisMonth) opt.selected = true;
    monthSelect.appendChild(opt);
  }
}

function setupImportSelectors() {
  populateYearMonthSelects($('import-year'), $('import-month'));
}

function setupMenuSelectors() {
  populateYearMonthSelects($('menu-year'), $('menu-month-select'));
}

function getSelectedMenuYearMonth() {
  const year = Number($('menu-year')?.value || getTodayStr().slice(0, 4));
  const month = Number($('menu-month-select')?.value || getTodayStr().slice(5, 7));
  return { year, month, yearMonth: `${year}-${pad2(month)}` };
}

function formatAdminMenuDate(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
}


function renderAdminOriginItem(item) {
  const text = String(item || '').trim();
  const colonIndex = text.indexOf(':');
  if (colonIndex > 0) {
    const menuName = text.slice(0, colonIndex).trim();
    const origin = text.slice(colonIndex + 1).trim();
    return `<span class="inline-flex flex-col rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 mr-1 mb-1"><b class="text-slate-700">${escapeHTML(menuName)}</b><span class="text-gray-600">${escapeHTML(origin)}</span></span>`;
  }
  return `<span class="inline-flex rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 mr-1 mb-1 text-gray-600">${escapeHTML(text)}</span>`;
}

function renderAdminMenuPreview(data) {
  currentMenuMonthData = data || { days: {} };
  const wrap = $('menu-admin-preview');
  if (!wrap) return;
  const days = data?.days || {};
  const dates = Object.keys(days).sort();
  if (dates.length === 0) {
    wrap.innerHTML = '<div class="col-span-full bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-600 font-bold">아직 추출된 식단표가 없습니다.</div>';
    return;
  }

  wrap.innerHTML = dates.map(date => {
    const day = days[date] || {};
    const menus = Array.isArray(day.menu) ? day.menu : [];
    const origins = Array.isArray(day.origins) ? day.origins : [];
    const isHoliday = menus.includes('공휴일') || Boolean(day.holidayName);
    return `
      <article class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3 mb-2">
          <h3 class="font-black text-slate-900">${escapeHTML(formatAdminMenuDate(date))}</h3>
          <button type="button" data-menu-date="${escapeAttr(date)}" class="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-100">수정</button>
        </div>
        <div class="text-xs font-black text-slate-600 mb-1">메뉴</div>
        ${isHoliday ? `<div class="text-sm font-black text-red-600 mb-3">공휴일${day.holidayName && day.holidayName !== '공휴일' ? ` <span class="text-xs text-red-400">(${escapeHTML(day.holidayName)})</span>` : ''}</div>` : `<ul class="text-sm font-bold text-gray-900 space-y-0.5 mb-3">${menus.length ? menus.map(item => `<li>• ${escapeHTML(item)}</li>`).join('') : '<li class="text-gray-400">없음</li>'}</ul>`}
        ${isHoliday ? '' : `<div class="text-xs font-black text-slate-600 mb-1">원산지</div><div class="text-xs text-gray-600 leading-relaxed">${origins.length ? origins.map(renderAdminOriginItem).join('') : '없음'}</div>`}
      </article>`;
  }).join('');
}

function splitTextareaLines(value) {
  return String(value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
}

function resetMenuEditorForm(date = '') {
  if ($('menu-edit-date')) $('menu-edit-date').value = date || '';
  if ($('menu-edit-items')) { $('menu-edit-items').value = ''; $('menu-edit-items').disabled = false; }
  if ($('menu-edit-origins')) { $('menu-edit-origins').value = ''; $('menu-edit-origins').disabled = false; }
  if ($('menu-edit-holiday')) $('menu-edit-holiday').checked = false;
  if ($('menu-edit-holiday-name')) $('menu-edit-holiday-name').value = '';
  if ($('menu-edit-status')) $('menu-edit-status').textContent = '';
}

function fillMenuEditor(date, day = {}) {
  if (!date) return resetMenuEditorForm();
  const menus = Array.isArray(day.menu) ? day.menu : [];
  const origins = Array.isArray(day.origins) ? day.origins : [];
  const isHoliday = menus.includes('공휴일') || Boolean(day.holidayName);
  if ($('menu-edit-date')) $('menu-edit-date').value = date;
  if ($('menu-edit-items')) { $('menu-edit-items').value = isHoliday ? '' : menus.join('\n'); $('menu-edit-items').disabled = isHoliday; }
  if ($('menu-edit-origins')) { $('menu-edit-origins').value = isHoliday ? '' : origins.join('\n'); $('menu-edit-origins').disabled = isHoliday; }
  if ($('menu-edit-holiday')) $('menu-edit-holiday').checked = isHoliday;
  if ($('menu-edit-holiday-name')) $('menu-edit-holiday-name').value = day.holidayName && day.holidayName !== '공휴일' ? day.holidayName : '';
  if ($('menu-edit-status')) $('menu-edit-status').textContent = `${formatAdminMenuDate(date)} 수정 중`;
}

async function saveMenuDayManual() {
  const date = $('menu-edit-date')?.value || '';
  if (!date) return alert('수정할 날짜를 선택해 주세요.');
  const holiday = Boolean($('menu-edit-holiday')?.checked);
  const menu = splitTextareaLines($('menu-edit-items')?.value);
  const origins = splitTextareaLines($('menu-edit-origins')?.value);
  const holidayName = ($('menu-edit-holiday-name')?.value || '').trim();
  if (!holiday && menu.length === 0) return alert('메뉴를 한 줄 이상 입력해 주세요.');

  const res = await apiFetch(`${API_BASE_URL}/admin/menu/day`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, menu, origins, holiday, holidayName })
  });
  const data = await readApiJson(res);
  if (!res.ok) return alert(data.message || '저장 실패');
  renderAdminMenuPreview(data.month);
  if ($('menu-upload-status')) $('menu-upload-status').textContent = `${date} 식단을 저장했습니다.`;
  if ($('menu-edit-status')) $('menu-edit-status').textContent = `${formatAdminMenuDate(date)} 저장 완료`;
}

async function deleteMenuDayManual() {
  const date = $('menu-edit-date')?.value || '';
  if (!date) return alert('삭제할 날짜를 선택해 주세요.');
  if (!confirm(`${date} 식단을 삭제하시겠습니까?`)) return;
  const res = await apiFetch(`${API_BASE_URL}/admin/menu/day/${date}`, { method: 'DELETE' });
  const data = await readApiJson(res);
  if (!res.ok) return alert(data.message || '삭제 실패');
  renderAdminMenuPreview(data.month);
  resetMenuEditorForm();
  if ($('menu-upload-status')) $('menu-upload-status').textContent = `${date} 식단을 삭제했습니다.`;
}

async function loadAdminMenuMonth() {
  const status = $('menu-upload-status');
  const { yearMonth } = getSelectedMenuYearMonth();
  if (status) status.textContent = `${yearMonth} 식단표를 불러오는 중...`;
  try {
    const res = await apiFetch(`${API_BASE_URL}/admin/menu/month/${yearMonth}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) return alert(data.message || '식단표 조회 실패');
    renderAdminMenuPreview(data);
    if (!$('menu-edit-date')?.value) resetMenuEditorForm();
    if (status) {
      const count = Object.keys(data.days || {}).length;
      status.textContent = count ? `${yearMonth} 식단 ${count}일치가 등록되어 있습니다.` : `${yearMonth} 등록 식단표가 없습니다.`;
    }
  } catch (e) {
    if (status) status.textContent = '식단표 조회 실패';
  }
}

async function uploadMenuImage(confirmMismatch = false) {
  const file = $('menu-image-file')?.files?.[0];
  if (!file) return alert('식단표 이미지 파일을 선택해 주세요.');
  const { year, month, yearMonth } = getSelectedMenuYearMonth();

  const formData = new FormData();
  formData.append('year', String(year));
  formData.append('month', String(month));
  formData.append('confirmMismatch', confirmMismatch ? 'true' : 'false');
  formData.append('image', file);

  const btn = $('btn-upload-menu-image');
  const status = $('menu-upload-status');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '분석 중...';
  }
  if (status) status.textContent = '이미지를 업로드하고 OCR로 식단표를 분석하는 중입니다. 이미지 크기에 따라 시간이 걸릴 수 있습니다.';

  try {
    const res = await apiFetch(`${API_BASE_URL}/admin/menu/upload-image`, {
      method: 'POST',
      body: formData
    });
    const data = await readApiJson(res);

    if (res.status === 409 && data.code === 'MONTH_MISMATCH') {
      const summary = data.summary || {};
      const detected = summary.detectedYear && summary.detectedMonth ? `${summary.detectedYear}년 ${summary.detectedMonth}월` : '확인 불가';
      const proceed = confirm(`선택한 식단 기간은 ${year}년 ${month}월입니다.\n\n이미지에서 인식한 기간은 ${detected}입니다.\n선택 기간 외 다른 파일이 업로드되었을 수 있습니다.\n\n계속 진행하겠습니까?`);
      if (proceed) {
        await uploadMenuImage(true);
        return;
      }
      if (status) status.textContent = '기간 불일치로 업로드를 취소했습니다.';
      return;
    }

    if (!res.ok) return alert(data.message || '식단표 업로드 실패');
    const count = Object.keys(data.month?.days || {}).length;
    if (status) {
      const warn = data.summary?.ocrError ? ` OCR 엔진 경고: ${data.summary.ocrError}` : '';
      status.textContent = `${yearMonth} 식단표 업로드 완료 · 추출 ${count}일치.${warn}`;
    }
    renderAdminMenuPreview(data.month);
    if (data.summary?.ocrError) alert('이미지는 저장했지만 OCR 엔진을 사용할 수 없어 자동 추출이 제한되었습니다. 서버에서 tesseract.js 설치 여부를 확인해 주세요.');
  } catch (e) {
    alert(e.message || '식단표 업로드 실패');
    if (status) status.textContent = '식단표 업로드 실패';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '이미지 분석·업로드';
    }
  }
}

async function analyzeMonthlyImport() {
  const year = Number($('import-year').value);
  const month = Number($('import-month').value);
  const files = $('import-files').files;
  if (!files || files.length === 0) return alert('xlsx 파일을 선택해 주세요.');

  const formData = new FormData();
  formData.append('year', String(year));
  formData.append('month', String(month));
  Array.from(files).forEach(file => formData.append('files', file));

  const btn = $('btn-analyze-import');
  btn.disabled = true;
  btn.textContent = '분석 중...';

  try {
    const res = await apiFetch(`${API_BASE_URL}/admin/monthly-import/analyze`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) return alert(data.message || '엑셀 분석 실패');

    if (data.summary?.monthMismatch) {
      const mismatchFiles = (data.files || []).filter(f => f.monthMismatch).map(f => `${f.fileName}(${f.detectedYear || '?'}년 ${f.detectedMonth || '?'}월)`).join('\n');
      const proceed = confirm(`선택한 급식 기간은 ${year}년 ${month}월입니다.\n\n다음 파일의 맨 윗줄 기간이 선택 기간과 다릅니다. 선택 기간 외 다른 파일이 업로드되었을 수 있습니다.\n\n${mismatchFiles}\n\n계속 진행하겠습니까?`);
      if (!proceed) return;
    }

    importMeta = { year, month, summary: data.summary, files: data.files || [], errors: data.errors || [] };
    importRows = (data.rows || []).map((row, idx) => ({
      ...row,
      id: row.id || `${Date.now()}_${idx}`,
      selected: !row.alreadyRegistered,
      seq: idx + 1,
      unpaidConfirmed: row.paymentStatus !== '미입금'
    }));
    renderImportPreview(true);
  } catch (e) {
    alert(e.message || '엑셀 분석 실패');
  } finally {
    btn.disabled = false;
    btn.textContent = '분석하기';
  }
}

function renderImportPreview(scrollToUnpaid = false) {
  const section = $('import-preview-section');
  const tbody = $('import-preview-body');
  if (!section || !tbody) return;

  section.classList.toggle('hidden', importRows.length === 0);
  if (importRows.length === 0) {
    tbody.innerHTML = '';
    return;
  }

  const unpaidCount = importRows.filter(r => r.paymentStatus === '미입금').length;
  const alreadyCount = importRows.filter(r => r.alreadyRegistered).length;
  const selectedCount = importRows.filter(r => r.selected).length;
  const summary = importMeta?.summary || {};
  const dailyImportCount = summary.dailyImportCount || 0;

  $('import-summary').textContent = `추출 ${importRows.length}명 · 선택 ${selectedCount}명 · 미입금 ${unpaidCount}명 · 일식 포함 ${dailyImportCount}명 · 중복 제외 ${summary.duplicateCount || 0}명 · 이미 등록 ${alreadyCount}명`;

  const warnings = [];
  if (unpaidCount > 0) warnings.push('미입금자는 빨간색으로 표시됩니다. 등록하려면 각 행의 확인 버튼을 눌러야 합니다.');
  if (alreadyCount > 0) warnings.push('이미 등록된 월식자는 기본 선택 해제되어 있습니다.');
  if (importMeta?.errors?.length) warnings.push(importMeta.errors.join(' / '));
  $('import-warning').textContent = warnings.join(' ');

  tbody.innerHTML = importRows.map((row, index) => {
    const isUnpaid = row.paymentStatus === '미입금';
    const isDailyImport = row.importMealType === 'daily';
    const rowClass = row.alreadyRegistered
      ? 'bg-gray-100 text-gray-400'
      : isUnpaid
        ? 'bg-red-100/80'
        : isDailyImport
          ? 'bg-sky-50'
          : 'bg-white';
    const confirmCell = isUnpaid
      ? row.unpaidConfirmed
        ? '<span class="inline-flex text-green-700 bg-green-100 px-3 py-1 rounded-full text-xs font-black">확인 완료</span>'
        : `<button type="button" data-import-action="confirm-unpaid" data-index="${index}" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold">확인</button>`
      : '<span class="text-gray-400 text-xs">-</span>';

    const statusLabel = isUnpaid
      ? '<span class="text-red-700 font-black">미입금</span>'
      : '<span class="text-green-700 font-bold">입금</span>';

    return `
      <tr id="import-row-${index}" class="${rowClass}">
        <td class="p-3 text-center"><input type="checkbox" class="import-check w-4 h-4" data-index="${index}" ${row.selected ? 'checked' : ''} ${row.alreadyRegistered ? 'disabled' : ''}></td>
        <td class="p-3 text-center font-mono font-bold">${index + 1}</td>
        <td class="p-3"><input value="${escapeAttr(row.name)}" data-import-field="name" data-index="${index}" class="w-44 border rounded-lg px-3 py-2 bg-white"></td>
        <td class="p-3"><input value="${escapeAttr(row.phoneLast4)}" data-import-field="phoneLast4" data-index="${index}" maxlength="4" inputmode="numeric" class="w-32 border rounded-lg px-3 py-2 font-mono bg-white"></td>
        <td class="p-3 text-center">${statusLabel}${row.alreadyRegistered ? '<div class="text-xs text-gray-500 mt-1">이미 등록됨</div>' : ''}</td>
        <td class="p-3 text-center">${confirmCell}</td>
        <td class="p-3 text-center"><button type="button" data-import-action="delete-row" data-index="${index}" class="text-xs font-bold text-gray-400 hover:text-red-500">삭제</button></td>
      </tr>`;
  }).join('');

  if (scrollToUnpaid) {
    const firstUnconfirmed = importRows.findIndex(r => r.paymentStatus === '미입금' && !r.unpaidConfirmed);
    if (firstUnconfirmed >= 0) {
      setTimeout(() => $('import-row-' + firstUnconfirmed)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }
}

function getSelectedImportRows(mode) {
  if (mode === 'all') return importRows.filter(r => !r.alreadyRegistered);
  return importRows.filter(r => r.selected && !r.alreadyRegistered);
}

async function registerImportRows(mode) {
  if (!importMeta) return alert('먼저 엑셀을 분석해 주세요.');
  const rows = getSelectedImportRows(mode);
  if (rows.length === 0) return alert('등록할 명단을 선택해 주세요.');

  const unconfirmedIdx = importRows.findIndex(r => rows.includes(r) && r.paymentStatus === '미입금' && !r.unpaidConfirmed);
  if (unconfirmedIdx >= 0) {
    alert('미입금자는 확인 버튼을 눌러야 등록할 수 있습니다.');
    $('import-row-' + unconfirmedIdx)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (!confirm(`${importMeta.year}년 ${importMeta.month}월 월식 명단 ${rows.length}명을 등록하시겠습니까?`)) return;

  const res = await apiFetch(`${API_BASE_URL}/admin/monthly-import/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: importMeta.year, month: importMeta.month, rows })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.message || '등록 실패');

  alert(`등록 완료: 추가 ${data.added}명, 건너뜀 ${data.skipped}명`);
  importRows = [];
  renderImportPreview();
  loadUsers();
}


function handleUserTableClick(event) {
  const button = event.target.closest('[data-user-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;

  if (button.dataset.userAction === 'change-period') return window.changePeriod(index, button.dataset.periodAction);
  if (button.dataset.userAction === 'edit-daily-dates') return window.editDailyDates(index);
  if (button.dataset.userAction === 'edit-info') return window.editUserInfo(index);
  if (button.dataset.userAction === 'delete-user') return window.deleteUser(index);
}

function handleMenuPreviewClick(event) {
  const button = event.target.closest('[data-menu-date]');
  if (!button) return;
  window.editMenuDay(button.dataset.menuDate);
}

function handleImportPreviewClick(event) {
  const button = event.target.closest('[data-import-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;

  if (button.dataset.importAction === 'confirm-unpaid') return window.confirmUnpaidImport(index);
  if (button.dataset.importAction === 'delete-row') return window.deleteImportRow(index);
}

function handleImportPreviewChange(event) {
  const target = event.target;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index)) return;

  if (target.classList.contains('import-check')) {
    window.toggleImportSelection(index, target.checked);
    return;
  }

  if (target.dataset.importField === 'name' || target.dataset.importField === 'phoneLast4') {
    window.updateImportRow(index, target.dataset.importField, target.value);
  }
}

function initAdminList() {
  if (adminListInitialized) return;
  adminListInitialized = true;

  $('btn-request-auth')?.addEventListener('click', requestAdminAuth);
  $('btn-verify-auth')?.addEventListener('click', verifyAdminAuth);
  $('btn-reset-auth')?.addEventListener('click', resetAuthUI);
  $('btn-logout')?.addEventListener('click', logout);
  $('daily-date-picker')?.addEventListener('change', handleDatePickerChange);
  $('search-input')?.addEventListener('input', renderUsers);
  $('new-phone')?.addEventListener('input', e => { e.target.value = normalizePhoneLast4(e.target.value); });
  $('btn-add-user')?.addEventListener('click', addUser);
  $('btn-export-daily')?.addEventListener('click', exportDaily);
  $('btn-export-monthly')?.addEventListener('click', exportMonthly);
  $('btn-analyze-import')?.addEventListener('click', analyzeMonthlyImport);
  $('btn-upload-menu-image')?.addEventListener('click', () => uploadMenuImage(false));
  $('btn-save-menu-day')?.addEventListener('click', saveMenuDayManual);
  $('btn-delete-menu-day')?.addEventListener('click', deleteMenuDayManual);
  $('btn-menu-editor-reset')?.addEventListener('click', () => resetMenuEditorForm());
  $('menu-edit-holiday')?.addEventListener('change', (e) => {
    const disabled = e.target.checked;
    if ($('menu-edit-items')) $('menu-edit-items').disabled = disabled;
    if ($('menu-edit-origins')) $('menu-edit-origins').disabled = disabled;
  });
  $('menu-year')?.addEventListener('change', loadAdminMenuMonth);
  $('menu-month-select')?.addEventListener('change', loadAdminMenuMonth);
  $('btn-register-selected-import')?.addEventListener('click', () => registerImportRows('selected'));
  $('btn-register-all-import')?.addEventListener('click', () => registerImportRows('all'));
  $('btn-delete-selected-import')?.addEventListener('click', () => {
    importRows = importRows.filter(r => !r.selected);
    renderImportPreview();
  });
  $('btn-clear-import')?.addEventListener('click', () => {
    if (importRows.length && !confirm('추출 명단을 모두 비우겠습니까?')) return;
    importRows = [];
    renderImportPreview();
  });

  $('tab-daily')?.addEventListener('click', () => window.switchTab('daily'));
  $('tab-monthly')?.addEventListener('click', () => window.switchTab('monthly'));
  $('tab-menu')?.addEventListener('click', () => window.switchTab('menu'));
  $('btn-bulk-delete')?.addEventListener('click', () => window.bulkDelete());
  $('btn-bulk-shorten')?.addEventListener('click', () => window.bulkChange('shorten'));
  $('btn-bulk-extend')?.addEventListener('click', () => window.bulkChange('extend'));

  $('user-list-body')?.addEventListener('click', handleUserTableClick);
  $('menu-admin-preview')?.addEventListener('click', handleMenuPreviewClick);
  $('import-preview-body')?.addEventListener('click', handleImportPreviewClick);
  $('import-preview-body')?.addEventListener('change', handleImportPreviewChange);

  $('check-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.user-check').forEach(cb => { cb.checked = e.target.checked; });
  });

  checkAdminSession();
}


window.editMenuDay = (date) => {
  const day = currentMenuMonthData?.days?.[date] || {};
  fillMenuEditor(date, day);
  $('menu-edit-date')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.switchTab = (tab) => {
  currentTab = tab;
  const isDaily = tab === 'daily';
  const isMonthly = tab === 'monthly';
  const isMenu = tab === 'menu';
  const active = 'flex-1 py-4 font-black text-blue-600 border-b-4 border-blue-600 bg-white';
  const inactive = 'flex-1 py-4 font-bold text-gray-400 bg-gray-50 hover:bg-gray-100';

  $('tab-daily').className = isDaily ? active : inactive;
  $('tab-monthly').className = isMonthly ? active : inactive;
  $('tab-menu').className = isMenu ? active : inactive;

  $('menu-management-section')?.classList.toggle('hidden', !isMenu);
  $('user-toolbar-section')?.classList.toggle('hidden', isMenu);
  $('user-table-section')?.classList.toggle('hidden', isMenu);
  $('bulk-action-section')?.classList.toggle('hidden', isMenu);
  $('import-preview-section')?.classList.toggle('hidden', isMenu || importRows.length === 0);

  if (isMenu) {
    loadAdminMenuMonth();
    return;
  }

  $('daily-date-wrapper')?.classList.toggle('hidden', !isDaily);
  $('monthly-bulk-actions')?.classList.toggle('hidden', isDaily);
  $('monthly-import-panel')?.classList.toggle('hidden', !isMonthly);
  $('th-endDate').textContent = isDaily ? '지정 날짜 목록' : '마감 기한';
  $('form-title').textContent = isDaily ? '일식 등록' : '월식 등록';
  renderUsers();
};

window.changePeriod = async (idx, action) => {
  const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users/update-period`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indexes: [idx], action })
  });
  const data = await res.json();
  if (!res.ok) alert(data.message || '기간 변경 실패');
  loadUsers();
};

window.editUserInfo = async (idx) => {
  const user = allUsers.find(u => u._index === idx);
  if (!user) return;
  const name = prompt('이름을 수정하세요.', user.name);
  if (name === null) return;
  const phoneLast4 = normalizePhoneLast4(prompt('전화번호 뒷자리 4자리를 수정하세요.', user.phoneLast4));
  if (!/^\d{4}$/.test(phoneLast4)) return alert('전화번호 뒷자리는 숫자 4자리입니다.');

  const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users/update-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: idx, name: name.trim(), phoneLast4 })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.message || '정보 수정 실패');
  loadUsers();
};

window.editDailyDates = async (idx) => {
  const user = allUsers.find(u => u._index === idx);
  if (!user) return;
  const currentStr = Array.isArray(user.validDates) ? user.validDates.join(', ') : '';
  const newVal = prompt('변경할 날짜들을 입력하세요. 예: 2026-05-26, 0527', currentStr);
  if (newVal === null) return;
  const currentText = $('daily-date-text').value;
  $('daily-date-text').value = newVal;
  const targetDates = parseDailyDatesFromText();
  $('daily-date-text').value = currentText;
  if (targetDates.length === 0) return alert('날짜 형식이 올바르지 않습니다.');

  const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users/update-dates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: idx, targetDates })
  });
  const data = await res.json();
  if (!res.ok) alert(data.message || '날짜 변경 실패');
  loadUsers();
};

window.deleteUser = async (idx) => {
  if (!confirm('삭제하시겠습니까?')) return;
  const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indexes: [idx] })
  });
  const data = await res.json();
  if (!res.ok) alert(data.message || '삭제 실패');
  loadUsers();
};

window.bulkChange = async (action) => {
  const indexes = Array.from(document.querySelectorAll('.user-check:checked')).map(cb => Number(cb.dataset.index));
  if (indexes.length === 0) return alert('대상을 선택하세요.');
  const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users/update-period`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indexes, action })
  });
  const data = await res.json();
  if (!res.ok) alert(data.message || '기간 변경 실패');
  loadUsers();
};

window.bulkDelete = async () => {
  const indexes = Array.from(document.querySelectorAll('.user-check:checked')).map(cb => Number(cb.dataset.index));
  if (indexes.length === 0) return alert('대상을 선택하세요.');
  if (!confirm('일괄 삭제하시겠습니까?')) return;
  const res = await apiFetch(`${API_BASE_URL}/admin/allowed-users`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indexes })
  });
  const data = await res.json();
  if (!res.ok) alert(data.message || '삭제 실패');
  loadUsers();
};

window.toggleImportSelection = (index, checked) => {
  if (!importRows[index]) return;
  importRows[index].selected = checked;
  renderImportPreview();
};

window.updateImportRow = (index, field, value) => {
  if (!importRows[index]) return;
  if (field === 'phoneLast4') importRows[index][field] = normalizePhoneLast4(value);
  else if (field === 'name') importRows[index][field] = String(value || '').replace(/[<>]/g, '').trim();
  renderImportPreview();
};

window.confirmUnpaidImport = (index) => {
  if (!importRows[index]) return;
  importRows[index].unpaidConfirmed = true;
  renderImportPreview();
};

window.deleteImportRow = (index) => {
  importRows.splice(index, 1);
  renderImportPreview();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminList, { once: true });
} else {
  initAdminList();
}
