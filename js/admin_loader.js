const showAdminLoadError = (error) => {
  console.error('Lunch Check admin script load failed', error);
  const msg = document.createElement('div');
  msg.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;padding:14px;border-radius:14px;background:#fee2e2;color:#991b1b;font-weight:900;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.18)';
  msg.textContent = '관리자 스크립트를 불러오지 못했습니다. 서버의 js 폴더 배포 상태를 확인해 주세요.';
  document.body.appendChild(msg);
};

(async () => {
  try {
    await import('./admin_bootstrap.js?v=20260702-final-refactor');
  } catch (error) {
    showAdminLoadError(error);
  }
})();
