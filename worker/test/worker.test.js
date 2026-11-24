import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import worker from '../src/index.js';
import {bootstrapScript} from '../src/bootstrap.js';

test('episode headings remove only a repeated episode number', () => {
  const source = bootstrapScript.match(/function normalizeEpisodeTitle\(value\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source);
  const normalizeEpisodeTitle = runInNewContext(`(${source})`);

  assert.equal(normalizeEpisodeTitle('بائعة الزهور الحلقة 1 1'), 'بائعة الزهور الحلقة 1');
  assert.equal(normalizeEpisodeTitle('مشاهدة الحلقة : 2 2'), 'مشاهدة الحلقة : 2');
  assert.equal(normalizeEpisodeTitle('Drama Episode 10 10'), 'Drama Episode 10');
  assert.equal(normalizeEpisodeTitle('الحلقة ١ 1'), 'الحلقة ١');
  assert.equal(normalizeEpisodeTitle('الحلقة 1 2'), 'الحلقة 1 2');
  assert.equal(normalizeEpisodeTitle('حلقة 3 3'), 'حلقة 3');
  assert.equal(normalizeEpisodeTitle('حلقة 3 : مسلسل بائعة الزهور مدبلج 3'), 'حلقة 3 : مسلسل بائعة الزهور مدبلج');
  assert.equal(normalizeEpisodeTitle('حلقة ٤ : مسلسل بائعة الزهور مدبلج 4'), 'حلقة ٤ : مسلسل بائعة الزهور مدبلج');
  assert.equal(normalizeEpisodeTitle('Series 2024 2024'), 'Series 2024 2024');
});

test('watch pages normalize duplicated episode titles and links', () => {
  const source = bootstrapScript.match(/function normalizeEpisodeTitles\(root\) \{[\s\S]*?\n  \}/)?.[0];
  const titleSource = bootstrapScript.match(/function normalizeEpisodeTitle\(value\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source);
  assert.ok(titleSource);
  const normalizeEpisodeTitle = runInNewContext('(' + titleSource + ')');
  const title = {textContent:'مشاهدة مسلسل بائعة الزهور الحلقة 3 3 | اكوام'};
  const episodeLink = {textContent:'الحلقة 3 3'};
  const root = {nodeType:1,closest() { return null; },matches() { return false; },querySelectorAll() { return [title,episodeLink]; }};
  const normalizeEpisodeTitles = runInNewContext('(' + source + ')', {
    episodePage:false,seriesPage:false,watchPage:true,normalizeEpisodeTitle
  });
  normalizeEpisodeTitles(root);
  assert.equal(title.textContent, 'مشاهدة مسلسل بائعة الزهور الحلقة 3 | اكوام');
  assert.equal(episodeLink.textContent, 'الحلقة 3');
});



test('Arabic Akwam footer brand spelling is recognized', () => {
  const source = bootstrapScript.match(/function isFooterBrand\(value\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source);
  const isFooterBrand = runInNewContext(`(${source})`);
  for (const label of ['اكوام','أكوام','شبكة اكوام','Akwam','Akwam Network']) {
    assert.equal(isFooterBrand(label), true, label);
  }
  assert.equal(isFooterBrand('DMCA'), false);
});

import {translatorScript} from '../src/translator.js';

const workerUrl = 'https://bridge.example.workers.dev';
const manualAdvanceKey = 'akwam-auto-next-after-manual-v1';

function createPaginationHarness({href,links,storage=new Map()}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const replacements = [];
  const timers = new Map();
  const clearedTimers = [];
  const scroller = {scrollHeight:1800,clientHeight:600,scrollTop:1200};
  const root = {
    nodeType:1,
    tagName:'HTML',
    hasAttribute() { return false; },
    querySelectorAll() { return []; }
  };
  const document = {
    documentElement:root,
    scrollingElement:scroller,
    body:{},
    getElementById() { return {}; },
    querySelector(selector) { return selector === '.page.page-archive' || selector === '.pagination' ? {} : null; },
    querySelectorAll(selector) { return selector === '.pagination a.page-link[href]' ? links : []; },
    createTreeWalker() { return {nextNode() { return null; }}; },
    addEventListener(type, listener) { documentListeners.set(type, listener); }
  };
  const window = {
    __AKWAM_BRIDGE__:{lang:'en',post() {}},
    addEventListener(type, listener) { windowListeners.set(type, listener); }
  };
  let timerId = 0;

  runInNewContext(translatorScript, {
    window,
    document,
    URL,
    location:{href,replace(url) { replacements.push(url); }},
    localStorage:{getItem() { return null; },setItem() {}},
    sessionStorage:{
      getItem(key) { return storage.get(key) || null; },
      setItem(key,value) { storage.set(key,value); },
      removeItem(key) { storage.delete(key); }
    },
    setTimeout(callback,delay) { const id=++timerId; timers.set(id,{callback,delay}); return id; },
    clearTimeout(id) { clearedTimers.push(id); timers.delete(id); },
    MutationObserver:class { observe() {} },
    Node:{TEXT_NODE:3,ELEMENT_NODE:1},
    NodeFilter:{SHOW_TEXT:4},
    innerHeight:600
  });

  return {window,windowListeners,document,documentListeners,replacements,timers,clearedTimers,scroller,storage};
}

function createPosterHarness({href,lang='en',alt,translation}) {
  const classes = new Set(['entry-image']);
  let label = null;
  const host = {
    classList:{
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); }
    },
    querySelector(selector) { return selector === ':scope > .akwam-poster-translation' ? label : null; },
    appendChild(element) {
      label = element;
      element.remove = () => { if (label === element) label = null; };
    }
  };
  const attributes = {alt};
  const image = {
    nodeType:1,
    tagName:'IMG',
    type:'',
    isConnected:true,
    hasAttribute(name) { return Object.hasOwn(attributes,name); },
    getAttribute(name) { return attributes[name] ?? null; },
    setAttribute(name,value) { attributes[name] = String(value); },
    closest(selector) { return selector === '.entry-image' ? host : null; }
  };
  const root = {
    nodeType:1,
    tagName:'HTML',
    hasAttribute() { return false; },
    querySelectorAll() { return [image]; }
  };
  const document = {
    documentElement:root,
    head:{appendChild() {}},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tagName) {
      return {tagName:tagName.toUpperCase(),dataset:{},setAttribute() {}};
    },
    createTreeWalker() { return {nextNode() { return null; }}; },
    addEventListener() {}
  };
  const window = {__AKWAM_BRIDGE__:{lang,post() {}},addEventListener() {}};
  runInNewContext(translatorScript, {
    window,
    document,
    location:{href},
    URL,
    localStorage:{getItem() { return null; },setItem() {}},
    sessionStorage:{getItem() { return null; },setItem() {},removeItem() {}},
    fetch:async (_url,init) => {
      const {texts} = JSON.parse(init.body);
      return {ok:true,json:async() => ({translations:texts.map(() => translation)})};
    },
    setTimeout,
    clearTimeout,
    MutationObserver:class { observe() {} },
    Node:{TEXT_NODE:3,ELEMENT_NODE:1},
    NodeFilter:{SHOW_TEXT:4},
    innerHeight:600
  });
  return {image,host,get label() { return label; }};
}

function createTextHarness({source,fetch:fetchTranslation}) {
  const node = {
    nodeType:3,
    nodeValue:source,
    parentElement:{tagName:'DIV',closest() { return null; }},
    isConnected:true
  };
  const reports = [];
  const retryTimers = [];
  let onMutation = () => {};
  const root = {
    nodeType:1,
    tagName:'HTML',
    hasAttribute() { return false; },
    querySelectorAll() { return []; }
  };
  const document = {
    documentElement:root,
    head:{appendChild() {}},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tagName) { return {tagName,id:'',textContent:'',setAttribute() {}}; },
    createTreeWalker() {
      let visited = false;
      return {nextNode() { if (visited) return null; visited = true; return node; }};
    },
    addEventListener() {}
  };
  runInNewContext(translatorScript, {
    window:{
      __AKWAM_BRIDGE__:{lang:'en',post(type,details) { reports.push({type,...details}); }},
      addEventListener() {}
    },
    document,
    location:{href:workerUrl + '/site/en/series'},
    URL,
    localStorage:{getItem() { return null; },setItem() {}},
    sessionStorage:{getItem() { return null; },setItem() {},removeItem() {}},
    fetch:fetchTranslation,
    setTimeout(callback,delay) {
      if (delay > 1000) {
        const timer = {callback,delay};
        retryTimers.push(timer);
        return timer;
      }
      return globalThis.setTimeout(callback,delay);
    },
    clearTimeout(timer) {
      if (typeof timer === 'object') timer.cancelled = true;
      else globalThis.clearTimeout(timer);
    },
    MutationObserver:class {
      constructor(callback) { onMutation = callback; }
      observe() {}
    },
    Node:{TEXT_NODE:3,ELEMENT_NODE:1},
    NodeFilter:{SHOW_TEXT:4},
    innerHeight:600
  });
  return {
    node,
    reports,
    retryTimers,
    updateText(value) {
      node.nodeValue = value;
      onMutation([{type:'characterData',target:node}]);
    }
  };
}

function createNavigationHarness(script,{country,language}) {
  const categories = ['turkish','indian','korean','foreign'];
  const buttons = categories.map(category => {
    const span = {textContent:''};
    const attributes = {};
    const classes = new Set(category === 'turkish' ? ['is-active'] : []);
    const listeners = new Map();
    return {
      listeners,
      click() { listeners.get('click')?.(); },
      dataset:{category},
      classList:{toggle(name,active) { active ? classes.add(name) : classes.delete(name); }},
      setAttribute(name,value) { attributes[name] = value; },
      addEventListener(type, listener) { listeners.set(type, listener); },
      querySelector(selector) { return selector === 'span' ? span : null; },
      get labels() { return span.textContent; },
      attributes
    };
  });
  const nav = {
    attributes:{},
    setAttribute(name,value) { this.attributes[name] = value; },
    querySelectorAll() { return buttons; }
  };
  const root = {lang:'ar',dir:'rtl',dataset:{},style:{setProperty() {}}};
  const setup = {hidden:true};
  const frameStage = {hidden:true};
  const frame = {src:'',contentWindow:{postMessage() {}},addEventListener() {}};
  const setupMessage = {textContent:''};
  const document = {
    documentElement:root,
    querySelector(selector) {
      return {
        '.category-nav':nav,
        '#setup':setup,
        '#frame-stage':frameStage,
        '#site-frame':frame,
        '#setup-message':setupMessage
      }[selector] || null;
    },
    querySelectorAll(selector) { return selector === '.category-tab' ? buttons : []; }
  };
  const windowListeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const window = {AKWAM_WORKER_URL:'https://bridge.example.workers.dev',addEventListener(type, listener) { windowListeners.set(type, listener); }};
  runInNewContext(script, {
    window,
    document,
    navigator:{languages:[language],language},
    location:{origin:'https://series.example.vercel.app'},
    URL,
    URLSearchParams,
    AbortController,
    fetch:async url => String(url).endsWith('/health')
      ? {ok:true,json:async() => ({ok:true,geminiConfigured:true})}
      : {ok:true,json:async() => ({country})},
    setTimeout(callback, delay) { const id=++timerId; timers.set(id,{callback,delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return 0; }
  });
  return {buttons,frame,frameStage,nav,root,setup,windowListeners,timers};
}

test('health only answers the configured Vercel origin', async () => {
  const env = {ALLOWED_PARENT_ORIGINS:'https://series.example.vercel.app', GEMINI_API_KEY:'secret', GEMINI_MODEL:'gemini-3.5-flash-lite'};
  const allowed = await worker.fetch(new Request(workerUrl + '/health', {headers:{Origin:'https://series.example.vercel.app'}}), env);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://series.example.vercel.app');
  assert.deepEqual(await allowed.json(), {ok:true,geminiConfigured:true,model:'gemini-3.5-flash-lite'});

  const wrongMethod = await worker.fetch(new Request(workerUrl + '/health', {method:'POST',headers:{Origin:'https://series.example.vercel.app'}}), env);
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(await wrongMethod.json(), {error:'Use GET'});

  const denied = await worker.fetch(new Request(workerUrl + '/health', {headers:{Origin:'https://attacker.example'}}), env);
  assert.equal(denied.status, 403);
});

test('injected scripts bypass stale browser caches', async () => {
  for (const path of ['/__bridge/bootstrap.js','/__bridge/translator.js']) {
    const response = await worker.fetch(new Request(workerUrl + path), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    if (path.endsWith('translator.js')) assert.match(await response.text(), /renderPosterTitle/);
  }
});

test('video ad bridge uses a fixed Smart Link and rejects other methods', async () => {
  const response = await worker.fetch(new Request(workerUrl + '/__bridge/ad?url=https://attacker.example'), {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://asiafilm.org/4/397db7f27bcb1e058e7ac9ba2a034a28');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');

  const rejected = await worker.fetch(new Request(workerUrl + '/__bridge/ad', {method:'POST'}), {});
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('Allow'), 'GET, HEAD');
});

test('the player ad iframe is routed through the Worker bridge', async () => {
  const bootstrap = await readFile(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /adFrame\.src = adBridgeUrl \|\| adLinkUrl/);
  assert.match(source, /adBridgeUrl:workerOrigin \+ '\/__bridge\/ad'/);
});

test('Korean and foreign archive posters keep labels when titles need no translation', async () => {
  const posters = [
    {href:'https://bridge.example.workers.dev/site/en/series?section=33&language=12',alt:'Love in Disguise'},
    {href:'https://bridge.example.workers.dev/site/en/series?section=30',alt:'Valentina and the 12 Signs'}
  ];
  for (const poster of posters) {
    const harness = createPosterHarness({...poster,lang:'en',translation:poster.alt});
    assert.equal(harness.label?.textContent, poster.alt);
    await new Promise(resolve => setTimeout(resolve,140));
    assert.equal(harness.label?.textContent, poster.alt);
    assert.equal(harness.host.classList.contains('akwam-poster-host'), true);
  }
});

test('poster labels show source immediately and update to the selected language', async () => {
  const harness = createPosterHarness({
    href:'https://bridge.example.workers.dev/site/ar/series?section=33&language=12',
    lang:'ar',
    alt:'Love in Disguise',
    translation:'حب متنكر'
  });
  assert.equal(harness.label?.textContent, 'Love in Disguise');
  await new Promise(resolve => setTimeout(resolve,140));
  assert.equal(harness.label?.textContent, 'حب متنكر');
  assert.equal(harness.image.getAttribute('alt'), 'حب متنكر');
});

test('a late translation does not overwrite text that changed while the request was in flight', async () => {
  const requests = [];
  const harness = createTextHarness({
    source:'Old title',
    fetch:async (_url,init) => new Promise(resolve => {
      requests.push({texts:JSON.parse(init.body).texts,resolve});
    })
  });
  await new Promise(resolve => setTimeout(resolve,140));
  assert.equal(requests.length, 1);
  harness.updateText('New title');
  requests[0].resolve({ok:true,json:async() => ({translations:['Old translation']})});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(harness.node.nodeValue, 'New title');
  requests[1].resolve({ok:true,json:async() => ({translations:['New translation']})});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.node.nodeValue, 'New translation');
});

test('a 429 translation error is retryable and preserves the server retry delay', async () => {
  let attempts = 0;
  const harness = createTextHarness({
    source:'Hello',
    fetch:async () => {
      attempts += 1;
      return attempts === 1
        ? {ok:false,status:429,headers:new Headers({'Retry-After':'60'})}
        : {ok:true,json:async() => ({translations:['Hello translated']})};
    }
  });
  await new Promise(resolve => setTimeout(resolve,140));
  const error = harness.reports.find(report => report.type === 'translation-error');
  assert.equal(error.status, 429);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfter, 60);
  const retry = harness.retryTimers.find(timer => timer.delay === 60000);
  assert.ok(retry);
  retry.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(harness.node.nodeValue, 'Hello translated');
});

test('navigation labels follow the detected language and set the matching direction', async () => {
  const page = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const dictionarySource = script?.match(/const navigationLabels = (\{[\s\S]*?\n  \});/)?.[1];
  assert.ok(script);
  assert.ok(dictionarySource);
  const labelsByLanguage = runInNewContext('(' + dictionarySource + ')');
  const countries = {
    ar:'SA',en:'US',tr:'TR',fr:'FR',de:'DE',es:'ES',it:'IT',pt:'PT',ru:'RU',
    fa:'IR',ur:'PK',hi:'NP',id:'ID',ja:'JP',ko:'KR','zh-CN':'CN'
  };
  const categories = ['turkish','indian','korean','foreign'];

  for (const language of Object.keys(labelsByLanguage)) {
    const harness = createNavigationHarness(script,{country:countries[language],language});
    await new Promise(resolve => setTimeout(resolve,0));
    assert.equal(harness.root.lang, language);
    assert.equal(harness.root.dir, ['ar','fa','ur'].includes(language) ? 'rtl' : 'ltr');
    assert.deepEqual(harness.buttons.map(button => button.labels), categories.map(category => labelsByLanguage[language][category]));
    assert.equal(harness.nav.attributes['aria-label'], labelsByLanguage[language].nav);
    assert.match(harness.frame.src, new RegExp('/site/' + language.replace('-', '\\-') + '/series'));
    assert.equal(harness.frameStage.hidden, false);
  }
});

test('retry preserves the detail page and the active category returns to its listing', async () => {
  const page = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
  const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  const harness = createNavigationHarness(script,{country:'US',language:'en'});
  await new Promise(resolve => setTimeout(resolve,0));
  const archive = harness.frame.src;
  harness.buttons[0].click();
  assert.equal(harness.frame.src, archive);

  const detail = 'https://bridge.example.workers.dev/site/en/series/5778/detail';
  harness.frame.src = detail;
  const send = data => harness.windowListeners.get('message')({
    origin:workerUrl,
    source:harness.frame.contentWindow,
    data:Object.assign({source:'akwam-gemini-bridge'}, data)
  });
  send({type:'frame-state',kind:'detail',skipHeight:120,href:detail});
  send({type:'translation-error',retryable:true,message:'Temporary failure'});
  const retry = [...harness.timers.values()].find(timer => timer.delay === 1500);
  assert.ok(retry);
  retry.callback();
  assert.equal(harness.frame.src, detail);

  harness.buttons[0].click();
  const listing = new URL(harness.frame.src);
  assert.equal(listing.pathname, '/site/en/series');
  assert.equal(listing.searchParams.get('section'), '32');

  harness.buttons[1].click();
  const newArchive = harness.frame.src;
  harness.buttons[1].click();
  assert.equal(harness.frame.src, newArchive);
});

test('the parent does not reload the frame while the translator retries a rate limit', async () => {
  const page = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
  const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  const harness = createNavigationHarness(script,{country:'US',language:'en'});
  await new Promise(resolve => setTimeout(resolve,0));
  harness.windowListeners.get('message')({
    origin:workerUrl,
    source:harness.frame.contentWindow,
    data:{source:'akwam-gemini-bridge',type:'translation-error',retryable:true,status:429,retryAfter:60}
  });
  assert.equal(harness.timers.size, 0);
});

test('auto-pagination waits 7 seconds at the bottom and cancels if the user scrolls away', () => {
  const link = {href:'https://bridge.example.workers.dev/site/en/series?section=32&%3Bcategory=0&%3Bpage=2&__parent=https%3A%2F%2Fseries.example.vercel.app'};
  const harness = createPaginationHarness({href:'https://bridge.example.workers.dev/site/en/series?section=32&page=1',links:[link]});
  assert.equal(new URL(link.href).searchParams.get('page'), '2');

  harness.documentListeners.get('scroll')({target:harness.document});
  assert.equal(harness.replacements.length, 0);
  const firstTimer = [...harness.timers.entries()][0];
  assert.equal(firstTimer[1].delay, 7000);

  harness.scroller.scrollTop = 700;
  harness.documentListeners.get('scroll')({target:harness.document});
  assert.deepEqual(harness.clearedTimers, [firstTimer[0]]);
  assert.equal(harness.replacements.length, 0);

  harness.scroller.scrollTop = 1200;
  harness.documentListeners.get('scroll')({target:harness.document});
  const nextTimer = [...harness.timers.values()][0];
  assert.equal(nextTimer.delay, 7000);
  nextTimer.callback();
  assert.equal(harness.replacements.length, 1);
  const next = new URL(harness.replacements[0]);
  assert.equal(next.searchParams.get('page'), '2');
  assert.equal(next.searchParams.get('category'), '0');
  assert.equal(next.searchParams.get(';page'), null);
  assert.equal(next.searchParams.get('__parent'), 'https://series.example.vercel.app');
  assert.equal(typeof harness.windowListeners.get('scroll'), 'function');
});

test('manual next-page navigation starts a 7-second automatic advance on the new page', () => {
  const link = {href:'https://bridge.example.workers.dev/site/en/series?section=32&%3Bpage=2'};
  const first = createPaginationHarness({href:'https://bridge.example.workers.dev/site/en/series?section=32&page=1',links:[link]});
  first.documentListeners.get('click')({target:{nodeType:1,closest() { return link; }}});
  assert.equal(first.storage.get(manualAdvanceKey), '1');

  const pageThree = {href:'https://bridge.example.workers.dev/site/en/series?section=32&%3Bpage=3'};
  const second = createPaginationHarness({
    href:'https://bridge.example.workers.dev/site/en/series?section=32&page=2',
    links:[pageThree],
    storage:first.storage
  });
  assert.equal(second.storage.has(manualAdvanceKey), false);
  assert.equal(second.timers.size, 1);
  const timer = [...second.timers.values()][0];
  assert.equal(timer.delay, 7000);
  timer.callback();
  assert.equal(new URL(second.replacements[0]).searchParams.get('page'), '3');
});

test('external popups are blocked while internal opens navigate in-frame', async () => {
  const parentOrigin = 'https://series.example.vercel.app';
  const assignments = [];
  const window = {
    __AKWAM_BRIDGE__:{lang:'en',parentOrigin,upstreamHost:'akwam.ss'},
    fetch:async () => new Response(),
    parent:{postMessage() {}}
  };
  const location = {
    origin:workerUrl,
    href:workerUrl + '/site/en/series?__parent=' + encodeURIComponent(parentOrigin),
    pathname:'/site/en/series',
    assign(url) { assignments.push(url); }
  };
  const root = {nodeType:1,tagName:'HTML',getAttribute() { return null; },querySelectorAll() { return []; }};
  class TestXHR { open() {} }
  class TestMutationObserver { observe() {} }
  runInNewContext(bootstrapScript, {
    window,
    location,
    URL,
    Request,
    XMLHttpRequest:TestXHR,
    history:{pushState() {},replaceState() {}},
    document:{documentElement:root,querySelector() { return null; },addEventListener() {}},
    MutationObserver:TestMutationObserver
  });

  assert.equal(window.open('/site/en/series/5967', '_blank'), window);
  assert.equal(new URL(assignments[0]).pathname, '/site/en/series/5967');
  assert.equal(new URL(assignments[0]).searchParams.get('__parent'), parentOrigin);
  assert.equal(window.open('https://ads.example/pop', '_blank'), null);
  assert.equal(assignments.length, 1);

  const page = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
  assert.match(page, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"/);
});

test('visitor endpoint uses Cloudflare country without sharing the visitor IP', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected external lookup'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const parent = 'https://series.example.vercel.app';
  const request = new Request(workerUrl + '/api/visitor', {
    headers:{Origin:parent,'CF-Connecting-IP':'203.0.113.10'}
  });
  Object.defineProperty(request, 'cf', {value:{country:'us'}});
  const response = await worker.fetch(request, {ALLOWED_PARENT_ORIGINS:parent});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), parent);
  assert.deepEqual(await response.json(), {country:'US',source:'cloudflare'});

  const denied = await worker.fetch(new Request(workerUrl + '/api/visitor', {
    headers:{Origin:'https://attacker.example','CF-Connecting-IP':'203.0.113.10'}
  }), {ALLOWED_PARENT_ORIGINS:parent});
  assert.equal(denied.status, 403);
});

test('visitor endpoint leaves country empty when Cloudflare has no valid country', async () => {
  const parent = 'https://series.example.vercel.app';
  const request = new Request(workerUrl + '/api/visitor', {
    headers:{Origin:parent}
  });
  Object.defineProperty(request, 'cf', {value:{country:'XX'}});
  const response = await worker.fetch(request, {ALLOWED_PARENT_ORIGINS:parent});
  assert.deepEqual(await response.json(), {country:'',source:''});
});

test('translation validates the caller and sends the API key only in a header', async t => {
  const originalFetch = globalThis.fetch;
  let outboundUrl;
  let outboundHeaders;
  globalThis.fetch = async (input, init) => {
    outboundUrl = String(input);
    outboundHeaders = new Headers(init.headers);
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({translations:['مرحبا','مسلسل']})}]}}]});
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const request = new Request(workerUrl + '/api/translate', {
    method:'POST',
    headers:{Origin:workerUrl,'Content-Type':'application/json'},
    body:JSON.stringify({targetLang:'ar',texts:['Hello','Series']})
  });
  const response = await worker.fetch(request, {GEMINI_API_KEY:'test-secret',GEMINI_MODEL:'gemini-3.5-flash-lite'});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {translations:['مرحبا','مسلسل']});
  assert.equal(new URL(outboundUrl).pathname, '/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(new URL(outboundUrl).search, '');
  assert.equal(outboundHeaders.get('x-goog-api-key'), 'test-secret');

  const denied = await worker.fetch(new Request(workerUrl + '/api/translate', {
    method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'
  }), {GEMINI_API_KEY:'test-secret'});
  assert.equal(denied.status, 403);
});

test('translation returns a client-safe error for a null Gemini response', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({candidates:[{content:{parts:[{text:'null'}]}}]});
  t.after(() => { globalThis.fetch = originalFetch; });

  const request = new Request(workerUrl + '/api/translate', {
    method:'POST',
    headers:{Origin:workerUrl,'Content-Type':'application/json'},
    body:JSON.stringify({targetLang:'ar',texts:['Hello']})
  });
  const response = await worker.fetch(request, {GEMINI_API_KEY:'test-secret'});
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {error:'Gemini returned an incomplete translation'});
});

test('translation rate limits tell the browser when to retry', async () => {
  const request = new Request(workerUrl + '/api/translate', {
    method:'POST',
    headers:{Origin:workerUrl,'Content-Type':'application/json'},
    body:JSON.stringify({targetLang:'ar',texts:['Hello']})
  });
  const response = await worker.fetch(request, {
    GEMINI_API_KEY:'test-secret',
    TRANSLATION_LIMITER:{limit:async () => ({success:false})}
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
});

test('translation rejects oversized and malformed batches before calling Gemini', async () => {
  const request = new Request(workerUrl + '/api/translate', {
    method:'POST',
    headers:{Origin:workerUrl,'Content-Type':'application/json'},
    body:JSON.stringify({targetLang:'ar',texts:['x'.repeat(701)]})
  });
  const response = await worker.fetch(request, {GEMINI_API_KEY:'test-secret'});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error:'Text item is too long or invalid'});
});

test('translation caps streamed request bodies before parsing JSON', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(32769)); },
    cancel() { cancelled = true; }
  });
  const request = {
    method:'POST',
    url:workerUrl + '/api/translate',
    headers:new Headers({Origin:workerUrl,'Content-Type':'application/json'}),
    body
  };
  const response = await worker.fetch(request, {GEMINI_API_KEY:'test-secret'});
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {error:'Request body is too large'});
  assert.equal(cancelled, true);
});

test('translation rejects oversized declared bodies before reading them', async () => {
  const headers = new Headers({Origin:workerUrl,'Content-Type':'application/json','Content-Length':'32769'});
  const response = await worker.fetch({method:'POST',url:workerUrl + '/api/translate',headers,body:null}, {GEMINI_API_KEY:'test-secret'});
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {error:'Request body is too large'});
});

test('SEO catalog pages stay on the public origin and receive category metadata', async t => {
  const originalFetch = globalThis.fetch;
  const originalRewriter = globalThis.HTMLRewriter;
  let upstreamUrl;
  const handlers = new Map();
  globalThis.fetch = async request => {
    upstreamUrl = String(request.url);
    return new Response('<!doctype html><html><head></head><body></body></html>', {headers:{'content-type':'text/html'}});
  };
  globalThis.HTMLRewriter = class {
    on(selector, handler) { handlers.set(selector, handler); return this; }
    transform(response) { return response; }
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.HTMLRewriter = originalRewriter;
  });

  const parent = 'https://series.example.vercel.app';
  const env = {UPSTREAM_HOST:'akwam.ss',ALLOWED_PARENT_ORIGINS:parent};
  const url = new URL(workerUrl + '/site/ar/series?section=33&page=2&seo=1');
  url.searchParams.set('__parent', parent);
  const response = await worker.fetch(new Request(url), env);
  const upstream = new URL(upstreamUrl);
  assert.equal(upstream.hostname, 'akwam.ss');
  assert.equal(upstream.searchParams.get('__parent'), null);
  assert.equal(upstream.searchParams.get('seo'), null);
  assert.equal(upstream.searchParams.get('section'), '33');
  assert.equal(response.status, 200);

  const element = attributes => ({
    attributes:{...attributes},
    text:'',
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name,value) { this.attributes[name] = String(value); },
    setInnerContent(value) { this.text = String(value); }
  });
  const canonical = element({href:'https://akwam.ss/series'});
  handlers.get('link[rel="canonical"]').element(canonical);
  assert.equal(canonical.attributes.href, parent + '/catalog/korean?page=2');
  const socialUrl = element({content:'https://akwam.ss/series'});
  handlers.get('meta[property="og:url"]').element(socialUrl);
  assert.equal(socialUrl.attributes.content, canonical.attributes.href);
  const title = element({});
  handlers.get('title').element(title);
  assert.equal(title.text, 'مسلسلات كورية مترجمة | Turkify Series');
  const heading = element({});
  handlers.get('h1.name').element(heading);
  assert.equal(heading.text, 'مسلسلات كورية');
  const link = element({href:'https://akwam.ss/series/5946/the-perfect-lie'});
  handlers.get('[href]').element(link);
  assert.equal(link.attributes.href, parent + '/catalog/ar/series/5946/the-perfect-lie');
});

test('SEO bootstrap preserves public catalog routes', () => {
  const parentOrigin = 'https://series.example.vercel.app';
  const assignments = [];
  const attributes = {href:'https://akwam.ss/series/5946/the-perfect-lie'};
  const link = {
    nodeType:1,
    tagName:'A',
    getAttribute(name) { return attributes[name] ?? null; },
    setAttribute(name,value) { attributes[name] = String(value); },
    hasAttribute() { return false; }
  };
  const window = {
    __AKWAM_BRIDGE__:{lang:'ar',parentOrigin:'',upstreamHost:'akwam.ss',seoMode:true},
    fetch:async () => new Response(),
    parent:{postMessage() {}}
  };
  const location = {
    origin:parentOrigin,
    href:parentOrigin + '/catalog/ar/series',
    pathname:'/catalog/ar/series',
    assign(url) { assignments.push(url); }
  };
  const root = {nodeType:1,tagName:'HTML',getAttribute() { return null; },querySelectorAll() { return [link]; }};
  class TestXHR { open() {} }
  class TestMutationObserver { observe() {} }
  runInNewContext(bootstrapScript, {
    window,location,URL,Request,XMLHttpRequest:TestXHR,
    history:{pushState() {},replaceState() {}},
    document:{documentElement:root,querySelector() { return null; },addEventListener() {}},MutationObserver:TestMutationObserver
  });

  assert.equal(attributes.href, parentOrigin + '/catalog/ar/series/5946/the-perfect-lie');
  assert.equal(window.open('https://akwam.ss/series/5946/the-perfect-lie', '_self'), window);
  assert.equal(new URL(assignments[0]).pathname, '/catalog/ar/series/5946/the-perfect-lie');
  assert.equal(new URL(assignments[0]).searchParams.get('__parent'), null);
});

test('Vercel exposes clean category and same-origin proxy routes', async () => {
  const config = JSON.parse(await readFile(new URL('../../site/vercel.json', import.meta.url), 'utf8'));
  const sources = new Set(config.rewrites.map(route => route.source));
  for (const category of ['turkish','indian','korean','foreign']) assert.ok(sources.has('/catalog/' + category));
  assert.ok(sources.has('/catalog/:lang/:path*'));
  assert.ok(sources.has('/api/translate'));
});

test('translation accepts only the configured site origin in addition to the Worker origin', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({candidates:[{content:{parts:[{text:JSON.stringify({translations:['مسلسل']})}]}}]});
  t.after(() => { globalThis.fetch = originalFetch; });

  const parent = 'https://series.example.vercel.app';
  const body = JSON.stringify({targetLang:'ar',texts:['Series']});
  const allowed = await worker.fetch(new Request(workerUrl + '/api/translate', {
    method:'POST',headers:{Origin:parent,'Content-Type':'application/json'},body
  }), {ALLOWED_PARENT_ORIGINS:parent,GEMINI_API_KEY:'test-secret'});
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), {translations:['مسلسل']});

  const denied = await worker.fetch(new Request(workerUrl + '/api/translate', {
    method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body
  }), {ALLOWED_PARENT_ORIGINS:parent,GEMINI_API_KEY:'test-secret'});
  assert.equal(denied.status, 403);
});

test('site proxy stays on the configured upstream and permits only the configured frame parent', async t => {
  const originalFetch = globalThis.fetch;
  const originalRewriter = globalThis.HTMLRewriter;
  const handlers = new Map();
  let upstreamUrl;
  globalThis.fetch = async request => {
    upstreamUrl = String(request.url);
    return new Response('<!doctype html><html><head></head><body>sample</body></html>', {
      headers:{'content-type':'text/html; charset=utf-8','x-frame-options':'DENY','content-security-policy':'default-src none'}
    });
  };
  globalThis.HTMLRewriter = class {
    on(selector, handler) { handlers.set(selector, handler); return this; }
    transform(response) { return response; }
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.HTMLRewriter = originalRewriter;
  });

  const parent = 'https://series.example.vercel.app';
  const env = {UPSTREAM_HOST:'akwam.ss',ALLOWED_PARENT_ORIGINS:parent};
  const url = new URL(workerUrl + '/site/ar/series?section=32');
  url.searchParams.set('__parent', parent);
  const response = await worker.fetch(new Request(url), env);
  assert.equal(new URL(upstreamUrl).hostname, 'akwam.ss');
  assert.equal(new URL(upstreamUrl).pathname, '/series');
  assert.equal(new URL(upstreamUrl).searchParams.get('__parent'), null);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/series\.example\.vercel\.app/);
  assert.equal(response.headers.get('x-frame-options'), null);

  for (const src of ['https://e.dtscout.com/e/?v=1a','https://aarems.org/20','https://mamshirt.com/ad.js']) {
    const adScript = {
      attributes:{src},
      getAttribute(name) { return this.attributes[name] ?? null; },
      remove() { this.removed = true; }
    };
    handlers.get('script[src]').element(adScript);
    assert.equal(adScript.removed, true);
  }

  const siteScript = {
    attributes:{src:'https://akwam.ss/style/assets/js/akwam.js'},
    getAttribute(name) { return this.attributes[name] ?? null; },
    remove() { this.removed = true; }
  };
  handlers.get('script[src]').element(siteScript);
  assert.equal(siteScript.removed, undefined);

  const deniedUrl = new URL(workerUrl + '/site/ar/series');
  deniedUrl.searchParams.set('__parent','https://attacker.example');
  const denied = await worker.fetch(new Request(deniedUrl), env);
  assert.equal(new URL(upstreamUrl).hostname, 'akwam.ss');
  assert.match(denied.headers.get('content-security-policy'), /frame-ancestors 'self'/);
});

test('episode updates report episode counts for each allowed catalog category', async t => {
  const originalFetch = globalThis.fetch;
  const sections = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    sections.push(url.searchParams.get('section'));
    const id = url.searchParams.get('section') === '32' ? '42' : url.searchParams.get('section');
    const count = url.searchParams.get('section') === '32' ? '١٢' : '4';
    return new Response('<div class="entry-box"><div class="labels"><span class="label series"><i></i>' + count + '</span></div><a href="/series/' + id + '/title">Title</a></div>', {
      headers:{'content-type':'text/html; charset=utf-8'}
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const origin = 'https://series.example.vercel.app';
  const response = await worker.fetch(new Request(workerUrl + '/api/episode-updates', {
    headers:{Origin:origin}
  }), {ALLOWED_PARENT_ORIGINS:origin});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  const result = await response.json();
  assert.deepEqual(result.categories.turkish, [{id:'42',episodes:12}]);
  assert.deepEqual(new Set(sections), new Set(['30','31','32','33']));

  const denied = await worker.fetch(new Request(workerUrl + '/api/episode-updates', {
    headers:{Origin:'https://attacker.example'}
  }), {ALLOWED_PARENT_ORIGINS:origin});
  assert.equal(denied.status, 403);
});
