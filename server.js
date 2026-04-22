// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// 💾 데이터베이스 초기화 및 자동 삭제 로직
// ==========================================
const dbPath = path.join(__dirname, 'data.json');
const userListPath = path.join(__dirname, 'allowed_users.json');

let db = { days: {} };
let allowedUsers = [];

const getKSTDateStr = (date = new Date()) => {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replace(/\. /g, '-').replace(/\./g, '');
};

const calculateMonthlyEndDate = (baseDate = new Date()) => {
  const d = new Date(baseDate);
  return getKSTDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
const saveUserList = () => fs.writeFileSync(userListPath, JSON.stringify(allowedUsers, null, 2), 'utf-8');

// 🌟 [핵심] 마감일 + 5일 경과 유저 자동 삭제 로직
const cleanupExpiredUsers = () => {
  const todayStr = getKSTDateStr();
  let changed = false;
  
  allowedUsers = allowedUsers.filter(u => {
    const endDate = new Date(u.endDate + "T12:00:00");
    const deleteDate = new Date(endDate);
    deleteDate.setDate(deleteDate.getDate() + 5); // 마감일 + 5일
    const deleteDateStr = getKSTDateStr(deleteDate);
    
    if (todayStr >= deleteDateStr) {
      changed = true;
      return false; // 배열에서 제거 (삭제)
    }
    return true; // 유지
  });
  if (changed) saveUserList();
};

const loadFiles = () => {
  if (fs.existsSync(dbPath)) {
    try { db = JSON.parse(fs.readFileSync(dbPath, 'utf-8')).days ? JSON.parse(fs.readFileSync(dbPath, 'utf-8')) : { days: {} }; } catch (e) { db = { days: {} }; }
  }
  if (fs.existsSync(userListPath)) {
    try {
      allowedUsers = JSON.parse(fs.readFileSync(userListPath, 'utf-8'));
      const today = getKSTDateStr();
      allowedUsers.forEach(u => { if (!u.startDate) u.startDate = u.createdAt ? u.createdAt.split('T')[0] : today; });
    } catch (e) { allowedUsers = []; }
  }
  cleanupExpiredUsers(); // 서버 시작 시 자동 청소
};

loadFiles();

// ==========================================
// 🔐 권한 분리 인증 로직 (.env 연동)
// ==========================================
const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
const superAdminEmails = process.env.SUPER_ADMIN_EMAILS ? process.env.SUPER_ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
let authCodes = {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// 공통 인증번호 발송/검증 로직
const handleAuthRequest = async (req, res, allowedList, roleName) => {
  const { email } = req.body;
  if (!allowedList.includes(email)) return res.status(403).json({ message: `등록된 ${roleName} 이메일이 아닙니다.` });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  authCodes[email] = { code, expires: Date.now() + 300000, attempts: 0 };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: email,
      subject: `[화성오산교육청] ${roleName} 보안 인증번호`, text: `인증번호: [${code}]`
    });
    res.json({ message: '인증 메일이 발송되었습니다.' });
  } catch (e) { res.status(500).json({ message: '메일 발송 실패' }); }
};

const handleAuthVerify = (req, res) => {
  const { email, code } = req.body;
  const auth = authCodes[email];
  if (!auth) return res.status(401).json({ message: '인증 요청 내역이 없습니다.', action: 'reset' });
  if (auth.code === code && auth.expires > Date.now()) {
    delete authCodes[email]; res.json({ message: '인증 성공' });
  } else {
    auth.attempts++;
    if (auth.attempts >= 3) { delete authCodes[email]; res.status(401).json({ message: '3회 오류로 만료', action: 'reset' }); }
    else res.status(401).json({ message: `번호가 틀렸습니다. (${auth.attempts}/3)` });
  }
};

// 1. 일반 스캐너 관리자 (ADMIN_EMAILS)
app.post('/api/admin/request-code', (req, res) => handleAuthRequest(req, res, adminEmails, '스캐너 관리자'));
app.post('/api/admin/verify-code', handleAuthVerify);

// 2. 최고 명단 관리자 (SUPER_ADMIN_EMAILS)
app.post('/api/superadmin/request-code', (req, res) => handleAuthRequest(req, res, superAdminEmails, '최고 관리자'));
app.post('/api/superadmin/verify-code', handleAuthVerify);


// ==========================================
// 👥 명단 관리 API
// ==========================================
app.get('/api/admin/allowed-users', (req, res) => {
  cleanupExpiredUsers(); // 명단 조회 시에도 만료 유저 정리
  res.json(allowedUsers);
});

app.post('/api/admin/allowed-users', (req, res) => {
  const { orgRole, name, mealType, targetDate } = req.body;
  if (allowedUsers.some(u => u.name === name && u.orgRole === orgRole && u.mealType === mealType && u.endDate >= getKSTDateStr())) {
    return res.status(409).json({ message: '이미 유효한 명단에 등록된 사용자입니다.' });
  }
  let startDate, endDate;
  if (mealType === 'daily') {
    startDate = targetDate; endDate = targetDate;
  } else {
    startDate = getKSTDateStr(); endDate = calculateMonthlyEndDate(new Date());
  }
  allowedUsers.push({ orgRole, name, mealType, startDate, endDate, createdAt: new Date().toISOString() });
  saveUserList(); res.json({ message: '등록 성공' });
});

app.post('/api/admin/allowed-users/update-period', (req, res) => {
  const { indexes, action, type } = req.body;
  const todayStr = getKSTDateStr();
  const thisMonthEnd = calculateMonthlyEndDate(new Date());
  let errorMsg = null;

  indexes.forEach(idx => {
    const user = allowedUsers[idx];
    if (user) {
      const currentEnd = new Date(user.endDate + "T12:00:00");
      if (action === 'extend') {
        const base = currentEnd < new Date() ? new Date() : currentEnd;
        if (type === 'daily') {
          base.setDate(base.getDate() + 1); user.endDate = getKSTDateStr(base);
        } else {
          const nextMonthFirst = new Date(base.getFullYear(), base.getMonth() + 1, 1);
          user.endDate = calculateMonthlyEndDate(nextMonthFirst);
        }
      } else if (action === 'shorten') {
        if (type === 'daily') {
          const shortenBase = new Date(currentEnd);
          shortenBase.setDate(shortenBase.getDate() - 1);
          const resultDate = getKSTDateStr(shortenBase);
          const minAllowedDate = user.startDate > todayStr ? user.startDate : todayStr;
          if (resultDate < minAllowedDate) errorMsg = `단축 오류: 시작일(${user.startDate}) 또는 오늘 이전으로 단축할 수 없습니다.`;
          else user.endDate = resultDate;
        } else {
          if (user.endDate <= thisMonthEnd) errorMsg = "단축 오류: 월식은 이번 달까지만 단축할 수 있습니다.";
          else {
            const shortenBase = new Date(currentEnd);
            shortenBase.setDate(0); 
            user.endDate = getKSTDateStr(shortenBase);
          }
        }
      }
    }
  });
  saveUserList();
  if (errorMsg) return res.status(400).json({ message: errorMsg });
  res.json({ message: '기간 업데이트 완료' });
});

app.delete('/api/admin/allowed-users', (req, res) => {
  const { indexes } = req.body;
  allowedUsers = allowedUsers.filter((_, idx) => !indexes.includes(idx));
  saveUserList(); res.json({ message: '삭제 완료' });
});

// ==========================================
// 🍱 식사 기록 및 QR 인증 로직 (기존과 동일)
// ==========================================
app.post('/api/qr/generate', (req, res) => {
  const { eventId: date, orgRole, name } = req.body;
  const todayStr = getKSTDateStr();

  const user = allowedUsers.find(u => u.name === name && u.orgRole === orgRole);
  if (!user) return res.status(403).json({ message: '미등록 사용자입니다.' });
  if (todayStr < user.startDate) return res.status(403).json({ message: `이용 시작일은 ${user.startDate} 부터입니다.` });
  if (user.endDate < todayStr) return res.status(403).json({ message: `이용 기간이 만료되었습니다. (마감: ${user.endDate})` });

  if (!db.days[date]) db.days[date] = [];
  let diner = db.days[date].find(d => d.name === name && d.orgRole === orgRole);
  const qrToken = Math.random().toString(36).substring(2, 15);
  const expiresAt = Date.now() + 180000;

  if (!diner) {
    db.days[date].push({ orgRole, name, qrToken, tokenExpiresAt: expiresAt, attended: false, scannedAt: null });
  } else {
    if (diner.attended) return res.status(409).json({ message: '오늘 이미 식사를 완료했습니다.' });
    diner.qrToken = qrToken; diner.tokenExpiresAt = expiresAt;
  }
  saveDB(); res.json({ qrData: qrToken, expiresAt });
});

app.post('/api/qr/scan', (req, res) => {
  const { qrToken } = req.body;
  const today = getKSTDateStr();
  if (!db.days[today]) return res.status(404).json({ message: '데이터가 없습니다.' });
  
  const diner = db.days[today].find(d => d.qrToken === qrToken);
  if (!diner || diner.tokenExpiresAt < Date.now()) return res.status(410).json({ message: '유효하지 않거나 만료된 QR입니다.' });
  if (diner.attended) return res.status(409).json({ message: '이미 처리된 QR입니다.' });

  diner.attended = true; diner.scannedAt = new Date().toISOString();
  saveDB(); res.json({ message: 'success', name: diner.name, orgRole: diner.orgRole });
});

app.get('/api/events/:date/attendees', (req, res) => res.json(db.days[req.params.date] || []));
app.get('/api/events/month/:yearMonth', (req, res) => {
  const { yearMonth } = req.params; let result = [];
  Object.keys(db.days).filter(d => d.startsWith(yearMonth)).forEach(date => {
    result = result.concat(db.days[date].filter(d => d.attended).map(d => ({ ...d, date })));
  });
  res.json(result);
});

app.listen(port, () => console.log(`🚀 Lunch Server Running on Port: ${port}`));