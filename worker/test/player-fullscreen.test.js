import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import {bootstrapScript} from '../src/bootstrap.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function makeElement(tagName) {
  const listeners = new Map();
  const element = {
    tagName,className:'',textContent:'',innerHTML:'',title:'',hidden:false,value:'',type:'',
    attributes:{},dataset:{},style:{setProperty() {}},children:[],parentElement:null,
    setAttribute(name,value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(name,callback) {
      const callbacks = listeners.get(name) || [];
      callbacks.push(callback);
      listeners.set(name,callbacks);
    },
    dispatch(name,event={}) { for (const callback of listeners.get(name) || []) callback(event); },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    append(...children) { for (const child of children) this.appendChild(child); },
    remove() {
      const index = this.parentElement?.children?.indexOf(this) ?? -1;
      if (index >= 0) this.parentElement.children.splice(index,1);
      this.parentElement = null;
    },
    contains(child) {
      return child === this || this.children.some(item => item.contains?.(child));
    },
    closest() { return null; }
  };
  const classes = () => new Set(element.className.split(/\s+/).filter(Boolean));
  element.classList = {
    add(name) { const values = classes(); values.add(name); element.className = [...values].join(' '); },
    contains(name) { return classes().has(name); }
  };
  element.listeners = listeners;
  return element;
}

function createClassList() {
  const values = new Set();
  return {
    contains(name) { return values.has(name); },
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    toggle(name, force) {
      const active = force === undefined ? !values.has(name) : Boolean(force);
      if (active) values.add(name);
      else values.delete(name);
      return active;
    }
  };
}

function runWatchPage(episode, sessionStorage = createStorage(), options = {}) {
  const messages = [];
  const windowListeners = new Map();
  const clock = options.clock || {now:1700000000000};
  const listeners = new Map();
  let fullscreenElement = null;
  const dispatchDocumentEvent = name => {
    for (const callback of listeners.get(name) || []) callback();
  };
  const intervals = [];
  const timers = [];
  const actions = [];
  const orientationListeners = new Map();
  const orientation = options.orientation ? {
    type:'portrait-primary',
    lockCalls:[],
    unlockCalls:0,
    lock(mode) {
      this.lockCalls.push(mode);
      if (options.orientation.lockFails) return Promise.reject(new Error('Lock unavailable'));
      if (!(options.orientation.deferPortrait && mode === 'portrait')) this.type = mode + '-primary';
      return Promise.resolve();
    },
    unlock() { this.unlockCalls += 1; },
    addEventListener(name, callback) {
      const callbacks = orientationListeners.get(name) || [];
      callbacks.push(callback);
      orientationListeners.set(name, callbacks);
    },
    removeEventListener(name, callback) {
      const callbacks = orientationListeners.get(name) || [];
      orientationListeners.set(name, callbacks.filter(item => item !== callback));
    },
    dispatchChange() {
      for (const callback of [...(orientationListeners.get('change') || [])]) callback();
    }
  } : null;
  const mobileSearchStyles = [];
  const searchToggle = {clickCount:0,click() { this.clickCount += 1; }};
  const searchInput = {focused:false,focus() { this.focused = true; }};
  const searchBox = {
    querySelector(selector) {
      if (selector === '.search-toggle') return searchToggle;
      if (selector === 'input[type="search"]') return searchInput;
      return null;
    }
  };
  const userProfile = {};
  const searchButtons = [];
  const searchRow = {
    insertBefore(element, reference) {
      element.insertedBefore = reference;
      searchButtons.push(element);
    }
  };
  const playerClassList = createClassList();
  const button = {
    closest(selector) { return selector === '.plyr' ? player : null; },
    setAttribute() {}
  };
  const player = {
    dataset:{},
    classList:playerClassList,
    children:[],
    appendChild(element) { this.children.push(element); element.parentElement = this; return element; },
    addEventListener(name,callback) {
      const callbacks = listeners.get('player:' + name) || [];
      callbacks.push(callback);
      listeners.set('player:' + name,callbacks);
    },
    querySelector(selector) {
      if (selector === 'button[data-plyr="fullscreen"]') return button;
      if (selector === '.plyr__video-wrapper') return videoWrapper;
      const className = selector.startsWith('.') ? selector.slice(1) : '';
      const visit = parent => {
        for (const child of parent.children || []) {
          if (child.classList?.contains(className)) return child;
          const nested = visit(child);
          if (nested) return nested;
        }
        return null;
      };
      return visit(this);
    }
  };
  const videoWrapper = makeElement('DIV');
  if (options.nativeFullscreen) {
    player.requestFullscreen = function (settings) {
      actions.push('fullscreen');
      this.fullscreenOptions = settings;
      if (options.rejectFullscreen) return Promise.reject(new Error('Fullscreen unavailable'));
      fullscreenElement = this;
      dispatchDocumentEvent('fullscreenchange');
      return Promise.resolve();
    };
  }
  const body = {
    children:[],
    appendChild(element) { this.children.push(element); element.parentElement = this; return element; }
  };
  const videoListeners = new Map();
  const video = {
    nodeType:1,
    tagName:'VIDEO',
    readyState:options.readyState ?? 4,
    duration:options.duration ?? 1800,
    currentTime:0,
    playbackRate:1,
    seeking:false,
    muted:false,
    paused:true,
    ended:false,
    playCalls:0,
    pauseCalls:0,
    closest(selector) { return selector === '.plyr' ? player : null; },
    play() {
      actions.push('play');
      this.paused = false;
      this.playCalls++;
      for (const name of ['play','playing']) for (const callback of videoListeners.get(name) || []) callback();
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
      this.pauseCalls++;
      for (const callback of videoListeners.get('pause') || []) callback();
    },
    removeAttribute() {},
    addEventListener(name, callback) {
      const callbacks = videoListeners.get(name) || [];
      callbacks.push(callback);
      videoListeners.set(name, callbacks);
    }
  };
  let currentTime = options.currentTime ?? 0;
  Object.defineProperty(video,'currentTime',{
    get() { return currentTime; },
    set(value) { currentTime = value; actions.push('seek'); }
  });
  const seriesLink = {href:'https://worker.example/site/en/series/5744/show'};
  const episodeId = 102320 + episode;
  const episodeLink = {
    innerText:`الحلقة ${episode} ${episode}`,
    href:`https://worker.example/site/en/episode/${episodeId}/show/الحلقة-${episode}`
  };
  const root = {
    nodeType:1,
    tagName:'HTML',
    classList:createClassList(),
    querySelectorAll(selector) { return selector === 'video' ? [video] : []; }
  };
  const document = {
    readyState:'complete',
    title:'Test | Turkify',
    documentElement:root,
    body,
    get fullscreenElement() { return fullscreenElement; },
    exitFullscreen() {
      fullscreenElement = null;
      dispatchDocumentEvent('fullscreenchange');
      return Promise.resolve();
    },
    head:{appendChild(element) { mobileSearchStyles.push(element); }},
    createElement(tagName) {
      const element = makeElement(tagName);
      Object.defineProperty(element,'src',{
        get() { return this._src || ''; },
        set(value) {
          this._src = value;
          if (value !== 'about:blank') this.playerAtSrc = this.parentElement?.parentElement || null;
        }
      });
      return element;
    },
    querySelector(selector) {
      if (selector === '.main-header .row') return searchRow;
      if (selector === '.search-box') return searchBox;
      if (selector === '.user-profile-container') return userProfile;
      if (selector === '.plyr') return player;
      if (selector === '.akwam-mobile-search-button') return null;
      if (selector.includes('/series/')) return seriesLink;
      if (selector.includes('/episode/')) return episodeLink;
      if (selector === '.plyr.akwam-immersive-player') {
        return playerClassList.contains('akwam-immersive-player') ? player : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/watch/"]' && options.nextEpisodeUrl) {
        return [{
          innerText:'التالي',
          getAttribute() { return ''; },
          href:options.nextEpisodeUrl,
          classList:{contains() { return false; }}
        }];
      }
      return [];
    },
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) || [];
      callbacks.push(callback);
      listeners.set(name, callbacks);
    }
  };
  const pathname = options.pathname || `/site/en/watch/181288/${episodeId}/show/episode-${episode}`;
  const location = {
    href:`https://worker.example${pathname}`,
    origin:'https://worker.example',
    pathname,
    assign(url) { navigation.push(url); }
  };
  const navigation = [];
  const window = {
    __AKWAM_BRIDGE__:{lang:'en',parentOrigin:'https://parent.example',upstreamHost:'akwam.ss'},
    navigator:options.navigator || {
      userAgent:options.mobile === false ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' : 'Mozilla/5.0 (iPhone)',
      userAgentData:{mobile:options.mobile !== false}
    },
    fetch:() => Promise.resolve(),
    openCalls:[],
    open(...args) { this.openCalls.push(args); return {}; },
    parent:{postMessage(message, target) { messages.push({message,target}); }},
    addEventListener(name, callback) {
      const callbacks = windowListeners.get(name) || [];
      callbacks.push(callback);
      windowListeners.set(name, callbacks);
    }
  };
  class MutationObserver { observe() {} }
  class XMLHttpRequest { open() {} }
  const localStorage = options.localStorage || createStorage();
  const context = {
    window,document,location,sessionStorage,localStorage,
    XMLHttpRequest,history:{pushState() {},replaceState() {}},MutationObserver,
    URL,Request,console,clock,
    Date:class extends Date { static now() { return clock.now; } },
    setInterval(callback,delay) { const timer = {callback,delay}; intervals.push(timer); return timer; },
    setTimeout(callback,delay) { const timer = {callback,delay}; timers.push(timer); return timer; },
    clearTimeout() {}
  };
  if (orientation) context.screen = {orientation};

  vm.runInNewContext(bootstrapScript, context);
  for (const callback of videoListeners.get('seeked') || []) callback();
  return {player,body,button,document,listeners,messages,sessionStorage,localStorage,mobileSearchStyles,searchToggle,searchInput,searchButtons,userProfile,intervals,timers,orientation,video,videoListeners,navigation,window,windowListeners,clock,actions,setFullscreenElement(value) { fullscreenElement = value; dispatchDocumentEvent('fullscreenchange'); }};
}

function clickFullscreen(page) {
  const event = {
    target:{nodeType:1,closest(selector) { return selector === 'button[data-plyr="fullscreen"]' ? page.button : null; }},
    preventDefault() {},
    stopImmediatePropagation() {}
  };
  page.listeners.get('click').at(-1)(event);
}

function dispatchVideoEvent(page, name) {
  for (const callback of page.videoListeners.get(name) || []) callback();
}

function clickCenterPlay(page) {
  const button = page.player.querySelector('.akwam-player-center-button');
  assert.ok(button);
  button.dispatch('click',{stopPropagation() {}});
}

function clickSeriesPoster(page) {
  const link = {href:'https://worker.example/site/en/series/5744/show'};
  const event = {
    target:{nodeType:1,closest(selector) { return selector === 'a[href]' ? link : null; }},
    prevented:false,
    preventDefault() { this.prevented = true; }
  };
  for (const listener of page.listeners.get('click') || []) listener(event);
  return event;
}

function getAdBreak(page) {
  return [...page.body.children,...page.player.children].find(element => element.className.includes('akwam-ad-break'));
}

test('only smartphones receive the standalone portrait manifest', async () => {
  const html = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
  const inlineScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .find(([, source]) => source.includes('site-mobile.webmanifest'))?.[1];
  assert.ok(inlineScript);

  const selectManifest = navigator => {
    let selected;
    const document = {
      createElement() { return {}; },
      head:{appendChild(link) { selected = link.href; }}
    };
    vm.runInNewContext(inlineScript, {navigator,document});
    return selected;
  };

  assert.equal(selectManifest({userAgentData:{mobile:true}}), '/site-mobile.webmanifest');
  assert.equal(selectManifest({userAgent:'Mozilla/5.0 (iPhone)',userAgentData:{mobile:false}}), '/site-mobile.webmanifest');
  assert.equal(selectManifest({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',userAgentData:{mobile:false}}), '/site.webmanifest');

  const manifest = JSON.parse(await readFile(new URL('../../site/site-mobile.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
});

test("mobile search is reachable and focuses the existing search form", () => {
  const page = runWatchPage(1);
  const button = page.searchButtons[0];
  assert.ok(button);
  assert.equal(button.type, "button");
  assert.equal(button.attributes["aria-label"], "Search");
  assert.equal(button.insertedBefore, page.userProfile);
  assert.match(page.mobileSearchStyles.map(style => style.textContent).join("\n"), /@media\(max-width:767px\)/);
  button.listeners.get('click')[0]();
  assert.equal(page.searchToggle.clickCount, 1);
  assert.equal(page.searchInput.focused, true);
});

test('episodes wait for an explicit play click before filling the screen', () => {
  const page = runWatchPage(1);
  assert.equal(page.video.playCalls, 0);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(page.messages.some(({message}) => message.type === 'player-immersive' && message.active === true), false);
});

test('the center play click requests fullscreen, skips the intro, and shows the fifteen-second ad before playback', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true,orientation:{}});
  assert.equal(page.video.playCalls, 0);
  clickCenterPlay(page);

  assert.deepEqual(page.actions.slice(0,2), ['fullscreen','seek']);
  assert.equal(page.video.currentTime, 85);
  assert.equal(page.video.playCalls, 0);
  assert.equal(page.document.fullscreenElement, page.player);
  assert.equal(page.orientation.lockCalls.includes('landscape'), true);

  const overlay = getAdBreak(page);
  assert.ok(overlay);
  assert.match(overlay.children[1].textContent, /15 ثوانٍ$/);
  assert.equal(page.player.children.includes(overlay), true);
  assert.equal(page.video.paused, true);

  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  assert.equal(getAdBreak(page), undefined);
  assert.equal(page.video.playCalls, 1);
  assert.equal(page.video.paused, false);
  assert.equal(page.video.currentTime, 85);
});

test('a click before metadata seeks as soon as the adaptive stream exposes duration', () => {
  const page = runWatchPage(1, undefined, {readyState:0,nativeFullscreen:true});
  clickCenterPlay(page);
  assert.equal(page.video.playCalls, 0);
  assert.equal(page.video.currentTime, 0);
  assert.ok(getAdBreak(page));

  page.video.readyState = 1;
  dispatchVideoEvent(page,'loadedmetadata');
  assert.equal(page.video.currentTime, 85);
  assert.equal(page.actions.at(-1), 'seek');

  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  assert.equal(page.video.playCalls, 1);
  assert.equal(page.video.paused, false);
});

test('episode progress survives navigation and matching-series poster clicks resume it', () => {
  const localStorage = createStorage();
  const episode = runWatchPage(1, undefined, {localStorage});
  clickCenterPlay(episode);
  episode.clock.now += 6000;
  episode.video.currentTime = 241;
  dispatchVideoEvent(episode,'timeupdate');
  const saved = JSON.parse(localStorage.getItem('akwam-watch-progress-v1:5744'));
  assert.equal(saved.episodeNumber, 1);
  assert.equal(saved.episodePath, '/watch/181288/102321/show/episode-1');
  assert.equal(saved.currentTime, 241);

  const series = runWatchPage(1, undefined, {
    localStorage,
    pathname:'/site/en/series/5744/show'
  });
  assert.equal(JSON.parse(localStorage.getItem('akwam-watch-progress-v1:5744')).currentTime, 241);
  const click = clickSeriesPoster(series);
  assert.equal(click.prevented, true);
  assert.equal(series.navigation[0].includes('/watch/181288/102321/'), true);
  assert.equal(JSON.parse(localStorage.getItem('akwam-watch-progress-v1:5744')).currentTime, 241);

  const resumedEpisode = runWatchPage(1, undefined, {localStorage});
  assert.equal(JSON.parse(localStorage.getItem('akwam-watch-progress-v1:5744')).currentTime, 241);
  clickCenterPlay(resumedEpisode);
  assert.equal(resumedEpisode.video.currentTime, 241);
});

test('a third-party autoplay attempt is paused until the user presses play', () => {
  const page = runWatchPage(1);
  page.video.paused = false;
  dispatchVideoEvent(page,'play');
  assert.equal(page.video.paused, true);
  assert.equal(page.video.playCalls, 0);
});

test('fullscreen stays exited until the user explicitly re-enters', () => {
  const sessionStorage = createStorage();
  const page = runWatchPage(1, sessionStorage);
  clickFullscreen(page);
  clickFullscreen(page);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);

  const laterEpisode = runWatchPage(2, sessionStorage);
  assert.equal(laterEpisode.player.classList.contains('akwam-immersive-player'), false);
});

test('old immersion dismissals still start paused and out of fullscreen', () => {
  const sessionStorage = createStorage();
  sessionStorage.setItem('akwam-immersive-dismissed-v1:5744', '1');
  const page = runWatchPage(3, sessionStorage);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(page.video.playCalls, 0);
});

test('only the sponsored fullscreen link can open an external popup', () => {
  const page = runWatchPage(1);
  const click = href => {
    const link = {getAttribute(name) { return name === 'href' ? href : null; }};
    const event = {
      target:{nodeType:1,closest(selector) { return selector === 'a[target="_blank"]' ? link : null; }},
      prevented:false,
      stopped:false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }
    };
    for (const listener of page.listeners.get('click') || []) listener(event);
    return event;
  };
  const adUrl = 'https://asiafilm.org/4/397db7f27bcb1e058e7ac9ba2a034a28';
  const adClick = click(adUrl);
  assert.equal(adClick.prevented, true);
  assert.equal(page.window.openCalls.length, 1);
  assert.equal(page.window.openCalls[0][0], adUrl);
  assert.equal(page.window.openCalls[0][1], '_blank');

  const externalClick = click('https://unapproved.example/');
  assert.equal(externalClick.prevented, true);
  assert.equal(page.window.openCalls.length, 1);
  assert.equal(page.window.open('https://unapproved.example/','_blank'), null);
});

test('skipping the intro cannot bypass the fifteen-second ad before the episode', () => {
  const page = runWatchPage(1);
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;

  assert.equal(page.video.currentTime, 85);
  assert.equal(page.video.paused, true);
  const overlay = getAdBreak(page);
  assert.ok(overlay);
  assert.match(overlay.children[1].textContent, /15 ثوانٍ$/);
  assert.equal(page.player.children.includes(overlay), true);

  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.currentTime = 500;
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  assert.equal(page.video.paused, true);
  assert.ok(getAdBreak(page));

  for (let second = 0; second < 14; second++) tick();
  assert.ok(getAdBreak(page));
  assert.match(overlay.children[1].textContent, /1 ثوانٍ$/);
  tick();
  assert.equal(getAdBreak(page), undefined);
  assert.equal(page.video.paused, false);
  assert.equal(page.video.playCalls, 1);
});

test('fullscreen ad pauses at the exact position and resumes after forty-five seconds', () => {
  const page = runWatchPage(1);
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;

  const openingOverlay = getAdBreak(page);
  assert.ok(openingOverlay);
  assert.match(openingOverlay.children[1].textContent, /15 ثوانٍ$/);
  for (let second = 0; second < 15; second++) tick();
  assert.equal(getAdBreak(page), undefined);
  assert.equal(page.video.playCalls, 1);

  page.video.currentTime = 590.375;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  for (let second = 0; second < 10; second++) {
    page.video.currentTime += 1;
    dispatchVideoEvent(page,'timeupdate');
    if (!getAdBreak(page)) tick();
  }

  const overlay = getAdBreak(page);
  assert.ok(overlay);
  const [frameShell,countdown] = overlay.children;
  const [adFrame] = frameShell.children;
  assert.equal(overlay.children.length, 2);
  assert.equal(adFrame.tagName, 'iframe');
  assert.equal(adFrame.className, 'akwam-ad-frame');
  assert.equal(adFrame.src, 'https://worker.example/__bridge/ad');
  assert.equal(adFrame.attributes.title, 'إعلان ممول');
  assert.equal(adFrame.attributes.loading, 'eager');
  assert.equal(adFrame.attributes.sandbox, 'allow-popups allow-popups-to-escape-sandbox');
  assert.equal(frameShell.className, 'akwam-ad-frame-shell');
  assert.equal(frameShell.children.length, 1);
  assert.match(countdown.textContent, /45 ثوانٍ$/);
  assert.equal(page.video.paused, true);
  assert.equal(page.video.pauseCalls, 1);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
  assert.equal(page.body.children.includes(overlay), true);
  assert.equal(page.player.children.includes(overlay), false);
  assert.equal(overlay.className, 'akwam-ad-break akwam-ad-break-immersive');
  const playerStyles = page.mobileSearchStyles.map(style => style.textContent).join('\n');
  assert.match(playerStyles, /\.akwam-ad-break-immersive\{position:fixed!important;inset:0!important;z-index:2147483647!important\}/);
  assert.match(playerStyles, /\.akwam-ad-frame-shell\{position:absolute!important;inset:10px!important;overflow:hidden!important;border:0!important;border-radius:0!important;background:transparent!important;/);
  assert.match(playerStyles, /\.akwam-ad-frame-shell\{inset:8px!important;/);
  assert.doesNotMatch(playerStyles, /akwam-ad-(?:fallback|hint|visit)/);

  for (let second = 0; second < 44; second++) tick();
  assert.ok(page.body.children.includes(overlay));
  assert.match(countdown.textContent, /1 ثوانٍ$/);
  tick();

  assert.equal(page.body.children.includes(overlay), false);
  assert.equal(adFrame.src, 'about:blank');
  assert.equal(page.video.currentTime, 600.375);
  assert.equal(page.video.paused, false);
  assert.equal(page.video.playCalls, 2);
});

test('native fullscreen ad stays inside the fullscreen player above the video', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true});
  clickCenterPlay(page);
  page.video.currentTime = 599;
  page.video.currentTime += 1;
  dispatchVideoEvent(page,'timeupdate');

  const overlay = getAdBreak(page);
  assert.ok(overlay);
  assert.equal(page.document.fullscreenElement, page.player);
  assert.equal(page.player.children.includes(overlay), true);
  assert.equal(page.body.children.includes(overlay), false);
  assert.equal(overlay.className, 'akwam-ad-break akwam-ad-break-immersive');
});

test('playing from minute nine triggers the minute-ten ad before episode advance in fullscreen', () => {
  const page = runWatchPage(1, createStorage(), {
    duration:670,
    nativeFullscreen:true,
    nextEpisodeUrl:'https://worker.example/site/en/watch/181288/102322/show/episode-2'
  });
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  page.video.currentTime = 540;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');

  for (let second = 0; second < 60; second++) {
    page.video.currentTime += 1;
    dispatchVideoEvent(page,'timeupdate');
    if (!getAdBreak(page)) tick();
  }

  assert.ok(getAdBreak(page));
  assert.equal(page.navigation.length, 0);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
  assert.equal(page.video.currentTime, 600);
  assert.equal(page.video.paused, true);
});

test('seeking near the episode end does not advance or exit fullscreen', () => {
  const nextEpisodeUrl = 'https://worker.example/site/en/watch/181288/102322/show/episode-2';
  const page = runWatchPage(1, undefined, {
    duration:2000,
    nextEpisodeUrl,
    nativeFullscreen:true
  });
  clickFullscreen(page);
  page.video.currentTime = 1970;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  dispatchVideoEvent(page,'timeupdate');

  assert.deepEqual(page.navigation, []);
  assert.equal(page.document.fullscreenElement, page.player);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
});

test('the opening ad runs once and never interrupts the episode again', () => {
  const page = runWatchPage(1);
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  assert.equal(getAdBreak(page), undefined);
  assert.equal(page.video.paused, false);

  for (let second = 0; second < 415; second++) {
    page.video.currentTime += 1;
    dispatchVideoEvent(page,'timeupdate');
  }
  assert.equal(page.video.currentTime, 500);
  assert.equal(getAdBreak(page), undefined);
  assert.equal(page.video.paused, false);
});

test('an episode ending at the ad mark waits for the ad before advancing', () => {
  const page = runWatchPage(1, createStorage(), {
    duration:600,
    nextEpisodeUrl:'https://worker.example/site/en/watch/181288/102322/show/episode-2'
  });
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  page.video.currentTime = 600;
  page.video.paused = true;
  page.video.ended = true;
  dispatchVideoEvent(page,'ended');

  assert.ok(getAdBreak(page));
  assert.equal(page.navigation.length, 0);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);

  for (let second = 0; second < 44; second++) tick();
  assert.equal(page.navigation.length, 0);
  tick();

  assert.equal(getAdBreak(page), undefined);
  assert.deepEqual(page.navigation, ['https://worker.example/site/en/watch/181288/102322/show/episode-2']);
});

test('paused time does not count toward the next ad break', () => {
  const page = runWatchPage(1);
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  assert.equal(page.video.paused, false);

  page.video.paused = true;
  for (let second = 0; second < 1200; second++) tick();
  assert.equal(getAdBreak(page), undefined);

  page.video.currentTime = 599;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  page.video.paused = false;
  page.video.currentTime += 1;
  dispatchVideoEvent(page,'timeupdate');
  assert.ok(getAdBreak(page));
  assert.match(getAdBreak(page).children[1].textContent, /45 ثوانٍ$/);
});

test('a manual seek across the scheduled ad mark triggers one ad immediately', () => {
  const page = runWatchPage(1);
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  assert.equal(page.video.playCalls, 1);

  page.video.currentTime = 600;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  const overlay = getAdBreak(page);
  assert.ok(overlay);
  assert.match(overlay.children[1].textContent, /45 ثوانٍ$/);
  assert.equal(page.video.paused, true);

  for (let second = 0; second < 45; second++) tick();
  assert.equal(getAdBreak(page), undefined);
  assert.equal(page.video.currentTime, 600);
  assert.equal(page.video.paused, false);
  assert.equal(page.video.playCalls, 2);

  page.video.currentTime += 1;
  dispatchVideoEvent(page,'timeupdate');
  assert.equal(getAdBreak(page), undefined);
});

test('non-immersive ads remain constrained to the video player', () => {
  const page = runWatchPage(1);
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  clickFullscreen(page);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  page.video.currentTime = 599;
  page.video.currentTime += 1;
  dispatchVideoEvent(page,'timeupdate');

  const overlay = getAdBreak(page);
  assert.ok(overlay);
  assert.equal(page.player.children.includes(overlay), true);
  assert.equal(page.body.children.includes(overlay), false);
  assert.equal(overlay.className, 'akwam-ad-break');
});

test('exiting fullscreen during the opening ad keeps it inside the player', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true});
  clickCenterPlay(page);
  const overlay = getAdBreak(page);
  assert.ok(overlay);
  assert.equal(page.player.children.includes(overlay), true);
  assert.equal(overlay.className, 'akwam-ad-break akwam-ad-break-immersive');

  page.setFullscreenElement(null);
  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(page.player.children.includes(overlay), true);
  assert.equal(page.body.children.includes(overlay), false);
  assert.equal(overlay.className, 'akwam-ad-break');
  assert.match(overlay.children[1].textContent, /ثوانٍ$/);

  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  assert.equal(getAdBreak(page), undefined);
  assert.equal(page.video.paused, false);
});

test('exiting fullscreen during a mid-roll ad keeps it inside the player', () => {
  const page = runWatchPage(1);
  clickCenterPlay(page);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  for (let second = 0; second < 15; second++) tick();
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);

  page.video.currentTime = 600;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  const overlay = getAdBreak(page);
  assert.ok(overlay);
  assert.equal(page.body.children.includes(overlay), true);
  assert.equal(overlay.className, 'akwam-ad-break akwam-ad-break-immersive');

  clickFullscreen(page);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(page.player.children.includes(overlay), true);
  assert.equal(page.body.children.includes(overlay), false);
  assert.equal(overlay.className, 'akwam-ad-break');
});

test('manual toggle can re-enable immersive mode', () => {
  const page = runWatchPage(1);
  clickFullscreen(page);
  clickFullscreen(page);
  clickFullscreen(page);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
});

test('fullscreen button requests native browser fullscreen and Escape exits it', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true});
  clickFullscreen(page);

  assert.equal(page.document.fullscreenElement, page.player);
  assert.equal(page.player.fullscreenOptions.navigationUI, 'hide');
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);

  page.listeners.get('keydown').at(-1)({
    key:'Escape',preventDefault() {},stopImmediatePropagation() {}
  });
  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
});

test('unexpected native fullscreen exit restores the page chrome', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true});
  clickFullscreen(page);
  assert.equal(page.document.fullscreenElement, page.player);

  page.video.currentTime = 585;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  page.setFullscreenElement(null);

  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(page.document.documentElement.classList.contains('akwam-immersive-page'), false);
  assert.equal(page.messages.at(-1).message.type, 'player-immersive');
  assert.equal(page.messages.at(-1).message.active, false);

  clickFullscreen(page);
  assert.equal(page.document.fullscreenElement, page.player);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
});

test('a seek that races a timeupdate cannot skip to the next episode', () => {
  const nextEpisodeUrl = 'https://worker.example/site/en/watch/181288/102322/show/episode-2';
  const page = runWatchPage(1, undefined, {duration:655,nextEpisodeUrl});
  page.video.paused = false;
  page.video.currentTime = 87;
  dispatchVideoEvent(page,'timeupdate');
  page.video.currentTime = 585;
  dispatchVideoEvent(page,'timeupdate');
  assert.deepEqual(page.navigation, []);

  page.clock.now += 2000;
  page.video.currentTime = 585.4;
  dispatchVideoEvent(page,'timeupdate');
  assert.deepEqual(page.navigation, []);
});

test('seeking a paused video does not start playback', () => {
  const page = runWatchPage(1, undefined, {duration:655});
  page.video.paused = true;
  page.video.currentTime = 585;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  assert.equal(page.video.playCalls, 0);
  assert.equal(page.video.paused, true);
});

test('rejected native fullscreen keeps the CSS fallback and allows manual exit', async () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true,rejectFullscreen:true});
  clickFullscreen(page);
  await Promise.resolve();

  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);

  clickFullscreen(page);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
});

test('parent bridge expands the iframe and restores navigation on exit', async () => {
  const configSource = await readFile(new URL('../../site/config.js', import.meta.url), 'utf8');
  const documentListeners = new Map();
  const windowListeners = new Map();
  const frameStyle = {
    top:'',height:'',zIndex:'',
    removeProperty(name) { this[name === 'z-index' ? 'zIndex' : name] = ''; }
  };
  const frame = {contentWindow:{},style:frameStyle};
  const nav = {hidden:false,style:{display:''}};
  let fullscreenElement = null;
  const document = {
    readyState:'loading',
    get fullscreenElement() { return fullscreenElement; },
    querySelector(selector) { return selector === '#site-frame' ? frame : nav; },
    addEventListener(name, callback) { documentListeners.set(name, callback); }
  };
  const window = {
    AKWAM_WORKER_URL:'https://turkifyseries.osamalovirboy.workers.dev',
    addEventListener(name, callback) { windowListeners.set(name, callback); }
  };

  vm.runInNewContext(configSource, {window,document,location:{href:'https://parent.example/'},URL});
  documentListeners.get('DOMContentLoaded')();
  const receiveMessage = windowListeners.get('message');
  const send = data => receiveMessage({origin:'https://turkifyseries.osamalovirboy.workers.dev',source:frame.contentWindow,data});
  const nativeFullscreen = active => {
    fullscreenElement = active ? frame : null;
    documentListeners.get('fullscreenchange')();
  };

  send({source:'akwam-gemini-bridge',type:'player-immersive',active:true});
  assert.equal(nav.hidden, true);
  assert.equal(frame.style.top, '0');
  assert.equal(frame.style.height, '100dvh');
  assert.equal(frame.style.zIndex, '3');

  send({source:'akwam-gemini-bridge',type:'player-immersive',active:false});
  assert.equal(nav.hidden, false);
  assert.equal(frame.style.top, '');
  assert.equal(frame.style.height, '');
  assert.equal(frame.style.zIndex, '');

  nativeFullscreen(true);
  assert.equal(nav.hidden, true);
  assert.equal(frame.style.height, '100dvh');

  nativeFullscreen(false);
  assert.equal(nav.hidden, false);
  assert.equal(frame.style.top, '');
  assert.equal(frame.style.height, '');
  assert.equal(frame.style.zIndex, '');

  nativeFullscreen(true);
  nativeFullscreen(false);
  send({source:'akwam-gemini-bridge',type:'player-immersive',active:true});
  assert.equal(nav.hidden, false);
});

test('parent bridge releases immersion when the iframe navigates to a browse page', async () => {
  const configSource = await readFile(new URL('../../site/config.js', import.meta.url), 'utf8');
  const documentListeners = new Map();
  const windowListeners = new Map();
  const frame = {
    contentWindow:{},
    style:{top:'',height:'',zIndex:'',removeProperty(name) { this[name === 'z-index' ? 'zIndex' : name] = ''; }},
    addEventListener() {}
  };
  const nav = {hidden:false,style:{display:''}};
  const document = {
    readyState:'complete',
    fullscreenElement:null,
    querySelector(selector) { return selector === '#site-frame' ? frame : nav; },
    addEventListener(name, callback) { documentListeners.set(name, callback); }
  };
  const window = {
    AKWAM_WORKER_URL:'https://turkifyseries.osamalovirboy.workers.dev',
    addEventListener(name, callback) { windowListeners.set(name, callback); }
  };

  vm.runInNewContext(configSource, {window,document,location:{href:'https://parent.example/'},URL});
  const receiveMessage = windowListeners.get('message');
  const send = data => receiveMessage({origin:'https://turkifyseries.osamalovirboy.workers.dev',source:frame.contentWindow,data});

  send({source:'akwam-gemini-bridge',type:'player-immersive',active:true});
  assert.equal(nav.hidden, true);

  send({source:'akwam-gemini-bridge',type:'player-page',watch:false});
  assert.equal(nav.hidden, false);
  assert.equal(frame.style.height, '');
});

test('starting an episode from the center button opens fullscreen in landscape', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true, orientation:{}});
  clickCenterPlay(page);

  assert.equal(page.document.fullscreenElement, page.player);
  assert.equal(page.orientation.lockCalls.includes('landscape'), true);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
});

test('desktop playback does not request orientation locks', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true, orientation:{}, mobile:false});
  clickCenterPlay(page);

  assert.equal(page.document.fullscreenElement, page.player);
  assert.deepEqual(page.orientation.lockCalls, []);
  page.setFullscreenElement(null);
  assert.deepEqual(page.orientation.lockCalls, []);
});

test('iPhone user agent enables orientation locks without client hints', () => {
  const page = runWatchPage(1, undefined, {
    nativeFullscreen:true,
    orientation:{},
    mobile:false,
    navigator:{userAgent:'Mozilla/5.0 (iPhone)',userAgentData:{mobile:false}}
  });
  clickCenterPlay(page);

  assert.equal(page.orientation.lockCalls.includes('landscape'), true);
});

test('leaving fullscreen waits for the device to finish rotating to portrait', async () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true, orientation:{deferPortrait:true}});
  clickFullscreen(page);
  assert.equal(page.document.fullscreenElement, page.player);
  page.orientation.lockCalls.length = 0;

  clickFullscreen(page);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(page.orientation.lockCalls, ['portrait']);
  assert.equal(page.orientation.type, 'landscape-primary');
  assert.equal(page.document.fullscreenElement, page.player);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);

  page.orientation.type = 'portrait-primary';
  page.orientation.dispatchChange();

  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(page.document.documentElement.classList.contains('akwam-immersive-page'), false);
  assert.equal(page.orientation.lockCalls.includes('portrait'), true);
});

test('a browser-forced fullscreen exit restores portrait orientation', () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true, orientation:{}});
  clickFullscreen(page);
  page.orientation.lockCalls.length = 0;

  page.setFullscreenElement(null);

  assert.equal(page.orientation.lockCalls.includes('portrait'), true);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
});

test('after a manual exit playback does not force fullscreen again', async () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true, orientation:{}});
  clickFullscreen(page);
  clickFullscreen(page);
  await new Promise(resolve => setImmediate(resolve));
  page.orientation.dispatchChange();
  assert.equal(page.document.fullscreenElement, null);

  dispatchVideoEvent(page,'play');

  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
});

test('parent bridge locks landscape in fullscreen and restores portrait on exit', async () => {
  const configSource = await readFile(new URL('../../site/config.js', import.meta.url), 'utf8');
  const documentListeners = new Map();
  const windowListeners = new Map();
  const frame = {
    contentWindow:{},
    style:{top:'',height:'',zIndex:'',removeProperty() {}},
    addEventListener() {}
  };
  const nav = {hidden:false,style:{display:''}};
  let fullscreenElement = null;
  const lockCalls = [];
  let unlockCalls = 0;
  const screen = {orientation:{
    lock(mode) { lockCalls.push(mode); return Promise.resolve(); },
    unlock() { unlockCalls += 1; }
  }};
  const document = {
    readyState:'complete',
    get fullscreenElement() { return fullscreenElement; },
    querySelector(selector) { return selector === '#site-frame' ? frame : nav; },
    addEventListener(name, callback) { documentListeners.set(name, callback); }
  };
  const window = {
    AKWAM_WORKER_URL:'https://turkifyseries.osamalovirboy.workers.dev',
    navigator:{userAgent:'Mozilla/5.0 (iPhone)',userAgentData:{mobile:true}},
    addEventListener(name, callback) { windowListeners.set(name, callback); }
  };

  vm.runInNewContext(configSource, {window,document,location:{href:'https://parent.example/'},URL,screen});
  const receiveMessage = windowListeners.get('message');
  const send = data => receiveMessage({
    origin:'https://turkifyseries.osamalovirboy.workers.dev',
    source:frame.contentWindow,
    data
  });
  const nativeFullscreen = active => {
    fullscreenElement = active ? frame : null;
    documentListeners.get('fullscreenchange')();
  };

  assert.equal(lockCalls[0], 'portrait');
  nativeFullscreen(true);
  assert.equal(lockCalls.includes('landscape'), true);
  assert.equal(nav.hidden, true);

  lockCalls.length = 0;
  nativeFullscreen(false);
  assert.equal(lockCalls.includes('portrait'), true);
  assert.equal(nav.hidden, false);

  lockCalls.length = 0;
  send({source:'akwam-gemini-bridge',type:'player-orientation',mode:'portrait'});
  assert.equal(lockCalls.at(-1), 'portrait');
});

test('parent bridge skips orientation locks on desktop', async () => {
  const configSource = await readFile(new URL('../../site/config.js', import.meta.url), 'utf8');
  const documentListeners = new Map();
  const windowListeners = new Map();
  const frame = {contentWindow:{},style:{top:'',height:'',zIndex:'',removeProperty() {}},addEventListener() {}};
  const nav = {hidden:false,style:{display:''}};
  const lockCalls = [];
  let fullscreenElement = null;
  const screen = {orientation:{lock(mode) { lockCalls.push(mode); return Promise.resolve(); }}};
  const document = {
    readyState:'complete',
    get fullscreenElement() { return fullscreenElement; },
    querySelector(selector) { return selector === '#site-frame' ? frame : nav; },
    addEventListener(name, callback) { documentListeners.set(name, callback); }
  };
  const window = {
    AKWAM_WORKER_URL:'https://turkifyseries.osamalovirboy.workers.dev',
    navigator:{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',userAgentData:{mobile:false}},
    addEventListener(name, callback) { windowListeners.set(name, callback); }
  };

  vm.runInNewContext(configSource, {window,document,location:{href:'https://parent.example/'},URL,screen});
  const send = data => windowListeners.get('message')({
    origin:'https://turkifyseries.osamalovirboy.workers.dev',source:frame.contentWindow,data
  });
  send({source:'akwam-gemini-bridge',type:'player-immersive',active:true});
  assert.equal(nav.hidden, true);
  assert.deepEqual(lockCalls, []);

  fullscreenElement = frame;
  documentListeners.get('fullscreenchange')();
  fullscreenElement = null;
  documentListeners.get('fullscreenchange')();
  send({source:'akwam-gemini-bridge',type:'player-immersive',active:false});
  assert.deepEqual(lockCalls, []);
});

test('exit still completes when the orientation lock is refused', async () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true, orientation:{lockFails:true}});
  clickFullscreen(page);
  assert.equal(page.document.fullscreenElement, page.player);
  page.orientation.lockCalls.length = 0;

  clickFullscreen(page);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.orientation.lockCalls.includes('portrait'), true);
  assert.equal(page.document.fullscreenElement, page.player);

  for (const timer of page.timers) timer.callback();
  assert.equal(page.document.fullscreenElement, null);
});

test('the embedded player frame is allowed to lock the screen orientation', async () => {
  const html = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
  const sandbox = html.match(/id="site-frame"[\s\S]*?sandbox="([^"]+)"/)?.[1] || '';
  assert.match(sandbox, /\ballow-orientation-lock\b/);
});

test('a late landscape reading after exit is pushed back to portrait', async () => {
  const page = runWatchPage(1, undefined, {nativeFullscreen:true, orientation:{}});
  clickFullscreen(page);
  assert.equal(page.document.fullscreenElement, page.player);
  clickFullscreen(page);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);

  page.orientation.lockCalls.length = 0;
  page.orientation.type = 'landscape-primary';
  page.orientation.dispatchChange();

  assert.equal(page.orientation.lockCalls.includes('portrait'), true);
});
