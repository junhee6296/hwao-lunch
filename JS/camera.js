// JS/camera.js
const CameraManager = {
    isFront: false,

    // 전면일 때만 좌우 반전(미러 모드) 적용
    updateMirrorEffect: function() {
        const video = document.querySelector('#reader video');
        if (!video) return;

        const tracks = video.srcObject ? video.srcObject.getVideoTracks() : [];
        if (tracks.length > 0) {
            const label = tracks[0].label.toLowerCase();
            const settings = tracks[0].getSettings();
            // user 모드이거나 라벨에 front/selfie가 포함되면 전면으로 간주
            this.isFront = settings.facingMode === 'user' || label.includes('front') || label.includes('selfie');
        }

        video.style.transition = "transform 0.4s ease";
        video.style.transform = this.isFront ? "scaleX(-1)" : "scaleX(1)";
    },

    // 카메라 전환 버튼 클릭 시 호출
    toggleCamera: async function() {
        if (window.html5QrCode && window.html5QrCode.isScanning) {
            try {
                await window.html5QrCode.stop();
                
                // 전/후면 방향 토글
                this.isFront = !this.isFront;
                const nextMode = this.isFront ? "user" : "environment";
                
                if (typeof window.startScanner === 'function') {
                    await window.startScanner(nextMode);
                    // 카메라가 켜진 후 반전 효과 적용
                    setTimeout(() => this.updateMirrorEffect(), 600);
                }
            } catch (err) {
                console.error("카메라 전환 실패:", err);
            }
        } else {
            alert("카메라가 아직 활성화되지 않았습니다.");
        }
    }
};

export default CameraManager;