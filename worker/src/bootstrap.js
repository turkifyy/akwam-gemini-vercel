export const bootstrapScript = String.raw`(() => {
  'use strict';
  const config = window.__AKWAM_BRIDGE__ || {};
  const lang = String(config.lang || 'ar');
  const parentOrigin = String(config.parentOrigin || '');
  const upstreamHost = String(config.upstreamHost || 'akwam.ss');
  const seoMode = config.seoMode === true;
  const routePath = (seoMode ? '/catalog/' : '/site/') + lang;
  const prefix = location.origin + routePath;
  const originalFetch = window.fetch.bind(window);

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
      const episodeRoute = episodeUrl.pathname.match(/^\/(?:site|catalog)\/[^/]+(\/episode\/\d+(?:\/.*)?)$/);
      if (episodeRoute) {
        try { localStorage.setItem('akwam-watch-progress-v1:' + seriesId, episodeRoute[1]); }
        catch (_) {}
      }
    }

    document.addEventListener('click', event => {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      const link = target?.closest?.('a[href]');
      if (!link) return;

      let destination;
      try { destination = new URL(link.href, location.href); }
      catch (_) { return; }
      const targetSeriesId = destination.pathname.match(/\/series\/(\d+)(?:\/|$)/)?.[1];
      if (!targetSeriesId || destination.hash !== '#series-episodes') return;

      const progressKey = 'akwam-watch-progress-v1:' + targetSeriesId;
      let savedPath = '';
      try { savedPath = localStorage.getItem(progressKey) || ''; }
      catch (_) {}

      if (/^\/episode\/\d+(?:\/|$)/.test(savedPath)) {
        event.preventDefault();
        const resumeUrl = new URL(routePath + savedPath, location.origin);
        if (parentOrigin && !seoMode) resumeUrl.searchParams.set('__parent', parentOrigin);
        location.assign(resumeUrl.href);
        return;
      }

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

  if (/\/watch\/\d+\/\d+(?:\/|$)/.test(location.pathname)) {
    const attachedVideos = new WeakSet();
    const autoplayAttempted = new WeakSet();

    function skipEpisodeIntro(video) {
      if (video.readyState < 1) return;
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 85 && video.currentTime < 85) {
        try {
          video.currentTime = 85;
        } catch (_) {}
      }
    }

    function autoplayEpisode(video) {
      if (video.readyState < 1 || autoplayAttempted.has(video)) return;
      autoplayAttempted.add(video);
      const playMuted = () => {
        video.muted = true;
        try {
          const playback = video.play();
          if (playback && typeof playback.catch === "function") playback.catch(() => {});
        } catch (_) {}
      };
      try {
        const playback = video.play();
        if (playback && typeof playback.catch === "function") playback.catch(playMuted);
      } catch (_) {
        playMuted();
      }
    }

    function watchVideo(video) {
      if (video.tagName !== "VIDEO" || attachedVideos.has(video)) return;
      attachedVideos.add(video);
      for (const eventName of ["durationchange","seeked","play","playing"]) {
        video.addEventListener(eventName, () => skipEpisodeIntro(video));
      }
      video.addEventListener("loadedmetadata", () => {
        skipEpisodeIntro(video);
        autoplayEpisode(video);
      });
      skipEpisodeIntro(video);
      autoplayEpisode(video);
    }

    function watchVideos(root) {
      if (root.nodeType === 1) watchVideo(root);
      if (root.querySelectorAll) root.querySelectorAll("video").forEach(watchVideo);
    }

    watchVideos(document.documentElement);
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) watchVideos(node);
      }
    }).observe(document.documentElement, {subtree:true,childList:true});
  }
  rewriteAttributes(document.documentElement);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') rewriteAttributes(record.target);
      else for (const node of record.addedNodes) rewriteAttributes(node);
    }
  }).observe(document.documentElement, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['href','src','action','target']
  });
})();`;
