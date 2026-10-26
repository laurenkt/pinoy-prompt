// The About page's pictures of the app (about.html), taken by the screenshot harness on a 390×844 iPhone and kept as
// WebP in src/about/shots/. Run again when a screen they show changes:
//
//   npm run about-shots
//
// Most are of a learner four months in (--seasoned), so the charts have something to show; the rest are flows written
// for the harness's usual learner of a dozen words.
//
// The coach-* ones run the real speech model, so its verdicts can change: check the About page's captions still match.

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SEASONED = ['home', 'drills', 'drills-memory', 'chat-call'];
/** The coach-* ones run the real speech model on src/about/walang-anuman-english.mp3 and on the app's own clip. */
const BEGINNER = ['drills-picture-answered', 'coach-wrong', 'coach-right'];
/** Shown scrolling inside the phone, so kept this tall (in the screenshot's pixels, twice the phone's points). */
const TALL = { 'drills-memory': 3400 };
const SIZE = '390x844';
const OUT = 'src/about/shots';

const RUNS = [
  ['seasoned', SEASONED, ['--seasoned']],
  ['beginner', BEGINNER, []],
];

const raw = await mkdtemp(join(tmpdir(), 'about-shots-'));
try {
  // Each learner in a folder of its own, as the harness always takes Home too.
  for (const [folder, names, options] of RUNS) {
    const run = spawnSync('node', ['scripts/screenshots.mjs', join(raw, folder), `--size=${SIZE}`, ...options, ...names], { stdio: 'inherit' });
    if (run.status !== 0) throw new Error('The screenshot harness could not take every screen (see above)');
  }
  // Chromium makes the WebP: cropped to the phone's screen (or its TALL height), at quality 0.8.
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [folder, name] of RUNS.flatMap(([folder, names]) => names.map((name) => [folder, name]))) {
    const png = await readFile(join(raw, folder, `${name}-${SIZE}.png`));
    const webp = await page.evaluate(
      async ([src, tall]) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = Math.min(image.height, tall);
        canvas.getContext('2d').drawImage(image, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
        return [...new Uint8Array(await blob.arrayBuffer())];
      },
      [`data:image/png;base64,${png.toString('base64')}`, TALL[name] ?? 844 * 2],
    );
    await writeFile(join(OUT, `${name}.webp`), Buffer.from(webp));
    console.log(`${OUT}/${name}.webp: ${Math.round(webp.length / 1024)} KB`);
  }
  await browser.close();
} finally {
  await rm(raw, { recursive: true, force: true });
}
