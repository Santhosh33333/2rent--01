/**
 * Layout probe for the landing page.
 *
 * Drives headless Chrome over the DevTools Protocol so the page can be measured
 * at viewport widths the review browser cannot be resized to (its window is
 * pinned at ~742px by a docked panel, which puts the page into its tablet
 * breakpoints and hides every desktop layout bug there is).
 *
 * Usage: node scripts/probe-landing.mjs [url] [outDir]
 * Writes screenshots and prints measured geometry as JSON.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ARG = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.argv[3] ?? 'C:\\Users\\acer\\AppData\\Local\\Temp\\opencode\\landing-shots';
const PORT = 9333;

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + join(OUT, 'profile'),
  'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    /* not up yet */
  }
}
if (!target) {
  chrome.kill();
  throw new Error('Chrome did not expose a debugging target.');
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Runs an expression in the page and returns its JSON value. */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed');
  }
  return res.result.value;
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

const PROBE = `(() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  const overflow = q('.nb *').filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2);
  }).slice(0, 12).map(el => ({
    cls: (el.className && String(el.className).slice(0, 60)) || el.tagName,
    left: Math.round(el.getBoundingClientRect().left),
    right: Math.round(el.getBoundingClientRect().right),
  }));
  return {
    vw: window.innerWidth,
    docH: document.documentElement.scrollHeight,
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    sections: q('.nb-section').map(s => ({ id: s.id || '(trust)', h: Math.round(s.getBoundingClientRect().height) })),
    heroGrid: box(document.querySelector('.nb-hero-grid')),
    pillars: q('.nb-pillar-grid').map(g => {
      const cols = getComputedStyle(g).gridTemplateColumns;
      return { cols, h: Math.round(g.getBoundingClientRect().height) };
    }),
    capVisible: q('.nb-cap').map(c => getComputedStyle(c).display !== 'none'),
    navUlVisible: getComputedStyle(document.querySelector('#nb-menu')).display !== 'none',
    burgerVisible: getComputedStyle(document.querySelector('.nb-burger')).display !== 'none',
    revealsHidden: q('.nb-rv').filter(e => getComputedStyle(e).opacity === '0').length,
    revealsTotal: q('.nb-rv').length,
    videos: q('video').map(v => ({ src: (v.querySelector('source').src || '').split('/').pop(), w: v.videoWidth, paused: v.paused })),
    stills: q('.nb-photo > img').map(i => (i.src || '').split('/').pop()),
    offer: document.querySelector('.nb-offer-huge')?.textContent ?? null,
    // The movies stage stacks a fixed 440x340 poster composition with the
    // "on the way" row beneath it, so the two can collide at some width. Measured
    // here because the review browser only ever shows one breakpoint.
    moviesStage: (() => {
      const sec = document.querySelector('#movies');
      if (!sec) return null;
      const inSec = (s) => Array.from(sec.querySelectorAll(s));
      const bx = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const posters = inSec('.nb-poster').map(bx);
      const soonBox = bx(sec.querySelector('.nb-soon'));
      const items = inSec('.nb-soon-item').map(bx);
      const posterBottom = posters.length ? Math.max(...posters.map((p) => p.b)) : null;
      const soonTop = soonBox ? soonBox.t : null;
      return {
        soonHead: sec.querySelector('.nb-soon-head')?.textContent ?? null,
        soonCount: items.length,
        titles: inSec('.nb-soon-item b').map((b) => b.textContent),
        dates: inSec('.nb-soon-item small').map((s) => s.textContent),
        postersWithoutImage: inSec('.nb-poster').filter((p) => !p.querySelector('img')).length,
        soonItemsWithoutImage: inSec('.nb-soon-item').filter((a) => !a.querySelector('img')).length,
        posterBottom,
        soonTop,
        // Negative means the row has ridden up over the posters.
        gap: posterBottom !== null && soonTop !== null ? soonTop - posterBottom : null,
        soonBox,
        itemsOutsideSoonBox: soonBox ? items.filter((i) => i.t < soonBox.t - 1 || i.b > soonBox.b + 1).length : 0,
        itemsWiderThanBox: soonBox ? items.filter((i) => i.l < soonBox.l - 1 || i.r > soonBox.r + 1).length : 0,
      };
    })(),
    overflow,
  };
})()`;

const results = {};
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  for (const [label, width, height, mobile] of [
    ['desktop-1440', 1440, 900, false],
    ['laptop-1280', 1280, 800, false],
    ['tablet-900', 900, 1000, false],
    ['mobile-390', 390, 844, true],
  ]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await send('Page.navigate', { url: URL_ARG });
    // Long enough for the five requests, the video metadata and the reveal
    // failsafe (1.5s) to all settle.
    await sleep(3500);
    results[label] = await evaluate(PROBE);
    await screenshot(label);
  }
} finally {
  const logs = await send('Log.enable').then(() => []).catch(() => []);
  void logs;
  ws.close();
  chrome.kill();
}

console.log(JSON.stringify(results, null, 1));