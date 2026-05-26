# 화성오산교육지원청 QR 점심식사 체크인 시스템
## 개요

## 기능 설명
### 사용자
<img width="300" height="500" alt="image" src="https://github.com/user-attachments/assets/60edaf08-f4e0-433d-aae9-943251eb14f9" /> <img width="400" height="385" alt="image" src="https://github.com/user-attachments/assets/cc015dbd-494b-4d57-9ad4-0b3aa6ce536c" />

1. 홈페이지에 접속합니다
2. 부서와 이름을 작성하고 QR 코드 생성을 누릅니다
3. 청내 비치된 태블릿에 스캔합니다.


## 배포 보안 메모

- 관리자 인증은 `ADMIN_EMAILS`에 등록된 이메일로만 가능하며, 인증 성공 후 서버가 `HttpOnly` 세션 쿠키를 발급합니다.
- `SUPER_ADMIN_EMAILS`는 더 이상 사용하지 않습니다.
- 운영 HTTPS 환경에서는 `.env`에 `NODE_ENV=production` 또는 `COOKIE_SECURE=true`를 권장합니다.
- 프록시/도메인 환경에서 Origin 검사가 막히면 `PUBLIC_ORIGIN=https://도메인` 값을 설정하세요.
- 데이터 파일은 `DATA_DIR=/보안/저장/경로`로 프로젝트 공개 폴더 밖에 두는 것을 권장합니다.
- `data.json`, `allowed_users.json`, `.env`, `node_modules`는 배포 zip/저장소에 포함하지 않습니다.
