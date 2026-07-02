function bindScannerControls() {
  document.getElementById('custom-flip-btn')?.addEventListener('click', () => globalThis.CameraManager?.toggleCamera());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindScannerControls, { once: true });
} else {
  bindScannerControls();
}
