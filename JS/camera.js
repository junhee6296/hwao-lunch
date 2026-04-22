// JS/admin_app.js 예시

window.startScanner = async function(facingMode = "environment") {
    const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };
    
    // html5QrCode.start 호출 시 facingMode 전달
    await html5QrCode.start(
        { facingMode: facingMode }, 
        config, 
        qrCodeSuccessCallback
    );
};