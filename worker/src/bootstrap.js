export const bootstrapScript = String.raw`(() => {
  'use strict';
  const config = window.__AKWAM_BRIDGE__ || {};
  const isSmartphone = window.navigator?.userAgentData?.mobile === true ||
    /iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|BlackBerry|BB10/i.test(window.navigator?.userAgent || '');
  const lang = String(config.lang || 'ar');
  const parentOrigin = String(config.parentOrigin || '');
  const upstreamHost = String(config.upstreamHost || 'akwam.ss');
  const seoMode = config.seoMode === true;
  const routePath = (seoMode ? '/catalog/' : '/site/') + lang;
  const pagePath = location.pathname.startsWith(routePath)
    ? location.pathname.slice(routePath.length)
    : location.pathname;
  const episodePage = /^\/episode\/\d+(?:\/|$)/.test(pagePath);
  const seriesPage = /^\/series\/\d+(?:\/|$)/.test(pagePath);
  const prefix = location.origin + routePath;
  const adLinkUrl = 'https://asiafilm.org/4/397db7f27bcb1e058e7ac9ba2a034a28';
  const adBridgeUrl = String(config.adBridgeUrl || '');
  const originalFetch = window.fetch.bind(window);
  const originalOpen = typeof window.open === 'function' ? window.open.bind(window) : () => null;

  function internal(path) {
    return path === '/health' || path.startsWith('/api/') || path.startsWith('/__bridge/');
  }

  function proxyUrl(input) {
    const raw = input instanceof Request ? input.url : String(input);
    let url;
    try { url = new URL(raw, location.href); }
    catch (_) { return raw; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;
    if (url.hostname === upstreamHost) {
      url = new URL(prefix + url.pathname + url.search + url.hash);
    } else if (url.origin === location.origin) {
      if (internal(url.pathname)) return raw;
      if (url.pathname !== routePath && !url.pathname.startsWith(routePath + '/')) {
        url = new URL(prefix + url.pathname + url.search + url.hash);
      }
    } else {
      return raw;
    }
    if (parentOrigin && !seoMode) url.searchParams.set('__parent', parentOrigin);
    return url.href;
  }

  window.fetch = function (input, init) {
    const rewritten = proxyUrl(input);
    return input instanceof Request
      ? originalFetch(new Request(rewritten, input), init)
      : originalFetch(rewritten, init);
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return xhrOpen.call(this, method, proxyUrl(url), ...rest);
  };

  const historyPush = history.pushState.bind(history);
  const historyReplace = history.replaceState.bind(history);
  history.pushState = (state, title, url) => historyPush(state, title, url == null ? url : proxyUrl(url));
  history.replaceState = (state, title, url) => historyReplace(state, title, url == null ? url : proxyUrl(url));

  window.open = (url, target) => {
    if (!url) return null;
    try {
      const destination = new URL(String(url), location.href);
      if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return null;
      if (destination.href === adLinkUrl && String(target || '').toLowerCase() === '_blank') {
        return originalOpen(destination.href, '_blank', 'noopener,noreferrer');
      }
      const routed = new URL(proxyUrl(destination.href), location.href);
      const internalPath = routePath;
      const isInternal = routed.origin === location.origin &&
        (routed.pathname === internalPath || routed.pathname.startsWith(internalPath + '/'));
      if (isInternal || String(target || '').toLowerCase() === '_self') {
        location.assign(routed.href);
        return window;
      }
    } catch (_) {}
    return null;
  };

  window.__AKWAM_BRIDGE__ = {lang, parentOrigin, upstreamHost, post};
  function post(type, detail) {
    if (!parentOrigin) return;
    window.parent.postMessage(Object.assign({source:'akwam-gemini-bridge', type}, detail || {}), parentOrigin);
  }

  function rewriteAttributes(root) {
    const nodes = [];
    if (root.nodeType === 1) nodes.push(root);
    if (root.querySelectorAll) nodes.push(...root.querySelectorAll('[href],[src],[action]'));
    for (const node of nodes) {
      for (const attr of ['href','src','action']) {
        const value = node.getAttribute?.(attr);
        if (!value || /^(?:#|javascript:|data:|mailto:|tel:|blob:)/i.test(value)) continue;
        const rewritten = proxyUrl(value);
        if (rewritten !== value) node.setAttribute(attr, rewritten);
      }
      if (node.tagName === 'A' && node.hasAttribute('target') && node.getAttribute('target') !== '_self') {
        try {
          const destination = new URL(node.getAttribute('href'), location.href);
          if (destination.origin === location.origin &&
              (destination.pathname === routePath || destination.pathname.startsWith(routePath + '/'))) {
            node.setAttribute('target', '_self');
          }
        } catch (_) {}
      }
    }
  }

  const watchProgressStoragePrefix = 'akwam-watch-progress-v1:';
  let activeWatchProgress = null;
  const userPlaybackRequested = new WeakSet();
  const userProgressInteraction = new WeakSet();

  function readWatchProgress(seriesId) {
    try {
      const raw = localStorage.getItem(watchProgressStoragePrefix + seriesId) || '';
      if (!raw) return null;
      if (/^\/(?:episode\/\d+|watch\/\d+\/\d+)(?:\/|$)/.test(raw)) {
        return {episodePath:raw,episodeNumber:0,currentTime:0,duration:0};
      }
      const saved = JSON.parse(raw);
      if (typeof saved?.episodePath !== 'string' || !/^\/(?:episode\/\d+|watch\/\d+\/\d+)(?:\/|$)/.test(saved.episodePath)) return null;
      const currentTime = Number(saved.currentTime);
      const duration = Number(saved.duration);
      return {
        episodePath:saved.episodePath,
        episodeNumber:Number.isSafeInteger(Number(saved.episodeNumber)) ? Number(saved.episodeNumber) : 0,
        currentTime:Number.isFinite(currentTime) ? Math.max(0,currentTime) : 0,
        duration:Number.isFinite(duration) ? Math.max(0,duration) : 0
      };
    } catch (_) {
      return null;
    }
  }

  function writeWatchProgress(progress) {
    if (!progress) return;
    const now = Date.now();
    try {
      localStorage.setItem(progress.key, JSON.stringify({
        version:2,
        episodePath:progress.episodePath,
        episodeNumber:progress.episodeNumber,
        currentTime:Math.max(0,Number(progress.currentTime) || 0),
        duration:Math.max(0,Number(progress.duration) || 0),
        updatedAt:now
      }));
      progress.lastSavedAt = now;
    } catch (_) {}
  }

  function saveWatchProgress(video, force=false) {
    const progress = activeWatchProgress;
    const currentTime = Number(video.currentTime);
    const now = Date.now();
    if (!progress || !Number.isFinite(currentTime) || currentTime < 0 ||
        (!userPlaybackRequested.has(video) && !userProgressInteraction.has(video))) return;
    if (!force && now - progress.lastSavedAt < 5000) return;
    progress.currentTime = currentTime;
    const duration = Number(video.duration);
    if (Number.isFinite(duration) && duration > 0) progress.duration = duration;
    writeWatchProgress(progress);
  }

  function installWatchProgress() {
    const episodePath = location.pathname.slice(routePath.length) || '/';
    const episodePage = /^\/episode\/\d+(?:\/|$)/.test(episodePath);
    const watchPage = /^\/watch\/\d+\/\d+(?:\/|$)/.test(episodePath);
    const seriesLink = document.querySelector('.breadcrumb a[href*="/series/"], h1 a[href*="/series/"], a[href*="/series/"]');
    const seriesId = seriesLink && new URL(seriesLink.href, location.href).pathname.match(/\/series\/(\d+)(?:\/|$)/)?.[1];

    if ((episodePage || watchPage) && seriesId) {
      const episodeLink = episodePage
        ? null
        : document.querySelector('.breadcrumb a[href*="/episode/"], h2 a[href*="/episode/"], a[href*="/episode/"]');
      const episodeUrl = new URL(episodeLink?.href || location.href, location.href);
      const episodeRoute = watchPage
        ? location.pathname.match(/^\/(?:site|catalog)\/[^/]+(\/watch\/\d+\/\d+(?:\/.*)?)$/)
        : episodeUrl.pathname.match(/^\/(?:site|catalog)\/[^/]+(\/episode\/\d+(?:\/.*)?)$/);
      if (episodeRoute) {
        const saved = readWatchProgress(seriesId);
        const isSameEpisode = saved?.episodePath === episodeRoute[1];
        const labelNumber = String(episodeLink?.innerText || '').match(/\d+/g)?.at(-1);
        const pathNumber = episodeRoute[1].match(/episode[-_\s]*(\d+)/i)?.[1];
        activeWatchProgress = {
          key:watchProgressStoragePrefix + seriesId,
          seriesId,
          episodePath:episodeRoute[1],
          episodeNumber:Number(labelNumber || pathNumber || (isSameEpisode ? saved.episodeNumber : 0)) || 0,
          currentTime:isSameEpisode ? saved.currentTime : 0,
          duration:isSameEpisode ? saved.duration : 0,
          lastSavedAt:0
        };
        writeWatchProgress(activeWatchProgress);
      }
    }

    document.addEventListener('click', event => {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      const link = target?.closest?.('a[href]');
      if (!link) return;

      let destination;
      try { destination = new URL(link.href, location.href); }
      catch (_) { return; }
      if (destination.origin !== location.origin || episodePage || watchPage) return;
      const targetSeriesId = destination.pathname.match(/\/series\/(\d+)(?:\/|$)/)?.[1];
      if (!targetSeriesId) return;
      const saved = readWatchProgress(targetSeriesId);

      if (saved?.episodePath) {
        event.preventDefault();
        const resumeUrl = new URL(routePath + saved.episodePath, location.origin);
        if (parentOrigin && !seoMode) resumeUrl.searchParams.set('__parent', parentOrigin);
        location.assign(resumeUrl.href);
        return;
      }
      if (destination.hash !== '#series-episodes') return;

      const episodes = document.querySelector('#series-episodes') || document;
      const links = [...episodes.querySelectorAll('a[href*="/episode/"]')]
        .map(anchor => {
          try {
            const url = new URL(anchor.href, location.href);
            const segment = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '');
            const number = Number(segment.match(/\d+(?!.*\d)/)?.[0]);
            return {url, number};
          } catch (_) {
            return null;
          }
        })
        .filter(item => item && item.url.origin === location.origin &&
          item.url.pathname.includes('/episode/'));
      const firstEpisode = links.filter(item => Number.isFinite(item.number))
        .sort((a, b) => a.number - b.number)[0]?.url || links.at(-1)?.url;
      if (firstEpisode) {
        event.preventDefault();
        location.assign(proxyUrl(firstEpisode.href));
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installWatchProgress, {once:true});
  } else {
    installWatchProgress();
  }

  const watchPage = /\/watch\/\d+\/\d+(?:\/|$)/.test(location.pathname);
  post('player-page', {watch:watchPage});
  if (watchPage) window.addEventListener('pagehide', () => post('player-immersive', {active:false}));

  if (watchPage) {
    const attachedVideos = new WeakSet();
    const adBreakVideos = new WeakSet();
    const adBreakStates = new WeakMap();
    const startPositionApplied = new WeakSet();
    const advancedVideos = new WeakSet();
    const lastPlaybackPositions = new WeakMap();
    const seekGraceUntil = new WeakMap();
    const seekGraceMs = 1500;
    const nativeFullscreenUnavailable = new WeakSet();
    let nativeFullscreenPlayer = null;
    const adBreakIntervalSeconds = 10 * 60;
    const adBreakDurationSeconds = 35;
    document.addEventListener('click', event => {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      const link = target?.closest?.('a[target="_blank"]');
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (link.getAttribute('href') === adLinkUrl) window.open(adLinkUrl, '_blank');
    }, true);
    let nextEpisodeUrl = '';
    let nextEpisodeResolved = false;
    const screenOrientation = (() => {
      try { return typeof screen !== 'undefined' && screen && screen.orientation ? screen.orientation : null; }
      catch (_) { return null; }
    })();
    let playerWasFullscreen = false;
    let portraitHoldUntil = 0;

    function lockOrientation(mode) {
      if (!isSmartphone || !screenOrientation || typeof screenOrientation.lock !== 'function') return Promise.resolve(false);
      try {
        return Promise.resolve(screenOrientation.lock(mode)).then(() => true, () => false);
      } catch (_) {
        return Promise.resolve(false);
      }
    }

    function lockFullscreenLandscape() {
      portraitHoldUntil = 0;
      lockOrientation('landscape');
    }

    // Exiting fullscreen releases the orientation lock, so the platform must ask for
    // portrait again: once immediately (while the fullscreen document still holds the
    // lock) and again across the next frames, when the unlock has actually happened.
    function restorePlatformPortrait(duration = 2400) {
      if (!isSmartphone) return;
      portraitHoldUntil = Math.max(portraitHoldUntil, Date.now() + duration);
      lockOrientation('portrait');
      if (typeof setTimeout !== 'function') return;
      for (const delay of [180, 520, 1000, 1800]) {
        setTimeout(() => {
          if (Date.now() <= portraitHoldUntil && !document.fullscreenElement) lockOrientation('portrait');
        }, delay);
      }
    }

    function reassertPlatformPortrait() {
      if (!isSmartphone || Date.now() > portraitHoldUntil) return;
      if (document.fullscreenElement) return;
      if (/^portrait/.test(String(screenOrientation?.type || ''))) return;
      lockOrientation('portrait');
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('orientationchange', reassertPlatformPortrait);
      window.addEventListener('resize', reassertPlatformPortrait);
      try { screenOrientation?.addEventListener?.('change', reassertPlatformPortrait); } catch (_) {}
    }

    function resolveNextEpisode() {
      if (nextEpisodeResolved) return nextEpisodeUrl;
      if (document.readyState === 'loading') return '';

      nextEpisodeResolved = true;
      const link = [...document.querySelectorAll('a[href*="/watch/"]')].find(anchor => {
        const label = String(anchor.innerText || '') + ' ' + String(anchor.getAttribute('aria-label') || '');
        return anchor.classList?.contains('justify-content-md-end') || /\bnext\b|التالي|التالية/i.test(label);
      });
      if (!link) return '';

      try {
        const url = new URL(link.href, location.href);
        if (url.origin === location.origin && url.pathname.startsWith(routePath + '/watch/')) {
          nextEpisodeUrl = url.href;
        }
      } catch (_) {}
      return nextEpisodeUrl;
    }

    function markSeekGrace(video) {
      seekGraceUntil.set(video, Date.now() + seekGraceMs);
    }

    function seekGraceActive(video) {
      return (seekGraceUntil.get(video) || 0) > Date.now();
    }

    function advanceEpisode(video, ended=false) {
      if (advancedVideos.has(video)) return;
      const adBreak = adBreakStates.get(video);
      if (adBreak) {
        adBreak.updatePlaybackProgress(ended);
        if (adBreak.isActive()) return;
      }
      const currentPosition = Number(video.currentTime);
      if (!Number.isFinite(currentPosition)) return;
      const previousPosition = lastPlaybackPositions.get(video);
      lastPlaybackPositions.set(video,currentPosition);
      if (!ended) {
        if (video.seeking || seekGraceActive(video)) return;
        const threshold = video.duration - 70;
        const crossedThresholdDuringPlayback = Number.isFinite(video.duration) && video.duration > 70 &&
          Number.isFinite(previousPosition) && previousPosition < threshold && currentPosition >= threshold &&
          video.paused === false && !video.seeking;
        if (!crossedThresholdDuringPlayback) return;
      }
      if (!ended && adBreak?.willOccurBeforeEnd()) return;
      const nextUrl = resolveNextEpisode();
      if (!nextUrl) return;
      advancedVideos.add(video);
      location.assign(nextUrl);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolveNextEpisode, {once:true});
    } else {
      resolveNextEpisode();
    }

    const immersiveStyle = document.createElement('style');
    immersiveStyle.textContent = '.akwam-immersive-page{overflow:hidden!important;background:#000!important}' +
      '.akwam-immersive-player{position:fixed!important;inset:0!important;z-index:2147483647!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-width:none!important;max-height:none!important;margin:0!important;background:#000!important;box-sizing:border-box!important}' +
      '.akwam-immersive-player .plyr__video-wrapper{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;padding:0!important;aspect-ratio:auto!important;border-radius:0!important;background:#000!important}' +
      '.akwam-immersive-player .plyr__video-wrapper video{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;aspect-ratio:auto!important;object-fit:contain!important}' +
      '.akwam-immersive-player button[data-plyr="fullscreen"] .icon--not-pressed,.akwam-immersive-player button[data-plyr="fullscreen"] .label--not-pressed{display:none!important}' +
      '.akwam-immersive-player button[data-plyr="fullscreen"] .icon--pressed,.akwam-immersive-player button[data-plyr="fullscreen"] .label--pressed{display:block!important}' +
      '.akwam-ad-supported:not(.akwam-immersive-player){position:relative!important}' +
      '.akwam-ad-break{position:absolute!important;inset:0!important;z-index:2147483646!important;display:grid!important;place-items:center!important;overflow:hidden!important;background:radial-gradient(circle at 50% 35%,#1b2740,#07090f 68%)!important}' +
      '.akwam-ad-break-immersive{position:fixed!important;inset:0!important;z-index:2147483647!important}' +
      '.akwam-ad-frame-shell{position:absolute!important;inset:10px!important;overflow:hidden!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:0 18px 64px #000b!important}' +
      '.akwam-ad-frame{display:block!important;width:100%!important;height:100%!important;border:0!important;background:transparent!important}' +
      '.akwam-ad-countdown{position:absolute!important;top:14px!important;left:14px!important;z-index:4!important;padding:8px 12px!important;border:1px solid #ffffff30!important;border-radius:8px!important;color:#fff!important;background:#000b!important;font:600 14px/1.4 system-ui,sans-serif!important;pointer-events:none!important}' +
      '@media(max-width:600px){.akwam-ad-frame-shell{inset:8px!important;border-radius:8px!important}.akwam-ad-countdown{top:12px!important;left:12px!important;padding:6px 9px!important;font-size:12px!important}}';
    (document.head || document.documentElement).appendChild(immersiveStyle);

    function setImmersive(player, active) {
      player.classList.toggle('akwam-immersive-player', active);
      document.documentElement.classList.toggle('akwam-immersive-page', active);
      const button = player.querySelector('button[data-plyr="fullscreen"]');
      if (button) button.setAttribute('aria-pressed', String(active));
      const customButton = player.querySelector('.akwam-player-fullscreen');
      if (customButton) {
        const label = active ? 'إنهاء ملء الشاشة' : 'ملء الشاشة';
        customButton.setAttribute('aria-label',label);
        customButton.setAttribute('aria-pressed',String(active));
        customButton.title = label;
      }
      post('player-immersive', {active});
    }

    function exitNativeFullscreen() {
      try {
        const exit = document.exitFullscreen();
        if (exit && typeof exit.catch === 'function') exit.catch(() => {});
      } catch (_) {}
    }

    function exitPlayerFullscreen(player) {
      // Ask the parent frame to rotate too; it is the top-level document and can hold
      // the orientation lock even when the player lives inside the iframe.
      post('player-orientation', {mode:'portrait'});
      let settled = false;
      let fallbackTimer;
      const isPortrait = () => /^portrait/.test(String(screenOrientation?.type || ''));
      const finish = () => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        try { screenOrientation?.removeEventListener?.('change', onOrientationChange); } catch (_) {}
        if (document.fullscreenElement === player) exitNativeFullscreen();
        else setImmersive(player,false);
        // Order matters: request portrait before exitNativeFullscreen() finishes, then
        // keep re-asserting it while the browser tears fullscreen down and unlocks.
        restorePlatformPortrait(2600);
      };
      const onOrientationChange = () => {
        if (isPortrait()) finish();
      };
      if (!screenOrientation || typeof screenOrientation.lock !== 'function' || typeof setTimeout !== 'function') {
        finish();
        return;
      }
      try { screenOrientation.addEventListener?.('change', onOrientationChange); } catch (_) {}
      // Keep fullscreen active until the device reports portrait. A lock can resolve
      // before a slow device has finished rotating, so use the change event as the cue.
      fallbackTimer = setTimeout(finish, 1600);
      lockOrientation('portrait').then(locked => {
        if (locked && isPortrait()) finish();
      });
    }

    function togglePlayerFullscreen(player) {
      if (document.fullscreenElement === player) {
        exitPlayerFullscreen(player);
        return;
      }
      if (nativeFullscreenPlayer === player) return;
      if (nativeFullscreenUnavailable.has(player)) {
        nativeFullscreenUnavailable.delete(player);
        setImmersive(player,false);
        restorePlatformPortrait();
        return;
      }

      const requestFullscreen = player.requestFullscreen;
      if (typeof requestFullscreen !== 'function') {
        const active = player.classList.contains('akwam-immersive-player');
        setImmersive(player,!active);
        if (active) {
          restorePlatformPortrait();
        }
        return;
      }

      setImmersive(player,true);
      nativeFullscreenPlayer = player;
      try {
        const request = requestFullscreen.call(player,{navigationUI:'hide'});
        if (request && typeof request.catch === 'function') {
          request.catch(() => {
            if (nativeFullscreenPlayer === player) nativeFullscreenPlayer = null;
            nativeFullscreenUnavailable.add(player);
          });
        }
      } catch (_) {
        nativeFullscreenPlayer = null;
        nativeFullscreenUnavailable.add(player);
      }
    }

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        const element = document.fullscreenElement;
        const player = nativeFullscreenPlayer === element || element.classList?.contains('plyr') ? element : null;
        if (player) {
          playerWasFullscreen = true;
          lockFullscreenLandscape();
        }
        return;
      }
      if (!playerWasFullscreen) return;
      playerWasFullscreen = false;
      const player = nativeFullscreenPlayer;
      nativeFullscreenPlayer = null;
      if (player) {
        nativeFullscreenUnavailable.delete(player);
        setImmersive(player,false);
      }
      restorePlatformPortrait();
    }, true);

    document.addEventListener('click', event => {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      const button = target?.closest?.('button[data-plyr="fullscreen"]');
      const player = button?.closest?.('.plyr');
      if (!player) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      togglePlayerFullscreen(player);
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const player = document.querySelector('.plyr.akwam-immersive-player');
      if (!player) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.fullscreenElement === player) {
        exitPlayerFullscreen(player);
      } else {
        nativeFullscreenUnavailable.delete(player);
        setImmersive(player, false);
        restorePlatformPortrait();
      }
    }, true);

    function applyEpisodeStartPosition(video) {
      if (!userPlaybackRequested.has(video) || startPositionApplied.has(video) || video.readyState < 1) return;
      const duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      const savedTime = activeWatchProgress?.currentTime || 0;
      const requestedTime = savedTime > 0 ? savedTime : (duration > 85 ? 85 : 0);
      const target = Math.min(requestedTime, Math.max(0,duration - 0.25));
      startPositionApplied.add(video);
      if (Math.abs(Number(video.currentTime) - target) < 1) return;
      try {
        video.currentTime = target;
        lastPlaybackPositions.set(video,target);
        if (activeWatchProgress) activeWatchProgress.currentTime = target;
      } catch (_) {
        startPositionApplied.delete(video);
      }
    }

    function installAdBreak(video) {
      const player = video.closest('.plyr');
      if (!player || adBreakVideos.has(video)) return;
      adBreakVideos.add(video);
      player.classList.add('akwam-ad-supported');

      const overlay = document.createElement('div');
      overlay.className = 'akwam-ad-break';
      overlay.setAttribute('role','region');
      overlay.setAttribute('aria-label','إعلان');

      const adFrameShell = document.createElement('div');
      adFrameShell.className = 'akwam-ad-frame-shell';
      const adFrame = document.createElement('iframe');
      adFrame.className = 'akwam-ad-frame';
      adFrame.setAttribute('title','إعلان ممول');
      adFrame.setAttribute('loading','eager');
      adFrame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
      adFrame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-storage-access-by-user-activation');
      adFrame.src = 'about:blank';
      adFrameShell.appendChild(adFrame);

      const countdownLabel = document.createElement('div');
      countdownLabel.className = 'akwam-ad-countdown';
      countdownLabel.setAttribute('aria-live','assertive');
      overlay.appendChild(adFrameShell);
      overlay.appendChild(countdownLabel);

      let nextAdBreakAt = adBreakIntervalSeconds;
      let secondsRemaining = 0;
      let savedPosition = 0;
      let playbackPosition = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      let shouldResume = false;
      let adActive = false;

      function resetPlaybackPosition() {
        if (Number.isFinite(video.currentTime)) playbackPosition = video.currentTime;
      }

      function finishSeeking() {
        resetPlaybackPosition();
        const currentPosition = Number(video.currentTime);
        if (!Number.isFinite(currentPosition) || currentPosition < nextAdBreakAt) return;
        nextAdBreakAt = (Math.floor(currentPosition / adBreakIntervalSeconds) + 1) * adBreakIntervalSeconds;
      }

      function updateCountdown() {
        countdownLabel.textContent = 'إعلان — سيستأنف الفيديو خلال ' + secondsRemaining + ' ثوانٍ';
      }

      function closeAdBreak() {
        adFrame.src = 'about:blank';
        overlay.remove();
        adActive = false;
        if (!shouldResume) {
          if (video.ended) advanceEpisode(video,true);
          return;
        }
        try { video.currentTime = savedPosition; }
        catch (_) {}
        try {
          const playback = video.play();
          if (playback && typeof playback.catch === 'function') playback.catch(() => {});
        } catch (_) {}
      }

      function openAdBreak() {
        adActive = true;
        savedPosition = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        shouldResume = video.paused === false && !video.ended;
        if (shouldResume) video.pause();
        secondsRemaining = adBreakDurationSeconds;
        updateCountdown();
        if (document.fullscreenElement === player) {
          overlay.className = 'akwam-ad-break akwam-ad-break-immersive';
          player.appendChild(overlay);
        } else if (player.classList.contains('akwam-immersive-player')) {
          overlay.className = 'akwam-ad-break akwam-ad-break-immersive';
          (document.body || document.documentElement).appendChild(overlay);
        } else {
          player.appendChild(overlay);
        }
        adFrame.src = adBridgeUrl || adLinkUrl;
      }

      function updatePlaybackProgress(endedEvent=false) {
        if (adActive) return;
        const currentPosition = Number(video.currentTime);
        if (video.ended) {
          if (Number.isFinite(currentPosition)) playbackPosition = currentPosition;
          if (endedEvent && Number.isFinite(currentPosition) && currentPosition >= nextAdBreakAt) {
            do {
              nextAdBreakAt += adBreakIntervalSeconds;
            } while (nextAdBreakAt <= currentPosition);
            openAdBreak();
          }
          return;
        }
        if (video.paused !== false || video.readyState < 2 || video.seeking) {
          if (Number.isFinite(currentPosition)) playbackPosition = currentPosition;
          return;
        }
        const elapsedMediaSeconds = currentPosition - playbackPosition;
        playbackPosition = currentPosition;
        if (!Number.isFinite(elapsedMediaSeconds) || elapsedMediaSeconds <= 0) return;
        if (currentPosition >= nextAdBreakAt) {
          do {
            nextAdBreakAt += adBreakIntervalSeconds;
          } while (nextAdBreakAt <= currentPosition);
          openAdBreak();
        }
      }

      function willOccurBeforeEnd() {
        if (adActive || video.paused !== false || video.ended || video.seeking || !Number.isFinite(video.duration)) return false;
        const remainingMediaSeconds = video.duration - Number(video.currentTime);
        const remainingAdSeconds = nextAdBreakAt - Number(video.currentTime);
        const playbackRate = Number(video.playbackRate) || 1;
        return remainingMediaSeconds > 0 && remainingAdSeconds > 0 &&
          remainingAdSeconds <= remainingMediaSeconds / playbackRate;
      }

      adBreakStates.set(video, {
        updatePlaybackProgress,
        isActive:() => adActive,
        willOccurBeforeEnd
      });

      video.addEventListener('seeking',resetPlaybackPosition);
      video.addEventListener('seeked',finishSeeking);
      video.addEventListener('ratechange',resetPlaybackPosition);

      setInterval(() => {
        if (adActive) {
          secondsRemaining -= 1;
          if (secondsRemaining <= 0) closeAdBreak();
          else updateCountdown();
          return;
        }
        updatePlaybackProgress();
      },1000);
    }

    let customPlayerStyle;

    function installCustomPlayer(video) {
      const player = video.closest('.plyr');
      if (!player || player.dataset?.akwamCustomReady === '1') return;
      if (!player.querySelector('.plyr__video-wrapper')) return;

      if (!customPlayerStyle) {
        customPlayerStyle = document.createElement('style');
        customPlayerStyle.textContent = '.akwam-custom-player .plyr__controls,.akwam-custom-player .plyr__control--overlaid{display:none!important}' +
          '.akwam-custom-player:not(.akwam-immersive-player){position:relative!important}' +
          '.akwam-custom-player .akwam-player-ui{position:absolute;inset:0;z-index:20;color:#fff;font:500 14px/1.4 system-ui,sans-serif;direction:rtl;pointer-events:none}' +
          '.akwam-player-title{position:absolute;top:0;left:0;right:0;padding:16px 20px 34px;background:linear-gradient(#000b,transparent);font-size:15px;font-weight:700;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '.akwam-player-center{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}' +
          '.akwam-custom-player .akwam-player-button{width:40px!important;height:40px!important;display:grid;place-items:center;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;pointer-events:auto;transition:background .15s ease,transform .15s ease}' +
          '.akwam-custom-player .akwam-player-button:hover{background:#ffffff22;transform:scale(1.06)}' +
          '.akwam-custom-player .akwam-player-button:focus-visible{outline:2px solid #d5f287;outline-offset:3px}' +
          '.akwam-custom-player .akwam-player-button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}' +
          '.akwam-custom-player .akwam-player-center-button{width:76px!important;height:76px!important;background:#d5f287;color:#11150f;box-shadow:0 8px 32px #0008}' +
          '.akwam-custom-player .akwam-player-center-button:hover{background:#e3ffa0}' +
          '.akwam-custom-player .akwam-player-center-button svg{width:32px;height:32px}' +
          '.akwam-player-center-button[hidden],.akwam-player-button[hidden]{display:none!important}' +
          '.akwam-player-controls{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:8px;padding:28px 18px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(transparent,#000d 34%,#000e);pointer-events:auto;opacity:1;transition:opacity .22s ease}' +
          '.akwam-custom-player .akwam-player-seek{width:100%!important;height:6px!important;margin:0!important;appearance:none!important;border:0!important;border-radius:9px!important;background:linear-gradient(to right,#d5f287 0%,#d5f287 var(--akwam-progress,0%),#ffffff66 var(--akwam-progress,0%),#ffffff66 100%)!important;cursor:pointer;direction:ltr}' +
          '.akwam-custom-player .akwam-player-seek::-webkit-slider-thumb{width:13px;height:13px;appearance:none;border:0;border-radius:50%;background:#d5f287;box-shadow:0 1px 5px #0008}' +
          '.akwam-custom-player .akwam-player-seek::-moz-range-thumb{width:13px;height:13px;border:0;border-radius:50%;background:#d5f287;box-shadow:0 1px 5px #0008}' +
          '.akwam-player-row{display:flex;align-items:center;gap:8px;min-height:40px;direction:ltr}' +
          '.akwam-player-time{min-width:94px;color:#fff;font-size:12px;font-variant-numeric:tabular-nums;text-align:center;direction:ltr}' +
          '.akwam-player-spacer{flex:1}' +
          '.akwam-player-volume{display:flex;align-items:center;gap:4px}' +
          '.akwam-custom-player .akwam-player-volume-range{width:82px!important;height:4px!important;appearance:none!important;accent-color:#d5f287;cursor:pointer}' +
          '.akwam-player-settings{position:absolute;right:18px;bottom:86px;z-index:2;width:min(270px,calc(100% - 36px));padding:12px;border:1px solid #ffffff20;border-radius:12px;background:#10130ff2;box-shadow:0 10px 35px #0009;pointer-events:auto;backdrop-filter:blur(12px)}' +
          '.akwam-player-settings[hidden]{display:none!important}' +
          '.akwam-player-settings-title{margin:0 0 8px;color:#d5f287;font-size:13px;font-weight:700}' +
          '.akwam-player-setting{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:6px 0;color:#fff;font-size:13px}' +
          '.akwam-player-setting select{max-width:132px;padding:7px 9px;border:1px solid #ffffff24;border-radius:7px;background:#22271f;color:#fff;font:inherit;direction:ltr}' +
          '.akwam-custom-player.akwam-controls-hidden .akwam-player-controls,.akwam-custom-player.akwam-controls-hidden .akwam-player-title{opacity:0;pointer-events:none}' +
          '@media(max-width:600px){.akwam-player-controls{gap:6px;padding:24px 10px calc(8px + env(safe-area-inset-bottom))}.akwam-player-row{gap:4px;min-height:38px}.akwam-custom-player .akwam-player-button{width:36px!important;height:36px!important}.akwam-custom-player .akwam-player-button svg{width:19px;height:19px}.akwam-player-time{min-width:82px;font-size:11px}.akwam-custom-player .akwam-player-volume .akwam-player-volume-range{display:none!important}.akwam-custom-player .akwam-player-center-button{width:64px!important;height:64px!important}.akwam-custom-player .akwam-player-center-button svg{width:28px;height:28px}.akwam-player-settings{right:10px;bottom:76px}}' +
          '@media(prefers-reduced-motion:reduce){.akwam-player-button,.akwam-player-controls{transition:none}}';
        (document.head || document.documentElement).appendChild(customPlayerStyle);
      }

      player.dataset.akwamCustomReady = '1';
      player.classList.add('akwam-custom-player');
      const ui = document.createElement('div');
      ui.className = 'akwam-player-ui';
      ui.setAttribute('dir','rtl');

      const heading = document.createElement('div');
      heading.className = 'akwam-player-title';
      const titleParts = [document.querySelector('h1')?.textContent,document.querySelector('h2')?.textContent]
        .map(value => String(value || '').trim()).filter(Boolean);
      heading.textContent = titleParts.join(' - ') || document.title.split('|')[0].trim();

      const playPath = '<path d="M9 5.5v13L19 12 9 5.5Z" fill="currentColor" stroke="none"/>';
      const pausePath = '<path d="M7.5 5h3.5v14H7.5zM14 5h3.5v14H14z" fill="currentColor" stroke="none"/>';
      function makeButton(name,label,path) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'akwam-player-button akwam-player-' + name;
        button.setAttribute('aria-label',label);
        button.title = label;
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
        return button;
      }

      const center = document.createElement('div');
      center.className = 'akwam-player-center';
      const centerButton = makeButton('center-button','تشغيل الفيديو',playPath);
      centerButton.classList.add('akwam-player-center-button');
      center.appendChild(centerButton);

      const controls = document.createElement('div');
      controls.className = 'akwam-player-controls';
      const seek = document.createElement('input');
      seek.className = 'akwam-player-seek';
      seek.type = 'range';
      seek.min = '0';
      seek.max = '1000';
      seek.step = '1';
      seek.value = '0';
      seek.setAttribute('aria-label','موضع التشغيل');

      const row = document.createElement('div');
      row.className = 'akwam-player-row';
      const playButton = makeButton('play','تشغيل',playPath);
      const time = document.createElement('span');
      time.className = 'akwam-player-time';
      time.textContent = '00:00 / 00:00';
      const volume = document.createElement('div');
      volume.className = 'akwam-player-volume';
      const muteButton = makeButton('mute','تشغيل الصوت','<path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none"/><path d="M16 9l5 6m0-6-5 6"/>');
      const volumeRange = document.createElement('input');
      volumeRange.className = 'akwam-player-volume-range';
      volumeRange.type = 'range';
      volumeRange.min = '0';
      volumeRange.max = '1';
      volumeRange.step = '0.05';
      volumeRange.value = '1';
      volumeRange.setAttribute('aria-label','مستوى الصوت');
      volume.append(muteButton,volumeRange);
      const spacer = document.createElement('span');
      spacer.className = 'akwam-player-spacer';
      const settingsButton = makeButton('settings-toggle','إعدادات المشغل','<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" transform="translate(1 3) scale(.85)"/>');
      settingsButton.setAttribute('aria-expanded','false');
      const pipButton = makeButton('pip','نافذة عائمة','<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none"/>');
      const fullscreenButton = makeButton('fullscreen','ملء الشاشة','<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>');
      row.append(playButton,time,volume,spacer,settingsButton,pipButton,fullscreenButton);
      controls.append(seek,row);

      const settings = document.createElement('div');
      settings.className = 'akwam-player-settings';
      settings.hidden = true;
      settings.setAttribute('aria-label','إعدادات المشغل');
      const settingsTitle = document.createElement('div');
      settingsTitle.className = 'akwam-player-settings-title';
      settingsTitle.textContent = 'إعدادات المشغل';
      settings.appendChild(settingsTitle);
      function addSetting(labelText,options) {
        const label = document.createElement('label');
        label.className = 'akwam-player-setting';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const select = document.createElement('select');
        select.setAttribute('aria-label',labelText);
        for (const item of options) {
          const option = document.createElement('option');
          option.value = String(item.value);
          option.textContent = item.label;
          select.appendChild(option);
        }
        label.append(caption,select);
        settings.appendChild(label);
        return select;
      }
      const speedOptions = [
        {value:0.5,label:'0.5×'},{value:0.75,label:'0.75×'},{value:1,label:'عادي'},
        {value:1.25,label:'1.25×'},{value:1.5,label:'1.5×'},{value:1.75,label:'1.75×'},
        {value:2,label:'2×'},{value:4,label:'4×'}
      ];
      const speedSelect = addSetting('سرعة التشغيل',speedOptions);
      speedSelect.value = String(video.playbackRate || 1);
      speedSelect.addEventListener('change',() => { video.playbackRate = Number(speedSelect.value); });
      let qualitySelect = null;
      let captionsSelect = null;
      function refreshOptionalSettings() {
        const engine = video.plyr;
        const qualities = Array.isArray(engine?.options?.quality)
          ? [...new Set(engine.options.quality.map(Number).filter(Number.isFinite))].sort((a,b) => a-b)
          : [];
        if (qualities.length > 1 && !qualitySelect) {
          qualitySelect = addSetting('جودة الفيديو',qualities.map(value => ({value,label:value + 'p'})));
          qualitySelect.addEventListener('change',() => {
            try { if (video.plyr) video.plyr.quality = Number(qualitySelect.value); }
            catch (_) {}
          });
        }
        if (qualitySelect && engine) qualitySelect.value = String(engine.quality || qualities[qualities.length - 1]);

        const tracks = Array.from(video.textTracks || []);
        if (tracks.length && !captionsSelect) {
          const captionOptions = [{value:'off',label:'إيقاف'}].concat(tracks.map((track,index) => ({
            value:index,
            label:track.label || track.language || ('ترجمة ' + (index + 1))
          })));
          captionsSelect = addSetting('الترجمة',captionOptions);
          captionsSelect.addEventListener('change',() => {
            for (let index = 0; index < tracks.length; index++) {
              tracks[index].mode = captionsSelect.value === String(index) ? 'showing' : 'disabled';
            }
          });
        }
      }

      let lastVolume = video.volume || 1;
      function updatePlayState() {
        const paused = video.paused || video.ended;
        const icon = paused ? playPath : pausePath;
        const label = paused ? 'تشغيل' : 'إيقاف مؤقت';
        playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg>';
        playButton.setAttribute('aria-label',label);
        playButton.title = label;
        centerButton.hidden = !paused;
        player.classList.toggle('akwam-player-playing',!paused);
      }
      function updateVolume() {
        const muted = video.muted || video.volume === 0;
        const icon = muted
          ? '<path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none"/><path d="M16 9l5 6m0-6-5 6"/>'
          : '<path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none"/><path d="M16 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/>';
        muteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg>';
        muteButton.setAttribute('aria-label',muted ? 'تشغيل الصوت' : 'كتم الصوت');
        muteButton.title = muted ? 'تشغيل الصوت' : 'كتم الصوت';
        muteButton.setAttribute('aria-pressed',String(muted));
        volumeRange.value = muted ? '0' : String(video.volume);
        if (!muted && video.volume > 0) lastVolume = video.volume;
      }
      function updateFullscreenState() {
        const active = player.classList.contains('akwam-immersive-player');
        const label = active ? 'إنهاء ملء الشاشة' : 'ملء الشاشة';
        fullscreenButton.setAttribute('aria-label',label);
        fullscreenButton.setAttribute('aria-pressed',String(active));
        fullscreenButton.title = label;
      }
      function formatTime(value) {
        if (!Number.isFinite(value) || value < 0) return '00:00';
        const seconds = Math.floor(value);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor(seconds / 60) % 60;
        const remainder = seconds % 60;
        const pad = number => String(number).padStart(2,'0');
        return hours ? hours + ':' + pad(minutes) + ':' + pad(remainder) : minutes + ':' + pad(remainder);
      }
      function updateProgress() {
        const duration = video.duration;
        const fraction = Number.isFinite(duration) && duration > 0 ? Math.max(0,Math.min(1,video.currentTime / duration)) : 0;
        seek.value = String(Math.round(fraction * 1000));
        seek.style.setProperty('--akwam-progress',(fraction * 100) + '%');
        time.textContent = formatTime(video.currentTime) + ' / ' + formatTime(duration);
      }
      function togglePlayback() {
        if (video.paused || video.ended) {
          userPlaybackRequested.add(video);
          const player = video.closest('.plyr');
          if (player && document.fullscreenElement !== player && !player.classList.contains('akwam-immersive-player')) {
            togglePlayerFullscreen(player);
          }
          applyEpisodeStartPosition(video);
          try { const playback = video.play(); if (playback?.catch) playback.catch(() => {}); }
          catch (_) {}
        } else {
          video.pause();
        }
      }
      function closeSettings() {
        settings.hidden = true;
        settingsButton.setAttribute('aria-expanded','false');
      }

      settingsButton.addEventListener('click',() => {
        settings.hidden = !settings.hidden;
        settingsButton.setAttribute('aria-expanded',String(!settings.hidden));
        if (!settings.hidden) refreshOptionalSettings();
      });
      playButton.addEventListener('click',togglePlayback);
      centerButton.addEventListener('click',event => { event.stopPropagation(); togglePlayback(); });
      muteButton.addEventListener('click',() => {
        if (video.muted || video.volume === 0) {
          video.muted = false;
          if (video.volume === 0) video.volume = lastVolume || 1;
        } else {
          lastVolume = video.volume || 1;
          video.muted = true;
        }
      });
      volumeRange.addEventListener('input',() => {
        const value = Number(volumeRange.value);
        video.volume = value;
        video.muted = value === 0;
        if (value > 0) lastVolume = value;
      });
      seek.addEventListener('input',() => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          userProgressInteraction.add(video);
          markSeekGrace(video);
          lastPlaybackPositions.set(video,video.duration * Number(seek.value) / 1000);
          video.currentTime = video.duration * Number(seek.value) / 1000;
          updateProgress();
        }
      });
      fullscreenButton.addEventListener('click',() => {
        togglePlayerFullscreen(player);
      });
      const pipAvailable = Boolean(document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function');
      pipButton.addEventListener('click',async () => {
        try {
          if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
          else await video.requestPictureInPicture();
        } catch (_) {}
      });
      player.addEventListener('click',event => {
        if (!settings.contains(event.target) && !settingsButton.contains(event.target)) closeSettings();
      });
      player.addEventListener('keydown',event => {
        if (event.target?.closest?.('button,input,select')) return;
        if (event.code === 'Space' || event.key === 'k') { event.preventDefault(); togglePlayback(); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); userProgressInteraction.add(video); video.currentTime = Math.min(video.duration || 0,video.currentTime + 10); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); userProgressInteraction.add(video); video.currentTime = Math.max(0,video.currentTime - 10); }
      });

      ui.append(heading,center,controls,settings);
      player.appendChild(ui);
      if (!pipAvailable) pipButton.remove();
      refreshOptionalSettings();
      updatePlayState();
      updateVolume();
      updateProgress();
      updateFullscreenState();

      let hideTimer = 0;
      function revealControls() {
        player.classList.remove('akwam-controls-hidden');
        clearTimeout(hideTimer);
        if (!video.paused) hideTimer = setTimeout(() => player.classList.add('akwam-controls-hidden'),2800);
      }
      player.addEventListener('pointermove',revealControls,{passive:true});
      player.addEventListener('pointerdown',revealControls,{passive:true});
      for (const eventName of ['play','playing']) video.addEventListener(eventName,() => { updatePlayState(); revealControls(); });
      video.addEventListener('pause',() => { updatePlayState(); revealControls(); });
      video.addEventListener('ended',updatePlayState);
      for (const eventName of ['timeupdate','loadedmetadata','durationchange','seeked']) video.addEventListener(eventName,updateProgress);
      video.addEventListener('volumechange',updateVolume);
      video.addEventListener('ratechange',() => { speedSelect.value = String(video.playbackRate); });
      video.addEventListener('loadedmetadata',refreshOptionalSettings);
      revealControls();
    }

    function watchVideo(video) {
      if (video.tagName !== "VIDEO") return;
      const alreadyAttached = attachedVideos.has(video);
      if (!alreadyAttached) {
        try {
          video.autoplay = false;
          video.preload = 'metadata';
          video.removeAttribute?.('autoplay');
        } catch (_) {}
      }
      installCustomPlayer(video);
      installAdBreak(video);
      if (alreadyAttached) return;
      attachedVideos.add(video);
      window.addEventListener('pagehide',() => saveWatchProgress(video,true));
      lastPlaybackPositions.set(video,Number(video.currentTime));
      video.addEventListener("seeking", () => {
        markSeekGrace(video);
        lastPlaybackPositions.set(video,Number(video.currentTime));
        saveWatchProgress(video,true);
      });
      video.addEventListener("seeked", () => {
        markSeekGrace(video);
        lastPlaybackPositions.set(video,Number(video.currentTime));
        saveWatchProgress(video,true);
      });
      video.addEventListener("play", () => {
        if (!userPlaybackRequested.has(video)) video.pause();
      });
      video.addEventListener("timeupdate", () => saveWatchProgress(video));
      video.addEventListener("pause", () => saveWatchProgress(video,true));
      video.addEventListener("timeupdate", () => advanceEpisode(video));
      video.addEventListener("ended", () => {
        saveWatchProgress(video,true);
        advanceEpisode(video,true);
      });
      for (const eventName of ["loadedmetadata","durationchange","loadeddata"]) {
        video.addEventListener(eventName,() => applyEpisodeStartPosition(video));
      }
      if (video.paused === false) video.pause();
    }

    function watchVideos(root) {
      if (root.nodeType === 1) watchVideo(root);
      if (root.querySelectorAll) root.querySelectorAll("video").forEach(watchVideo);
    }

    watchVideos(document.documentElement);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes") {
          const player = record.target.closest?.(".plyr");
          if (player) watchVideos(player);
          continue;
        }
        for (const node of record.addedNodes) watchVideos(node);
      }
    }).observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
  }
  function installMobileSearch() {
    const row = document.querySelector('.main-header .row');
    const searchBox = document.querySelector('.search-box');
    const searchToggle = searchBox?.querySelector('.search-toggle');
    const input = searchBox?.querySelector('input[type="search"]');
    if (!row || !searchToggle || !input || document.querySelector('.akwam-mobile-search-button')) return;

    const labels = {
      ar:'بحث',en:'Search',tr:'Ara',fr:'Rechercher',de:'Suchen',es:'Buscar',it:'Cerca',pt:'Pesquisar',
      ru:'Поиск',fa:'جستجو',ur:'تلاش',hi:'खोजें',id:'Cari',ja:'検索',ko:'검색','zh-CN':'搜索'
    };
    const label = labels[lang] || 'Search';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'akwam-mobile-search-button';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('data-akwam-generated-ui', 'true');
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
    button.addEventListener('click', () => {
      searchToggle.click();
      input.focus({preventScroll:true});
    });

    const style = document.createElement('style');
    style.textContent = '.akwam-mobile-search-button{display:none;align-items:center;justify-content:center;width:44px;height:44px;margin:0 2px;padding:0;border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;flex:0 0 auto}' +
      '.akwam-mobile-search-button:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
      '@media(max-width:767px){.akwam-mobile-search-button{display:inline-flex!important}}';
    document.head.appendChild(style);
    row.insertBefore(button, document.querySelector('.user-profile-container'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installMobileSearch, {once:true});
  } else {
    installMobileSearch();
  }

  const footerBrands = {
    ar:'مسلسلات توركيفاي',
    en:'Turkify Series',
    tr:'Turkify Dizileri',
    fr:'Séries Turkify',
    de:'Turkify-Serien',
    es:'Series de Turkify',
    it:'Serie Turkify',
    pt:'Séries Turkify',
    ru:'Сериалы Turkify',
    fa:'سریال‌های تورکیفای',
    ur:'ترکیفائی سیریز',
    hi:'टर्किफ़ाई सीरीज़',
    id:'Serial Turkify',
    ja:'Turkifyシリーズ',
    ko:'Turkify 시리즈',
    'zh-CN':'Turkify 剧集'
  };
  const footerCopyrights = {
    ar:'جميع الحقوق محفوظة لـ {brand} © {year}',
    en:'All rights reserved to {brand} © {year}',
    tr:'Tüm hakları saklıdır: {brand} © {year}',
    fr:'Tous droits réservés à {brand} © {year}',
    de:'Alle Rechte vorbehalten für {brand} © {year}',
    es:'Todos los derechos reservados para {brand} © {year}',
    it:'Tutti i diritti riservati a {brand} © {year}',
    pt:'Todos os direitos reservados a {brand} © {year}',
    ru:'Все права защищены: {brand} © {year}',
    fa:'تمامی حقوق برای {brand} محفوظ است © {year}',
    ur:'{brand} کے تمام حقوق محفوظ ہیں © {year}',
    hi:'{brand} के सर्वाधिकार सुरक्षित © {year}',
    id:'Hak cipta {brand} dilindungi © {year}',
    ja:'{brand} の全著作権を保有します © {year}',
    ko:'{brand} 판권 소유 © {year}',
    'zh-CN':'版权所有：{brand} © {year}'
  };
  const footerBrand = footerBrands[lang] || footerBrands.en;

  function isFooterBrand(value) {
    return /^(?:شبكة\s*)?(?:[اأإآ]?كوام|akwam(?:\s+network)?)$/i.test(String(value || '').replace(/\s+/g, ' ').trim());
  }

  function blockFooterAction(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function updateFooter() {
    const footer = document.querySelector?.('footer');
    if (!footer) return;

    if (footer.getAttribute('data-turkify-actions-blocked') !== 'true') {
      for (const eventName of ['click','auxclick','dblclick','keydown','submit']) {
        footer.addEventListener(eventName, blockFooterAction, true);
      }
      footer.setAttribute('data-turkify-actions-blocked', 'true');
    }

    const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
    const labels = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (isFooterBrand(node.nodeValue)) labels.push(node);
    }
    for (const node of labels) {
      node.nodeValue = footerBrand;
      node.parentElement?.setAttribute('data-akwam-generated-ui', 'true');
    }

    const copyright = footer.querySelector('.copyright');
    if (copyright) {
      const year = copyright.textContent.match(/\b\d{4}\b/)?.[0] || String(new Date().getFullYear());
      const template = footerCopyrights[lang] || footerCopyrights.en;
      const localized = template.replace('{brand}', footerBrand).replace('{year}', year);
      if (copyright.textContent !== localized) copyright.textContent = localized;
      if (copyright.getAttribute('data-akwam-generated-ui') !== 'true') {
        copyright.setAttribute('data-akwam-generated-ui', 'true');
      }
    }

    for (const control of footer.querySelectorAll('a,area,button,input,select,textarea,[role="button"],[role="link"],[tabindex]')) {
      if (control.hasAttribute('href')) control.removeAttribute('href');
      if (control.hasAttribute('target')) control.removeAttribute('target');
      if (control.hasAttribute('download')) control.removeAttribute('download');
      if (control.hasAttribute('onclick')) control.removeAttribute('onclick');
      if ('disabled' in control) control.disabled = true;
      if (control.getAttribute('aria-disabled') !== 'true') control.setAttribute('aria-disabled', 'true');
      if (control.getAttribute('tabindex') !== '-1') control.setAttribute('tabindex', '-1');
      if (control.style) {
        control.style.pointerEvents = 'none';
        control.style.cursor = 'default';
      }
    }
  }

  function normalizeEpisodeTitle(value) {
    const normalizeDigits = digits => digits.replace(/[٠-٩۰-۹]/g, digit => {
      const code = digit.codePointAt(0);
      return String(code - (code >= 0x6f0 ? 0x6f0 : 0x660));
    });
    const sameNumber = (first, repeated) => normalizeDigits(first) === normalizeDigits(repeated);
    const adjacentDuplicate = String(value || '').replace(
      /((?:ال)?حلقة|\bepisode\b)(\s*[:：]?\s*)([0-9٠-٩۰-۹]+)\s+([0-9٠-٩۰-۹]+)(?![0-9٠-٩۰-۹])/gi,
      (match, label, separator, number, repeated) =>
        sameNumber(number, repeated) ? label + separator + number : match
    );
    return adjacentDuplicate.replace(
      /((?:ال)?حلقة)(\s*[:：]?\s*)([0-9٠-٩۰-۹]+)(\s*[:：]\s*مسلسل\s+[\s\S]*?\S)\s+([0-9٠-٩۰-۹]+)(?![0-9٠-٩۰-۹])$/gi,
      (match, label, separator, number, title, repeated) =>
        sameNumber(number, repeated) ? label + separator + number + title : match
    );
  }

  function normalizeEpisodeTitles(root) {
    if (!episodePage && !seriesPage && !watchPage) return;
    const scope = root?.nodeType === 3 ? root.parentElement : root;
    if (!scope) return;

    const titles = new Set();
    const containingTitle = scope.closest?.('title, .entry-title, a[href*="/episode/"]');
    if (containingTitle) titles.add(containingTitle);
    if (scope.matches?.('title, .entry-title, a[href*="/episode/"]')) titles.add(scope);
    scope.querySelectorAll?.('title, .entry-title, a[href*="/episode/"]').forEach(title => titles.add(title));

    for (const title of titles) {
      const current = title.textContent || '';
      const normalized = normalizeEpisodeTitle(current);
      if (normalized !== current) title.textContent = normalized;
    }
  }

  function watchEpisodeTitles() {
    if (!episodePage && !seriesPage && !watchPage) return;
    normalizeEpisodeTitles(document.documentElement);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') normalizeEpisodeTitles(record.target);
        else for (const node of record.addedNodes) normalizeEpisodeTitles(node);
      }
    }).observe(document.documentElement, {subtree:true,childList:true,characterData:true});
  }

  watchEpisodeTitles();
  rewriteAttributes(document.documentElement);
  updateFooter();
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') rewriteAttributes(record.target);
      else for (const node of record.addedNodes) rewriteAttributes(node);
    }
    updateFooter();
  }).observe(document.documentElement, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['href','src','action','target']
  });
})();`;
