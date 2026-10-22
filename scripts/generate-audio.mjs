// Makes a recorded clip for every piece of Tagalog the app can say, using
// OpenAI's text-to-speech, so words play at once and sound the same on every
// device. Run it after adding or changing cards:
//
//   OPENAI_API_KEY=sk-... npm run audio
//
// Only texts without a clip are made, so it's cheap to re-run. `--redo "text"`
// makes just that one again (for a take that sounds wrong), and `--all` remakes every
// clip (after changing the voice or instructions below). `--limit 5` makes only
// the first few, for trying a change out. Needs ffmpeg.
//
// Each text gets two clips in public/audio/: `<name>.mp3` at a natural pace and
// `<name>-slow.mp3`, the same take slowed down, listed in src/clips.json by
// text (what play() looks up, and what the app keeps offline). A name ends in
// a hash of the sound, so a remade take gets a new name and phones that kept
// the old one fetch it again. Every take is transcribed back and compared with
// its text; a take that doesn't match is made again, up to three times, and
// any still unsure are listed at the end to be checked by ear. A remade take
// that never matches leaves the old clip as it was.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AUDIO_DIR = join(ROOT, 'public/audio');
const MANIFEST = join(ROOT, 'src/clips.json');

const MODEL = 'gpt-4o-mini-tts';
const VOICE = 'coral';
const NATURAL =
  'Voice: a native Tagalog speaker from Manila, talking casually to a friend. Pace: normal everyday conversational speed, relaxed and natural, not slow or carefully enunciated. Accent: Filipino, pronouncing every word the Tagalog way.';
/** The slow clip is the same take stretched to this speed, keeping its pitch: asked to speak slowly, the voice barely slows down. */
const SLOW_TEMPO = 0.7;
const ATTEMPTS = 3;
const PARALLEL = 6;

const args = process.argv.slice(2);
const all = args.includes('--all');
const redo = args.flatMap((a, i) => (a === '--redo' ? [args[i + 1]] : []));
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;
// Without a key, requests go out unsigned, for a proxy that adds it.
const key = process.env.OPENAI_API_KEY;

async function spokenTexts() {
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  try {
    return (await vite.ssrLoadModule('/src/spoken.ts')).allSpoken();
  } finally {
    await vite.close();
  }
}

/** A readable file name: the text's first letters, and a hash of the take so a new take gets a new name. */
function clipName(text, take) {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return `${slug || 'clip'}-${createHash('sha1').update(take).digest('hex').slice(0, 8)}`;
}

async function api(path, init) {
  for (let tries = 0; ; tries++) {
    const response = await fetch(`https://api.openai.com/v1/${path}`, { ...init, headers: { ...(key && { Authorization: `Bearer ${key}` }), ...init.headers } });
    if (response.ok) return response;
    if (tries < 4 && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** tries));
      continue;
    }
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
}

async function speak(text, instructions) {
  const response = await api('audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions, response_format: 'wav' }),
  });
  return Buffer.from(await response.arrayBuffer());
}

/** What a take says, heard by a speech recogniser. Given the take as made, as it rejects some very short MP3s. */
async function transcribe(wav) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
  form.append('model', 'gpt-4o-transcribe');
  form.append('language', 'tl');
  form.append('prompt', 'A short Tagalog word or phrase.');
  const response = await api('audio/transcriptions', { method: 'POST', body: form });
  return (await response.json()).text;
}

/** Trim the silence at each end, even out loudness, and save as mono MP3 in `work`: once as said, and once slowed down. */
async function encode(wav, name, work) {
  const input = join(work, `${name}.wav`);
  await writeFile(input, wav);
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
  const clean = `${trim},areverse,${trim},areverse,loudnorm=I=-16:TP=-1.5:LRA=11`;
  // The voice comes at 24 kHz, which is plenty for speech, so clips stay at that rate. MP3, as
  // every browser decodes it (open-source Chromium builds can't decode AAC).
  const mp3 = ['-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k'];
  for (const [suffix, tempo] of [['', ''], ['-slow', `,atempo=${SLOW_TEMPO}`]]) {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', `${clean}${tempo},apad=pad_dur=0.05`, ...mp3, join(work, `${name}${suffix}.mp3`)]);
  }
  await rm(input);
}

const words = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

/** Letters that differ between two strings, for a rough match that forgives a stray letter. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = next;
    }
  }
  return row[b.length];
}

/** Whether a take's transcript is close enough to its text: a letter or two off in short ones, a little more in long ones. */
function heardRight(text, heard) {
  const want = words(text);
  return distance(want, words(heard)) <= Math.max(1, Math.floor(want.length / 12));
}

/** Make a text's clips, returning their name, or null if no take sounded right and there's already a clip to keep. */
async function makeClip(text, work, unsure, keepOld) {
  for (let attempt = 1; ; attempt++) {
    const take = await speak(text, NATURAL);
    const draft = `take-${createHash('sha1').update(take).digest('hex')}`;
    await encode(take, draft, work);
    let heard;
    let checked = true;
    try {
      heard = await transcribe(take);
    } catch (error) {
      // Not worth paying for more takes when the check itself failed.
      checked = false;
      heard = `(couldn't transcribe: ${error.message.split('\n')[0]})`;
    }
    const right = !checked || heardRight(text, heard);
    if (!right && attempt < ATTEMPTS) continue;
    if (!right || !checked) unsure.push({ text, heard, kept: !right && keepOld });
    if (!right && keepOld) return null;
    const name = clipName(text, await readFile(join(work, `${draft}.mp3`)));
    for (const suffix of ['', '-slow']) await rename(join(work, `${draft}${suffix}.mp3`), join(AUDIO_DIR, `${name}${suffix}.mp3`));
    return name;
  }
}

const texts = await spokenTexts();
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8').catch(() => '{}'));
await mkdir(AUDIO_DIR, { recursive: true });
// Inside the repo, not the system temp folder, so takes can be moved into public/audio (a move can't cross disks).
const work = await mkdtemp(join(ROOT, 'node_modules', '.pinoy-audio-'));
const todo = (redo.length ? redo : texts.filter((t) => all || !manifest[t])).slice(0, limit);
const unknown = redo.filter((t) => !texts.includes(t));
if (unknown.length) throw new Error(`Not a text the app says: ${unknown.join(', ')}`);
console.log(`${texts.length} texts, ${todo.length} to make.`);

/** Write the lists, keeping only what the app still says, in deck order. Saved after every clip, so a run cut short keeps what it made. */
let saving = Promise.resolve();
function save(prune = false) {
  // One at a time, as several clips can finish together.
  return (saving = saving.then(() => write(prune)));
}

async function write(prune) {
  const kept = Object.fromEntries(texts.filter((t) => manifest[t]).map((t) => [t, manifest[t]]));
  await writeFile(MANIFEST, `${JSON.stringify(kept, null, 2)}\n`);
  if (!prune) return;
  // Every clip here is one this script made, so one no longer listed can go.
  const files = Object.values(kept).flatMap((name) => [`${name}.mp3`, `${name}-slow.mp3`]);
  for (const file of await readdir(AUDIO_DIR)) {
    if (file.endsWith('.mp3') && !files.includes(file)) await rm(join(AUDIO_DIR, file));
  }
}

const unsure = [];
let done = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let text; (text = queue.shift()) !== undefined; ) {
      const name = await makeClip(text, work, unsure, !!manifest[text]);
      if (name) manifest[text] = name;
      await save();
      console.log(`${++done}/${todo.length} ${text}`);
    }
  }),
);
await rm(work, { recursive: true });
await save(true);

if (unsure.length) {
  console.log(`\nThese didn't transcribe back to their text. Listen to them, and --redo any that sound wrong:`);
  for (const u of unsure) console.log(`  "${u.text}" heard as "${u.heard}"${u.kept ? ', so the old clip was kept' : ''}`);
}
