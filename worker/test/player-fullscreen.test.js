import assert from 'node:assert/strict';
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
    toggle(name, force) {
      const active = force === undefined ? !values.has(name) : Boolean(force);
      if (active) values.add(name);
      else values.delete(name);
      return active;
    }
  };
}

function runWatchPage(episode, sessionStorage = createStorage()) {
  const messages = [];
  const listeners = new Map();
  const playerClassList = createClassList();
  const button = {
    closest(selector) { return selector === '.plyr' ? player : null; },
    setAttribute() {}
  };
  const player = {
    classList:playerClassList,
    querySelector(selector) { return selector === 'button[data-plyr="fullscreen"]' ? button : null; }
  };
  const videoListeners = new Map();
  const video = {
    nodeType:1,
    tagName:'VIDEO',
    readyState:1,
    duration:1800,
    currentTime:0,
    muted:false,
    closest(selector) { return selector === '.plyr' ? player : null; },
    play() { return Promise.resolve(); },
    addEventListener(name, callback) {
      const callbacks = videoListeners.get(name) || [];
      callbacks.push(callback);
      videoListeners.set(name, callbacks);
    }
  };
  const seriesLink = {href:'https://worker.example/site/en/series/5744/show'};
  const episodeLink = {
    innerText:`الحلقة ${episode} ${episode}`,
    href:`https://worker.example/site/en/episode/102325/show/الحلقة-${episode}`
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
    head:{appendChild() {}},
    createElement() { return {textContent:''}; },
    querySelector(selector) {
      if (selector.includes('/series/')) return seriesLink;
      if (selector.includes('/episode/')) return episodeLink;
      if (selector === '.plyr.akwam-immersive-player') {
        return playerClassList.contains('akwam-immersive-player') ? player : null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) || [];
      callbacks.push(callback);
      listeners.set(name, callbacks);
    }
  };
  const location = {
    href:`https://worker.example/site/en/watch/181288/102325/show/episode-${episode}`,
    origin:'https://worker.example',
    pathname:`/site/en/watch/181288/102325/show/episode-${episode}`,
    assign() {}
  };
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
    URL,Request,console
  };

  vm.runInNewContext(bootstrapScript, context);
  return {player,button,listeners,messages,sessionStorage};
}

function clickFullscreen(page) {
  const event = {
    target:{nodeType:1,closest(selector) { return selector === 'button[data-plyr="fullscreen"]' ? page.button : null; }},
    preventDefault() {},
    stopImmediatePropagation() {}
  };
  page.listeners.get('click').at(-1)(event);
}

test('episode 1 stays in the normal player layout', () => {
  const page = runWatchPage(1);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(page.messages.some(({message}) => message.type === 'player-immersive' && message.active === false), true);
});

test('episode 2 and later request the immersive player layout', () => {
  for (const episode of [2,3,8]) {
    const page = runWatchPage(episode);
    assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
    assert.equal(page.messages.some(({message}) => message.type === 'player-immersive' && message.active === true), true);
  }
});

test('manual exit stays dismissed on later episodes of the same series', () => {
  const sessionStorage = createStorage();
  const episodeTwo = runWatchPage(2, sessionStorage);
  clickFullscreen(episodeTwo);
  assert.equal(episodeTwo.player.classList.contains('akwam-immersive-player'), false);

  const episodeThree = runWatchPage(3, sessionStorage);
  assert.equal(episodeThree.player.classList.contains('akwam-immersive-player'), false);
  assert.equal(episodeThree.messages.some(({message}) => message.type === 'player-immersive' && message.active === false), true);
});

test('manual toggle can re-enable immersive mode', () => {
  const page = runWatchPage(2);
  clickFullscreen(page);
  clickFullscreen(page);
  assert.equal(page.player.classList.contains('akwam-immersive-player'), true);
});
