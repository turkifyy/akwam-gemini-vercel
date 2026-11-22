window.AKWAM_WORKER_URL = "https://turkifyseries.osamalovirboy.workers.dev";

function installPlayerFullscreenBridge() {
  const frame = document.querySelector('#site-frame');
  const nav = document.querySelector('.category-nav');
  if (!frame || !nav) return;

  let workerOrigin;
  try { workerOrigin = new URL(window.AKWAM_WORKER_URL, location.href).origin; }
  catch (_) { return; }

  function setImmersive(active) {
    nav.hidden = active;
    nav.style.display = active ? 'none' : '';
    if (active) {
      frame.style.top = '0';
      frame.style.height = '100dvh';
      frame.style.zIndex = '3';
    } else {
      frame.style.removeProperty('top');
      frame.style.removeProperty('height');
      frame.style.removeProperty('z-index');
    }
  }

  window.addEventListener('message', event => {
    if (event.origin !== workerOrigin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.source !== 'akwam-gemini-bridge') return;
    if (data.type === 'player-page' && data.watch === false) setImmersive(false);
    if (data.type === 'player-immersive' && typeof data.active === 'boolean') setImmersive(data.active);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installPlayerFullscreenBridge, {once:true});
} else {
  installPlayerFullscreenBridge();
}
