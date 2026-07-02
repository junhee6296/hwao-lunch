// JS/camera.js

/**
 * 스캐너 전면/후면 전환과 전면 카메라 미러링을 관리합니다.
 */
const CameraManager = {
  isFront: true,
  switching: false,
  observer: null,

  updateMirrorEffect() {
    const video = document.querySelector('#reader video');
    if (!video) return;

    let detectedMode = window.currentScannerFacingMode || (this.isFront ? 'user' : 'environment');
    const tracks = video.srcObject?.getVideoTracks?.() || [];
    if (tracks.length > 0) {
      const settings = tracks[0].getSettings?.() || {};
      const label = String(tracks[0].label || '').toLowerCase();
      if (settings.facingMode === 'user' || /front|selfie|user/.test(label)) detectedMode = 'user';
      if (settings.facingMode === 'environment' || /back|rear|environment/.test(label)) detectedMode = 'environment';
    }

    this.isFront = detectedMode === 'user';
    window.currentScannerFacingMode = detectedMode;
    video.setAttribute('playsinline', 'true');
    video.style.transition = 'transform 0.28s ease';
    video.style.transform = this.isFront ? 'scaleX(-1)' : 'scaleX(1)';

    const button = document.getElementById('custom-flip-btn');
    if (button) {
      button.dataset.facing = detectedMode;
      button.setAttribute('aria-label', this.isFront ? '후면 카메라로 전환' : '전면 카메라로 전환');
      button.title = this.isFront ? '현재 전면 카메라 · 후면으로 전환' : '현재 후면 카메라 · 전면으로 전환';
    }
  },

  async toggleCamera() {
    if (this.switching || typeof window.restartScanner !== 'function') return;

    this.switching = true;
    const button = document.getElementById('custom-flip-btn');
    if (button) {
      button.disabled = true;
      button.classList.add('is-switching');
    }

    const currentMode = window.currentScannerFacingMode || (this.isFront ? 'user' : 'environment');
    const nextMode = currentMode === 'user' ? 'environment' : 'user';

    try {
      await window.restartScanner(nextMode);
      window.setTimeout(() => this.updateMirrorEffect(), 260);
    } catch (error) {
      console.error('카메라 전환 중 오류:', error);
    } finally {
      this.switching = false;
      if (button) {
        button.disabled = false;
        button.classList.remove('is-switching');
      }
    }
  },

  initObserver() {
    const target = document.getElementById('reader');
    if (!target || this.observer) return;

    this.observer = new MutationObserver(() => {
      if (document.querySelector('#reader video')) this.updateMirrorEffect();
    });
    this.observer.observe(target, { childList: true, subtree: true });

    window.addEventListener('scanner-camera-started', () => {
      window.setTimeout(() => this.updateMirrorEffect(), 160);
    });
  }
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => CameraManager.initObserver(), { once: true });
} else {
  CameraManager.initObserver();
}

globalThis.CameraManager = CameraManager;
