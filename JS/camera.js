// JS/camera.js
const CameraManager = {
    isFront: false,

    // 전면일 때만 시각적 반전(거울 모드) 적용
    updateMirrorEffect: function() {
        const video = document.querySelector('#reader video');
        if (!video) return;

        // 전면 카메라(user)일 때만 좌우 반전
        video.style.transition = "transform 0.4s ease";
        video.style.transform = this.isFront ? "scaleX(-1)" : "scaleX(1)";
    },

    // 카메라 전환 실행
    toggleCamera: async function() {
        // 전역 객체로 노출된 html5QrCode와 startScanner 사용
        if (window.html5QrCode && window.html5QrCode.isScanning) {
            try {
                await window.html5QrCode.stop();
                
                // 전/후면 토글
                this.isFront = !this.isFront;
                const nextMode = this.isFront ? "user" : "environment";
                
                // admin_app.js의 전역 함수 호출
                if (typeof window.startScanner === 'function') {
                    await window.startScanner(nextMode);
                    // 카메라 로드 후 반전 적용
                    setTimeout(() => this.updateMirrorEffect(), 600);
                }
            } catch (err) {
                console.error("카메라 전환 중 오류:", err);
            }
        } else {
            alert("카메라가 작동 중이 아닙니다.");
        }
    }
};

export default CameraManager;