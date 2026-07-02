const target = document.currentScript?.dataset?.target || './qr.html';
if (target) window.location.replace(target);
