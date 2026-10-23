// Screenshots of the app on phone-sized screens, for checking a layout change
// against REVIEW.md the same way every time (docs/ARCHITECTURE.md).
//
//   npm run screenshots -- <out-dir> [screen ...]
//
// Screens: the keys of SCREENS below (all of them by default). Each is taken at
// every size, on a learner who knows a dozen words (or, for the first-* ones,
// none yet), with randomness seeded so before and after match.
// Prints Home's scroll height at each size, how far any other screen scrolls,
// and any screen wider than the phone.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * 360 and 390 wide (CLAUDE.md), and the shortest and tallest phones the app should suit. The iPhones
 * carry their safe-area insets as installed (status bar, home bar), which the app's padding adds to.
 */
const SIZES = [
  { name: '360x640', width: 360, height: 640, top: 0, bottom: 0 },
  { name: '390x844', width: 390, height: 844, top: 47, bottom: 34 },
  { name: 'se-375x667', width: 375, height: 667, top: 20, bottom: 0 },
  { name: 'max-430x932', width: 430, height: 932, top: 59, bottom: 34 },
];

/** Where drills-speak keeps the speech model between runs. */
const MODEL_FILE = 'node_modules/.cache/pinoy-prompt/model.int8.onnx';
/** The speech model, read once. */
let model;

/** How to reach each screen from Home. */
const SCREENS = {
  home: async () => {},
  // The memory chart tapped where the past meets the forecast: the marker on today.
  'home-chart': async (page) => {
    const frame = await page.locator('.growth-frame').boundingBox();
    const past = await page.locator('.growth-axis-past').boundingBox();
    await page.touchscreen.tap(past.x + past.width, frame.y + frame.height * 0.8);
  },
  drills: (page) => page.click('.drills-btn'),
  // With the speech model on the device (a stand-in for it), Drills asks for the microphone as it opens,
  // here a question never answered, so the holding screen stays up.
  'drills-mic': async (page) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    });
    await page.evaluate(async () => {
      const { CACHE, MODEL_URL } = await import('/src/model-cache.ts');
      await (await caches.open(CACHE)).put(MODEL_URL, new Response('stand-in'));
    });
    await page.reload();
    await page.waitForSelector('.home');
    await page.click('.drills-btn');
  },
  // A round of Speak only, with the real speech model (about 70 MB, downloaded once into node_modules/.cache) and a
  // stand-in microphone: ready to listen, then listening.
  'drills-speak': (page) => speakOnly(page),
  'drills-speaking': async (page) => {
    await speakOnly(page);
    await page.click('.btn.mic');
    await page.waitForSelector('.speak.recording');
  },
  'drills-answered': async (page) => {
    await page.click('.drills-btn');
    await page.click('.choice');
  },
  study: (page) => page.click('.hub-btn.big:not(.chat-btn)'),
  'study-next': async (page) => {
    await page.click('.hub-btn.big:not(.chat-btn)');
    await page.click('.panel .btn.big');
  },
  // A spoken attempt's results, from a drill round asking only to speak, with stand-ins for the microphone and
  // the speech model that hear the word with a vowel and a consonant off.
  'speak-result': async (page) => {
    await page.evaluate(async () => {
      const { defaultDeps } = await import('/src/screens/speak.ts');
      const { toPhones } = await import('/src/phonetics.ts');
      const { NUM_MEL_BINS } = await import('/src/fbank.ts');
      const swap = { a: 'ɛ', i: 'ɛ', u: 'o', o: 'u', ɛ: 'i', s: 'ʃ', ŋ: 'n', ɾ: 'd', k: 'g', t: 'd', p: 'b', l: 'ɾ', m: 'n', n: 'm', b: 'p', d: 't', g: 'k', h: 'k', w: 'b', j: 'dʒ' };
      const vowels = new Set(['a', 'i', 'u', 'o', 'ɛ']);
      const samples = new Float32Array(16000 * 2).map((_, i) => Math.sin(i / 7) * 0.2 * Math.sin((i / 32000) * Math.PI));
      Object.assign(defaultDeps, {
        recordingSupported: () => true,
        modelDownloaded: async () => true,
        modelKnownDownloaded: () => true,
        microphoneAllowed: () => true,
        holdMicrophone: async () => true,
        record: () => ({ audio: Promise.resolve({ samples, speech: true }), stop() {}, cancel() {} }),
        loadPhoneModel: async () => ({
          async recognise() {
            const sounds = toPhones(document.querySelector('.prompt .tl').textContent).filter((p) => !p.optional).map((p) => p.ipa);
            const vowel = sounds.findIndex((s) => vowels.has(s));
            const consonant = sounds.findLastIndex((s) => !vowels.has(s) && swap[s]);
            if (vowel >= 0) sounds[vowel] = swap[sounds[vowel]];
            if (consonant >= 0) sounds[consonant] = swap[sounds[consonant]];
            const frames = 200;
            return {
              sounds,
              timing: sounds.map((_, i) => ({ start: 0.3 + i * 0.12, end: 0.38 + i * 0.12 })),
              features: { data: new Float32Array(frames * NUM_MEL_BINS).map((_, i) => Math.sin(i / 9) * 3 - 4), frames },
            };
          },
        }),
      });
    });
    await drillOnlySpeak(page);
    await page.click('.speak .btn.mic');
    await page.waitForSelector('.sound-results');
  },
  // Listen only, on settled words, with a key for OpenAI: the meaning said into the box, as a wave of levels from a
  // stand-in microphone, then being heard (OpenAI never answers here).
  'drills-saying': (page) => sayMeaning(page),
  'drills-hearing': async (page) => {
    await sayMeaning(page);
    await page.click('.meaning-mic');
    await page.waitForSelector('.meaning-wave.thinking');
  },
  library: (page) => page.click('.library-btn'),
  // The filter chips, open on All, then open again with another filter chosen.
  'library-filters': async (page) => {
    await page.click('.library-btn');
    await page.click('.filter-toggle');
  },
  'library-filtered': async (page) => {
    await page.click('.library-btn');
    await page.click('.filter-toggle');
    await page.click('#library-filters .chip:nth-child(3)');
    await page.click('.filter-toggle');
  },
  // The kinds of question, open on the mix, then with one kind left out.
  'drills-scope': async (page) => {
    await page.click('.drills-btn');
    await page.click('.filter-toggle');
  },
  'drills-scoped': async (page) => {
    await page.click('.drills-btn');
    await page.click('.filter-toggle');
    await page.click('#drill-scope .chip:not(:disabled)');
  },
  settings: (page) => page.click('[aria-label="Settings"]'),
  // With a key saved and some spend on it, so the Chat card shows the estimate.
  'settings-key': async (page) => {
    await page.evaluate(async () => {
      const { addSpend, setApiKey } = await import('/src/openai.ts');
      setApiKey('sk-screenshot-0000000000000000000000');
      addSpend(3.1, Date.now() - 62 * 86_400_000);
      addSpend(1.27);
    });
    await page.click('[aria-label="Settings"]');
  },
  // Opened from the Home Screen, so Settings offers the number on the app's icon.
  'settings-installed': async (page) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        const list = real(q);
        if (q === '(display-mode: standalone)') Object.defineProperty(list, 'matches', { value: true });
        return list;
      };
      // Headless Chromium refuses notifications outright; a phone that hasn't been asked yet.
      Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    });
    await page.reload();
    await page.waitForSelector('.home');
    await page.click('[aria-label="Settings"]');
  },
  chat: (page) => page.click('.chat-btn'),
  // A new learner's first Study: the topic's introduction, then the first word's.
  'first-study': (page) => page.click('.hub-btn.big:not(.chat-btn)'),
  'first-study-next': async (page) => {
    await page.click('.hub-btn.big:not(.chat-btn)');
    await page.click('.panel .btn.big');
  },
  // Drills and Chat before there are words for them: a message in the middle, as Study's are.
  'first-drills': (page) => page.click('.drills-btn'),
  'first-chat': async (page) => {
    await page.evaluate(async () => (await import('/src/openai.ts')).setApiKey('sk-proj-screenshotsonly0123456789'));
    await page.click('.chat-btn');
  },
};

const [outDir, ...wanted] = process.argv.slice(2);
if (!outDir) {
  console.error(`Usage: npm run screenshots -- <out-dir> [${Object.keys(SCREENS).join(' | ')} ...]`);
  process.exit(1);
}
// Home always, for REVIEW.md's check that it fits one screen.
const names = wanted.length ? [...new Set(['home', ...wanted])] : Object.keys(SCREENS);
for (const name of names) if (!SCREENS[name]) throw new Error(`No screen called "${name}"`);
await mkdir(outDir, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];
// Playwright's own Chromium: `npx playwright install chromium` once, if it isn't installed.
const browser = await chromium.launch();

try {
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    // Seeded, so the same questions come up before and after a change.
    await context.addInitScript(() => {
      let seed = 42;
      Math.random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    });
    for (const name of names) {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: size.top, bottom: size.bottom, left: 0, right: 0 } });
      await seed(page, name.startsWith('first-') ? 0 : 12);
      await SCREENS[name](page);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(outDir, `${name}-${size.name}.png`), fullPage: true });
      const { scroll, wide } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollHeight,
        wide: document.documentElement.scrollWidth > innerWidth,
      }));
      if (name === 'home') console.log(`Home at ${size.name}: scroll height ${scroll} (screen ${size.height})`);
      // A few pixels over means a screen that should fit but can be dragged.
      else if (scroll > size.height) console.log(`${name} at ${size.name} scrolls by ${scroll - size.height}px`);
      if (wide) console.log(`SIDEWAYS SCROLL: ${name} at ${size.name}`);
      await page.close();
      // The microphone allowed for the speaking screens is theirs only.
      await context.clearPermissions();
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

/** Drills, asking only Speak. */
async function drillOnlySpeak(page) {
  await page.click('.drills-btn');
  await page.click('.filter-toggle');
  for (const mode of ['listen', 'read', 'recall']) await page.click(`#drill-scope [data-mode="${mode}"]`);
  await page.click('.filter-toggle');
}

/** Drills, asking only Listen on words settled in Study, saying the meaning into the box. */
async function sayMeaning(page) {
  await page.route('https://api.openai.com/**', () => {});
  await page.evaluate(async () => {
    const { load, recordAnswer, save } = await import('/src/store.ts');
    const progress = load(Date.now());
    // A second good answer, a day on, settles each word (settled in session.ts).
    for (const id of Object.keys(progress.cards)) recordAnswer(progress, id, 'good', Date.now() - 2 * 86_400_000);
    save(progress, { replace: true });
    (await import('/src/openai.ts')).setApiKey('sk-proj-screenshotsonly0123456789');
  });
  await page.reload();
  await page.waitForSelector('.home');
  await page.evaluate(async () => {
    const { defaultDeps } = await import('/src/screens/speak.ts');
    // A voice that rises and falls, a dozen levels a second, until it's stopped.
    defaultDeps.recordingSupported = () => true;
    defaultDeps.microphoneAllowed = () => true;
    defaultDeps.record = ({ onLevel } = {}) => {
      let finish = () => {};
      const audio = new Promise((resolve) => (finish = () => resolve({ samples: new Float32Array(16000), speech: true })));
      let n = 0;
      const timer = setInterval(() => {
        n++;
        onLevel?.(n < 6 ? 0.02 : Math.abs(Math.sin(n / 2.3)) * (0.35 + 0.6 * Math.abs(Math.sin(n / 7))));
      }, 85);
      const end = () => {
        clearInterval(timer);
        finish();
      };
      return { audio, stop: end, cancel: end };
    };
  });
  await page.click('.drills-btn');
  await page.click('.filter-toggle');
  for (const mode of ['read', 'recall', 'speak']) {
    const chip = page.locator(`#drill-scope [data-mode="${mode}"]`);
    if (await chip.isEnabled()) await chip.click();
  }
  await page.click('.filter-toggle');
  await page.click('.meaning-mic');
  await page.waitForTimeout(3200);
}

/** Drills, asking only Speak, ready to listen. */
async function speakOnly(page) {
  const { MODEL_URL } = await page.evaluate(() => import('/src/model-cache.ts'));
  if (!model) {
    if (!existsSync(MODEL_FILE)) {
      console.log('Downloading the speech model once…');
      const response = await fetch(MODEL_URL);
      if (!response.ok) throw new Error(`Couldn't download the speech model: ${response.status}`);
      await mkdir(dirname(MODEL_FILE), { recursive: true });
      // Kept only once it's all here, so a download cut short is tried again next time.
      await writeFile(`${MODEL_FILE}.part`, Buffer.from(await response.arrayBuffer()));
      await rename(`${MODEL_FILE}.part`, MODEL_FILE);
    }
    model = await readFile(MODEL_FILE);
  }
  await page.route(MODEL_URL, (route) => route.fulfill({ body: model, contentType: 'application/octet-stream' }));
  await page.context().grantPermissions(['microphone']);
  // Headless Chromium has no microphone: a quiet hum stands in for the room.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const hum = new OscillatorNode(context, { frequency: 120 });
      const level = new GainNode(context, { gain: 0.01 });
      const out = context.createMediaStreamDestination();
      hum.connect(level).connect(out);
      hum.start();
      return out.stream;
    };
  });
  await drillOnlySpeak(page);
  await page.click('.speak .btn.primary');
  await page.waitForSelector('.speak.ready', { timeout: 60_000 });
}

/** A learner who has met `words` words, built and saved by the app's own code, then Home. */
async function seed(page, words) {
  await page.goto(url);
  await page.evaluate(async (words) => {
    // Nothing left by an earlier screen at this size (a key saved by settings-key).
    localStorage.clear();
    // Only drills-mic has the speech model; the others are drawn without it.
    const { CACHE } = await import('/src/model-cache.ts');
    await caches.delete(CACHE);
    const { emptyProgress, recordAnswer, save } = await import('/src/store.ts');
    const { LEARN_ORDER } = await import('/src/deck.ts');
    const now = Date.now();
    const progress = emptyProgress(now - 3 * 86_400_000);
    Object.assign(progress.settings, { autoplay: false });
    for (const id of LEARN_ORDER.slice(0, words)) recordAnswer(progress, id, 'good', now - 3 * 86_400_000);
    save(progress, { replace: true });
  }, words);
  await page.reload();
  await page.waitForSelector('.home');
}
