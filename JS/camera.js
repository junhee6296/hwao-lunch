// JS/camera.js

/**
 * 전면/후면 카메라 상태에 따라 비디오 화면 반전을 제어하는 모듈
 */
const CameraManager = {
    isFront: false,

    // 🌟 사용 중인 카메라가 전면인지 판별하여 미러 효과 적용
    updateMirrorEffect: function() {
        const video = document.querySelector('#reader video');
        if (!video) return;

        // 브라우저에서 현재 활성화된 비디오 트랙 정보 가져오기
        const tracks = video.srcObject ? video.srcObject.getVideoTracks() : [];
        if (tracks.length > 0) {
            const settings = tracks[0].getSettings();
            const label = tracks[0].label.toLowerCase();

            // facingMode 설정값이 'user'이거나, 라벨에 'front'가 포함된 경우 전면으로 판단
            this.isFront = settings.facingMode === 'user' || label.includes('front') || label.includes('selfie');
        }

        // 전면/노트북이면 좌우반전(scaleX -1), 후면이면 정방향(scaleX 1)
        video.style.transition = "transform 0.4s ease";
        video.style.transform = this.isFront ? "scaleX(-1)" : "scaleX(1)";
        
        console.log(`[CameraManager] 현재 카메라: ${this.isFront ? '전면(거울 모드)' : '후면(정방향)'}`);
    },

    // 🔄 카메라 전환 버튼 클릭 시 호출
    toggleCamera: async function() {
        if (window.html5QrCode && window.html5QrCode.isScanning) {
            try {
                await window.html5QrCode.stop();
                
                // 방향 토글
                const nextMode = this.isFront ? "environment" : "user";
                
                // admin_app.js의 스캐너 시작 함수 호출 (모드 전달)
                if (typeof window.startScanner === 'function') {
                    await window.startScanner(nextMode);
                    // 카메라가 로드된 후 약간의 지연을 주고 미러 효과 적용
                    setTimeout(() => this.updateMirrorEffect(), 600);
                }
            } catch (err) {
                console.error("카메라 전환 중 오류:", err);
            }
        }
    },

    // 🛠️ 비디오 태그 생성을 감시하는 옵저버 (처음 로드 시 대응)
    initObserver: function() {
        const target = document.getElementById('reader');
        if (!target) return;

        const observer = new MutationObserver(() => {
            if (document.querySelector('#reader video')) {
                this.updateMirrorEffect();
            }
        });

        observer.observe(target, { childList: true, subtree: true });
    }
};

// 페이지 로드 시 옵저버 실행
window.addEventListener('DOMContentLoaded', () => {
    CameraManager.initObserver();
});

export default CameraManager;