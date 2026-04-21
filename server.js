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

//기본 접속 html 설정
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

const dbPath = path.join(__dirname, 'data.json');
let db = { days: {} };

if (fs.existsSync(dbPath)) {
  try {
    const rawData = fs.readFileSync(dbPath, 'utf-8');
    const parsed = JSON.parse(rawData);
    db = parsed.days ? parsed : { days: {} };
  } catch (e) { db = { days: {} }; }
}

function saveDB() { fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8'); }

const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : [];
let authCodes = {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// 관리자 인증 메일 발송
app.post('/api/admin/request-code', async (req, res) => {
  const { email } = req.body;
  if (!adminEmails.includes(email)) return res.status(403).json({ message: '등록되지 않은 관리자 이메일입니다.' });
  
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // 🌟 attempts(시도 횟수) 필드 추가
  authCodes[email] = { code, expires: Date.now() + 5 * 60 * 1000, attempts: 0 };
  
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER, to: email,
      subject: '[화성오산교육청] 점심체크 관리자 인증번호', text: `인증번호: [${code}]`
    });
    res.json({ message: '인증 메일이 발송되었습니다.' });
  } catch (error) { res.status(500).json({ message: '메일 발송에 실패했습니다.' }); }
});

// 인증번호 검증 (3회 오류 체크 로직)
app.post('/api/admin/verify-code', (req, res) => {
  const { email, code } = req.body;
  const auth = authCodes[email];
  
  if (!auth) return res.status(401).json({ message: '인증 요청 내역이 없습니다. 메일을 다시 요청해주세요.', action: 'reset' });
  if (auth.expires < Date.now()) {
    delete authCodes[email];
    return res.status(401).json({ message: '인증 시간이 만료되었습니다. 다시 요청해주세요.', action: 'reset' });
  }

  // 성공 시
  if (auth.code === code) {
    delete authCodes[email]; 
    res.json({ message: '인증 성공' });
  } 
  // 🌟 실패 시 횟수 증가 및 처리
  else {
    auth.attempts += 1;
    if (auth.attempts >= 3) {
      delete authCodes[email]; // 3회 틀리면 즉시 파기
      res.status(401).json({ message: '인증번호를 3회 잘못 입력하여 코드가 만료되었습니다. 다시 요청해주세요.', action: 'reset' });
    } else {
      res.status(401).json({ message: `인증번호가 일치하지 않습니다. (오류 횟수: ${auth.attempts}/3)` });
    }
  }
});

app.get('/api/events/:date/attendees', (req, res) => { res.json(db.days[req.params.date] || []); });
app.get('/api/events/month/:yearMonth', (req, res) => {
  const { yearMonth } = req.params;
  let monthlyData = [];
  for (const date in db.days) {
    if (date.startsWith(yearMonth)) {
      const attended = db.days[date].filter(d => d.attended).map(d => ({ ...d, date }));
      monthlyData = monthlyData.concat(attended);
    }
  }
  res.json(monthlyData);
});

app.post('/api/qr/generate', (req, res) => {
  const { eventId: date, orgRole, name } = req.body;
  if (!db.days[date]) db.days[date] = [];
  let diner = db.days[date].find(d => d.name === name && d.orgRole === orgRole);
  const qrToken = Math.random().toString(36).substring(2, 15);
  const expiresAt = Date.now() + 3 * 60 * 1000;

  if (!diner) {
    db.days[date].push({ orgRole, name, qrToken, tokenExpiresAt: expiresAt, attended: false, scannedAt: null });
  } else {
    if (diner.attended) return res.status(409).json({ message: '이미 오늘 식사 체크가 완료되었습니다.' });
    diner.qrToken = qrToken; diner.tokenExpiresAt = expiresAt;
  }
  saveDB(); res.json({ qrData: qrToken, expiresAt });
});

app.post('/api/qr/scan', (req, res) => {
  const { qrToken } = req.body;
  const today = new Date().toISOString().split('T')[0];
  if (!db.days[today]) return res.status(404).json({ message: '오늘 등록된 데이터가 없습니다.' });
  
  const diner = db.days[today].find(d => d.qrToken === qrToken);
  if (!diner) return res.status(404).json({ message: '유효하지 않은 QR 코드입니다.' });
  if (diner.tokenExpiresAt < Date.now()) return res.status(410).json({ message: '만료된 QR 코드입니다.' });
  if (diner.attended) return res.status(409).json({ message: '이미 처리된 QR입니다.' });

  diner.attended = true; diner.scannedAt = new Date().toISOString();
  saveDB();
  res.json({ message: 'success', name: diner.name, orgRole: diner.orgRole });
});

app.listen(port, () => console.log(`✅ 서버 실행 중: http://localhost:${port}`));