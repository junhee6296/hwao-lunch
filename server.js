// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const port = Number(process.env.PORT || 5000);

const trustProxySetting = process.env.TRUST_PROXY;
if (trustProxySetting) {
  app.set('trust proxy', trustProxySetting === 'true' ? true : trustProxySetting === 'false' ? false : trustProxySetting);
} else {
  // Oracle/Nginx 같은 로컬 reverse proxy 뒤에서도 실제 접속 IP를 기준으로 관리자 세션을 잡기 위함
  app.set('trust proxy', 'loopback');
}

const ROOT_DIR = __dirname;
const pickExistingDir = (...dirs) => dirs.find(dir => fs.existsSync(dir)) || dirs[0];
const HTML_DIR = pickExistingDir(path.join(ROOT_DIR, 'html'), ROOT_DIR);
const JS_DIR = pickExistingDir(path.join(ROOT_DIR, 'js'), path.join(ROOT_DIR, 'JS'));
const CSS_DIR = pickExistingDir(path.join(ROOT_DIR, 'css'), path.join(ROOT_DIR, 'CSS'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || ROOT_DIR);
const dbPath = path.join(DATA_DIR, 'data.json');
const userListPath = path.join(DATA_DIR, 'allowed_users.json');
const menuPath = path.join(DATA_DIR, 'menus.json');
const menuImageDir = path.join(DATA_DIR, 'menu_images');
const holidayCachePath = path.join(DATA_DIR, 'holidays_kr_cache.json');

const COOKIE_NAME = 'hwao_lunch_admin_session';
const ADMIN_IP_SESSION_MINUTES = Math.max(1, Number(process.env.ADMIN_IP_SESSION_MINUTES || process.env.ADMIN_SESSION_MINUTES || 180));
const ADMIN_IP_SESSION_MS = ADMIN_IP_SESSION_MINUTES * 60 * 1000;
const CODE_EXPIRES_MS = 3 * 60 * 1000;
const CODE_COOLDOWN_MS = 30 * 1000;
const MAX_AUTH_ATTEMPTS = 3;
const QR_EXPIRES_MINUTES = Math.max(1, Number(process.env.QR_EXPIRES_MINUTES || 15));
const QR_EXPIRES_MS = QR_EXPIRES_MINUTES * 60 * 1000;
const MAX_JSON_SIZE = '1mb';
const MAX_UPLOAD_SIZE = 8 * 1024 * 1024;
const MAX_MENU_IMAGE_SIZE = 12 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.EMAIL_PASS || crypto.randomBytes(32).toString('hex');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(menuImageDir, { recursive: true });

let db = { days: {} };
let allowedUsers = [];
let menus = { months: {} };
let holidayCache = { years: {} };
let authCodes = new Map();
let adminIpSessions = new Map();

const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ==========================================
// 공통 유틸
// ==========================================
const pad2 = value => String(value).padStart(2, '0');

const getKSTDateStr = (date = new Date()) => {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date).replace(/\. /g, '-').replace(/\./g, '');
};

const getKSTYearMonth = (date = new Date()) => getKSTDateStr(date).slice(0, 7);

const calculateMonthlyEndDate = (year, month) => {
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(lastDay)}`;
};

const parseISODate = (dateStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return { year: y, month: mo, day: d, date };
};

const isWeekendDateStr = (dateStr) => {
  const parsed = parseISODate(dateStr);
  if (!parsed) return false;
  const day = parsed.date.getUTCDay();
  return day === 0 || day === 6;
};

const addDays = (dateStr, days) => {
  const parsed = parseISODate(dateStr);
  if (!parsed) return dateStr;
  const date = new Date(parsed.date);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

const normalizeName = (value) => String(value || '')
  .replace(/[<>]/g, '')
  .replace(/[\u0000-\u001F\u007F]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 40);

const stripTrailingPhoneFromName = (value) => normalizeName(value).replace(/\d{4}$/, '').trim();

const normalizePhoneLast4 = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits;
};

const isValidPhoneLast4 = (value) => /^\d{4}$/.test(String(value || ''));

const sanitizeUserForClient = (u) => ({
  name: u.name,
  phoneLast4: u.phoneLast4,
  mealType: u.mealType,
  startDate: u.startDate,
  endDate: u.endDate,
  validDates: Array.isArray(u.validDates) ? u.validDates : null,
  paymentStatus: u.paymentStatus || '입금',
  createdAt: u.createdAt
});

const sanitizeDinerForScanner = (d) => ({
  name: d.name,
  scannedAt: d.scannedAt
});

const sanitizeDinerForAdmin = (d) => ({
  date: d.date,
  name: d.name,
  phoneLast4: d.phoneLast4 || normalizePhoneLast4(d.orgRole || ''),
  mealType: d.mealType || '',
  attended: Boolean(d.attended),
  scannedAt: d.scannedAt || null
});


const normalizeAllowedUser = (u) => {
  const phoneLast4 = normalizePhoneLast4(u.phoneLast4 || u.phone || u.orgRole || '');
  const name = normalizeName(u.name);
  const mealType = u.mealType === 'daily' ? 'daily' : 'monthly';
  const today = getKSTDateStr();
  let validDates = Array.isArray(u.validDates) ? u.validDates.filter(d => parseISODate(d)).sort() : null;
  let startDate = parseISODate(u.startDate) ? u.startDate : today;
  let endDate = parseISODate(u.endDate) ? u.endDate : calculateMonthlyEndDate(today.slice(0, 4), today.slice(5, 7));

  if (mealType === 'daily') {
    if (!validDates || validDates.length === 0) validDates = [startDate].filter(d => parseISODate(d));
    if (validDates.length > 0) {
      startDate = validDates[0];
      endDate = validDates[validDates.length - 1];
    }
  } else {
    validDates = null;
  }

  return {
    name,
    phoneLast4,
    mealType,
    startDate,
    endDate,
    validDates,
    paymentStatus: u.paymentStatus === '미입금' ? '미입금' : '입금',
    createdAt: u.createdAt || new Date().toISOString()
  };
};

const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
const saveUserList = () => fs.writeFileSync(userListPath, JSON.stringify(allowedUsers.map(sanitizeUserForClient), null, 2), 'utf-8');
const saveMenus = () => fs.writeFileSync(menuPath, JSON.stringify(menus, null, 2), 'utf-8');
const saveHolidayCache = () => fs.writeFileSync(holidayCachePath, JSON.stringify(holidayCache, null, 2), 'utf-8');

const cleanupExpiredUsers = () => {
  const todayStr = getKSTDateStr();
  let changed = false;

  allowedUsers = allowedUsers.filter(u => {
    if (!u.endDate || !parseISODate(u.endDate)) {
      changed = true;
      return false;
    }
    const deleteDateStr = addDays(u.endDate, 5);
    if (todayStr >= deleteDateStr) {
      changed = true;
      return false;
    }
    return true;
  });

  if (changed) saveUserList();
};

const loadFiles = () => {
  if (fs.existsSync(dbPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      db = parsed && parsed.days ? parsed : { days: {} };

      Object.keys(db.days).forEach(date => {
        if (!Array.isArray(db.days[date])) db.days[date] = [];
        db.days[date].forEach(d => {
          d.name = normalizeName(d.name);
          d.phoneLast4 = normalizePhoneLast4(d.phoneLast4 || d.orgRole || '');
          delete d.orgRole;
        });
      });
    } catch (e) {
      db = { days: {} };
    }
  }

  if (fs.existsSync(userListPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(userListPath, 'utf-8'));
      allowedUsers = Array.isArray(parsed)
        ? parsed.map(normalizeAllowedUser).filter(u => u.name && isValidPhoneLast4(u.phoneLast4))
        : [];
      saveUserList();
    } catch (e) {
      allowedUsers = [];
    }
  }


  if (fs.existsSync(menuPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(menuPath, 'utf-8'));
      menus = parsed && parsed.months ? parsed : { months: {} };
    } catch (e) {
      menus = { months: {} };
    }
  }

  if (fs.existsSync(holidayCachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(holidayCachePath, 'utf-8'));
      holidayCache = parsed && parsed.years ? parsed : { years: {} };
    } catch (e) {
      holidayCache = { years: {} };
    }
  }

  cleanupExpiredUsers();
};

loadFiles();

// ==========================================
// 보안 헤더 / 정적 파일 제공
// ==========================================
app.disable('x-powered-by');
app.use(express.json({ limit: MAX_JSON_SIZE }));

app.use((err, req, res, next) => {
  const isJsonParseError = err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError);
  if (isJsonParseError) {
    // 잘못된 JSON 또는 봇/스캐너 요청이 서버 로그에 stack trace로 쌓이지 않도록 400으로 흡수합니다.
    if (req.path.startsWith('/api/')) {
      return res.status(400).json({ message: '요청 데이터 형식이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.' });
    }
    return res.status(400).type('text/plain').send('Bad Request');
  }
  next(err);
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "img-src 'self' data: https:",
    "media-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

app.use('/css', express.static(CSS_DIR, { fallthrough: true, maxAge: '1h' }));
app.use('/js', express.static(JS_DIR, { fallthrough: true, maxAge: '0', setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));
// 구버전 캐시 호환용 별칭입니다. 실제 소스는 css/js 폴더 한 곳에서만 관리합니다.
app.use('/CSS', express.static(CSS_DIR, { fallthrough: true, maxAge: '1h' }));
app.use('/JS', express.static(JS_DIR, { fallthrough: true, maxAge: '0', setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));
app.use('/audio', express.static(path.join(ROOT_DIR, 'audio'), { fallthrough: true, maxAge: '1h' }));
app.use('/img', express.static(path.join(ROOT_DIR, 'img'), { fallthrough: true, maxAge: '1d' }));
app.use('/html', express.static(HTML_DIR, { fallthrough: true, maxAge: '0', setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(ROOT_DIR, 'manifest.json')));
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile(path.join(ROOT_DIR, 'sw.js'));
});

app.get(['/config.js', '/qr_app.js', '/scanner_app.js', '/scanner_bootstrap.js', '/admin_bootstrap.js', '/admin_list_app.js', '/camera.js', '/auth.js', '/admin_app.js'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript');
  const fileName = path.basename(req.path);
  const candidates = [
    path.join(JS_DIR, fileName),
    path.join(ROOT_DIR, 'js', fileName),
    path.join(ROOT_DIR, 'JS', fileName),
    path.join(ROOT_DIR, fileName)
  ];
  const target = candidates.find(file => fs.existsSync(file));
  if (!target) return res.status(404).type('text/plain').send(`${fileName} not found`);
  return res.sendFile(target);
});

app.get(['/common.css', '/qr.css', '/scanner.css', '/admin.css', '/admin_list.css'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/css');
  const fileName = path.basename(req.path);
  const candidates = [
    path.join(CSS_DIR, fileName),
    path.join(ROOT_DIR, 'css', fileName),
    path.join(ROOT_DIR, 'CSS', fileName),
    path.join(ROOT_DIR, fileName)
  ];
  const target = candidates.find(file => fs.existsSync(file));
  if (!target) return res.status(404).type('text/plain').send(`${fileName} not found`);
  return res.sendFile(target);
});

const sendHtml = (res, fileName) => {
  res.setHeader('Cache-Control', 'no-store');
  const candidates = [
    path.join(HTML_DIR, fileName),
    path.join(ROOT_DIR, 'html', fileName)
  ];
  const target = candidates.find(file => fs.existsSync(file));
  if (!target) return res.status(404).type('text/plain').send(`${fileName} not found`);
  return res.sendFile(target);
};

app.get('/', (req, res) => sendHtml(res, 'qr.html'));
app.get('/index.html', (req, res) => sendHtml(res, 'qr.html'));
app.get('/qr.html', (req, res) => sendHtml(res, 'qr.html'));
app.get('/scanner', (req, res) => sendHtml(res, 'scanner.html'));
app.get('/scanner.html', (req, res) => sendHtml(res, 'scanner.html'));
app.get('/admin', (req, res) => sendHtml(res, 'admin.html'));
app.get('/admin.html', (req, res) => sendHtml(res, 'admin.html'));
app.get('/admin_list.html', (req, res) => res.redirect(302, '/admin.html'));

// ==========================================
// 인증 / 관리자 세션
// ==========================================
const parseCookies = (cookieHeader = '') => Object.fromEntries(
  String(cookieHeader).split(';').map(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return null;
    return [decodeURIComponent(part.slice(0, idx).trim()), decodeURIComponent(part.slice(idx + 1).trim())];
  }).filter(Boolean)
);

const hashCode = (code, email) => crypto.createHash('sha256').update(`${email}:${code}:${AUTH_SECRET}`).digest('hex');
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.COOKIE_SECURE === 'true' || (isProduction && /^https:/i.test(process.env.PUBLIC_ORIGIN || ''));

const setSessionCookie = (res, sessionId) => {
  const maxAge = ADMIN_IP_SESSION_MINUTES * 60;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`
  ];
  if (cookieSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
};

const clearSessionCookie = (res) => {
  const parts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0'
  ];
  if (cookieSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
};

const normalizeClientIp = (value = '') => String(value || '')
  .split(',')[0]
  .trim()
  .replace(/^::ffff:/, '')
  .replace(/^::1$/, '127.0.0.1');

const getClientIpKey = (req) => normalizeClientIp(req.ip || req.socket?.remoteAddress || 'unknown') || 'unknown';

const setAdminIpSession = (req, email) => {
  const ipKey = getClientIpKey(req);
  const now = Date.now();
  adminIpSessions.set(ipKey, {
    email,
    createdAt: now,
    expiresAt: now + ADMIN_IP_SESSION_MS
  });
  return ipKey;
};

const getAdminIpSession = (req) => {
  const ipKey = getClientIpKey(req);
  const session = adminIpSessions.get(ipKey);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    adminIpSessions.delete(ipKey);
    return null;
  }
  return { ...session, ipKey };
};

const requireAdmin = (req, res, next) => {
  const session = getAdminIpSession(req);

  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ message: '관리자 인증이 필요합니다.' });
  }

  req.adminEmail = session.email;
  req.adminIp = session.ipKey;
  req.adminSessionExpiresAt = session.expiresAt;
  next();
};

const getExpectedOrigins = (req) => {
  const origins = new Set();
  const hostOrigin = `${req.protocol}://${req.get('host')}`;
  origins.add(hostOrigin);
  if (process.env.PUBLIC_ORIGIN) origins.add(process.env.PUBLIC_ORIGIN.replace(/\/$/, ''));
  return origins;
};

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  if (!getExpectedOrigins(req).has(origin.replace(/\/$/, ''))) {
    return res.status(403).json({ message: '허용되지 않은 요청 출처입니다.' });
  }
  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [email, auth] of authCodes.entries()) {
    if (auth.expiresAt < now - CODE_EXPIRES_MS) authCodes.delete(email);
  }
  for (const [ipKey, session] of adminIpSessions.entries()) {
    if (session.expiresAt < now) adminIpSessions.delete(ipKey);
  }
}, 60 * 1000).unref();

app.post('/api/admin/request-code', async (req, res) => {
  const email = normalizeName(req.body.email).toLowerCase();
  if (!email) return res.status(400).json({ message: '이메일을 입력해 주세요.' });
  if (!adminEmails.includes(email)) return res.status(403).json({ message: '등록되지 않은 관리자 이메일입니다.' });

  const existing = authCodes.get(email);
  if (existing && Date.now() - existing.requestedAt < CODE_COOLDOWN_MS) {
    const retryAfter = Math.ceil((CODE_COOLDOWN_MS - (Date.now() - existing.requestedAt)) / 1000);
    return res.status(429).json({
      message: `인증번호는 ${retryAfter}초 후 다시 요청할 수 있습니다.`,
      retryAfter,
      sent: false
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashCode(code, email);
  const auth = {
    codeHash,
    expiresAt: Date.now() + CODE_EXPIRES_MS,
    requestedAt: Date.now(),
    attempts: 0
  };
  authCodes.set(email, auth);

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: '[Lunch Check] 관리자 보안 인증번호',
      text: `인증번호: [${code}]\n유효시간: 3분`
    });
    res.json({ message: '인증 메일이 발송되었습니다.', cooldownSeconds: 30, expiresInSeconds: 180, sent: true });
  } catch (e) {
    authCodes.delete(email);
    res.status(500).json({ message: '메일 발송 실패. 서버 메일 설정을 확인해 주세요.' });
  }
});

app.post('/api/admin/verify-code', (req, res) => {
  const email = normalizeName(req.body.email).toLowerCase();
  const code = String(req.body.code || '').trim();
  const auth = authCodes.get(email);

  if (!auth) return res.status(401).json({ message: '인증 요청 내역이 없습니다.', action: 'reset' });
  if (auth.expiresAt < Date.now()) {
    authCodes.delete(email);
    return res.status(401).json({ message: '인증 시간이 만료되었습니다.', action: 'reset' });
  }

  if (hashCode(code, email) === auth.codeHash) {
    authCodes.delete(email);
    const ipKey = setAdminIpSession(req, email);
    // 브라우저 호환을 위해 쿠키도 3시간짜리 표시용으로 남기지만, 실제 관리자 권한은 IP 세션으로 판단합니다.
    const sessionMarker = crypto.createHash('sha256').update(`${ipKey}:${email}:${AUTH_SECRET}`).digest('hex');
    setSessionCookie(res, sessionMarker);
    return res.json({
      message: '인증 성공',
      email,
      sessionType: 'ip',
      expiresInSeconds: ADMIN_IP_SESSION_MINUTES * 60
    });
  }

  auth.attempts += 1;
  if (auth.attempts >= MAX_AUTH_ATTEMPTS) {
    authCodes.delete(email);
    return res.status(401).json({ message: '3회 오류로 인증번호가 만료되었습니다.', action: 'reset' });
  }

  res.status(401).json({ message: `번호가 틀렸습니다. (${auth.attempts}/${MAX_AUTH_ATTEMPTS})` });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({
  authenticated: true,
  email: req.adminEmail,
  sessionType: 'ip',
  expiresAt: req.adminSessionExpiresAt
}));
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  if (req.adminIp) adminIpSessions.delete(req.adminIp);
  clearSessionCookie(res);
  res.json({ message: '로그아웃되었습니다.' });
});

// 옛 superadmin 경로는 사용하지 않음. ADMIN_EMAILS 기반 관리자 인증으로 통합.
app.post('/api/superadmin/request-code', (req, res) => res.status(410).json({ message: '최고 관리자 인증은 관리자 인증으로 통합되었습니다. /api/admin/request-code를 사용하세요.' }));
app.post('/api/superadmin/verify-code', (req, res) => res.status(410).json({ message: '최고 관리자 인증은 관리자 인증으로 통합되었습니다. /api/admin/verify-code를 사용하세요.' }));

// ==========================================
// 명단 관리 API
// ==========================================
const ensureValidUserPayload = ({ name, phoneLast4 }) => {
  const cleanName = normalizeName(name);
  const cleanPhoneLast4 = normalizePhoneLast4(phoneLast4);
  if (!cleanName) return { error: '이름을 입력해 주세요.' };
  if (!isValidPhoneLast4(cleanPhoneLast4)) return { error: '전화번호 뒷자리는 숫자 4자리로 입력해 주세요.' };
  return { name: cleanName, phoneLast4: cleanPhoneLast4 };
};

const isUserValidOnDate = (user, dateStr) => {
  if (user.mealType === 'daily') return Array.isArray(user.validDates) && user.validDates.includes(dateStr);
  return user.startDate <= dateStr && dateStr <= user.endDate;
};

const hasOverlappingMonthlyUser = ({ name, phoneLast4, startDate, endDate, excludeIndex = -1 }) => {
  return allowedUsers.some((u, idx) => idx !== excludeIndex && u.mealType === 'monthly' && u.name === name && u.phoneLast4 === phoneLast4 && !(u.endDate < startDate || endDate < u.startDate));
};

app.get('/api/admin/allowed-users', requireAdmin, (req, res) => {
  cleanupExpiredUsers();
  res.json(allowedUsers.map(sanitizeUserForClient));
});

app.post('/api/admin/allowed-users', requireAdmin, (req, res) => {
  const { mealType, targetDates, year, month } = req.body;
  const cleaned = ensureValidUserPayload(req.body);
  if (cleaned.error) return res.status(400).json({ message: cleaned.error });

  const type = mealType === 'daily' ? 'daily' : 'monthly';
  let startDate;
  let endDate;
  let validDates = null;

  if (type === 'daily') {
    if (!Array.isArray(targetDates) || targetDates.length === 0) return res.status(400).json({ message: '날짜를 하나 이상 지정하세요.' });
    validDates = [...new Set(targetDates.filter(d => parseISODate(d)))].sort();
    if (validDates.length === 0) return res.status(400).json({ message: '올바른 날짜를 하나 이상 지정하세요.' });
    startDate = validDates[0];
    endDate = validDates[validDates.length - 1];
  } else {
    const ym = String(year || month ? `${year}-${pad2(month)}` : getKSTYearMonth());
    const parsed = /^(\d{4})-(\d{2})$/.exec(ym);
    const y = parsed ? Number(parsed[1]) : Number(getKSTYearMonth().slice(0, 4));
    const m = parsed ? Number(parsed[2]) : Number(getKSTYearMonth().slice(5, 7));
    if (m < 1 || m > 12) return res.status(400).json({ message: '월 정보가 올바르지 않습니다.' });
    startDate = `${y}-${pad2(m)}-01`;
    endDate = calculateMonthlyEndDate(y, m);

    if (hasOverlappingMonthlyUser({ ...cleaned, startDate, endDate })) {
      return res.status(409).json({ message: '이미 해당 월식 명단에 등록된 사용자입니다.' });
    }
  }

  if (allowedUsers.some(u => u.name === cleaned.name && u.phoneLast4 === cleaned.phoneLast4 && u.mealType === type && u.endDate >= getKSTDateStr())) {
    return res.status(409).json({ message: '이미 유효한 명단에 등록된 사용자입니다.' });
  }

  allowedUsers.push({
    ...cleaned,
    mealType: type,
    startDate,
    endDate,
    validDates,
    paymentStatus: req.body.paymentStatus === '미입금' ? '미입금' : '입금',
    createdAt: new Date().toISOString()
  });
  saveUserList();
  res.json({ message: '등록 성공' });
});

app.post('/api/admin/allowed-users/update-info', requireAdmin, (req, res) => {
  const index = Number(req.body.index);
  const user = allowedUsers[index];
  if (!user) return res.status(404).json({ message: '대상을 찾을 수 없습니다.' });

  const cleaned = ensureValidUserPayload(req.body);
  if (cleaned.error) return res.status(400).json({ message: cleaned.error });

  const duplicate = allowedUsers.some((u, idx) => idx !== index && u.name === cleaned.name && u.phoneLast4 === cleaned.phoneLast4 && u.mealType === user.mealType && u.endDate >= getKSTDateStr());
  if (duplicate) return res.status(409).json({ message: '같은 이름/전화번호 뒷자리의 유효한 사용자가 이미 있습니다.' });

  user.name = cleaned.name;
  user.phoneLast4 = cleaned.phoneLast4;
  saveUserList();
  res.json({ message: '정보 수정 완료' });
});

app.post('/api/admin/allowed-users/update-dates', requireAdmin, (req, res) => {
  const index = Number(req.body.index);
  const user = allowedUsers[index];
  const targetDates = Array.isArray(req.body.targetDates) ? req.body.targetDates : [];
  const validDates = [...new Set(targetDates.filter(d => parseISODate(d)))].sort();

  if (user && user.mealType === 'daily' && validDates.length > 0) {
    user.validDates = validDates;
    user.startDate = validDates[0];
    user.endDate = validDates[validDates.length - 1];
    saveUserList();
    res.json({ message: '날짜가 성공적으로 변경되었습니다.' });
  } else {
    res.status(400).json({ message: '잘못된 요청이거나 날짜가 비어있습니다.' });
  }
});

app.post('/api/admin/allowed-users/update-period', requireAdmin, (req, res) => {
  const indexes = Array.isArray(req.body.indexes) ? req.body.indexes.map(Number).filter(Number.isInteger) : [];
  const action = req.body.action;
  if (indexes.length === 0) return res.status(400).json({ message: '대상을 선택하세요.' });

  const thisMonthEnd = calculateMonthlyEndDate(Number(getKSTYearMonth().slice(0, 4)), Number(getKSTYearMonth().slice(5, 7)));
  let errorMsg = null;

  indexes.forEach(idx => {
    const user = allowedUsers[idx];
    if (!user || user.mealType !== 'monthly') return;
    const [y, m] = user.endDate.slice(0, 7).split('-').map(Number);

    if (action === 'extend') {
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear = m === 12 ? y + 1 : y;
      user.endDate = calculateMonthlyEndDate(nextYear, nextMonth);
    } else if (action === 'shorten') {
      if (user.endDate <= thisMonthEnd) errorMsg = '단축 오류: 월식은 이번 달까지만 단축할 수 있습니다.';
      else {
        const prevMonth = m === 1 ? 12 : m - 1;
        const prevYear = m === 1 ? y - 1 : y;
        user.endDate = calculateMonthlyEndDate(prevYear, prevMonth);
      }
    }
  });

  saveUserList();
  if (errorMsg) return res.status(400).json({ message: errorMsg });
  res.json({ message: '기간 업데이트 완료' });
});

app.delete('/api/admin/allowed-users', requireAdmin, (req, res) => {
  const indexes = Array.isArray(req.body.indexes) ? req.body.indexes.map(Number).filter(Number.isInteger) : [];
  if (indexes.length === 0) return res.status(400).json({ message: '대상을 선택하세요.' });
  const removeSet = new Set(indexes);
  allowedUsers = allowedUsers.filter((_, idx) => !removeSet.has(idx));
  saveUserList();
  res.json({ message: '삭제 완료' });
});

// ==========================================
// 월식 엑셀 자동 등록 API
// ==========================================
let excelUploadMiddleware = null;
let menuImageUploadMiddleware = null;
let uploadDependencyError = null;
try {
  const multer = require('multer');
  const memoryStorage = multer.memoryStorage();
  excelUploadMiddleware = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_UPLOAD_SIZE, files: MAX_UPLOAD_FILES },
    fileFilter: (req, file, cb) => {
      if (/\.xlsx$/i.test(file.originalname || '')) cb(null, true);
      else cb(new Error('xlsx 파일만 업로드할 수 있습니다.'));
    }
  }).array('files', MAX_UPLOAD_FILES);

  menuImageUploadMiddleware = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_MENU_IMAGE_SIZE, files: 1 },
    fileFilter: (req, file, cb) => {
      const name = String(file.originalname || '');
      const type = String(file.mimetype || '');
      if (/\.(png|jpe?g|webp)$/i.test(name) && /^image\/(png|jpeg|webp)$/i.test(type)) cb(null, true);
      else cb(new Error('png, jpg, jpeg, webp 이미지 파일만 업로드할 수 있습니다.'));
    }
  }).single('image');
} catch (e) {
  uploadDependencyError = e;
}

const parsePaymentStatus = (value) => /미\s*입금|미납|미완료|확인필요/i.test(String(value || '')) ? '미입금' : '입금';

const findHeaderIndex = (rows) => rows.findIndex(row => {
  const cells = row.map(v => String(v || '').trim());
  const hasName = cells.some(v => /학생명|성명|이름/.test(v));
  const hasPhone = cells.some(v => /^ID$/i.test(v) || /전화|휴대|연락|폰|아이디|ID/i.test(v));
  return hasName && hasPhone;
});

const findColumnIndex = (headers, patterns, fallback) => {
  const idx = headers.findIndex(h => patterns.some(p => p.test(String(h || '').trim())));
  return idx >= 0 ? idx : fallback;
};

const detectYearMonthFromRows = (rows) => {
  const topText = rows.slice(0, 5).flat().map(v => String(v || '')).join(' ');
  let match = /(20\d{2})\s*[-./년]\s*(\d{1,2})/.exec(topText);
  if (!match) match = /(20\d{2})(\d{2})/.exec(topText);
  if (!match) return { year: null, month: null };
  return { year: Number(match[1]), month: Number(match[2]) };
};

const analyzeWorkbookRows = ({ rows, fileName, selectedYear, selectedMonth }) => {
  const headerIdx = findHeaderIndex(rows);
  const detected = detectYearMonthFromRows(rows);
  const resultRows = [];
  const errors = [];
  let excludedDailyCount = 0;
  let skippedInvalidCount = 0;

  if (headerIdx === -1) {
    return { rows: [], errors: [`${fileName}: 이름/전화번호 열을 찾을 수 없습니다.`], detected, excludedDailyCount: 0, skippedInvalidCount: 0 };
  }

  const headers = rows[headerIdx].map(v => String(v || '').trim());
  const classIdx = findColumnIndex(headers, [/^반$/, /신청|구분|유형|분류/], 1);
  const phoneIdx = findColumnIndex(headers, [/^ID$/i, /전화|휴대|연락|폰|아이디/], 2);
  const nameIdx = findColumnIndex(headers, [/학생명|성명|이름/], 3);
  const paymentIdx = findColumnIndex(headers, [/입금|결제|상태/], 5);

  rows.slice(headerIdx + 1).forEach((row, offset) => {
    const sourceRow = headerIdx + 2 + offset;
    const classText = String(row[classIdx] || '').trim();
    const isDaily = /일식|날짜\s*선택|선택\s*신청/i.test(classText);
    if (isDaily) {
      excludedDailyCount += 1;
      return;
    }

    const name = stripTrailingPhoneFromName(row[nameIdx]);
    const phoneLast4 = normalizePhoneLast4(row[phoneIdx]);
    if (!name && !phoneLast4) return;
    if (!name || !isValidPhoneLast4(phoneLast4)) {
      skippedInvalidCount += 1;
      return;
    }

    const paymentStatus = parsePaymentStatus(row[paymentIdx]);
    resultRows.push({
      sourceFile: fileName,
      sourceRow,
      name,
      phoneLast4,
      paymentStatus,
      unpaidConfirmed: paymentStatus !== '미입금',
      selected: true,
      detectedYear: detected.year,
      detectedMonth: detected.month,
      monthMismatch: Boolean(detected.year && detected.month && (detected.year !== selectedYear || detected.month !== selectedMonth))
    });
  });

  return { rows: resultRows, errors, detected, excludedDailyCount, skippedInvalidCount };
};

const dedupeImportRows = (rows) => {
  const seen = new Set();
  const unique = [];
  let duplicateCount = 0;
  rows.forEach(row => {
    const key = `${row.name}|${row.phoneLast4}`;
    if (seen.has(key)) {
      duplicateCount += 1;
      return;
    }
    seen.add(key);
    unique.push(row);
  });
  return { unique, duplicateCount };
};

app.post('/api/admin/monthly-import/analyze', requireAdmin, (req, res) => {
  if (!excelUploadMiddleware) {
    return res.status(500).json({ message: '엑셀 업로드 기능을 사용하려면 multer 패키지를 설치해야 합니다.', detail: uploadDependencyError && uploadDependencyError.message });
  }

  excelUploadMiddleware(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || '파일 업로드 실패' });

    let XLSX;
    try {
      XLSX = require('xlsx');
    } catch (e) {
      return res.status(500).json({ message: '엑셀 분석 기능을 사용하려면 xlsx 패키지를 설치해야 합니다.', detail: e.message });
    }

    const selectedYear = Number(req.body.year);
    const selectedMonth = Number(req.body.month);
    if (!selectedYear || selectedMonth < 1 || selectedMonth > 12) return res.status(400).json({ message: '급식 연도와 월을 올바르게 선택해 주세요.' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'xlsx 파일을 업로드해 주세요.' });

    let allRows = [];
    let errors = [];
    let fileSummaries = [];
    let excludedDailyCount = 0;
    let skippedInvalidCount = 0;

    req.files.forEach(file => {
      try {
        const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: false, raw: false });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '', raw: false });
        const analyzed = analyzeWorkbookRows({ rows, fileName: file.originalname, selectedYear, selectedMonth });
        allRows = allRows.concat(analyzed.rows);
        errors = errors.concat(analyzed.errors);
        excludedDailyCount += analyzed.excludedDailyCount;
        skippedInvalidCount += analyzed.skippedInvalidCount;
        fileSummaries.push({
          fileName: file.originalname,
          detectedYear: analyzed.detected.year,
          detectedMonth: analyzed.detected.month,
          monthMismatch: Boolean(analyzed.detected.year && analyzed.detected.month && (analyzed.detected.year !== selectedYear || analyzed.detected.month !== selectedMonth)),
          extractedCount: analyzed.rows.length,
          excludedDailyCount: analyzed.excludedDailyCount,
          skippedInvalidCount: analyzed.skippedInvalidCount
        });
      } catch (e) {
        errors.push(`${file.originalname}: 파일 분석 실패 (${e.message})`);
      }
    });

    const deduped = dedupeImportRows(allRows);
    const targetStart = `${selectedYear}-${pad2(selectedMonth)}-01`;
    const targetEnd = calculateMonthlyEndDate(selectedYear, selectedMonth);
    const rowsWithExisting = deduped.unique.map((row, index) => {
      const alreadyRegistered = hasOverlappingMonthlyUser({ name: row.name, phoneLast4: row.phoneLast4, startDate: targetStart, endDate: targetEnd });
      return { ...row, id: crypto.randomBytes(8).toString('hex'), seq: index + 1, alreadyRegistered };
    });

    const unpaidCount = rowsWithExisting.filter(r => r.paymentStatus === '미입금').length;
    const alreadyRegisteredCount = rowsWithExisting.filter(r => r.alreadyRegistered).length;
    const monthMismatch = fileSummaries.some(s => s.monthMismatch);

    res.json({
      year: selectedYear,
      month: selectedMonth,
      rows: rowsWithExisting,
      summary: {
        extractedCount: rowsWithExisting.length,
        unpaidCount,
        alreadyRegisteredCount,
        duplicateCount: deduped.duplicateCount,
        excludedDailyCount,
        skippedInvalidCount,
        monthMismatch
      },
      files: fileSummaries,
      errors
    });
  });
});

app.post('/api/admin/monthly-import/register', requireAdmin, (req, res) => {
  const year = Number(req.body.year);
  const month = Number(req.body.month);
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

  if (!year || month < 1 || month > 12) return res.status(400).json({ message: '급식 연도와 월이 올바르지 않습니다.' });
  if (rows.length === 0) return res.status(400).json({ message: '등록할 명단이 없습니다.' });

  const startDate = `${year}-${pad2(month)}-01`;
  const endDate = calculateMonthlyEndDate(year, month);
  let added = 0;
  let skipped = 0;
  const skippedRows = [];

  for (const row of rows) {
    const cleaned = ensureValidUserPayload(row);
    if (cleaned.error) {
      skipped += 1;
      skippedRows.push({ name: row.name, phoneLast4: row.phoneLast4, reason: cleaned.error });
      continue;
    }

    const paymentStatus = row.paymentStatus === '미입금' ? '미입금' : '입금';
    if (paymentStatus === '미입금' && row.unpaidConfirmed !== true) {
      return res.status(400).json({ message: `${cleaned.name}(${cleaned.phoneLast4})님은 미입금 확인이 필요합니다.` });
    }

    if (hasOverlappingMonthlyUser({ ...cleaned, startDate, endDate })) {
      skipped += 1;
      skippedRows.push({ ...cleaned, reason: '이미 해당 월식 명단에 등록됨' });
      continue;
    }

    allowedUsers.push({
      ...cleaned,
      mealType: 'monthly',
      startDate,
      endDate,
      validDates: null,
      paymentStatus,
      createdAt: new Date().toISOString()
    });
    added += 1;
  }

  if (added > 0) saveUserList();
  res.json({ message: '월식 명단 등록 완료', added, skipped, skippedRows });
});


// ==========================================
// 식단표 이미지 OCR / 조회 API
// ==========================================
const normalizeMenuTextLine = (value) => String(value || '')
  .replace(/[<>]/g, '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const menuMonthKey = (year, month) => `${Number(year)}-${pad2(month)}`;

const normalizeHolidayName = (value) => {
  const clean = normalizeMenuTextLine(value).replace(/National Holiday|Public Holiday/ig, '').trim();
  return clean || '공휴일';
};

const fetchKoreanHolidayMap = async (year) => {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return {};

  const cached = holidayCache.years?.[String(y)];
  if (cached && cached.holidays && Date.now() - Number(cached.fetchedAt || 0) < 1000 * 60 * 60 * 24 * 30) {
    return cached.holidays;
  }

  const result = {};
  if (typeof fetch !== 'function') return cached?.holidays || result;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.HOLIDAY_API_TIMEOUT_MS || 4500));
  try {
    const baseUrl = (process.env.HOLIDAY_API_URL || 'https://date.nager.at/api/v3/PublicHolidays/{year}/KR').trim();
    const url = baseUrl.replace('{year}', String(y));
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`holiday api ${response.status}`);
    const list = await response.json();
    if (Array.isArray(list)) {
      list.forEach(item => {
        const date = String(item.date || item.localDate || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          result[date] = normalizeHolidayName(item.localName || item.nativeName || item.name || '공휴일');
        }
      });
      if (!holidayCache.years) holidayCache.years = {};
      holidayCache.years[String(y)] = { fetchedAt: Date.now(), holidays: result };
      saveHolidayCache();
      return result;
    }
  } catch (e) {
    return cached?.holidays || result;
  } finally {
    clearTimeout(timer);
  }
  return cached?.holidays || result;
};

const getHolidayNameFromParsedDay = (day) => {
  const raw = [
    ...(Array.isArray(day?.menu) ? day.menu : []),
    ...(Array.isArray(day?.rawLines) ? day.rawLines : [])
  ].map(normalizeMenuTextLine).join(' ');
  if (!isHolidayLine(raw)) return '';
  if (/지방선거|선거/.test(raw)) return '공휴일';
  const match = /(대체공휴일|임시공휴일|공휴일|현충일|광복절|개천절|한글날|성탄절?|부처님오신날|석가탄신일|설날|추석)/.exec(raw);
  return normalizeHolidayName(match?.[1] || '공휴일');
};

const applyHolidayOverrides = (parsed, holidayMap = {}) => {
  if (!parsed || !parsed.days) return parsed;
  const year = Number(parsed.year);
  const month = Number(parsed.month);
  const prefix = `${year}-${pad2(month)}-`;

  Object.entries(holidayMap || {}).forEach(([date, name]) => {
    if (!date.startsWith(prefix) || !parseISODate(date) || isWeekendDateStr(date)) return;
    if (!parsed.days[date]) parsed.days[date] = { date, menu: [], origins: [], rawLines: [] };
    parsed.days[date].holidayName = normalizeHolidayName(name);
    parsed.days[date].menu = ['공휴일'];
    parsed.days[date].origins = [];
  });

  Object.values(parsed.days).forEach(day => {
    const holidayName = getHolidayNameFromParsedDay(day);
    if (holidayName) {
      day.holidayName = holidayName;
      day.menu = ['공휴일'];
      day.origins = [];
    }
  });

  return parsed;
};

const enrichMenuMonthWithHolidays = async (monthData, yearMonthFallback = '') => {
  const ym = monthData?.yearMonth || yearMonthFallback;
  const match = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!match) return monthData;
  const year = Number(monthData?.year || match[1]);
  const month = Number(monthData?.month || match[2]);
  const clone = monthData ? JSON.parse(JSON.stringify(monthData)) : { year, month, yearMonth: `${year}-${pad2(month)}`, days: {} };
  clone.days = clone.days || {};
  const holidayMap = await fetchKoreanHolidayMap(year);
  applyHolidayOverrides(clone, holidayMap);
  return clone;
};

const compactMenuLine = (line) => normalizeMenuTextLine(line).replace(/\s+/g, '');

const isMenuEventLine = (line) => {
  const compact = compactMenuLine(line).replace(/[★☆★☆]/g, '');
  return /(일품데이|일품|입품데이|품데이|데이)$/.test(compact) || /^(일품데이|일품|입품데이|품데이|데이)$/.test(compact);
};

const isHolidayLine = (line) => {
  const compact = compactMenuLine(line);
  return /(공휴일|대체공휴일|임시공휴일|휴일|휴무|휴업|재량휴업|방학|선거|지방선거|현충일|광복절|개천절|한글날|성탄|석가탄신|부처님오신날|설날|추석)/.test(compact);
};

const isOriginLine = (line) => {
  const compact = compactMenuLine(line);
  return /(원산|국내산|국내|국산|외국산|수입산|중국산|미국산|호주산|러시아산|스페인산|덴마크산|캐나다산|브라질산|베트남산|태국산|칠레산|뉴질랜드산|한우|육우|우육|돈육|계육|대두|고춧가루|쌀[:：]|김치[:：]|오리[:：]|오리\s*국내산)/i.test(compact);
};

const isOriginFragmentLine = (line) => {
  const compact = compactMenuLine(line);
  return /^(국내|국내산|국산|외국산|수입산|중국|중국산|미국|미국산|호주|호주산|러시아|러시아산|스페인|스페인산|덴마크|덴마크산|브라질|브라질산|베트남|베트남산|우육|돈육|계육|대두|고춧가루|원산|원산지)$/.test(compact);
};

const isNoiseMenuLine = (line) => {
  const compact = compactMenuLine(line);
  if (!compact || compact.length < 2) return true;
  if (/^(중식|월식|원산지|원산|요일|월요일|화요일|수요일|목요일|금요일|토요일|일요일|메뉴와|없음|해당없음|물물|봉기|볼|엘로|훨|지)$/.test(compact)) return true;
  if (/^\d{1,2}월?\d{1,2}일?$/.test(compact) || /^\d{1,2}일$/.test(compact)) return true;
  if (/^[※◎*|＿_~`^·•●□■◆◇○△▲▽▼=+\-]+$/.test(compact)) return true;
  return isMenuEventLine(compact) || isHolidayLine(compact) || isOriginFragmentLine(compact);
};

const cleanMenuCandidate = (line) => {
  let clean = normalizeMenuTextLine(line)
    .replace(/^[•·ㆍ\-–—*★☆★☆\s]+/, '')
    .replace(/[★☆★☆]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = compactMenuLine(clean);
  if (!compact || isNoiseMenuLine(compact) || isOriginLine(compact)) return '';
  if (!/[가-힣]/.test(compact)) return '';
  if (/[\[\]{}]|[A-Za-z]{2,}/.test(clean)) return '';
  if (/^[가-힣]$/.test(compact)) return '';
  if (/^(일품|입품|품데이|데이|선거|공휴일|휴무|휴업|국내|국산|원산|물물|봉기|볼|엘로|훨|지)$/.test(compact)) return '';
  const menu = compact.replace(/[|ㅣ:：.;,]+$/g, '').replace(/^[|ㅣ:：.;,]+/g, '');
  if (!menu || menu.length < 2) return '';
  return menu.slice(0, 80);
};

const ORIGIN_ITEM_PATTERN = '(쌀|백미|흑미|현미|찹쌀|돈육|돼지고기|돼지|계육|닭고기|닭|우육|소고기|쇠고기|소|한우|육우|오리|오리고기|삼치|새우|새우살|가다랑어|참치|코다리|대두|콩|두부|순두부|연두부|배추|배추김치|포기김치|고춧가루|고추가루|오징어|명태|동태|낙지|주꾸미|쭈꾸미|고등어|갈치|미꾸라지|장어|메밀)';
const ORIGIN_COUNTRY_PATTERN = '(국내산|국산|중국산|중국|미국산|미국|호주산|호주|러시아산|러시아|스페인산|스페인|덴마크산|덴마크|캐나다산|캐나다|브라질산|브라질|베트남산|베트남|태국산|태국|칠레산|칠레|뉴질랜드산|뉴질랜드|원양산|원양|외국산|외국|수입산|수입)';
const ORIGIN_SOURCE_RE = new RegExp(`${ORIGIN_ITEM_PATTERN}[:：\\s\\-]*${ORIGIN_COUNTRY_PATTERN}`, 'i');
const ORIGIN_SOURCE_RE_GLOBAL = new RegExp(`${ORIGIN_ITEM_PATTERN}[:：\\s\\-]*${ORIGIN_COUNTRY_PATTERN}`, 'gi');

const canonicalOriginItem = (item) => {
  const clean = String(item || '');
  if (/쌀|백미/.test(clean)) return '쌀';
  if (/흑미/.test(clean)) return '흑미';
  if (/현미/.test(clean)) return '현미';
  if (/찹쌀/.test(clean)) return '찹쌀';
  if (/돈육|돼지/.test(clean)) return '돈육';
  if (/계육|닭/.test(clean)) return '계육';
  if (/우육|소고기|쇠고기|소/.test(clean)) return '우육';
  if (/오리/.test(clean)) return '오리';
  if (/대두|콩/.test(clean)) return '대두';
  if (/고추/.test(clean)) return '고춧가루';
  return clean;
};

const canonicalOriginCountry = (country) => {
  const clean = String(country || '');
  if (/국내|국산/.test(clean)) return '국내산';
  if (/중국/.test(clean)) return '중국산';
  if (/미국/.test(clean)) return '미국산';
  if (/호주/.test(clean)) return '호주산';
  if (/러시아/.test(clean)) return '러시아산';
  if (/스페인/.test(clean)) return '스페인산';
  if (/덴마크/.test(clean)) return '덴마크산';
  if (/캐나다/.test(clean)) return '캐나다산';
  if (/브라질/.test(clean)) return '브라질산';
  if (/베트남/.test(clean)) return '베트남산';
  if (/태국/.test(clean)) return '태국산';
  if (/칠레/.test(clean)) return '칠레산';
  if (/뉴질랜드/.test(clean)) return '뉴질랜드산';
  if (/원양/.test(clean)) return '원양산';
  if (/외국/.test(clean)) return '외국산';
  if (/수입/.test(clean)) return '수입산';
  return clean;
};

const normalizeOriginText = (value) => normalizeMenuTextLine(value)
  .replace(/[|ㅣ]/g, ' ')
  .replace(/[()\[\]{}]/g, ' ')
  .replace(/[★☆★☆]/g, '')
  .replace(/^[•·ㆍ\-–—*\s]+/, '')
  .replace(/\s+/g, '')
  .replace(/국\s*내\s*산/g, '국내산')
  .replace(/국\s*산/g, '국산')
  .replace(/중\s*국\s*산/g, '중국산')
  .replace(/미\s*국\s*산/g, '미국산')
  .replace(/호\s*주\s*산/g, '호주산')
  .replace(/러\s*시\s*아\s*산/g, '러시아산')
  .replace(/스\s*페\s*인\s*산/g, '스페인산')
  .replace(/베\s*트\s*남\s*산/g, '베트남산')
  .replace(/계욕/g, '계육')
  .replace(/돋육/g, '돈육')
  .replace(/돈욕/g, '돈육')
  .replace(/듬육/g, '돈육')
  .replace(/자육/g, '돈육')
  .replace(/닭고끼/g, '닭고기')
  .replace(/계욱/g, '계육')
  .replace(/우욕/g, '우육')
  .replace(/오리육/g, '오리')
  .replace(/돈국내산/g, '돈육국내산')
  .replace(/자육국내산/g, '돈육국내산')
  .replace(/고자육국내산/g, '돈육국내산')
  .replace(/계국내산/g, '계육국내산')
  .replace(/우국내산/g, '우육국내산')
  .replace(/초주산/g, '호주산')
  .replace(/러시산/g, '러시아산')
  .replace(/국내산국내산/g, '국내산')
  .trim();

const extractOriginSourcesDetailed = (value) => {
  const clean = normalizeOriginText(value);
  if (!clean || isHolidayLine(clean) || isMenuEventLine(clean)) return [];
  const items = [];
  ORIGIN_SOURCE_RE_GLOBAL.lastIndex = 0;
  let match;
  while ((match = ORIGIN_SOURCE_RE_GLOBAL.exec(clean)) !== null) {
    const item = canonicalOriginItem(match[1]);
    const country = canonicalOriginCountry(match[2]);
    if (item && country) items.push({ index: match.index, text: `${item}: ${country}` });
  }
  return items.filter((entry, idx, arr) => arr.findIndex(e => e.text === entry.text && e.index === entry.index) === idx);
};

const formatOriginSource = (value) => {
  const detailed = extractOriginSourcesDetailed(value);
  if (detailed.length) return [...new Set(detailed.map(entry => entry.text))].join(' / ').slice(0, 160);

  let clean = normalizeOriginText(value);
  if (!clean || isHolidayLine(clean) || isMenuEventLine(clean)) return '';
  clean = clean
    .replace(/[:：]{2,}/g, ':')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:：\-–—]+|[:：\-–—]+$/g, '')
    .replace(/[.。]+$/g, '')
    .trim();
  if (!clean || !isOriginLine(clean)) return '';
  return clean.slice(0, 160);
};

const cleanOriginMenuName = (line) => {
  const clean = cleanMenuCandidate(line);
  if (!clean) return '';
  if (isOriginLine(clean) || isOriginFragmentLine(clean)) return '';
  if (/^(원산지|원산|중식|월식|메뉴)$/.test(clean)) return '';
  return clean.slice(0, 60);
};

const matchOriginMenuName = (day, menuName) => {
  const key = compactMenuLine(menuName).replace(/[^가-힣0-9*]/g, '');
  if (!key || !Array.isArray(day?.menu)) return menuName;
  const candidates = day.menu
    .map(item => cleanMenuCandidate(item))
    .filter(Boolean);
  const exact = candidates.find(item => compactMenuLine(item) === key);
  if (exact) return exact;
  const contained = candidates.find(item => {
    const candidateKey = compactMenuLine(item);
    return candidateKey.includes(key) || key.includes(candidateKey) || (key.length >= 4 && candidateKey.includes(key.slice(-4)));
  });
  return contained || menuName;
};

const menuKeyForOriginMatch = (value) => compactMenuLine(value).replace(/[^가-힣0-9]/g, '');

const extractOriginEntriesForDay = (day, text) => {
  if (!day) return [];
  const clean = normalizeOriginText(text);
  const sources = extractOriginSourcesDetailed(clean);
  if (!clean || !sources.length) return [];

  const menuPositions = (Array.isArray(day.menu) ? day.menu : [])
    .map(menu => cleanMenuCandidate(menu))
    .filter(Boolean)
    .map(menu => {
      const key = menuKeyForOriginMatch(menu);
      if (!key || key.length < 2) return null;
      let index = clean.indexOf(key);
      if (index < 0 && key.length >= 4) index = clean.indexOf(key.slice(0, Math.max(3, key.length - 1)));
      if (index < 0 && key.length >= 5) index = clean.indexOf(key.slice(-Math.max(3, Math.min(5, key.length))));
      return index >= 0 ? { menu, index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  if (!menuPositions.length) return [];
  const entries = [];
  menuPositions.forEach((pos, idx) => {
    const nextIndex = idx + 1 < menuPositions.length ? menuPositions[idx + 1].index : clean.length + 1;
    const scopedSources = sources
      .filter(source => source.index >= pos.index && source.index < nextIndex)
      .map(source => source.text);
    if (scopedSources.length) entries.push(`${pos.menu}: ${[...new Set(scopedSources)].join(' / ')}`);
  });
  return [...new Set(entries)].slice(0, 8);
};

const cleanOriginCandidate = (line) => {
  let clean = normalizeOriginText(line);
  if (!clean || isHolidayLine(clean) || isMenuEventLine(clean)) return '';
  const detailed = extractOriginSourcesDetailed(clean);
  const match = ORIGIN_SOURCE_RE.exec(clean);
  if (match && match.index > 0) {
    const menuName = cleanOriginMenuName(clean.slice(0, match.index));
    const source = detailed.length
      ? [...new Set(detailed.map(entry => entry.text))].join(' / ')
      : formatOriginSource(clean.slice(match.index));
    if (source) return menuName ? `${menuName}: ${source}` : source;
  }
  const source = formatOriginSource(clean);
  if (source) return source;
  if (!isOriginLine(clean) && !isOriginFragmentLine(clean)) return '';
  if (clean.length < 2) return '';
  return clean.slice(0, 120);
};

const pushOriginPairCandidate = (day, menuText, sourceText) => {
  if (!day) return;
  const source = formatOriginSource(sourceText) || cleanOriginCandidate(sourceText);
  if (!source) return;
  let menuName = cleanOriginMenuName(menuText);
  menuName = matchOriginMenuName(day, menuName);
  day.origins.push(menuName ? `${menuName}: ${source}` : source);
};

const pushOriginCandidate = (day, text) => {
  if (!day) return;
  const entries = extractOriginEntriesForDay(day, text);
  if (entries.length) {
    entries.forEach(entry => day.origins.push(entry));
    return;
  }
  const origin = cleanOriginCandidate(text);
  if (origin) day.origins.push(origin);
};

const pushMenuCandidate = (day, text, section = 'menu') => {
  if (!day) return;
  day.rawLines.push(normalizeMenuTextLine(text));
  if (section === 'origin') {
    pushOriginCandidate(day, text);
    return;
  }
  const origin = cleanOriginCandidate(text);
  if (origin) {
    day.origins.push(origin);
    return;
  }
  const menu = cleanMenuCandidate(text);
  if (menu) day.menu.push(menu);
};

const finalizeParsedMenuDay = (day) => {
  if (!day) return day;
  const holidayName = getHolidayNameFromParsedDay(day);
  if (holidayName) {
    day.holidayName = holidayName;
    day.menu = ['공휴일'];
    day.origins = [];
    day.rawLines = [...new Set((day.rawLines || []).map(normalizeMenuTextLine).filter(Boolean))].slice(0, 35);
    return day;
  }

  day.menu = [...new Set((day.menu || []).map(cleanMenuCandidate).filter(Boolean))]
    .filter(line => !isHolidayLine(line) && !isMenuEventLine(line))
    .slice(0, 14);
  day.origins = [...new Set((day.origins || []).map(cleanOriginCandidate).filter(Boolean))]
    .slice(0, 16);
  day.rawLines = [...new Set((day.rawLines || []).map(normalizeMenuTextLine).filter(Boolean))]
    .slice(0, 45);
  return day;
};

const detectMenuYearMonth = (text, selectedYear, selectedMonth) => {
  const clean = String(text || '').replace(/\s+/g, ' ');
  let match = /(20\d{2})\s*년?\s*(\d{1,2})\s*월/.exec(clean);
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  match = /(20\d{2})[-./](\d{1,2})/.exec(clean);
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  return { year: Number(selectedYear), month: Number(selectedMonth) };
};

const parseMenuOCRText = ({ text, selectedYear, selectedMonth }) => {
  const detected = detectMenuYearMonth(text, selectedYear, selectedMonth);
  const year = Number(selectedYear || detected.year);
  const month = Number(selectedMonth || detected.month);
  const monthKey = menuMonthKey(year, month);
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(normalizeMenuTextLine)
    .filter(Boolean);

  const days = {};
  let currentDate = null;
  let lastDay = 0;

  const ensureDay = (day) => {
    if (!day || day < 1 || day > 31) return null;
    const date = `${monthKey}-${pad2(day)}`;
    if (!parseISODate(date)) return null;
    if (!days[date]) days[date] = { date, menu: [], origins: [], rawLines: [] };
    currentDate = date;
    lastDay = day;
    return date;
  };

  for (const line of lines) {
    const compact = line.replace(/\s/g, '');
    const fullDateMatch = /(\d{1,2})월(\d{1,2})일/.exec(compact);
    if (fullDateMatch) {
      ensureDay(Number(fullDateMatch[2]));
      continue;
    }

    let dayMatch = /^(\d{1,2})일/.exec(compact);
    if (!dayMatch) dayMatch = /(?:^|\D)(\d{1,2})일(?:\D|$)/.exec(compact);
    if (dayMatch) {
      const day = Number(dayMatch[1]);
      if (day >= 1 && day <= 31 && day !== lastDay) ensureDay(day);
      const rest = normalizeMenuTextLine(line.replace(/.*?\d{1,2}\s*일/, ''));
      if (!rest || isNoiseMenuLine(rest)) continue;
      if (currentDate) pushMenuCandidate(days[currentDate], rest);
      continue;
    }

    if (!currentDate) continue;
    if (isNoiseMenuLine(line)) continue;
    pushMenuCandidate(days[currentDate], line);
  }

  // 같은 줄이 반복 인식되는 경우 정리
  Object.values(days).forEach(finalizeParsedMenuDay);

  return {
    year,
    month,
    detectedYear: detected.year,
    detectedMonth: detected.month,
    monthMismatch: Boolean(detected.year && detected.month && (detected.year !== year || detected.month !== month)),
    days
  };
};

const getMonthWeekdayIndex = (year, month) => {
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, 1)).getUTCDay();
  return weekday === 0 ? 6 : weekday - 1; // 월=0, 화=1, ... 금=4, 토=5, 일=6
};

const getLastDayOfMonth = (year, month) => new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();

const normalizeOCRToken = (value) => normalizeMenuTextLine(value)
  .replace(/[|＿_~`^·•●□■◆◇○◎△▲▽▼※=+]+/g, '')
  .replace(/^[\[\]{}()0-9A-Za-z:;,.\-\s]+$/g, '')
  .trim();

const mergeOCRTokens = (tokens) => normalizeMenuTextLine(
  tokens
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .join('')
    .replace(/\s+/g, '')
);

const hasHangul = (value) => /[가-힣]/.test(String(value || ''));

const extractWordsFromTesseract = (data) => {
  const words = Array.isArray(data?.words) ? data.words : [];
  return words.map(word => {
    const bbox = word.bbox || {};
    const x0 = Number(bbox.x0 ?? word.x0 ?? word.left ?? 0);
    const y0 = Number(bbox.y0 ?? word.y0 ?? word.top ?? 0);
    const x1 = Number(bbox.x1 ?? word.x1 ?? (word.left != null && word.width != null ? Number(word.left) + Number(word.width) : x0));
    const y1 = Number(bbox.y1 ?? word.y1 ?? (word.top != null && word.height != null ? Number(word.top) + Number(word.height) : y0));
    const text = normalizeOCRToken(word.text || word.symbol || '');
    const confidence = Number(word.confidence ?? word.conf ?? 0);
    return { text, x0, y0, x1, y1, confidence };
  }).filter(word => word.text && Number.isFinite(word.x0) && Number.isFinite(word.y0) && word.x1 > word.x0 && word.y1 > word.y0 && (word.confidence >= 0 || hasHangul(word.text)));
};

const groupWordsIntoRows = (words, tolerance = 18) => {
  const rows = [];
  words
    .slice()
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
    .forEach(word => {
      const centerY = (word.y0 + word.y1) / 2;
      const last = rows[rows.length - 1];
      if (!last || Math.abs(centerY - last.centerY) > tolerance) {
        rows.push({ minY: word.y0, maxY: word.y1, centerY, words: [word] });
      } else {
        last.minY = Math.min(last.minY, word.y0);
        last.maxY = Math.max(last.maxY, word.y1);
        last.centerY = (last.centerY * last.words.length + centerY) / (last.words.length + 1);
        last.words.push(word);
      }
    });
  return rows;
};

const getQuantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
};

const findMenuWeekBands = (rows) => {
  const contentRows = rows
    .filter(row => row.maxY > 45)
    .filter(row => hasHangul(row.words.map(w => w.text).join('')))
    .filter(row => !/화성|오산|교육청|식단표|FOOD|MENU|메뉴와/.test(mergeOCRTokens(row.words.map(w => w.text))));

  const bands = [];
  contentRows.forEach(row => {
    const last = bands[bands.length - 1];
    if (!last || row.minY - last.lastY > 70) {
      bands.push({ minY: row.minY, maxY: row.maxY, lastY: row.maxY, rows: [row] });
    } else {
      last.minY = Math.min(last.minY, row.minY);
      last.maxY = Math.max(last.maxY, row.maxY);
      last.lastY = row.maxY;
      last.rows.push(row);
    }
  });

  return bands
    .filter(band => band.rows.length >= 3)
    .slice(0, 6);
};

const isMenuFooterRow = (row) => {
  const compact = mergeOCRTokens(row.words.map(w => w.text));
  return /(계절|식자재|수급|부득이|변경|백미밥쌀|흑미밥|현미밥|볶음김치|포기김치배추|고춧가루|사골농축|원산지는|메뉴와원산지)/.test(compact);
};

const buildCalendarWeekBands = (rows, firstVisibleMondayDay, lastDay) => {
  const weekCount = Math.max(1, Math.min(6, Math.ceil((lastDay - firstVisibleMondayDay + 1) / 7)));
  const contentRows = rows
    .filter(row => row.maxY > 45)
    .filter(row => hasHangul(row.words.map(w => w.text).join('')))
    .filter(row => !isMenuFooterRow(row))
    .filter(row => !/화성|오산|교육청|식단표|FOOD|MENU|메뉴와/.test(mergeOCRTokens(row.words.map(w => w.text))));

  if (contentRows.length < weekCount * 3) return [];

  const yMin = contentRows[0].minY;
  const centerCut = getQuantile(contentRows.map(row => row.centerY), 0.95) + 30;
  const trimmedRows = contentRows.filter(row => row.centerY <= centerCut);
  const yMax = trimmedRows[trimmedRows.length - 1].maxY;
  const bandHeight = Math.max(1, (yMax - yMin + 1) / weekCount);

  return Array.from({ length: weekCount }, (_, idx) => {
    const minY = yMin + idx * bandHeight;
    const maxY = idx === weekCount - 1 ? yMax + 1 : yMin + (idx + 1) * bandHeight;
    const bandRows = trimmedRows.filter(row => row.centerY >= minY && row.centerY < maxY);
    return {
      minY: bandRows.length ? Math.min(...bandRows.map(r => r.minY)) : minY,
      maxY: bandRows.length ? Math.max(...bandRows.map(r => r.maxY)) : maxY,
      rows: bandRows
    };
  }).filter(band => band.rows.length >= 3);
};

const getCellColumn = (word, xStart, colWidth) => {
  const centerX = (word.x0 + word.x1) / 2;
  const col = Math.floor((centerX - xStart) / colWidth);
  return col >= 0 && col < 5 ? col : -1;
};

const parseMenuOCRLayout = ({ words, selectedYear, selectedMonth }) => {
  const year = Number(selectedYear);
  const month = Number(selectedMonth);
  const monthKey = menuMonthKey(year, month);
  const firstWeekday = getMonthWeekdayIndex(year, month);
  const firstVisibleMondayDay = firstWeekday <= 4 ? 1 - firstWeekday : 8 - firstWeekday;
  const lastDay = getLastDayOfMonth(year, month);

  const cleanWords = (Array.isArray(words) ? words : [])
    .filter(word => hasHangul(word.text))
    .filter(word => word.y0 > 35)
    .filter(word => !/화성|오산|교육청|식단표|FOOD|MENU|요일|메뉴와/.test(word.text));

  if (cleanWords.length < 20) {
    return { year, month, detectedYear: year, detectedMonth: month, monthMismatch: false, days: {} };
  }

  // 식단표는 좌측에 '중식/원산지' 세로 라벨이 있고, 그 오른쪽 5칸이 월~금입니다.
  // OCR이 날짜 헤더를 놓쳐도 5열×주차 구조로 안정적으로 분배합니다.
  const xCandidates = cleanWords
    .filter(w => w.x0 > 35)
    .map(w => w.x0);
  const xStart = Math.max(45, getQuantile(xCandidates, 0.03) - 45);
  const xEnd = Math.max(...cleanWords.map(w => w.x1)) + 10;
  const colWidth = Math.max(1, (xEnd - xStart) / 5);

  const rows = groupWordsIntoRows(cleanWords, 18);
  const calendarBands = buildCalendarWeekBands(rows, firstVisibleMondayDay, lastDay);
  const bands = calendarBands.length ? calendarBands : findMenuWeekBands(rows);
  const days = {};

  bands.forEach((band, weekIndex) => {
    const bandHeight = Math.max(1, band.maxY - band.minY);
    // 굵은 대표 메뉴가 주차 블록의 첫 OCR 행으로 잡히는 경우가 많아서 상단 컷을 거의 두지 않습니다.
    // 대신 날짜/요일/공휴일/이벤트 문구는 cleanMenuCandidate 쪽에서 제거합니다.
    const menuTop = band.minY - 2;
    // 원산지 행은 보통 각 주차 블록의 하단 20~25%에 배치됩니다. 조금 넉넉하게 잡아 누락을 줄입니다.
    const originTop = band.minY + bandHeight * 0.74;

    band.rows.forEach(row => {
      if (row.maxY < menuTop) return;
      const section = row.minY >= originTop ? 'origin' : 'menu';
      const cellWords = [[], [], [], [], []];

      row.words.forEach(word => {
        const col = getCellColumn(word, xStart, colWidth);
        if (col >= 0) cellWords[col].push(word);
      });

      cellWords.forEach((wordsInCell, col) => {
        if (!wordsInCell.length) return;
        const dayNumber = firstVisibleMondayDay + (weekIndex * 7) + col;
        if (dayNumber < 1 || dayNumber > lastDay) return;

        const date = `${monthKey}-${pad2(dayNumber)}`;
        if (!parseISODate(date) || isWeekendDateStr(date)) return;
        if (!days[date]) days[date] = { date, menu: [], origins: [], rawLines: [] };

        const sortedWords = wordsInCell.slice().sort((a, b) => a.x0 - b.x0);
        const text = mergeOCRTokens(sortedWords.map(w => w.text));
        if (!text) return;
        if (isHolidayLine(text)) {
          days[date].rawLines.push(normalizeMenuTextLine(text));
          return;
        }

        const isOriginSection = section === 'origin' || isOriginLine(text) || extractOriginSourcesDetailed(text).length > 0;
        if (isOriginSection) {
          days[date].rawLines.push(normalizeMenuTextLine(text));
          const cellLeft = xStart + col * colWidth;
          const midX = cellLeft + colWidth * 0.50;
          const leftWords = sortedWords.filter(w => ((w.x0 + w.x1) / 2) < midX);
          const rightWords = sortedWords.filter(w => ((w.x0 + w.x1) / 2) >= midX);
          const leftText = mergeOCRTokens(leftWords.map(w => w.text));
          const rightText = mergeOCRTokens(rightWords.map(w => w.text));

          if (leftText && rightText) {
            pushOriginPairCandidate(days[date], leftText, rightText);
          } else {
            pushOriginCandidate(days[date], text);
          }
          return;
        }

        if (isNoiseMenuLine(text)) return;

        pushMenuCandidate(days[date], text, section);
      });
    });
  });

  Object.values(days).forEach(finalizeParsedMenuDay);

  return { year, month, detectedYear: year, detectedMonth: month, monthMismatch: false, days };
};

const scoreMenuParse = (parsed) => {
  const days = Object.values(parsed?.days || {});
  const dayCount = days.length;
  const menuCount = days.reduce((sum, day) => sum + (Array.isArray(day.menu) ? day.menu.length : 0), 0);
  const badCount = days.reduce((sum, day) => sum + (day.menu || []).filter(line => isNoiseMenuLine(line) || isHolidayLine(line) || isMenuEventLine(line) || isOriginLine(line)).length, 0);
  return dayCount * 12 + menuCount - badCount * 8;
};

const chooseBestMenuParse = (textParsed, layoutParsed) => {
  const layoutScore = scoreMenuParse(layoutParsed);
  const textScore = scoreMenuParse(textParsed);
  if (Object.keys(layoutParsed?.days || {}).length >= 5 && layoutScore >= textScore * 0.65) return layoutParsed;
  return textScore >= layoutScore ? textParsed : layoutParsed;
};

const mergeMenuParses = (textParsed, layoutParsed) => {
  const base = chooseBestMenuParse(textParsed, layoutParsed) || {};
  const merged = {
    year: base.year || textParsed?.year || layoutParsed?.year,
    month: base.month || textParsed?.month || layoutParsed?.month,
    detectedYear: base.detectedYear || textParsed?.detectedYear || layoutParsed?.detectedYear,
    detectedMonth: base.detectedMonth || textParsed?.detectedMonth || layoutParsed?.detectedMonth,
    monthMismatch: Boolean(base.monthMismatch || textParsed?.monthMismatch || layoutParsed?.monthMismatch),
    days: {}
  };

  const sourceDays = [textParsed?.days || {}, layoutParsed?.days || {}];
  sourceDays.forEach(days => {
    Object.entries(days).forEach(([date, day]) => {
      if (!merged.days[date]) merged.days[date] = { date, menu: [], origins: [], rawLines: [] };
      const target = merged.days[date];
      target.menu.push(...(Array.isArray(day?.menu) ? day.menu : []));
      target.origins.push(...(Array.isArray(day?.origins) ? day.origins : []));
      target.rawLines.push(...(Array.isArray(day?.rawLines) ? day.rawLines : []));
      if (day?.holidayName && !target.holidayName) target.holidayName = day.holidayName;
    });
  });

  Object.values(merged.days).forEach(finalizeParsedMenuDay);
  return merged;
};

const runMenuOCR = async (buffer) => {
  try {
    const { recognize } = require('tesseract.js');
    const lang = process.env.OCR_LANG || 'kor+eng';
    const result = await recognize(buffer, lang, {
      logger: () => {},
      tessedit_pageseg_mode: '4',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    return {
      text: result?.data?.text || '',
      words: extractWordsFromTesseract(result?.data),
      engine: `tesseract.js:${lang}:psm4`
    };
  } catch (e) {
    return { text: '', words: [], engine: 'unavailable', error: e.message };
  }
};

const sanitizeMenuMonthForClient = (monthData) => {
  if (!monthData) return null;
  const days = {};
  Object.entries(monthData.days || {}).forEach(([date, day]) => {
    days[date] = {
      date,
      menu: Array.isArray(day.menu) ? day.menu.map(normalizeMenuTextLine).filter(Boolean) : [],
      origins: Array.isArray(day.origins) ? day.origins.map(normalizeMenuTextLine).filter(Boolean) : [],
      holidayName: day.holidayName ? normalizeMenuTextLine(day.holidayName) : null
    };
  });
  return {
    year: monthData.year,
    month: monthData.month,
    yearMonth: monthData.yearMonth,
    updatedAt: monthData.updatedAt,
    ocrEngine: monthData.ocrEngine,
    ocrError: monthData.ocrError || null,
    days
  };
};

app.post('/api/admin/menu/upload-image', requireAdmin, (req, res) => {
  if (!menuImageUploadMiddleware) {
    return res.status(500).json({ message: '이미지 업로드 기능을 사용하려면 multer 패키지를 설치해야 합니다.', detail: uploadDependencyError && uploadDependencyError.message });
  }

  menuImageUploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || '이미지 업로드 실패' });

    const year = Number(req.body.year);
    const month = Number(req.body.month);
    if (!year || month < 1 || month > 12) return res.status(400).json({ message: '식단 연도와 월을 올바르게 선택해 주세요.' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ message: '식단표 이미지 파일을 업로드해 주세요.' });

    const ocr = await runMenuOCR(req.file.buffer);
    const parsedByText = parseMenuOCRText({ text: ocr.text, selectedYear: year, selectedMonth: month });
    const parsedByLayout = parseMenuOCRLayout({ words: ocr.words, selectedYear: year, selectedMonth: month });
    const parsed = mergeMenuParses(parsedByText, parsedByLayout);
    const holidayMap = await fetchKoreanHolidayMap(year);
    applyHolidayOverrides(parsed, holidayMap);
    const confirmMismatch = String(req.body.confirmMismatch || '').toLowerCase() === 'true';

    if (parsed.monthMismatch && !confirmMismatch) {
      return res.status(409).json({
        code: 'MONTH_MISMATCH',
        message: '식단표 이미지에서 인식한 연도/월이 선택한 기간과 다릅니다.',
        summary: {
          monthMismatch: true,
          detectedYear: parsed.detectedYear,
          detectedMonth: parsed.detectedMonth,
          selectedYear: year,
          selectedMonth: month,
          extractedDays: Object.keys(parsed.days || {}).length,
          ocrEngine: ocr.engine,
          ocrError: ocr.error || null
        }
      });
    }

    const extMatch = /\.(png|jpe?g|webp)$/i.exec(req.file.originalname || '');
    const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
    const safeName = `${year}-${pad2(month)}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(menuImageDir, safeName), req.file.buffer);

    const yearMonth = menuMonthKey(year, month);
    const monthData = {
      year,
      month,
      yearMonth,
      imageFile: safeName,
      updatedAt: new Date().toISOString(),
      uploadedBy: req.adminEmail,
      ocrEngine: ocr.engine,
      ocrError: ocr.error || null,
      detectedYear: parsed.detectedYear,
      detectedMonth: parsed.detectedMonth,
      monthMismatch: parsed.monthMismatch,
      rawText: String(ocr.text || '').slice(0, 50000),
      days: parsed.days
    };

    if (!menus.months) menus.months = {};
    menus.months[yearMonth] = monthData;
    saveMenus();

    res.json({
      message: ocr.error ? '이미지는 저장했지만 OCR 엔진을 사용할 수 없어 식단 자동 추출은 완료되지 않았습니다.' : '식단표 이미지 분석 완료',
      month: sanitizeMenuMonthForClient(monthData),
      summary: {
        extractedDays: Object.keys(monthData.days || {}).length,
        monthMismatch: monthData.monthMismatch,
        detectedYear: monthData.detectedYear,
        detectedMonth: monthData.detectedMonth,
        ocrEngine: monthData.ocrEngine,
        ocrError: monthData.ocrError,
        layoutWords: Array.isArray(ocr.words) ? ocr.words.length : 0
      }
    });
  });
});

app.get('/api/admin/menu/month/:yearMonth', requireAdmin, async (req, res) => {
  const yearMonth = String(req.params.yearMonth || '');
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return res.status(400).json({ message: '월 형식은 YYYY-MM이어야 합니다.' });
  const monthData = await enrichMenuMonthWithHolidays(menus.months?.[yearMonth], yearMonth);
  res.json(sanitizeMenuMonthForClient(monthData) || { yearMonth, days: {} });
});

app.get('/api/menu/month/:yearMonth', async (req, res) => {
  const yearMonth = String(req.params.yearMonth || '');
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return res.status(400).json({ message: '월 형식은 YYYY-MM이어야 합니다.' });
  res.setHeader('Cache-Control', 'no-store');
  const monthData = await enrichMenuMonthWithHolidays(menus.months?.[yearMonth], yearMonth);
  res.json(sanitizeMenuMonthForClient(monthData) || { yearMonth, days: {} });
});


app.post('/api/admin/menu/day', requireAdmin, async (req, res) => {
  const date = String(req.body.date || '').trim();
  const parsedDate = parseISODate(date);
  if (!parsedDate) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });

  const year = parsedDate.year;
  const month = parsedDate.month;
  const yearMonth = menuMonthKey(year, month);
  const holiday = req.body.holiday === true || String(req.body.holiday || '').toLowerCase() === 'true';
  const holidayName = holiday ? normalizeHolidayName(req.body.holidayName || '공휴일') : null;
  const menu = Array.isArray(req.body.menu) ? req.body.menu : String(req.body.menu || '').split(/\r?\n/);
  const origins = Array.isArray(req.body.origins) ? req.body.origins : String(req.body.origins || '').split(/\r?\n/);

  if (!menus.months) menus.months = {};
  if (!menus.months[yearMonth]) {
    menus.months[yearMonth] = {
      year,
      month,
      yearMonth,
      updatedAt: new Date().toISOString(),
      uploadedBy: req.adminEmail,
      ocrEngine: 'manual',
      ocrError: null,
      days: {}
    };
  }

  const monthData = menus.months[yearMonth];
  if (!monthData.days) monthData.days = {};

  const day = {
    date,
    menu: holiday ? ['공휴일'] : menu.map(cleanMenuCandidate).filter(Boolean),
    origins: holiday ? [] : origins.map(cleanOriginCandidate).filter(Boolean),
    rawLines: []
  };
  if (holiday) day.holidayName = holidayName;
  finalizeParsedMenuDay(day);
  monthData.days[date] = day;
  monthData.updatedAt = new Date().toISOString();
  monthData.uploadedBy = req.adminEmail;
  monthData.ocrEngine = monthData.ocrEngine || 'manual';
  saveMenus();

  const enriched = await enrichMenuMonthWithHolidays(monthData, yearMonth);
  res.json({ message: '해당 날짜 식단을 저장했습니다.', month: sanitizeMenuMonthForClient(enriched), day: sanitizeMenuMonthForClient({ days: { [date]: day } }).days[date] });
});

app.delete('/api/admin/menu/day/:date', requireAdmin, async (req, res) => {
  const date = String(req.params.date || '').trim();
  const parsedDate = parseISODate(date);
  if (!parsedDate) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });
  const yearMonth = menuMonthKey(parsedDate.year, parsedDate.month);
  const monthData = menus.months?.[yearMonth];
  if (!monthData?.days?.[date]) return res.status(404).json({ message: '해당 날짜 식단이 없습니다.' });
  delete monthData.days[date];
  monthData.updatedAt = new Date().toISOString();
  monthData.uploadedBy = req.adminEmail;
  saveMenus();
  const enriched = await enrichMenuMonthWithHolidays(monthData, yearMonth);
  res.json({ message: '해당 날짜 식단을 삭제했습니다.', month: sanitizeMenuMonthForClient(enriched) });
});

// ==========================================
// QR 발급 / 스캔 / 조회 API
// ==========================================
app.post('/api/qr/generate', (req, res) => {
  const cleaned = ensureValidUserPayload(req.body);
  if (cleaned.error) return res.status(400).json({ message: cleaned.error });

  const todayStr = getKSTDateStr();
  if (isWeekendDateStr(todayStr)) return res.status(403).json({ message: '오늘은 주말입니다. 점심 체크를 운영하지 않습니다.' });

  cleanupExpiredUsers();
  const candidates = allowedUsers.filter(u => u.name === cleaned.name && u.phoneLast4 === cleaned.phoneLast4);
  if (candidates.length === 0) return res.status(403).json({ message: '미등록 사용자입니다. 이름과 전화번호 뒷자리를 확인해 주세요.' });

  const user = candidates.find(u => isUserValidOnDate(u, todayStr));
  if (!user) {
    const monthly = candidates.find(u => u.mealType === 'monthly');
    const daily = candidates.find(u => u.mealType === 'daily');
    if (daily && daily.validDates && !daily.validDates.includes(todayStr)) return res.status(403).json({ message: `오늘(${todayStr.slice(5)})은 식사하도록 지정된 날짜가 아닙니다.` });
    if (monthly && todayStr < monthly.startDate) return res.status(403).json({ message: `이용 시작일은 ${monthly.startDate}부터입니다.` });
    if (monthly && monthly.endDate < todayStr) return res.status(403).json({ message: `이용 기간이 만료되었습니다. (마감: ${monthly.endDate})` });
    return res.status(403).json({ message: '오늘 이용 가능한 명단이 없습니다.' });
  }

  if (!db.days[todayStr]) db.days[todayStr] = [];
  let diner = db.days[todayStr].find(d => d.name === cleaned.name && d.phoneLast4 === cleaned.phoneLast4);
  const qrToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + QR_EXPIRES_MS;

  if (!diner) {
    db.days[todayStr].push({
      phoneLast4: cleaned.phoneLast4,
      name: cleaned.name,
      mealType: user.mealType,
      qrToken,
      tokenExpiresAt: expiresAt,
      qrMode: 'temporary',
      attended: false,
      scannedAt: null
    });
  } else {
    if (diner.attended) return res.status(409).json({ message: '오늘 이미 식사를 완료했습니다.', code: 'ALREADY_ATTENDED' });
    diner.qrToken = qrToken;
    diner.tokenExpiresAt = expiresAt;
    diner.qrMode = 'temporary';
    diner.mealType = user.mealType;
  }

  saveDB();
  res.json({
    qrData: qrToken,
    expiresAt,
    alreadyAttended: Boolean(diner && diner.attended),
    expiresInMinutes: QR_EXPIRES_MINUTES,
    eventId: todayStr
  });
});

app.post('/api/qr/scan', (req, res) => {
  const qrToken = String(req.body.qrToken || '').trim();
  if (!qrToken || qrToken.length > 220) return res.status(400).json({ message: 'QR 데이터가 올바르지 않습니다.', code: 'BAD_QR' });

  if (/^LC-PERM-v1\./.test(qrToken)) {
    return res.status(410).json({ message: '영구 QR은 더 이상 지원하지 않습니다. QR을 다시 발급해 주세요.', code: 'PERMANENT_QR_DISABLED' });
  }

  const today = getKSTDateStr();
  const diners = db.days[today] || [];
  const diner = diners.find(d => d.qrToken === qrToken);

  if (!diner) return res.status(410).json({ message: '유효하지 않거나 만료된 QR입니다.', code: 'INVALID_OR_EXPIRED' });
  if (diner.tokenExpiresAt < Date.now()) return res.status(410).json({ message: '유효하지 않거나 만료된 QR입니다.', code: 'INVALID_OR_EXPIRED' });
  if (diner.attended) return res.status(409).json({ message: '이미 처리된 QR입니다.', code: 'DUPLICATE', name: diner.name });

  diner.attended = true;
  diner.scannedAt = new Date().toISOString();
  saveDB();
  res.json({ message: 'success', name: diner.name });
});

app.get('/api/scanner/attendees/:date', (req, res) => {
  const date = req.params.date;
  if (!parseISODate(date)) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });
  const diners = (db.days[date] || [])
    .filter(d => d.attended)
    .map(sanitizeDinerForScanner);
  res.json(diners);
});

// 옛 공개 조회 API는 토큰/미식사자 노출을 막기 위해 참석 완료자만 반환.
app.get('/api/events/:date/attendees', (req, res) => {
  const date = req.params.date;
  if (!parseISODate(date)) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });
  const diners = (db.days[date] || [])
    .filter(d => d.attended)
    .map(sanitizeDinerForScanner);
  res.json(diners);
});

app.get('/api/admin/events/:date/attendees', requireAdmin, (req, res) => {
  const date = req.params.date;
  if (!parseISODate(date)) return res.status(400).json({ message: '날짜 형식이 올바르지 않습니다.' });
  const diners = (db.days[date] || [])
    .filter(d => d.attended)
    .map(d => sanitizeDinerForAdmin({ ...d, date }));
  res.json(diners);
});

app.get('/api/admin/events/month/:yearMonth', requireAdmin, (req, res) => {
  const yearMonth = String(req.params.yearMonth || '');
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return res.status(400).json({ message: '월 형식은 YYYY-MM이어야 합니다.' });

  let result = [];
  Object.keys(db.days).filter(date => date.startsWith(yearMonth)).sort().forEach(date => {
    result = result.concat((db.days[date] || [])
      .filter(d => d.attended)
      .map(d => sanitizeDinerForAdmin({ ...d, date })));
  });
  res.json(result);
});

app.use((req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

app.listen(port, () => console.log(`🚀 Lunch Server Running on Port: ${port}`));
