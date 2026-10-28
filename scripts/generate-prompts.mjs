// Records the English lines walk and talk's recorded version says (its
// questions, "How do you say ...?", and a few others: walkLines in src/walk.ts),
// so it plays them through the app's audio like every other clip. The phone's
// built-in voice, which it used before, stays silent on an iPhone while the
// microphone is open. Run it after adding or changing cards, with
// `npm run audio` for the Tagalog:
//
//   OPENAI_API_KEY=sk-... npm run prompts
//
// Only lines without a clip are made. Each is one take in one voice, trimmed
// and encoded as generate-audio.mjs encodes the Tagalog (clip-edges.mjs), into
// public/audio/en-<name>.mp3, listed in src/prompt-clips.json by line. Needs
// ffmpeg.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { edges, trimPlan } from './clip-edges.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AUDIO_DIR = join(ROOT, 'public/audio');
const MANIFEST = join(ROOT, 'src/prompt-clips.json');
const MODEL = 'gpt-4o-mini-tts';
const VOICE = 'marin';
const INSTRUCTIONS =
  'A warm, friendly Filipina from Manila, quizzing a friend on Tagalog words while they walk. Filipino-accented English, relaxed and bright, at an easy pace. Read the line exactly as written.';
const PARALLEL = 6;
// Without a key, requests go out unsigned, for a proxy that adds it.
const key = process.env.OPENAI_API_KEY;

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { walkLines } = await vite.ssrLoadModule('/src/walk.ts');
await vite.close();

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8').catch(() => '{}'));
const lines = walkLines();
const todo = lines.filter((line) => !manifest[line]);
console.log(`${lines.length} lines, ${todo.length} to record.`);

async function speak(line) {
  for (let tries = 0; ; tries++) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: line, instructions: INSTRUCTIONS, response_format: 'wav' }),
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (tries < 4 && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** tries));
      continue;
    }
    throw new Error(`${line}: ${response.status} ${await response.text()}`);
  }
}

async function samplesOf(file, rate) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 });
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

/** A readable file name: the line's first letters, and a hash of the take. */
function clipName(line, take) {
  const slug = line.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `en-${slug || 'line'}-${createHash('sha1').update(take).digest('hex').slice(0, 8)}`;
}

const work = await mkdtemp(join(tmpdir(), 'prompts-'));
async function record(line) {
  const take = await speak(line);
  const name = clipName(line, take);
  const input = join(work, `${name}.wav`);
  await writeFile(input, take);
  const { from, to, before, after } = trimPlan(edges(await samplesOf(input, 24000), 24000));
  const filter = `atrim=${from}:${to},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,adelay=${Math.round(before * 1000)}:all=1,apad=pad_dur=${after}`;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', filter, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', join(AUDIO_DIR, `${name}.mp3`)]);
  await rm(input);
  manifest[line] = name;
}

let done = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let line = queue.shift(); line !== undefined; line = queue.shift()) {
      await record(line);
      if (++done % 25 === 0) console.log(`${done}/${todo.length}`);
    }
  }),
);
await rm(work, { recursive: true });
// Kept in walkLines' order, without lines no card says any more (their files are left for phones that still have them cached).
const kept = Object.fromEntries(lines.filter((line) => manifest[line]).map((line) => [line, manifest[line]]));
await writeFile(MANIFEST, `${JSON.stringify(kept, null, 2)}\n`);
console.log(`Recorded ${done}.`);
