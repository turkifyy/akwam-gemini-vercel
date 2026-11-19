export const translatorScript = String.raw`(() => {
  'use strict';
  const bridge = window.__AKWAM_BRIDGE__ || {};
  const lang = String(bridge.lang || 'ar');
  const ignored = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','CODE','PRE','TEXTAREA','IFRAME']);
  const textRecords = new WeakMap();
  const attrRecords = new WeakMap();
  const pending = new Map();
  const cacheKey = 'akwam-gemini-cache-v1:' + lang;
  const cache = new Map();
  const MAX_CHUNK = 700;
  let draining = false;
  let translated = 0;
  let queued = 0;

  try {
    const stored = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    for (const pair of stored) if (Array.isArray(pair) && pair.length === 2) cache.set(pair[0], pair[1]);
  } catch (_) {}

  function report(type, details) {
    if (typeof bridge.post === 'function') bridge.post(type, Object.assign({lang}, details || {}));
  }

  function saveCache() {
    try { localStorage.setItem(cacheKey, JSON.stringify([...cache.entries()].slice(-2500))); }
    catch (_) {}
  }

  function installPosterStyles() {
    if (document.getElementById('akwam-poster-translation-style')) return;
    const style = document.createElement('style');
    style.id = 'akwam-poster-translation-style';
    style.textContent = [
      '.entry-image.akwam-poster-host{position:relative!important}',
      '.akwam-poster-translation{position:absolute;inset:auto 6px 6px;z-index:4;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;padding:7px 9px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:linear-gradient(135deg,rgba(8,11,17,.9),rgba(8,11,17,.72));box-shadow:0 4px 12px rgba(0,0,0,.32);backdrop-filter:blur(4px);color:#fff;font-family:inherit;font-size:clamp(10px,.85vw,12px);font-weight:700;line-height:1.4;text-align:start;text-shadow:0 1px 2px #000;pointer-events:none}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function renderPosterTitle(image, translated, source) {
    if (image.tagName !== 'IMG') return;
    const host = image.closest('.entry-image');
    if (!host) return;
    const title = String(translated || '').trim() || String(source || '').trim();
    let label = host.querySelector(':scope > .akwam-poster-translation');
    if (!title) {
      label?.remove();
      host.classList.remove('akwam-poster-host');
      return;
    }
    if (!label) {
      label = document.createElement('span');
      label.className = 'akwam-poster-translation';
      label.dataset.akwamGeneratedUi = 'true';
      label.setAttribute('aria-hidden', 'true');
      host.appendChild(label);
    }
    host.classList.add('akwam-poster-host');
    label.dir = ['ar','fa','ur','he'].includes(lang) ? 'rtl' : 'ltr';
    label.textContent = title;
  }

  function splitLongText(value) {
    const parts = [];
    let start = 0;
    while (start < value.length) {
      let end = Math.min(value.length, start + MAX_CHUNK);
      if (end < value.length) {
        const boundary = value.lastIndexOf(' ', end);
        if (boundary > start + MAX_CHUNK * 0.55) end = boundary + 1;
      }
      const raw = value.slice(start, end);
      const trailing = raw.match(/\s*$/)?.[0] || '';
      const text = raw.slice(0, raw.length - trailing.length);
      if (text) parts.push({text, trailing});
      start = end;
    }
    return parts;
  }

  function enqueue(value, apply) {
    if (cache.has(value)) {
      apply(cache.get(value));
      return;
    }
    const callbacks = pending.get(value) || [];
    callbacks.push(apply);
    pending.set(value, callbacks);
    queued += callbacks.length === 1 ? 1 : 0;
    if (!draining) setTimeout(drain, 120);
  }

  async function drain() {
    if (draining || pending.size === 0) return;
    draining = true;
    while (pending.size) {
      const batch = [...pending.entries()].slice(0, 20);
      for (const [value] of batch) pending.delete(value);
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: {'content-type':'application/json'},
          body: JSON.stringify({targetLang:lang, texts:batch.map(([value]) => value)})
        });
        if (!response.ok) {
          const error = new Error('Translation service returned ' + response.status);
          error.status = response.status;
          throw error;
        }
        const result = await response.json();
        if (!Array.isArray(result.translations) || result.translations.length !== batch.length) {
          throw new Error('Translation service returned an invalid response');
        }
        result.translations.forEach((value, index) => {
          const source = batch[index][0];
          const translatedValue = String(value);
          cache.set(source, translatedValue);
          translated += 1;
          for (const apply of batch[index][1]) apply(translatedValue);
        });
        saveCache();
        report('translation-progress', {translated, queued, pending:pending.size});
      } catch (error) {
        const status = Number(error.status) || 0;
        report('translation-error', {
          message:String(error.message || 'Translation failed'),
          status,
          retryable:!status || status >= 500
        });
        break;
      }
    }
    draining = false;
  }

  function processText(node) {
    if (!node.parentElement || ignored.has(node.parentElement.tagName)) return;
    if (node.parentElement.closest('[contenteditable="true"],[aria-hidden="true"],[data-akwam-generated-ui]')) return;
    const source = node.nodeValue || '';
    const trimmed = source.trim();
    const previous = textRecords.get(node);
    if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed) || (previous && (trimmed === previous.source || trimmed === previous.translated))) return;

    const leading = source.match(/^\s*/)?.[0] || '';
    const trailing = source.match(/\s*$/)?.[0] || '';
    const pieces = splitLongText(trimmed);
    const outputs = new Array(pieces.length);
    let remaining = pieces.length;
    const record = {source:trimmed, translated:null};
    textRecords.set(node, record);
    pieces.forEach((piece, index) => enqueue(piece.text, value => {
      outputs[index] = value + piece.trailing;
      remaining -= 1;
      if (remaining === 0 && node.isConnected) {
        record.translated = outputs.join('').trim();
        node.nodeValue = leading + outputs.join('').trim() + trailing;
      }
    }));
  }

  function processAttribute(element, name) {
    if (ignored.has(element.tagName) || element.closest('[contenteditable="true"],[data-akwam-generated-ui]')) return;
    if (name === 'value' && !/^(?:button|submit|reset)$/i.test(element.type || '')) return;
    const source = element.getAttribute(name) || '';
    const trimmed = source.trim();
    if (!trimmed || trimmed.length > 700 || !/[\p{L}\p{N}]/u.test(trimmed)) {
      if (name === 'alt') renderPosterTitle(element, '', '');
      return;
    }
    let records = attrRecords.get(element);
    if (!records) { records = new Map(); attrRecords.set(element, records); }
    const previous = records.get(name);
    if (previous && (trimmed === previous.source || trimmed === previous.translated)) return;
    const leading = source.match(/^\s*/)?.[0] || '';
    const trailing = source.match(/\s*$/)?.[0] || '';
    const record = {source:trimmed, translated:null};
    records.set(name, record);
    if (name === 'alt') renderPosterTitle(element, trimmed, trimmed);
    enqueue(trimmed, value => {
      if (!element.isConnected) return;
      const translatedValue = String(value || '').trim() || trimmed;
      record.translated = translatedValue;
      element.setAttribute(name, leading + translatedValue + trailing);
      if (name === 'alt') renderPosterTitle(element, translatedValue, trimmed);
    });
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { processText(root); return; }
    if (root.nodeType === Node.ELEMENT_NODE && !ignored.has(root.tagName)) {
      for (const name of ['title','aria-label','placeholder','alt']) if (root.hasAttribute(name)) processAttribute(root, name);
      if (root.tagName === 'INPUT' && ['button','submit','reset'].includes((root.type || '').toLowerCase())) processAttribute(root, 'value');
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) processText(node);
    if (root.querySelectorAll) for (const element of root.querySelectorAll('[title],[aria-label],[placeholder],[alt],input[type="button"],input[type="submit"],input[type="reset"]')) {
      for (const name of ['title','aria-label','placeholder','alt']) if (element.hasAttribute(name)) processAttribute(element, name);
      if (element.tagName === 'INPUT' && element.hasAttribute('value')) processAttribute(element, 'value');
    }
  }

  function reportFrameState() {
    const archive = Boolean(document.querySelector('.page.page-archive'));
    const header = document.querySelector('.main-header');
    const breadcrumb = document.querySelector('.breadcrumb');
    const bar = breadcrumb?.closest('nav') || breadcrumb;
    const bottom = element => {
      let top = 0;
      for (let current = element; current; current = current.offsetParent) top += current.offsetTop;
      return top + element.offsetHeight;
    };
    const skipHeight = archive ? 524 : Math.min(600, Math.max(0, ...[header,bar].filter(Boolean).map(bottom)));
    report('frame-state', {kind:archive ? 'archive' : 'detail', skipHeight});
  }

  function autoPaginate() {
    if (!document.querySelector('.page.page-archive')) return;
    const current = new URL(location.href);
    const manualAdvanceKey = 'akwam-auto-next-after-manual-v1';
    const getPage = url => {
      const entry = [...url.searchParams].find(([key]) => key.replace(/^;+/, '') === 'page');
      return Number(entry?.[1] || 1);
    };
    const normalizeUrl = url => {
      for (const [key,value] of [...url.searchParams]) {
        const normalized = key.replace(/^;+/, '');
        if (normalized === key) continue;
        url.searchParams.delete(key);
        if (!url.searchParams.has(normalized)) url.searchParams.set(normalized, value);
      }
      return url;
    };
    let advanceAfterManual = false;
    try {
      advanceAfterManual = sessionStorage.getItem(manualAdvanceKey) === '1';
      if (advanceAfterManual) sessionStorage.removeItem(manualAdvanceKey);
    } catch (_) {}

    const page = getPage(current);
    const links = [...document.querySelectorAll('.pagination a.page-link[href]')].map(link => {
      const url = normalizeUrl(new URL(link.href, current));
      if (url.origin === current.origin && url.pathname === current.pathname) link.href = url.href;
      return url;
    });
    const next = links.find(url => url.origin === current.origin && url.pathname === current.pathname && getPage(url) === page + 1);
    if (!next) return;

    let moving = false;
    let pendingTimer = null;
    function clearPending() {
      if (pendingTimer === null) return;
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    function scheduleAdvance(scroller, viewportHeight, requireBottom) {
      if (pendingTimer !== null || moving) return;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (moving || (requireBottom && scroller.scrollHeight - viewportHeight - scroller.scrollTop > 180)) return;
        moving = true;
        location.replace(next.href);
      }, 15000);
    }

    if (advanceAfterManual) scheduleAdvance(null, 0, false);
    document.addEventListener('click', event => {
      const target = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
      const link = target?.closest?.('.pagination a.page-link[href]');
      if (!link) return;
      const url = normalizeUrl(new URL(link.href, current));
      if (url.origin !== current.origin || url.pathname !== current.pathname || getPage(url) !== page + 1) return;
      try { sessionStorage.setItem(manualAdvanceKey, '1'); }
      catch (_) {}
      clearPending();
    }, true);

    const advanceAtBottom = event => {
      if (moving) return;
      const target = event?.target;
      const pageScroll = !target || target === window || target === document ||
        target === document.documentElement || target === document.body;
      const pagination = document.querySelector('.pagination');
      const scroller = pageScroll ? document.scrollingElement || document.documentElement : target;
      if (!pageScroll && (!pagination || (target !== pagination && !target.contains?.(pagination)))) return;
      const viewportHeight = pageScroll ? innerHeight : scroller.clientHeight;
      if (scroller.scrollHeight - viewportHeight - scroller.scrollTop > 180) {
        clearPending();
        return;
      }
      scheduleAdvance(scroller, viewportHeight, true);
    };
    window.addEventListener('scroll', advanceAtBottom, {passive:true});
    document.addEventListener('scroll', advanceAtBottom, {capture:true,passive:true});
    window.addEventListener('resize', advanceAtBottom, {passive:true});
  }

  if (['ar','fa','ur','he'].includes(lang)) {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'rtl';
  } else {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
  }

  installPosterStyles();
  scan(document.documentElement);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') processText(record.target);
      else for (const node of record.addedNodes) scan(node);
      if (record.type === 'attributes') processAttribute(record.target, record.attributeName);
    }
  }).observe(document.documentElement, {
    subtree:true,
    childList:true,
    characterData:true,
    attributes:true,
    attributeFilter:['title','aria-label','placeholder','alt','value']
  });
  reportFrameState();
  autoPaginate();
  report('translation-progress', {translated, queued, pending:pending.size});
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.data?.source === 'akwam-gemini-bridge' && event.data.type === 'frame-state-request') reportFrameState();
  });
})();`;
