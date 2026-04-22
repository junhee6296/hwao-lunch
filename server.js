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
// 💾 데이터베이스 및 경로 설정
// ==========================================
const dbPath = path.join(__dirname, 'data.json');
const userListPath = path.join(__dirname, 'allowed_users.json');

let db = { days: {} };
let allowedUsers = [];

// 데이터 로드 함수
const loadData = () => {
  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf-8');
      db = JSON.parse(raw).days ? JSON.parse(raw) : { days: {} };
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

loadData();

// 날짜 관련 헬퍼 함수
const getTodayStr = () => new Date().toISOString().split('T')[0];
const calculateEndDate = (type, baseDate = new Date()) => {
  const date = new Date(baseDate);
  if (type === 'daily') return getTodayStr(); // 일식: 오늘 마감
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0); // 월식: 이번달 말일
  return lastDay.toISOString().split('T')[0];
};

// ==========================================
// 📧 이메일 및 인증 설정
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
  if (!adminEmails.includes(email)) return res.status(403).json({ message: '권한이 없는 이메일입니다.' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  authCodes[email] = { code, expires: Date.now() + 5 * 60 * 1000, attempts: 0 };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: email,
      subject: '[화성오산교육청] 관리자 인증번호', text: `인증번호: [${code}]`
    });
    res.json({ message: '메일 발송 완료' });
  } catch (e) { res.status(500).json({ message: '메일 발송 실패' }); }
});

app.post('/api/admin/verify-code', (req, res) => {
  const { email, code } = req.body;
  const auth = authCodes[email];
  if (!auth) return res.status(401).json({ message: '인증 내역 없음', action: 'reset' });
  if (auth.code === code && auth.expires > Date.now()) {
    delete authCodes[email]; res.json({ message: '성공' });
  } else {
    auth.attempts++;
    if (auth.attempts >= 3) { delete authCodes[email]; res.status(401).json({ message: '3회 오류', action: 'reset' }); }
    else res.status(401).json({ message: `틀림 (${auth.attempts}/3)` });
  }
});

// ==========================================
// 👥 명단 관리 API (일식/월식 및 기간 연장)
// ==========================================

// 명단 조회
app.get('/api/admin/allowed-users', (req, res) => res.json(allowedUsers));

// 명단 추가
app.post('/api/admin/allowed-users', (req, res) => {
  const { orgRole, name, mealType } = req.body;
  if (allowedUsers.some(u => u.name === name && u.orgRole === orgRole)) 
    return res.status(409).json({ message: '중복된 사용자' });

  allowedUsers.push({
    orgRole, name, mealType,
    endDate: calculateEndDate(mealType),
    createdAt: new Date().toISOString()
  });
  saveUserList();
  res.json({ message: '등록 성공' });
});

// 기간 연장 로직 (1일/다음달 전체)
app.post('/api/admin/allowed-users/extend', (req, res) => {
  const { indexes, type } = req.body;
  indexes.forEach(idx => {
    const user = allowedUsers[idx];
    if (user) {
      const currentEnd = new Date(user.endDate);
      const base = currentEnd < new Date() ? new Date() : currentEnd;
      if (type === 'daily') {
        base.setDate(base.getDate() + 1);
        user.endDate = base.toISOString().split('T')[0];
      } else if (type === 'monthly') {
        const nextMonth = new Date(base.getFullYear(), base.getMonth() + 1, 1);
        const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);
        user.endDate = lastDay.toISOString().split('T')[0];
      }
    }
  });
  saveUserList();
  res.json({ message: '연장 완료' });
});

// 일괄 삭제
app.delete('/api/admin/allowed-users', (req, res) => {
  const { indexes } = req.body;
  allowedUsers = allowedUsers.filter((_, idx) => !indexes.includes(idx));
  saveUserList();
  res.json({ message: '삭제 완료' });
});

// ==========================================
// 🍱 식사 기록 및 QR API
// ==========================================

app.get('/api/events/:date/attendees', (req, res) => res.json(db.days[req.params.date] || []));

app.get('/api/events/month/:yearMonth', (req, res) => {
  const { yearMonth } = req.params;
  let result = [];
  Object.keys(db.days).filter(d => d.startsWith(yearMonth)).forEach(date => {
    result = result.concat(db.days[date].filter(d => d.attended).map(d => ({ ...d, date })));
  });
  res.json(result);
});

app.post('/api/qr/generate', (req, res) => {
  const { eventId: date, orgRole, name } = req.body;
  const user = allowedUsers.find(u => u.name === name && u.orgRole === orgRole);

  if (!user) return res.status(403).json({ message: '등록되지 않은 사용자입니다.' });
  if (user.endDate < getTodayStr()) return res.status(403).json({ message: `기간 만료 (마감일: ${user.endDate})` });

  if (!db.days[date]) db.days[date] = [];
  let diner = db.days[date].find(d => d.name === name && d.orgRole === orgRole);
  const qrToken = Math.random().toString(36).substring(2, 15);
  const expiresAt = Date.now() + 3 * 60 * 1000;

  if (!diner) {
    db.days[date].push({ orgRole, name, qrToken, tokenExpiresAt: expiresAt, attended: false, scannedAt: null });
  } else {
    if (diner.attended) return res.status(409).json({ message: '오늘 식사 완료' });
    diner.qrToken = qrToken; diner.tokenExpiresAt = expiresAt;
  }
  saveDB();
  res.json({ qrData: qrToken, expiresAt });
});

app.post('/api/qr/scan', (req, res) => {
  const { qrToken } = req.body;
  const today = getTodayStr();
  if (!db.days[today]) return res.status(404).json({ message: '데이터 없음' });
  
  const diner = db.days[today].find(d => d.qrToken === qrToken);
  if (!diner || diner.tokenExpiresAt < Date.now()) return res.status(410).json({ message: '만료된 QR' });
  if (diner.attended) return res.status(409).json({ message: '이미 처리됨' });

  diner.attended = true;
  diner.scannedAt = new Date().toISOString();
  saveDB();
  res.json({ message: 'success', name: diner.name, orgRole: diner.orgRole });
});

app.listen(port, () => console.log(`✅ 서버 실행 중: 포트 ${port}`));