// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5000; // 배정받은 5000번 포트

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// 💾 데이터베이스 및 명단 로드
// ==========================================
const dbPath = path.join(__dirname, 'data.json');
const userListPath = path.join(__dirname, 'allowed_users.json');

let db = { days: {} };
let allowedUsers = [];

// 점심 식사 기록 로드
if (fs.existsSync(dbPath)) {
  try {
    const rawData = fs.readFileSync(dbPath, 'utf-8');
    const parsed = JSON.parse(rawData);
    db = parsed.days ? parsed : { days: {} };
  } catch (e) { db = { days: {} }; }
}

// 승인된 이용자 명단 로드
if (fs.existsSync(userListPath)) {
  try {
    allowedUsers = JSON.parse(fs.readFileSync(userListPath, 'utf-8'));
  } catch (e) { allowedUsers = []; }
}

function saveDB() { fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8'); }
function saveUserList() { fs.writeFileSync(userListPath, JSON.stringify(allowedUsers, null, 2), 'utf-8'); }

// ==========================================
// 📧 이메일 및 인증 세팅
// ==========================================
const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
let authCodes = {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// 루트 접속 시 qr.html 연결
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

// ==========================================
// 🔐 관리자 인증 API
// ==========================================
app.post('/api/admin/request-code', async (req, res) => {
  const { email } = req.body;
  if (!adminEmails.includes(email)) return res.status(403).json({ message: '등록되지 않은 관리자 이메일입니다.' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  authCodes[email] = { code, expires: Date.now() + 5 * 60 * 1000, attempts: 0 };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: email,
      subject: '[화성오산교육청] 점심체크 관리자 인증번호', text: `인증번호: [${code}]`
    });
    res.json({ message: '인증 메일이 발송되었습니다.' });
  } catch (error) { res.status(500).json({ message: '메일 발송 실패' }); }
});

app.post('/api/admin/verify-code', (req, res) => {
  const { email, code } = req.body;
  const auth = authCodes[email];
  if (!auth) return res.status(401).json({ message: '인증 요청 내역이 없습니다.', action: 'reset' });
  if (auth.code === code && auth.expires > Date.now()) {
    delete authCodes[email]; res.json({ message: '인증 성공' });
  } else {
    auth.attempts++;
    if (auth.attempts >= 3) {
      delete authCodes[email];
      res.status(401).json({ message: '3회 오류로 번호가 만료되었습니다.', action: 'reset' });
    } else {
      res.status(401).json({ message: `번호가 틀렸습니다. (${auth.attempts}/3)` });
    }
  }
});

// ==========================================
// 👥 이용자 명단 관리 API (신규)
// ==========================================
app.get('/api/admin/allowed-users', (req, res) => res.json(allowedUsers));

app.post('/api/admin/allowed-users', (req, res) => {
  const { orgRole, name } = req.body;
  if (allowedUsers.some(u => u.name === name && u.orgRole === orgRole)) {
    return res.status(409).json({ message: '이미 등록된 사용자입니다.' });
  }
  allowedUsers.push({ orgRole, name, createdAt: new Date().toISOString() });
  saveUserList();
  res.json({ message: '등록 성공' });
});

app.delete('/api/admin/allowed-users/:index', (req, res) => {
  allowedUsers.splice(req.params.index, 1);
  saveUserList();
  res.json({ message: '삭제 성공' });
});

// ==========================================
// 🍱 식사 관리 및 QR API
// ==========================================
app.get('/api/events/:date/attendees', (req, res) => res.json(db.days[req.params.date] || []));

app.get('/api/events/month/:yearMonth', (req, res) => {
  const { yearMonth } = req.params;
  let monthlyData = [];
  for (const date in db.days) {
    if (date.startsWith(yearMonth)) {
      monthlyData = monthlyData.concat(db.days[date].filter(d => d.attended).map(d => ({ ...d, date })));
    }
  }
  res.json(monthlyData);
});

app.post('/api/qr/generate', (req, res) => {
  const { eventId: date, orgRole, name } = req.body;

  // 🌟 승인된 명단 대조
  const isAllowed = allowedUsers.some(u => u.name === name && u.orgRole === orgRole);
  if (!isAllowed) return res.status(403).json({ message: '등록되지 않은 사용자입니다.' });

  if (!db.days[date]) db.days[date] = [];
  let diner = db.days[date].find(d => d.name === name && d.orgRole === orgRole);
  const qrToken = Math.random().toString(36).substring(2, 15);
  const expiresAt = Date.now() + 3 * 60 * 1000;

  if (!diner) {
    db.days[date].push({ orgRole, name, qrToken, tokenExpiresAt: expiresAt, attended: false, scannedAt: null });
  } else {
    if (diner.attended) return res.status(409).json({ message: '이미 오늘 식사 처리가 완료되었습니다.' });
    diner.qrToken = qrToken; diner.tokenExpiresAt = expiresAt;
  }
  saveDB(); res.json({ qrData: qrToken, expiresAt });
});

app.post('/api/qr/scan', (req, res) => {
  const { qrToken } = req.body;
  const today = new Date().toISOString().split('T')[0];
  if (!db.days[today]) return res.status(404).json({ message: '데이터가 없습니다.' });
  
  const diner = db.days[today].find(d => d.qrToken === qrToken);
  if (!diner || diner.tokenExpiresAt < Date.now()) return res.status(410).json({ message: '유효하지 않거나 만료된 QR입니다.' });
  if (diner.attended) return res.status(409).json({ message: '이미 처리된 QR입니다.' });

  diner.attended = true; diner.scannedAt = new Date().toISOString();
  saveDB();
  res.json({ message: 'success', name: diner.name, orgRole: diner.orgRole });
});

app.listen(port, () => console.log(`✅ 서버 실행 중: 포트 ${port}`));