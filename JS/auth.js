// 예전 인증 모듈 호환용 빈 모듈입니다.
// 현재 관리자 인증은 JS/admin_list_app.js와 백엔드 HttpOnly 세션 쿠키로 처리됩니다.
function initAuth() {}
globalThis.initAuth = initAuth;
