window.AKWAM_WORKER_URL = "https://turkifyseries.osamalovirboy.workers.dev";

function installPlayerFullscreenBridge() {
  const frame = document.querySelector('#site-frame');
  const nav = document.querySelector('.category-nav');
  if (!frame || !nav) return;

  let workerOrigin;
  try { workerOrigin = new URL(window.AKWAM_WORKER_URL, location.href).origin; }
  catch (_) { return; }

  let frameImmersive = false;
  let nativeFullscreen = false;
  let staleMessageUntil = 0;

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

  function syncImmersive() {
    setImmersive(frameImmersive || nativeFullscreen);
  }

  function releaseImmersive() {
    frameImmersive = false;
    nativeFullscreen = false;
    setImmersive(false);
  }

  window.addEventListener('message', event => {
    if (event.origin !== workerOrigin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.source !== 'akwam-gemini-bridge') return;
    if (data.type === 'player-page' && data.watch === false) releaseImmersive();
    if (data.type === 'player-immersive' && typeof data.active === 'boolean') {
      if (data.active && Date.now() < staleMessageUntil) return;
      frameImmersive = data.active;
      syncImmersive();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    nativeFullscreen = document.fullscreenElement === frame;
    if (!nativeFullscreen) {
      frameImmersive = false;
      staleMessageUntil = Date.now() + 1200;
    }
    syncImmersive();
  });

  window.addEventListener('pagehide', releaseImmersive);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installPlayerFullscreenBridge, {once:true});
} else {
  installPlayerFullscreenBridge();
}
