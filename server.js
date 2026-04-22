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
// 💾 데이터베이스 경로 및 초기화
// ==========================================
const dbPath = path.join(__dirname, 'data.json');
const userListPath = path.join(__dirname, 'allowed_users.json');

let db = { days: {} };
let allowedUsers = [];

const loadFiles = () => {
  if (fs.existsSync(dbPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      db = data.days ? data : { days: {} };
    } catch (e) { db = { days: {} }; }
  }
  if (fs.existsSync(userListPath)) {
    try {
      allowedUsers = JSON.parse(fs.readFileSync(userListPath, 'utf-8'));
    } catch (e) { allowedUsers = []; }
  }
};

const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
const saveUserList = () => fs.writeFileSync(userListPath, JSON.stringify(allowedUsers, null, 2), 'utf-8');

loadFiles();

// ==========================================
// 📅 날짜 계산 유틸리티 (KST 기준 버그 수정)
// ==========================================
const getKSTDateStr = (date = new Date()) => {
  // 서버 환경에 상관없이 한국 시간(KST) 기준 YYYY-MM-DD 반환
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date).replace(/\. /g, '-').replace(/\./g, '');
};

const calculateEndDate = (type, baseDate = new Date()) => {
  const d = new Date(baseDate);
  if (type === 'daily') {
    return getKSTDateStr(d);
  } else if (type === 'monthly') {
    // 해당 월의 마지막 날 계산 (다음 달의 0일)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return getKSTDateStr(lastDay);
  }
};

// ==========================================
// 📧 인증 및 보안 설정
// ==========================================
const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
let authCodes = {};
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'qr.html')));

// 관리자 로그인 API
app.post('/api/admin/request-code', async (req, res) => {
  const { email } = req.body;
  if (!adminEmails.includes(email)) return res.status(403).json({ message: '권한 없음' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  authCodes[email] = { code, expires: Date.now() + 300000, attempts: 0 };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: email,
      subject: '[화성오산교육청] 관리자 인증번호', text: `인증번호: [${code}]`
    });
    res.json({ message: '발송 완료' });
  } catch (e) { res.status(500).json({ message: '메일 발송 실패' }); }
});

app.post('/api/admin/verify-code', (req, res) => {
  const { email, code } = req.body;
  const auth = authCodes[email];
  if (!auth) return res.status(401).json({ message: '요청 없음', action: 'reset' });
  if (auth.code === code && auth.expires > Date.now()) {
    delete authCodes[email]; res.json({ message: '성공' });
  } else {
    auth.attempts++;
    if (auth.attempts >= 3) { delete authCodes[email]; res.status(401).json({ message: '만료', action: 'reset' }); }
    else res.status(401).json({ message: `오류 (${auth.attempts}/3)` });
  }
});

// ==========================================
// 👥 명단 관리 API (일식/월식 지원)
// ==========================================
app.get('/api/admin/allowed-users', (req, res) => res.json(allowedUsers));

app.post('/api/admin/allowed-users', (req, res) => {
  const { orgRole, name, mealType } = req.body;
  if (allowedUsers.some(u => u.name === name && u.orgRole === orgRole)) 
    return res.status(409).json({ message: '중복 등록' });

  allowedUsers.push({
    orgRole, name, mealType,
    endDate: calculateEndDate(mealType),
    createdAt: new Date().toISOString()
  });
  saveUserList();
  res.json({ message: '등록 성공' });
});

app.post('/api/admin/allowed-users/extend', (req, res) => {
  const { indexes, type } = req.body;
  const today = new Date();
  
  indexes.forEach(idx => {
    const user = allowedUsers[idx];
    if (user) {
      const currentEnd = new Date(user.endDate + "T12:00:00");
      const base = currentEnd < today ? today : currentEnd;

      if (type === 'daily') {
        base.setDate(base.getDate() + 1);
        user.endDate = getKSTDateStr(base);
      } else if (type === 'monthly') {
        const nextMonthFirst = new Date(base.getFullYear(), base.getMonth() + 1, 1);
        const nextMonthLast = new Date(nextMonthFirst.getFullYear(), nextMonthFirst.getMonth() + 1, 0);
        user.endDate = getKSTDateStr(nextMonthLast);
      }
    }
  });
  saveUserList();
  res.json({ message: '연장 완료' });
});

app.delete('/api/admin/allowed-users', (req, res) => {
  const { indexes } = req.body;
  allowedUsers = allowedUsers.filter((_, idx) => !indexes.includes(idx));
  saveUserList();
  res.json({ message: '삭제 완료' });
});

// ==========================================
// 🍱 식사 기록 및 QR 로직
// ==========================================
app.post('/api/qr/generate', (req, res) => {
  const { eventId: date, orgRole, name } = req.body;
  const todayStr = getKSTDateStr();

  const user = allowedUsers.find(u => u.name === name && u.orgRole === orgRole);
  if (!user) return res.status(403).json({ message: '미등록 사용자' });
  if (user.endDate < todayStr) return res.status(403).json({ message: `기간 만료 (마감: ${user.endDate})` });

  if (!db.days[date]) db.days[date] = [];
  let diner = db.days[date].find(d => d.name === name && d.orgRole === orgRole);
  const qrToken = Math.random().toString(36).substring(2, 15);
  const expiresAt = Date.now() + 180000;

  if (!diner) {
    db.days[date].push({ orgRole, name, qrToken, tokenExpiresAt: expiresAt, attended: false, scannedAt: null });
  } else {
    if (diner.attended) return res.status(409).json({ message: '오늘 이미 식사함' });
    diner.qrToken = qrToken; diner.tokenExpiresAt = expiresAt;
  }
  saveDB();
  res.json({ qrData: qrToken, expiresAt });
});

app.post('/api/qr/scan', (req, res) => {
  const { qrToken } = req.body;
  const today = getKSTDateStr();
  if (!db.days[today]) return res.status(404).json({ message: '데이터 없음' });
  
  const diner = db.days[today].find(d => d.qrToken === qrToken);
  if (!diner || diner.tokenExpiresAt < Date.now()) return res.status(410).json({ message: '만료된 QR' });
  if (diner.attended) return res.status(409).json({ message: '이미 처리됨' });

  diner.attended = true;
  diner.scannedAt = new Date().toISOString();
  saveDB();
  res.json({ message: 'success', name: diner.name, orgRole: diner.orgRole });
});

// 명단 조회 및 월별 통계
app.get('/api/events/:date/attendees', (req, res) => res.json(db.days[req.params.date] || []));
app.get('/api/events/month/:yearMonth', (req, res) => {
  const { yearMonth } = req.params;
  let result = [];
  Object.keys(db.days).filter(d => d.startsWith(yearMonth)).forEach(date => {
    result = result.concat(db.days[date].filter(d => d.attended).map(d => ({ ...d, date })));
  });
  res.json(result);
});

app.listen(port, () => console.log(`🚀 Lunch Server Port: ${port}`));