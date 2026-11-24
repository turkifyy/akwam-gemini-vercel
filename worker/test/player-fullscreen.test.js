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

function createClassList() {
  const values = new Set();
  return {
    contains(name) { return values.has(name); },
    add(name) { values.add(name); },
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
  const listeners = new Map();
  const intervals = [];
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
    classList:playerClassList,
    children:[],
    appendChild(element) { this.children.push(element); element.parentElement = this; return element; },
    querySelector(selector) { return selector === 'button[data-plyr="fullscreen"]' ? button : null; }
  };
  const videoListeners = new Map();
  const video = {
    nodeType:1,
    tagName:'VIDEO',
    readyState:4,
    duration:options.duration ?? 1800,
    currentTime:0,
    playbackRate:1,
    seeking:false,
    muted:false,
    paused:false,
    ended:false,
    playCalls:0,
    pauseCalls:0,
    closest(selector) { return selector === '.plyr' ? player : null; },
    play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
    pause() { this.paused = true; this.pauseCalls++; },
    addEventListener(name, callback) {
      const callbacks = videoListeners.get(name) || [];
      callbacks.push(callback);
      videoListeners.set(name, callbacks);
    }
  };
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
    documentElement:root,
    head:{appendChild(element) { mobileSearchStyles.push(element); }},
    createElement(tagName) {
      const element = {
        tagName,className:'',textContent:'',attributes:{},listeners:{},children:[],
        setAttribute(name,value) { this.attributes[name] = String(value); },
        addEventListener(name,callback) { this.listeners[name] = callback; },
        appendChild(element) { this.children.push(element); element.parentElement = this; return element; },
        remove() {
          const index = this.parentElement?.children?.indexOf(this) ?? -1;
          if (index >= 0) this.parentElement.children.splice(index,1);
          this.parentElement = null;
        }
      };
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
  const location = {
    href:`https://worker.example/site/en/watch/181288/${episodeId}/show/episode-${episode}`,
    origin:'https://worker.example',
    pathname:`/site/en/watch/181288/${episodeId}/show/episode-${episode}`,
    assign(url) { navigation.push(url); }
  };
  const navigation = [];
  const window = {
    __AKWAM_BRIDGE__:{lang:'en',parentOrigin:'https://parent.example',upstreamHost:'akwam.ss'},
    fetch:() => Promise.resolve(),
    parent:{postMessage(message, target) { messages.push({message,target}); }}
  };
  class MutationObserver { observe() {} }
  class XMLHttpRequest { open() {} }
  const context = {
    window,document,location,sessionStorage,localStorage:createStorage(),
    XMLHttpRequest,history:{pushState() {},replaceState() {}},MutationObserver,
    URL,Request,console,
    setInterval(callback,delay) { const timer = {callback,delay}; intervals.push(timer); return timer; }
  };

  vm.runInNewContext(bootstrapScript, context);
  for (const callback of videoListeners.get('seeked') || []) callback();
  return {player,button,listeners,messages,sessionStorage,mobileSearchStyles,searchToggle,searchInput,searchButtons,userProfile,intervals,video,videoListeners,navigation};
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

test("mobile search is reachable and focuses the existing search form", () => {
  const page = runWatchPage(1);
  const button = page.searchButtons[0];
  assert.ok(button);
  assert.equal(button.type, "button");
  assert.equal(button.attributes["aria-label"], "Search");
  assert.equal(button.insertedBefore, page.userProfile);
  assert.match(page.mobileSearchStyles.map(style => style.textContent).join("\n"), /@media\(max-width:767px\)/);
  button.listeners.click();
  assert.equal(page.searchToggle.clickCount, 1);
  assert.equal(page.searchInput.focused, true);
});

test('episode 1 starts in the immersive player layout', () => {
  const page = runWatchPage(1);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
  assert.equal(page.messages.some(({message}) => message.type === 'player-immersive' && message.active === true), true);
});

test('episode 2 and later request the immersive player layout', () => {
  for (const episode of [2,3,8]) {
    const page = runWatchPage(episode);
    assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
    assert.equal(page.messages.some(({message}) => message.type === 'player-immersive' && message.active === true), true);
  }
});

test('manual exit stays on the current episode while later episodes auto-expand', () => {
  const sessionStorage = createStorage();
  const episodeOne = runWatchPage(1, sessionStorage);
  clickFullscreen(episodeOne);
  assert.equal(episodeOne.player.classList.contains('akwam-immersive-player'), false);

  const episodeOneAgain = runWatchPage(1, sessionStorage);
  assert.equal(episodeOneAgain.player.classList.contains('akwam-immersive-player'), false);
  const episodeTwo = runWatchPage(2, sessionStorage);
  assert.equal(episodeTwo.player.classList.contains('akwam-immersive-player'), true);
});

test('old series-wide dismissal does not block automatic mode', () => {
  const sessionStorage = createStorage();
  sessionStorage.setItem('akwam-immersive-dismissed-v1:5744', '1');
  const page = runWatchPage(3, sessionStorage);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
});

test('ad break pauses at the exact position and resumes after five seconds', () => {
  const page = runWatchPage(1);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  page.video.currentTime = 590.375;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  for (let second = 0; second < 10; second++) {
    page.video.currentTime += 1;
    dispatchVideoEvent(page,'timeupdate');
    if (!page.player.children.some(element => element.className === 'akwam-ad-break')) tick();
  }

  const overlay = page.player.children.find(element => element.className === 'akwam-ad-break');
  assert.ok(overlay);
  const [adFrame,countdown] = overlay.children;
  assert.equal(adFrame.src, 'https://aarems.org/1/962ae41308332ad6376e83c9183edfbc');
  assert.equal(adFrame.playerAtSrc, page.player);
  assert.equal(adFrame.attributes.sandbox, 'allow-scripts allow-same-origin allow-forms');
  assert.match(countdown.textContent, /5 ثوانٍ$/);
  assert.equal(page.video.paused, true);
  assert.equal(page.video.pauseCalls, 1);

  for (let second = 0; second < 4; second++) tick();
  assert.ok(page.player.children.includes(overlay));
  assert.match(countdown.textContent, /1 ثوانٍ$/);
  tick();

  assert.equal(page.player.children.includes(overlay), false);
  assert.equal(adFrame.src, 'about:blank');
  assert.equal(page.video.currentTime, 600.375);
  assert.equal(page.video.paused, false);
  assert.equal(page.video.playCalls, 2);
});

test('playing from minute nine triggers the minute-ten ad before episode advance in fullscreen', () => {
  const page = runWatchPage(1, createStorage(), {
    duration:670,
    nextEpisodeUrl:'https://worker.example/site/en/watch/181288/102322/show/episode-2'
  });
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  page.video.currentTime = 540;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');

  for (let second = 0; second < 60; second++) {
    page.video.currentTime += 1;
    dispatchVideoEvent(page,'timeupdate');
    if (!page.player.children.some(element => element.className === 'akwam-ad-break')) tick();
  }

  assert.ok(page.player.children.some(element => element.className === 'akwam-ad-break'));
  assert.equal(page.navigation.length, 0);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
  assert.equal(page.video.currentTime, 600);
  assert.equal(page.video.paused, true);
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

  assert.ok(page.player.children.some(element => element.className === 'akwam-ad-break'));
  assert.equal(page.navigation.length, 0);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);

  for (let second = 0; second < 4; second++) tick();
  assert.equal(page.navigation.length, 0);
  tick();

  assert.equal(page.player.children.some(element => element.className === 'akwam-ad-break'), false);
  assert.deepEqual(page.navigation, ['https://worker.example/site/en/watch/181288/102322/show/episode-2']);
});

test('paused time does not count toward the next ad break', () => {
  const page = runWatchPage(1);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  page.video.paused = true;
  for (let second = 0; second < 1200; second++) tick();
  assert.equal(page.player.children.some(element => element.className === 'akwam-ad-break'), false);

  page.video.currentTime = 599;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  page.video.paused = false;
  page.video.currentTime += 1;
  dispatchVideoEvent(page,'timeupdate');
  assert.equal(page.player.children.some(element => element.className === 'akwam-ad-break'), true);
});

test('a manual seek past the ad mark does not trigger immediately', () => {
  const page = runWatchPage(1);
  const tick = page.intervals.find(timer => timer.delay === 1000).callback;
  page.video.currentTime = 600;
  page.video.seeking = true;
  dispatchVideoEvent(page,'seeking');
  page.video.seeking = false;
  dispatchVideoEvent(page,'seeked');
  tick();
  assert.equal(page.player.children.some(element => element.className === 'akwam-ad-break'), false);

  page.video.currentTime += 600;
  dispatchVideoEvent(page,'timeupdate');
  assert.equal(page.player.children.some(element => element.className === 'akwam-ad-break'), true);
});

test('manual toggle can re-enable immersive mode', () => {
  const page = runWatchPage(1);
  clickFullscreen(page);
  clickFullscreen(page);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
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
  const document = {
    readyState:'loading',
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
});
