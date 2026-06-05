# 화성오산교육지원청 점심 QR

## 주요 URL

- `/qr.html` : 사용자 QR 발급 화면
- `/scanner.html` 또는 `/scanner` : 인증 없는 스캐너 전용 화면
- `/admin.html` 또는 `/admin` : 관리자 인증 후 명단 관리, 엑셀 다운로드, 월식 엑셀 자동 등록

## 운영 환경 변수

```env
PORT=5000
EMAIL_USER=메일계정
EMAIL_PASS=앱비밀번호
ADMIN_EMAILS=admin1@example.com,admin2@example.com
DATA_DIR=/secure/path/for/json
PUBLIC_ORIGIN=https://example.com
NODE_ENV=production
COOKIE_SECURE=true
ADMIN_SESSION_MINUTES=240
AUTH_SECRET=긴_랜덤_문자열
```

## 설치

```bash
npm install
npm start
```

## TTS 음성 파일

`audio/README.txt`의 파일명대로 MP3를 넣으면 스캐너에서 랜덤 재생됩니다. MP3가 없으면 브라우저 기본 음성 합성으로 대체 안내를 재생합니다.
