import assert from "node:assert/strict";
import {test} from "node:test";
import vm from "node:vm";
import {bootstrapScript} from "../src/bootstrap.js";

function makeVideo({duration = 1850, currentTime = 0, readyState = 1, source = "episode.mp4"} = {}) {
  const listeners = new Map();
  return {
    nodeType:1,
    tagName:"VIDEO",
    currentSrc:source,
    src:source,
    duration,
    currentTime,
    readyState,
    muted:false,
    playCalls:0,
    closest() { return null; },
    play() { this.playCalls++; return Promise.resolve(); },
    addEventListener(name, listener) {
      const callbacks = listeners.get(name) || [];
      callbacks.push(listener);
      listeners.set(name, callbacks);
    },
    emit(name) { listeners.get(name)?.forEach(listener => listener()); }
  };
}

function runBootstrap(pathname, videos = []) {
  const observers = [];
  const root = {
    nodeType:1,
    tagName:"HTML",
    querySelectorAll(selector) { return selector === "video" ? videos : []; }
  };
  const window = {
    __AKWAM_BRIDGE__:{lang:"en",upstreamHost:"akwam.ss"},
    fetch:() => Promise.resolve(),
    parent:{postMessage() {}}
  };
  const context = {
    window,
    location:{href:"https://example.com" + pathname,origin:"https://example.com",pathname},
    document:{
      readyState:"loading",
      documentElement:root,
      head:{appendChild() {}},
      createElement() { return {textContent:""}; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {}
    },
    XMLHttpRequest:class { open() {} },
    history:{pushState() {},replaceState() {}},
    MutationObserver:class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} },
    URL,
    Request,
    console
  };
  vm.runInNewContext(bootstrapScript, context);
  return observers;
}

test("episode playback skips exactly 85 seconds and autoplays", () => {
  const video = makeVideo();
  runBootstrap("/site/en/watch/185231/105666/episode", [video]);
  assert.equal(video.currentTime, 85);
  assert.equal(video.playCalls, 1);
});

test("saved playback positions are preserved", () => {
  const video = makeVideo({currentTime:120});
  runBootstrap("/site/en/watch/185231/105666/episode", [video]);
  assert.equal(video.currentTime, 120);
  assert.equal(video.playCalls, 1);
});

test("clips up to 85 seconds are not skipped and still autoplay", () => {
  const video = makeVideo({duration:85});
  runBootstrap("/site/en/watch/185231/105666/episode", [video]);
  assert.equal(video.currentTime, 0);
  assert.equal(video.playCalls, 1);
});

test("movie pages are not affected", () => {
  const video = makeVideo();
  runBootstrap("/site/en/watch/185231/movie-title", [video]);
  assert.equal(video.currentTime, 0);
  assert.equal(video.playCalls, 0);
});

test("the skip waits for video metadata", () => {
  const video = makeVideo({readyState:0});
  runBootstrap("/site/en/watch/185231/105666/episode", [video]);
  assert.equal(video.currentTime, 0);
  video.readyState = 1;
  video.emit("loadedmetadata");
  assert.equal(video.currentTime, 85);
  assert.equal(video.playCalls, 1);
});

test("videos inserted after page load are handled", () => {
  const observers = runBootstrap("/site/en/watch/185231/105666/episode");
  const video = makeVideo();
  observers[0].callback([{addedNodes:[video]}]);
  assert.equal(video.currentTime, 85);
  assert.equal(video.playCalls, 1);
});

test("player resets to the intro are corrected before playback", () => {
  const video = makeVideo();
  runBootstrap("/site/en/watch/185231/105666/episode", [video]);
  video.currentTime = 0;
  video.emit("seeked");
  assert.equal(video.currentTime, 85);
  video.currentTime = 0;
  video.emit("play");
  assert.equal(video.currentTime, 85);
});

test("rejected autoplay retries muted", async () => {
  const video = makeVideo();
  video.play = () => {
    video.playCalls++;
    return video.playCalls === 1 ? Promise.reject(new Error("Autoplay blocked")) : Promise.resolve();
  };
  runBootstrap("/site/en/watch/185231/105666/episode", [video]);
  await Promise.resolve();
  assert.equal(video.playCalls, 2);
  assert.equal(video.muted, true);
});
