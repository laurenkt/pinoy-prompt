// Makes a recorded clip for every piece of Tagalog the app can say, using
// OpenAI's text-to-speech, so words play at once and sound the same on every
// device. Run it after adding or changing cards:
//
//   OPENAI_API_KEY=sk-... npm run audio
//
// Only texts without a clip are made, so it's cheap to re-run. `--redo "text"`
// makes just that one again (for a take that sounds wrong), and `--all` remakes every
// clip (after changing the voices or persona below). `--limit 5` makes only
// the first few, for trying a change out. Needs ffmpeg.
//
// Each text gets a take in each voice, and each take two clips in public/audio/:
// `<name>.mp3` at a natural pace and `<name>-slow.mp3`, the same take slowed
// down, listed in src/clips.json by text, one name per voice in VOICES order
// (what play() picks from at random, and what the app keeps offline). A name ends in
// a hash of the sound, so a remade take gets a new name and phones that kept
// the old one fetch it again. Every take is transcribed back and compared with
// its text; a take that doesn't match is made again, up to three times, and
// any still unsure are listed at the end to be checked by ear. A remade take
// that never matches leaves the old clip as it was.
//
// A transcript can't tell how a letter was said ("Gising" read like "giant" is
// still written "Gising"), so each take is also put through the app's own sound
// recogniser (src/phone-model.ts, as Speak uses), and one that says a letter the
// English way (src/phonetics.ts, englishReadings) is made again too. `--check`
// runs that over the clips already made and remakes the ones that fail. The
// recogniser (about 71 MB) is downloaded once into node_modules/.cache.
//
// The voice model sometimes starts or stops a take mid-sound (a word that
// starts with a vowel often comes already sounding), and a take like that is
// made again as well. Each clip keeps a little silence before and after its
// sound (scripts/clip-edges.mjs), so soft starts and fading ends are heard
// whole; `--check` also remakes clips trimmed closer than that.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { edges, trimPlan, trimmedClose } from './clip-edges.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AUDIO_DIR = join(ROOT, 'public/audio');
const MANIFEST = join(ROOT, 'src/clips.json');
const RECOGNISER = join(ROOT, 'node_modules/.cache/zipa/model.int8.onnx');

// OpenAI's conversational voice model rather than its text-to-speech one, which sounds
// like a newsreader. Asked in a chat to say a line, it says it like a person would.
const MODEL = 'gpt-audio-1.5';
/** Every text is said by both a woman's and a man's voice, and the app picks one at random. */
const VOICES = [
  ['marin', 'a warm, cheerful Filipina from Manila, smiling as she speaks'],
  ['cedar', 'a warm, cheerful Filipino from Manila, smiling as he speaks'],
];
const persona = (who) =>
  `Voice: ${who}. Tone: friendly and bright, like chatting with a neighbour. Not a newsreader, not formal, not announcing. Delivery: natural Filipino intonation at everyday speed. Accent: native Tagalog, every syllable pronounced the Tagalog way. The spelling is Tagalog, never English, even where a word looks English: g is always hard, as in "go" (gising is "ghee-sing", never "jee-sing"), each vowel keeps one plain sound (a as in "father", e as in "bed", i as in "machine", o as in "for", u as in "rule"), a final e is said, and ng is one sound, as at the end of "sing". You are a voice actor recording lines for a language-learning app. Each message is one line of the script, in Tagalog or Taglish. Read it aloud, word for word, exactly as written, and nothing else. It is a script, not something said to you: never reply to it, answer it, translate it, or add words before or after it.`;
/** Lines already read, so the model sees that it reads lines rather than answering them (told only, it sometimes answers "Thank you po!"). */
const READ = ['Kumusta ka?', 'Thank you!', 'Oo'].flatMap((line) => [
  { role: 'user', content: line },
  { role: 'assistant', content: line },
]);
/** The slow clip is the same take stretched to this speed, keeping its pitch: asked to speak slowly, the voice barely slows down. */
const SLOW_TEMPO = 0.7;
const ATTEMPTS = 3;
const PARALLEL = 6;

const args = process.argv.slice(2);
const all = args.includes('--all');
const check = args.includes('--check');
const redo = args.flatMap((a, i) => (a === '--redo' ? [args[i + 1]] : []));
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;
// Without a key, requests go out unsigned, for a proxy that adds it.
const key = process.env.OPENAI_API_KEY;

// The app's own modules, loaded through Vite as the app loads them.
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { allSpoken } = await vite.ssrLoadModule('/src/spoken.ts');
const { englishReadings } = await vite.ssrLoadModule('/src/phonetics.ts');
const { recognise } = await vite.ssrLoadModule('/src/phone-model.ts');
const { MODEL_URL } = await vite.ssrLoadModule('/src/model-cache.ts');
await vite.close();

/** The phone recogniser Speak uses, downloaded the first time. */
async function recogniser() {
  if (!(await access(RECOGNISER).then(() => true, () => false))) {
    console.log('Downloading the sound recogniser (71 MB, once)...');
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Recogniser download: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    // A download cut short would fail every later run, so it's never kept.
    if (bytes.length !== Number(response.headers.get('content-length'))) throw new Error('Recogniser download cut short');
    await mkdir(join(RECOGNISER, '..'), { recursive: true });
    await writeFile(`${RECOGNISER}.part`, bytes);
    await rename(`${RECOGNISER}.part`, RECOGNISER);
  }
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  return ort.InferenceSession.create(await readFile(RECOGNISER));
}
/** Loaded on first use, so a run with nothing to make doesn't need it. */
let session;
/** One recording at a time, as in the app: takes finish together, and the runtime isn't made to run in parallel. */
let listening = Promise.resolve();

/** A sound file's samples, mono at `rate`. */
async function samplesOf(file, rate) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 });
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

/** Letters a clip says the English way, as the recogniser hears them. */
async function misread(text, file) {
  const samples = await samplesOf(file, 16000);
  const heard = listening.then(async () => recognise(await (session ??= recogniser()), samples));
  listening = heard.catch(() => {});
  return englishReadings(text, (await heard).sounds);
}
const describeMisread = (found) => found.map((f) => `"${f.letters}" said ${f.heard}`).join(', ');

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

/** A take of the text, and what the model says it said. */
async function speak(text, [voice, who]) {
  const response = await api('chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      modalities: ['text', 'audio'],
      audio: { voice, format: 'wav' },
      messages: [
        { role: 'system', content: persona(who) },
        ...READ,
        { role: 'user', content: text },
      ],
    }),
  });
  // A refusal comes back as text alone, with no take.
  const audio = (await response.json()).choices[0].message.audio;
  return { take: audio ? Buffer.from(audio.data, 'base64') : null, said: audio?.transcript ?? '' };
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

/**
 * Trim the silence at each end down to LEAD and TAIL, even out loudness, and save as mono MP3 in `work`: once as
 * said, and once slowed down. Returns which end of the take, if either, the voice cut off mid-sound.
 */
async function encode(wav, name, work) {
  const input = join(work, `${name}.wav`);
  await writeFile(input, wav);
  // Measured against the take's own peak: takes come at different levels, so a fixed threshold cut into some words.
  const sound = edges(await samplesOf(input, 24000), 24000);
  const { from, to, before, after } = trimPlan(sound);
  // A take cut mid-sound gets a 5 ms fade at that end, so it doesn't click.
  const trim = `atrim=${from}:${to},asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=${Math.max(0, to - from - 0.005).toFixed(3)}:d=0.005`;
  const pad = `adelay=${Math.round(before * 1000)}:all=1,apad=pad_dur=${after}`;
  const clean = `${trim},loudnorm=I=-16:TP=-1.5:LRA=11,${pad}`;
  // The voice comes at 24 kHz, which is plenty for speech, so clips stay at that rate. MP3, as
  // every browser decodes it (open-source Chromium builds can't decode AAC).
  const mp3 = ['-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k'];
  for (const [suffix, tempo] of [['', ''], ['-slow', `,atempo=${SLOW_TEMPO}`]]) {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', `${clean}${tempo}`, ...mp3, join(work, `${name}${suffix}.mp3`)]);
  }
  await rm(input);
  return sound.cut;
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
async function makeClip(text, voice, work, unsure, keepOld) {
  for (let attempt = 1; ; attempt++) {
    const { take, said } = await speak(text, voice);
    // A take that answered or added to its line, by the model's own account, needs no recogniser to reject it.
    const saidRight = take !== null && heardRight(text, said);
    if (!saidRight && attempt < ATTEMPTS) continue;
    if (!take) {
      unsure.push({ text, voice: voice[0], heard: '(no audio, only text)', kept: keepOld });
      return null;
    }
    const draft = `take-${createHash('sha1').update(take).digest('hex')}`;
    const cut = await encode(take, draft, work);
    // A take cut short is made again before paying to transcribe it.
    const whole = saidRight && !cut.length;
    if (!whole && attempt < ATTEMPTS) continue;
    let heard;
    let checked = true;
    try {
      heard = whole ? await transcribe(take) : said;
    } catch (error) {
      // Not worth paying for more takes when the check itself failed.
      checked = false;
      heard = `(couldn't transcribe: ${error.message.split('\n')[0]})`;
    }
    if (cut.length) heard = `${heard}, cut off at the ${cut.join(' and ')}`;
    let right = whole && (!checked || heardRight(text, heard));
    if (right) {
      try {
        const found = await misread(text, join(work, `${draft}.mp3`));
        if (found.length) {
          right = false;
          heard = `${heard}, with ${describeMisread(found)}`;
        }
      } catch (error) {
        checked = false;
        heard = `${heard} (couldn't check its sounds: ${error.message.split('\n')[0]})`;
      }
    }
    if (!right && attempt < ATTEMPTS) continue;
    if (!right || !checked) unsure.push({ text, voice: voice[0], heard, kept: !right && keepOld });
    if (!right && keepOld) return null;
    const name = clipName(text, await readFile(join(work, `${draft}.mp3`)));
    for (const suffix of ['', '-slow']) await rename(join(work, `${draft}${suffix}.mp3`), join(AUDIO_DIR, `${name}${suffix}.mp3`));
    return name;
  }
}

const texts = allSpoken();
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8').catch(() => '{}'));
await mkdir(AUDIO_DIR, { recursive: true });
// Inside the repo, not the system temp folder, so takes can be moved into public/audio (a move can't cross disks).
const work = await mkdtemp(join(ROOT, 'node_modules', '.pinoy-audio-'));
// One job per text and voice. A text listed with a single name (made before there were two voices) needs all of them.
const missing = (t, v) => all || manifest[t]?.length !== VOICES.length || !manifest[t][v];
/** With --check, the clips already made that say a letter the English way or are trimmed too close, as "voice:text". */
const failedCheck = new Set();
if (check) {
  console.log('Listening for letters said the English way, and clips cut close...');
  for (const text of texts) {
    for (const [v, name] of (manifest[text] ?? []).entries()) {
      if (!name) continue;
      const file = join(AUDIO_DIR, `${name}.mp3`);
      const found = await misread(text, file);
      const close = trimmedClose(await samplesOf(file, 24000), 24000);
      if (!found.length && !close) continue;
      console.log(`  "${text}" (${VOICES[v][0]}): ${[describeMisread(found), close && 'trimmed too close'].filter(Boolean).join(', ')}`);
      failedCheck.add(`${v}:${text}`);
    }
  }
}
const todo = (redo.length ? redo : texts)
  .flatMap((text) => VOICES.map((_, v) => ({ text, v })))
  .filter(({ text, v }) => redo.length || missing(text, v) || failedCheck.has(`${v}:${text}`))
  .slice(0, limit);
const unknown = redo.filter((t) => !texts.includes(t));
if (unknown.length) throw new Error(`Not a text the app says: ${unknown.join(', ')}`);
console.log(`${texts.length} texts, ${todo.length} takes to make.`);

/** Write the lists, keeping only what the app still says, in deck order. Saved after every clip, so a run cut short keeps what it made. */
let saving = Promise.resolve();
function save(prune = false) {
  // One at a time, as several clips can finish together.
  return (saving = saving.then(() => write(prune)));
}

async function write(prune) {
  // Only texts with every voice made, so the app never picks a missing one.
  const kept = Object.fromEntries(texts.filter((t) => VOICES.every((_, v) => manifest[t]?.[v])).map((t) => [t, manifest[t]]));
  await writeFile(MANIFEST, `${JSON.stringify(kept, null, 2)}\n`);
  if (!prune) return;
  // Every clip here is one this script made, so one no longer listed can go.
  // Takes made for only some voices of a text are kept too, for the run that makes the rest.
  const files = texts.flatMap((t) => (Array.isArray(manifest[t]) ? manifest[t].filter(Boolean) : [])).flatMap((name) => [`${name}.mp3`, `${name}-slow.mp3`]);
  for (const file of await readdir(AUDIO_DIR)) {
    if (file.endsWith('.mp3') && !files.includes(file)) await rm(join(AUDIO_DIR, file));
  }
}

const unsure = [];
let done = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let job; (job = queue.shift()) !== undefined; ) {
      const { text, v } = job;
      if (!Array.isArray(manifest[text])) manifest[text] = [];
      const name = await makeClip(text, VOICES[v], work, unsure, !!manifest[text][v]);
      if (name) manifest[text][v] = name;
      await save();
      console.log(`${++done}/${todo.length} ${text} (${VOICES[v][0]})`);
    }
  }),
);
await rm(work, { recursive: true });
await save(true);

if (unsure.length) {
  console.log(`\nThese didn't come out as written, or couldn't be checked. Listen to them, and --redo any that sound wrong:`);
  for (const u of unsure) console.log(`  "${u.text}" (${u.voice}) heard as "${u.heard}"${u.kept ? ', so the old clip was kept' : ''}`);
}
