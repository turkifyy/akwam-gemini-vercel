export const bootstrapScript = String.raw`(() => {
  'use strict';
  const config = window.__AKWAM_BRIDGE__ || {};
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

  const watchPage = /\/watch\/\d+\/\d+(?:\/|$)/.test(location.pathname);
  post('player-page', {watch:watchPage});

  if (watchPage) {
    const attachedVideos = new WeakSet();
    const autoplayAttempted = new WeakSet();
    const advancedVideos = new WeakSet();
    let nextEpisodeUrl = '';
    let nextEpisodeResolved = false;

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

    function advanceEpisode(video, ended=false) {
      if (advancedVideos.has(video)) return;
      if (!ended && (!Number.isFinite(video.duration) || video.duration <= 70 || video.currentTime < video.duration - 70)) return;
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
      '.akwam-immersive-player button[data-plyr="fullscreen"] .icon--pressed,.akwam-immersive-player button[data-plyr="fullscreen"] .label--pressed{display:block!important}';
    (document.head || document.documentElement).appendChild(immersiveStyle);

    function immersiveDismissKey() {
      const episodeLink = document.querySelector('h2 a[href*="/episode/"], .breadcrumb a[href*="/episode/"], a[href*="/episode/"]');
      try {
        const path = new URL(episodeLink?.href || location.href, location.href).pathname;
        const segments = path.split('/').filter(Boolean);
        const episodeIndex = segments.indexOf('episode');
        const watchIndex = segments.indexOf('watch');
        const episodeId = episodeIndex >= 0 ? segments[episodeIndex + 1]
          : watchIndex >= 0 ? segments[watchIndex + 2] : '';
        return episodeId ? 'akwam-immersive-dismissed-v2:' + episodeId : '';
      } catch (_) { return ''; }
    }

    function immersiveDismissed() {
      const key = immersiveDismissKey();
      if (!key) return false;
      try { return sessionStorage.getItem(key) === '1'; }
      catch (_) { return false; }
    }

    function setImmersive(player, active, manual=false) {
      player.classList.toggle('akwam-immersive-player', active);
      document.documentElement.classList.toggle('akwam-immersive-page', active);
      const button = player.querySelector('button[data-plyr="fullscreen"]');
      if (button) button.setAttribute('aria-pressed', String(active));
      post('player-immersive', {active});

      const key = immersiveDismissKey();
      if (manual && key) {
        try {
          if (active) sessionStorage.removeItem(key);
          else sessionStorage.setItem(key, '1');
        } catch (_) {}
      }
    }

    function currentEpisodeNumber() {
      const episodeLink = document.querySelector('h2 a[href*="/episode/"], .breadcrumb a[href*="/episode/"], a[href*="/episode/"]');
      const labelNumber = String(episodeLink?.innerText || '').match(/\d+/g)?.at(-1);
      if (labelNumber) return Number(labelNumber);

      let path = location.pathname;
      try { path = decodeURIComponent(path); }
      catch (_) {}
      return Number(path.match(/(?:episode|الحلقة)[\s_-]*(\d+)(?:\/|$)/i)?.[1] || 0);
    }

    function enableImmersiveForEpisode(video) {
      const player = video.closest('.plyr');
      if (!player) return;
      setImmersive(player, currentEpisodeNumber() >= 1 && !immersiveDismissed());
    }

    document.addEventListener('click', event => {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      const button = target?.closest?.('button[data-plyr="fullscreen"]');
      const player = button?.closest?.('.plyr');
      if (!player) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setImmersive(player, !player.classList.contains('akwam-immersive-player'), true);
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const player = document.querySelector('.plyr.akwam-immersive-player');
      if (!player) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setImmersive(player, false, true);
    }, true);

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
      video.addEventListener("timeupdate", () => advanceEpisode(video));
      video.addEventListener("ended", () => advanceEpisode(video, true));
      video.addEventListener("loadedmetadata", () => {
        skipEpisodeIntro(video);
        autoplayEpisode(video);
        enableImmersiveForEpisode(video);
      });
      skipEpisodeIntro(video);
      autoplayEpisode(video);
      enableImmersiveForEpisode(video);
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
