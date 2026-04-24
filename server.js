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

// 🌟 마감일 + 5일 경과 유저 자동 삭제 로직
const cleanupExpiredUsers = () => {
  const todayStr = getKSTDateStr();
  let changed = false;
  
  allowedUsers = allowedUsers.filter(u => {
    const endDate = new Date(u.endDate + "T12:00:00");
    const deleteDate = new Date(endDate);
    deleteDate.setDate(deleteDate.getDate() + 5); 
    const deleteDateStr = getKSTDateStr(deleteDate);
    
    if (todayStr >= deleteDateStr) {
      changed = true; return false;
    }
    return true; 
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
  cleanupExpiredUsers(); 
};

loadFiles();

// ==========================================
// 🔐 권한 분리 인증 로직 (.env 연동)
// ==========================================
const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
const superAdminEmails = process.env.SUPER_ADMIN_EMAILS ? process.env.SUPER_ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
let authCodes = {};

const transporter = nodemailer.createTransport({
  service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const handleAuthRequest = async (req, res, allowedList, roleName) => {
  const { email } = req.body;
  if (!allowedList.includes(email)) return res.status(403).json({ message: `등록되지 않은 ${roleName} 이메일입니다.` });
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

app.post('/api/admin/request-code', (req, res) => handleAuthRequest(req, res, adminEmails, '스캐너 관리자'));
app.post('/api/admin/verify-code', handleAuthVerify);
app.post('/api/superadmin/request-code', (req, res) => handleAuthRequest(req, res, superAdminEmails, '최고 관리자'));
app.post('/api/superadmin/verify-code', handleAuthVerify);

// ==========================================
// 👥 명단 관리 API (🌟 다중 날짜 로직 적용)
// ==========================================
app.get('/api/admin/allowed-users', (req, res) => {
  cleanupExpiredUsers();
  res.json(allowedUsers);
});

app.post('/api/admin/allowed-users', (req, res) => {
  const { orgRole, name, mealType, targetDates } = req.body;
  
  if (allowedUsers.some(u => u.name === name && u.orgRole === orgRole && u.mealType === mealType && u.endDate >= getKSTDateStr())) {
    return res.status(409).json({ message: '이미 유효한 명단에 등록된 사용자입니다.' });
  }

  let startDate, endDate, validDates = null;

  if (mealType === 'daily') {
    if (!targetDates || targetDates.length === 0) return res.status(400).json({ message: '날짜를 하나 이상 지정하세요.' });
    targetDates.sort();
    validDates = targetDates;          // 🌟 지정된 여러 날짜들 저장
    startDate = targetDates[0];        // 가장 빠른 날 (시작일)
    endDate = targetDates[targetDates.length - 1]; // 가장 늦은 날 (마감일, 삭제 기준)
  } else {
    startDate = getKSTDateStr(); 
    endDate = calculateMonthlyEndDate(new Date());
  }

  allowedUsers.push({ orgRole, name, mealType, startDate, endDate, validDates, createdAt: new Date().toISOString() });
  saveUserList(); res.json({ message: '등록 성공' });
});

// 🌟 일식 전용 날짜 변경 API
app.post('/api/admin/allowed-users/update-dates', (req, res) => {
  const { index, targetDates } = req.body;
  const user = allowedUsers[index];
  
  if (user && user.mealType === 'daily' && targetDates && targetDates.length > 0) {
    targetDates.sort();
    user.validDates = targetDates;
    user.startDate = targetDates[0];
    user.endDate = targetDates[targetDates.length - 1]; // 새로운 삭제 기준일 자동 갱신
    saveUserList();
    res.json({ message: '날짜가 성공적으로 변경되었습니다.' });
  } else {
    res.status(400).json({ message: '잘못된 요청이거나 날짜가 비어있습니다.' });
  }
});

// 기존 월식 연장/단축 API
app.post('/api/admin/allowed-users/update-period', (req, res) => {
  const { indexes, action, type } = req.body;
  if (type === 'daily') return res.status(400).json({ message: '일식은 개별 날짜 변경 버튼을 이용해 주세요.' });

  const thisMonthEnd = calculateMonthlyEndDate(new Date());
  let errorMsg = null;

  indexes.forEach(idx => {
    const user = allowedUsers[idx];
    if (user) {
      const currentEnd = new Date(user.endDate + "T12:00:00");
      if (action === 'extend') {
        const nextMonthFirst = new Date(currentEnd.getFullYear(), currentEnd.getMonth() + 1, 1);
        user.endDate = calculateMonthlyEndDate(nextMonthFirst);
      } else if (action === 'shorten') {
        if (user.endDate <= thisMonthEnd) errorMsg = "단축 오류: 월식은 이번 달까지만 단축할 수 있습니다.";
        else {
          const shortenBase = new Date(currentEnd);
          shortenBase.setDate(0); 
          user.endDate = getKSTDateStr(shortenBase);
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
// 🍱 식사 기록 및 QR 인증 로직 (🌟 다중 날짜 검증)
// ==========================================
app.post('/api/qr/generate', (req, res) => {
  const { eventId: date, orgRole, name } = req.body;
  const todayStr = getKSTDateStr();

  const user = allowedUsers.find(u => u.name === name && u.orgRole === orgRole);
  if (!user) return res.status(403).json({ message: '미등록 사용자입니다.' });
  
  // 🌟 일식일 경우: 정확히 지정된 날짜 목록(validDates)에 오늘이 있는지 검사
  if (user.mealType === 'daily') {
    if (user.validDates && !user.validDates.includes(todayStr)) {
      return res.status(403).json({ message: `오늘(${todayStr.slice(5)})은 식사하도록 지정된 날짜가 아닙니다.` });
    }
  } else {
    // 월식일 경우: 기간으로 검사
    if (todayStr < user.startDate) return res.status(403).json({ message: `이용 시작일은 ${user.startDate} 부터입니다.` });
    if (user.endDate < todayStr) return res.status(403).json({ message: `이용 기간이 만료되었습니다. (마감: ${user.endDate})` });
  }

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