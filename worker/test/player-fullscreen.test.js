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
