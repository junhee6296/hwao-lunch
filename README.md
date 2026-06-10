# Lunch Check

화성오산교육지원청 점심 식사 QR 체크 앱입니다.

## 주요 화면

- `/qr.html` : 사용자 QR 발급, 식단표 보기, 홈 화면 바로가기 추가
- `/scanner.html` : 인증 없는 스캐너 전용 화면
- `/admin.html` : 관리자 인증 후 일식/월식 명단, 엑셀 등록, 식단표 이미지 OCR 업로드

## 실행

```bash
npm install
npm start
```

식단표 이미지 자동 추출은 `tesseract.js` OCR을 사용합니다. 서버 환경에서 한국어 OCR 데이터 접근이 제한되면 이미지는 저장되지만 자동 추출 결과가 비어 있을 수 있습니다.

## 운영 데이터

운영 데이터는 `DATA_DIR` 환경변수로 지정한 서버 내부 경로에 저장하는 것을 권장합니다.

- `data.json`
- `allowed_users.json`
- `menus.json`
- `menu_images/`
