// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 5000;

app.set('trust proxy', 1);

// ==========================================
// 🔒 보안 기본값
// ==========================================
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : isProduction;

const ADMIN_SESSION_COOKIE = 'hwao_admin_session';
const ADMIN_SESSION_MINUTES = Number.parseInt(process.env.ADMIN_SESSION_MINUTES || '240', 10);
const ADMIN_SESSION_TTL_MS = Math.max(10, ADMIN_SESSION_MINUTES) * 60 * 1000;
const AUTH_CODE_TTL_MS = 3 * 60 * 1000;
const AUTH_REQUEST_COOLDOWN_MS = 30 * 1000;
const MAX_INPUT_LENGTH = 80;

const configuredOrigins = new Set(
  (process.env.PUBLIC_ORIGIN || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => {
      try { return new URL(origin).origin; } catch (_) { return ''; }
    })
    .filter(Boolean)
);

const getRequestOrigin = (req) => `${req.protocol}://${req.get('host')}`;
const isAllowedOrigin = (origin, req) => {
  if (!origin) return true;
  return origin === getRequestOrigin(req) || configuredOrigins.has(origin);
};

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );

  if (isProduction || cookieSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  if (req.path.startsWith('/api/') || ['.html', ''].includes(path.extname(req.path))) {
    res.setHeader('Cache-Control', 'no-store');
  }

  next();
});

app.use((req, res, next) => {
  const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafeMethod && !isAllowedOrigin(req.get('origin'), req)) {
    return res.status(403).json({ message: '허용되지 않은 요청 출처입니다.' });
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// 전체 루트 정적 공개 금지: 필요한 화면/정적 폴더만 명시적으로 공개합니다.
const staticNoStore = (res) => res.setHeader('Cache-Control', 'no-store');
app.use('/CSS', express.static(path.join(__dirname, 'CSS'), { dotfiles: 'deny', index: false, setHeaders: staticNoStore }));
app.use('/JS', express.static(path.join(__dirname, 'JS'), { dotfiles: 'deny', index: false, setHeaders: staticNoStore }));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));

app.get('/', (req, res) => res.redirect('/qr.html'));
app.get('/qr.html', (req, res) => res.sendFile(path.join(__dirname, 'qr.html')));
app.get('/scanner.html', (req, res) => res.sendFile(path.join(__dirname, 'scanner.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin_list.html', (req, res) => res.sendFile(path.join(__dirname, 'admin_list.html')));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/scanner', (req, res) => res.redirect('/scanner.html'));

// ==========================================
// 💾 데이터 저장소
// ==========================================
const dataDir = process.env.DATA_DIR
  ? (path.isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : path.join(__dirname, process.env.DATA_DIR))
  : __dirname;
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'data.json');
const userListPath = path.join(dataDir, 'allowed_users.json');

let db = { days: {} };
let allowedUsers = [];

const getKSTDateStr = (date = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
};

const getKSTParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
};

const isValidDateStr = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 3));
  return getKSTDateStr(date) === value;
};

const isWeekendKST = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 3));
  const kstDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(date);
  return kstDay === 'Sat' || kstDay === 'Sun';
};

const addDaysToDateStr = (dateStr, days) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 3));
  return getKSTDateStr(date);
};

const calculateMonthlyEndDate = (baseDate = new Date()) => {
  const { year, month } = getKSTParts(baseDate);
  const lastDayKSTNoon = new Date(Date.UTC(year, month, 0, 3));
  return getKSTDateStr(lastDayKSTNoon);
};

const readJsonFile = (filePath, fallback) => {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`[data] JSON 읽기 실패: ${filePath}`, e.message);
    return fallback;
  }
};

const writeJsonAtomic = (filePath, data) => {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
};

const saveDB = () => writeJsonAtomic(dbPath, db);
const saveUserList = () => writeJsonAtomic(userListPath, allowedUsers);

const createId = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

const sanitizeText = (value, fieldName) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error(`${fieldName}을(를) 입력하세요.`);
  if (text.length > MAX_INPUT_LENGTH) throw new Error(`${fieldName}은(는) ${MAX_INPUT_LENGTH}자 이하로 입력하세요.`);
  return text;
};

const normalizeMealType = (value) => {
  if (value !== 'daily' && value !== 'monthly') throw new Error('식사 유형이 올바르지 않습니다.');
  return value;
};

const normalizeDateList = (targetDates) => {
  if (!Array.isArray(targetDates) || targetDates.length === 0) {
    throw new Error('날짜를 하나 이상 지정하세요.');
  }

  const normalized = [...new Set(targetDates.map(String).map(v => v.trim()))]
    .filter(Boolean)
    .sort();

  if (normalized.length > 370) throw new Error('날짜가 너무 많습니다.');
  if (normalized.some(date => !isValidDateStr(date))) throw new Error('날짜 형식이 올바르지 않습니다.');

  return normalized;
};

const sanitizeDiner = (diner, date = null) => ({
  ...(date ? { date } : {}),
  orgRole: diner.orgRole || '',
  name: diner.name || '',
  attended: Boolean(diner.attended),
  scannedAt: diner.scannedAt || null
});

const sanitizeUser = (user) => ({
  id: user.id,
  orgRole: user.orgRole,
  name: user.name,
  mealType: user.mealType,
  startDate: user.startDate,
  endDate: user.endDate,
  validDates: Array.isArray(user.validDates) ? user.validDates : null,
  createdAt: user.createdAt
});

const isUserEligibleToday = (user, todayStr) => {
  if (!user || !user.name || !user.orgRole) return false;
  if (user.mealType === 'daily') {
    return Array.isArray(user.validDates) && user.validDates.includes(todayStr);
  }
  if (user.mealType === 'monthly') {
    return user.startDate <= todayStr && todayStr <= user.endDate;
  }
  return false;
};

const cleanupExpiredUsers = () => {
  const todayStr = getKSTDateStr();
  let changed = false;

  allowedUsers = allowedUsers.filter(user => {
    if (!user.endDate || !isValidDateStr(user.endDate)) return true;
    const deleteDateStr = addDaysToDateStr(user.endDate, 5);
    if (todayStr >= deleteDateStr) {
      changed = true;
      return false;
    }
    return true;
  });

  if (changed) saveUserList();
};

const loadFiles = () => {
  const loadedDb = readJsonFile(dbPath, { days: {} });
  db = loadedDb && typeof loadedDb === 'object' && loadedDb.days && typeof loadedDb.days === 'object'
    ? loadedDb
    : { days: {} };

  const loadedUsers = readJsonFile(userListPath, []);
  const today = getKSTDateStr();
  allowedUsers = Array.isArray(loadedUsers)
    ? loadedUsers.map(user => ({
        id: user.id || createId(),
        orgRole: String(user.orgRole || '').trim(),
        name: String(user.name || '').trim(),
        mealType: user.mealType === 'monthly' ? 'monthly' : 'daily',
        startDate: isValidDateStr(user.startDate) ? user.startDate : (user.createdAt ? String(user.createdAt).split('T')[0] : today),
        endDate: isValidDateStr(user.endDate) ? user.endDate : today,
        validDates: Array.isArray(user.validDates) ? user.validDates.filter(isValidDateStr).sort() : null,
        createdAt: user.createdAt || new Date().toISOString()
      })).filter(user => user.orgRole && user.name)
    : [];

  cleanupExpiredUsers();
};

loadFiles();

// ==========================================
// 🔐 관리자 인증: 메일 인증 후 서버 세션 쿠키 발급
// ==========================================
const parseEmailList = (raw) => new Set(
  String(raw || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
);

const adminEmails = parseEmailList(process.env.ADMIN_EMAILS);
const authCodes = new Map();
const adminSessions = new Map();
const authRequestCooldowns = new Map();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

const parseCookies = (cookieHeader = '') => {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) return [part, ''];
        return [part.slice(0, eqIndex), decodeURIComponent(part.slice(eqIndex + 1))];
      })
  );
};

const buildSessionCookie = (token, maxAgeSec) => {
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`
  ];
  if (cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
};

const clearSessionCookie = () => {
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
};

const cleanupSessions = () => {
  const now = Date.now();
  for (const [token, session] of adminSessions.entries()) {
    if (session.expires <= now) adminSessions.delete(token);
  }
};

const createAdminSession = (email) => {
  cleanupSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  adminSessions.set(token, { email, expires: Date.now() + ADMIN_SESSION_TTL_MS });
  return token;
};

const getAdminSession = (req) => {
  cleanupSessions();
  const token = parseCookies(req.headers.cookie || '')[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session || session.expires <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  return { token, ...session };
};

const refreshAdminSession = (res, token, session) => {
  session.expires = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, session);
  res.setHeader('Set-Cookie', buildSessionCookie(token, Math.floor(ADMIN_SESSION_TTL_MS / 1000)));
};

const requireAdmin = (req, res, next) => {
  const session = getAdminSession(req);
  if (!session) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(401).json({ message: '관리자 인증이 필요합니다.', action: 'reauth' });
  }
  req.adminEmail = session.email;
  refreshAdminSession(res, session.token, { email: session.email, expires: session.expires });
  next();
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

app.get('/api/admin/session', (req, res) => {
  const session = getAdminSession(req);
  if (!session) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.json({ authenticated: false });
  }
  refreshAdminSession(res, session.token, { email: session.email, expires: session.expires });
  res.json({ authenticated: true, email: session.email });
});

app.post('/api/admin/request-code', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return res.status(400).json({ message: '이메일 형식이 올바르지 않습니다.' });
  }
  if (adminEmails.size === 0) {
    return res.status(500).json({ message: '관리자 이메일 설정이 없습니다.' });
  }
  if (!adminEmails.has(email)) {
    return res.status(403).json({ message: '등록되지 않은 관리자 이메일입니다.' });
  }

  const cooldownKey = `${req.ip}:${email}`;
  const lastRequestAt = authRequestCooldowns.get(cooldownKey) || 0;
  if (Date.now() - lastRequestAt < AUTH_REQUEST_COOLDOWN_MS) {
    return res.status(429).json({ message: '인증번호는 30초 뒤 다시 요청할 수 있습니다.' });
  }
  authRequestCooldowns.set(cooldownKey, Date.now());

  const code = crypto.randomInt(100000, 1000000).toString();
  authCodes.set(email, {
    codeHash: hashCode(code),
    expires: Date.now() + AUTH_CODE_TTL_MS,
    attempts: 0
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: '[화성오산교육청] 관리자 보안 인증번호',
      text: `인증번호: [${code}]\n\n이 번호는 3분 동안만 유효합니다.`
    });
    res.json({ message: '인증 메일이 발송되었습니다.', expiresIn: Math.floor(AUTH_CODE_TTL_MS / 1000) });
  } catch (e) {
    console.error('[auth] 메일 발송 실패:', e.message);
    res.status(500).json({ message: '메일 발송 실패' });
  }
});

app.post('/api/admin/verify-code', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || '').trim();
  const auth = authCodes.get(email);

  if (!auth) return res.status(401).json({ message: '인증 요청 내역이 없습니다.', action: 'reset' });
  if (auth.expires <= Date.now()) {
    authCodes.delete(email);
    return res.status(401).json({ message: '인증 시간이 만료되었습니다.', action: 'reset' });
  }
  if (!/^\d{6}$/.test(code)) {
    auth.attempts += 1;
    if (auth.attempts >= 3) authCodes.delete(email);
    return res.status(401).json({ message: '인증번호 형식이 올바르지 않습니다.', action: auth.attempts >= 3 ? 'reset' : undefined });
  }

  const submittedHash = hashCode(code);
  const ok = crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(auth.codeHash));

  if (!ok) {
    auth.attempts += 1;
    if (auth.attempts >= 3) {
      authCodes.delete(email);
      return res.status(401).json({ message: '3회 오류로 인증이 만료되었습니다.', action: 'reset' });
    }
    return res.status(401).json({ message: `번호가 틀렸습니다. (${auth.attempts}/3)` });
  }

  authCodes.delete(email);
  const token = createAdminSession(email);
  res.setHeader('Set-Cookie', buildSessionCookie(token, Math.floor(ADMIN_SESSION_TTL_MS / 1000)));
  res.json({ message: '인증 성공', email, expiresIn: Math.floor(ADMIN_SESSION_TTL_MS / 1000) });
});

app.post('/api/admin/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie || '')[ADMIN_SESSION_COOKIE];
  if (token) adminSessions.delete(token);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ message: '로그아웃되었습니다.' });
});

// 기존 superadmin API는 더 이상 사용하지 않습니다. 혼선을 막기 위해 관리자 인증 API로만 통일합니다.
app.post('/api/superadmin/request-code', (req, res) => res.status(410).json({ message: '이 API는 사용하지 않습니다. /api/admin/request-code를 사용하세요.' }));
app.post('/api/superadmin/verify-code', (req, res) => res.status(410).json({ message: '이 API는 사용하지 않습니다. /api/admin/verify-code를 사용하세요.' }));

// ==========================================
// 👥 관리자 전용 명단/시트 API
// ==========================================
app.get('/api/admin/allowed-users', requireAdmin, (req, res) => {
  cleanupExpiredUsers();
  res.json(allowedUsers.map(sanitizeUser));
});

app.post('/api/admin/allowed-users', requireAdmin, (req, res) => {
  try {
    const orgRole = sanitizeText(req.body.orgRole, '부서');
    const name = sanitizeText(req.body.name, '이름');
    const mealType = normalizeMealType(req.body.mealType);
    const todayStr = getKSTDateStr();

    if (allowedUsers.some(user => (
      user.name === name &&
      user.orgRole === orgRole &&
      user.mealType === mealType &&
      user.endDate >= todayStr
    ))) {
      return res.status(409).json({ message: '이미 유효한 명단에 등록된 사용자입니다.' });
    }

    let startDate;
    let endDate;
    let validDates = null;

    if (mealType === 'daily') {
      validDates = normalizeDateList(req.body.targetDates);
      startDate = validDates[0];
      endDate = validDates[validDates.length - 1];
    } else {
      startDate = todayStr;
      endDate = calculateMonthlyEndDate(new Date());
    }

    allowedUsers.push({
      id: createId(),
      orgRole,
      name,
      mealType,
      startDate,
      endDate,
      validDates,
      createdAt: new Date().toISOString()
    });

    saveUserList();
    res.json({ message: '등록 성공' });
  } catch (e) {
    res.status(400).json({ message: e.message || '잘못된 요청입니다.' });
  }
});

app.post('/api/admin/allowed-users/update-dates', requireAdmin, (req, res) => {
  try {
    const index = Number.parseInt(req.body.index, 10);
    const user = allowedUsers[index];
    if (!Number.isInteger(index) || index < 0 || !user || user.mealType !== 'daily') {
      return res.status(400).json({ message: '잘못된 대상입니다.' });
    }

    const targetDates = normalizeDateList(req.body.targetDates);
    user.validDates = targetDates;
    user.startDate = targetDates[0];
    user.endDate = targetDates[targetDates.length - 1];
    saveUserList();
    res.json({ message: '날짜가 성공적으로 변경되었습니다.' });
  } catch (e) {
    res.status(400).json({ message: e.message || '잘못된 요청입니다.' });
  }
});

app.post('/api/admin/allowed-users/update-period', requireAdmin, (req, res) => {
  const indexes = Array.isArray(req.body.indexes) ? req.body.indexes.map(idx => Number.parseInt(idx, 10)) : [];
  const action = req.body.action;
  const type = req.body.type;

  if (type === 'daily') return res.status(400).json({ message: '일식은 개별 날짜 변경 버튼을 이용해 주세요.' });
  if (!['extend', 'shorten'].includes(action)) return res.status(400).json({ message: '요청한 작업이 올바르지 않습니다.' });
  if (indexes.length === 0 || indexes.some(idx => !Number.isInteger(idx) || idx < 0 || idx >= allowedUsers.length)) {
    return res.status(400).json({ message: '대상 선택이 올바르지 않습니다.' });
  }

  const thisMonthEnd = calculateMonthlyEndDate(new Date());
  let errorMsg = null;

  indexes.forEach(index => {
    const user = allowedUsers[index];
    if (!user || user.mealType !== 'monthly') return;

    const [year, month, day] = user.endDate.split('-').map(Number);
    const currentEnd = new Date(Date.UTC(year, month - 1, day, 3));

    if (action === 'extend') {
      const nextMonthFirst = new Date(Date.UTC(year, month, 1, 3));
      user.endDate = calculateMonthlyEndDate(nextMonthFirst);
    } else if (action === 'shorten') {
      if (user.endDate <= thisMonthEnd) {
        errorMsg = '단축 오류: 월식은 이번 달까지만 단축할 수 있습니다.';
      } else {
        const previousMonthLast = new Date(Date.UTC(currentEnd.getUTCFullYear(), currentEnd.getUTCMonth(), 0, 3));
        user.endDate = getKSTDateStr(previousMonthLast);
      }
    }
  });

  if (errorMsg) return res.status(400).json({ message: errorMsg });
  saveUserList();
  res.json({ message: '기간 업데이트 완료' });
});

app.delete('/api/admin/allowed-users', requireAdmin, (req, res) => {
  const indexes = Array.isArray(req.body.indexes) ? req.body.indexes.map(idx => Number.parseInt(idx, 10)) : [];
  if (indexes.length === 0 || indexes.some(idx => !Number.isInteger(idx) || idx < 0 || idx >= allowedUsers.length)) {
    return res.status(400).json({ message: '삭제 대상이 올바르지 않습니다.' });
  }

  const targets = new Set(indexes);
  allowedUsers = allowedUsers.filter((_, index) => !targets.has(index));
  saveUserList();
  res.json({ message: '삭제 완료' });
});

app.get('/api/admin/events/:date/attendees', requireAdmin, (req, res) => {
  const date = req.params.date;
  if (!isValidDateStr(date)) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });
  res.json((db.days[date] || []).map(diner => sanitizeDiner(diner, date)));
});

app.get('/api/admin/events/month/:yearMonth', requireAdmin, (req, res) => {
  const { yearMonth } = req.params;
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return res.status(400).json({ message: '월 형식이 올바르지 않습니다.' });

  let result = [];
  Object.keys(db.days)
    .filter(date => date.startsWith(yearMonth))
    .forEach(date => {
      result = result.concat(
        db.days[date]
          .filter(diner => diner.attended)
          .map(diner => sanitizeDiner(diner, date))
      );
    });

  res.json(result);
});

// ==========================================
// 🍱 공개 QR/스캐너 API
// ==========================================
app.get('/api/today', (req, res) => {
  const today = getKSTDateStr();
  res.json({ today, isWeekend: isWeekendKST(today) });
});

app.post('/api/qr/generate', (req, res) => {
  try {
    const todayStr = getKSTDateStr();
    if (isWeekendKST(todayStr)) return res.status(403).json({ message: '오늘은 주말입니다. 점심 체크를 운영하지 않습니다.' });

    const orgRole = sanitizeText(req.body.orgRole, '부서');
    const name = sanitizeText(req.body.name, '이름');

    cleanupExpiredUsers();

    const eligibleUsers = allowedUsers.filter(user => (
      user.name === name &&
      user.orgRole === orgRole &&
      isUserEligibleToday(user, todayStr)
    ));

    if (eligibleUsers.length === 0) {
      const registeredUser = allowedUsers.find(user => user.name === name && user.orgRole === orgRole);
      if (!registeredUser) return res.status(403).json({ message: '미등록 사용자입니다.' });
      if (registeredUser.mealType === 'daily') return res.status(403).json({ message: `오늘(${todayStr.slice(5)})은 식사하도록 지정된 날짜가 아닙니다.` });
      if (todayStr < registeredUser.startDate) return res.status(403).json({ message: `이용 시작일은 ${registeredUser.startDate} 부터입니다.` });
      if (registeredUser.endDate < todayStr) return res.status(403).json({ message: `이용 기간이 만료되었습니다. (마감: ${registeredUser.endDate})` });
      return res.status(403).json({ message: '오늘 이용 가능한 명단이 아닙니다.' });
    }

    if (!db.days[todayStr]) db.days[todayStr] = [];
    let diner = db.days[todayStr].find(item => item.name === name && item.orgRole === orgRole);
    const qrToken = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 180000;

    if (!diner) {
      db.days[todayStr].push({ orgRole, name, qrToken, tokenExpiresAt: expiresAt, attended: false, scannedAt: null });
    } else {
      if (diner.attended) return res.status(409).json({ message: '오늘 이미 식사를 완료했습니다.' });
      diner.qrToken = qrToken;
      diner.tokenExpiresAt = expiresAt;
    }

    saveDB();
    res.json({ qrData: qrToken, expiresAt, date: todayStr });
  } catch (e) {
    res.status(400).json({ message: e.message || '잘못된 요청입니다.' });
  }
});

app.post('/api/qr/scan', (req, res) => {
  const qrToken = String(req.body.qrToken || '').trim();
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(qrToken)) return res.status(400).json({ message: 'QR 형식이 올바르지 않습니다.' });

  const today = getKSTDateStr();
  if (!db.days[today]) return res.status(404).json({ message: '데이터가 없습니다.' });

  const diner = db.days[today].find(item => item.qrToken === qrToken);
  if (!diner || diner.tokenExpiresAt < Date.now()) return res.status(410).json({ message: '유효하지 않거나 만료된 QR입니다.' });
  if (diner.attended) return res.status(409).json({ message: '이미 처리된 QR입니다.' });

  diner.attended = true;
  diner.scannedAt = new Date().toISOString();
  saveDB();
  res.json({ message: 'success', name: diner.name, orgRole: diner.orgRole });
});

// 스캐너 전용 공개 조회: QR 토큰/미식사 대기자/내부 필드는 절대 내려주지 않습니다.
app.get('/api/scanner/attendees/:date', (req, res) => {
  const date = req.params.date;
  if (!isValidDateStr(date)) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });

  const attendees = (db.days[date] || [])
    .filter(diner => diner.attended)
    .map(diner => sanitizeDiner(diner, date));

  res.json(attendees);
});

// 과거 공개 API는 민감 필드 노출을 막기 위해 관리자 인증을 요구합니다.
app.get('/api/events/:date/attendees', requireAdmin, (req, res) => {
  const date = req.params.date;
  if (!isValidDateStr(date)) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });
  res.json((db.days[date] || []).map(diner => sanitizeDiner(diner, date)));
});

app.get('/api/events/month/:yearMonth', requireAdmin, (req, res) => {
  const { yearMonth } = req.params;
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return res.status(400).json({ message: '월 형식이 올바르지 않습니다.' });

  let result = [];
  Object.keys(db.days)
    .filter(date => date.startsWith(yearMonth))
    .forEach(date => {
      result = result.concat(
        db.days[date]
          .filter(diner => diner.attended)
          .map(diner => sanitizeDiner(diner, date))
      );
    });

  res.json(result);
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API를 찾을 수 없습니다.' });
  res.status(404).send('Not Found');
});

app.listen(port, () => console.log(`🚀 Lunch Server Running on Port: ${port}`));
