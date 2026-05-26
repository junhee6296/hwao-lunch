// JS/auth.js
// 이전 스캐너 로그인 전용 모듈은 더 이상 사용하지 않습니다.
// 스캐너는 admin.html에서 바로 실행되고, 관리자 메뉴 인증은 JS/admin_list_app.js에서 처리합니다.

export function initAuth() {
  console.info('[auth] 스캐너 로그인 모듈은 비활성화되었습니다. 관리자 인증은 admin_list_app.js를 사용합니다.');
}
