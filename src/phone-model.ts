// The phone recogniser: ZIPA (small, CTC), a multilingual model that turns
// speech into IPA sounds. It runs on the device with onnxruntime-web, so audio
// never leaves the phone. The model (about 71 MB) downloads on first use and is
// kept in the Cache API for offline use after that.
//
// Model: Zhu et al., "ZIPA: A family of efficient models for multilingual phone
// recognition" (ACL 2025), https://github.com/lingjzhu/zipa, CC BY 4.0.

import * as ort from 'onnxruntime-web/wasm';
// The package doesn't export its runtime files, so they're referenced by path for Vite to copy into the build.
// Both are needed: once wasmPaths is set, onnxruntime-web loads its JS glue from there too.
import mjsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import { fbank, NUM_MEL_BINS } from './fbank';
import { groupTimed, type TimedToken } from './phonetics';
import TOKENS from './phone-tokens.json';

import { CACHE, DownloadError, MODEL_URL } from './model-cache';

export { MODEL_URL, modelDownloaded } from './model-cache';

const MODEL_BYTES = 70677672;

export interface Recognition {
  /** The sounds heard, in IPA. */
  sounds: string[];
  /** When each sound was heard, in seconds from the start of the recording. */
  timing: { start: number; end: number }[];
  /** The log mel features the model heard: NUM_MEL_BINS values per 10 ms frame, for drawing. */
  features: { data: Float32Array; frames: number };
}

export interface PhoneModel {
  recognise(samples: Float32Array): Promise<Recognition>;
}

/** Read a download to the end, reporting progress; keeps the bytes only if asked. */
async function readAll(body: ReadableStream<Uint8Array>, onProgress?: (fraction: number) => void, keep = false, stop?: { now: boolean }) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read().catch((err: unknown) => {
      throw new DownloadError(`Model download dropped: ${String(err)}`);
    });
    if (done) break;
    if (stop?.now) {
      await reader.cancel().catch(() => {});
      break;
    }
    if (keep) chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(1, received / MODEL_BYTES));
  }
  return { chunks, received };
}

async function fetchModel(onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(MODEL_URL);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // No Cache API (e.g. private mode), or an unreadable copy: download it.
  }
  const body = await download();

  if (cache) {
    // Stream straight into the cache and read it back once, so the phone holds one copy in memory, not three.
    const [toCache, toCount] = body.tee();
    const stop = { now: false };
    const counting = readAll(toCount, onProgress, false, stop);
    counting.catch(() => {});
    try {
      await cache.put(MODEL_URL, new Response(toCache, { headers: { 'content-type': 'application/octet-stream' } }));
    } catch {
      // Couldn't store it (e.g. the phone is out of space): download it again into memory for this session.
      await cache.delete(MODEL_URL).catch(() => false);
      stop.now = true;
      return fetchIntoMemory(onProgress);
    }
    try {
      const { received } = await counting;
      // A download cut short must never be kept: it would fail on every launch.
      if (received !== MODEL_BYTES) throw new DownloadError(`Model download incomplete: ${received} of ${MODEL_BYTES} bytes`);
      const stored = await cache.match(MODEL_URL);
      if (stored) return await stored.arrayBuffer();
    } catch (err) {
      await cache.delete(MODEL_URL).catch(() => false);
      throw err;
    }
    // Stored, then gone (evicted already): the download has been read, so fetch it again into memory.
    return fetchIntoMemory(onProgress);
  }

  return inMemory(body, onProgress);
}

/** Download the model without keeping it, for when it can't be stored. */
async function fetchIntoMemory(onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  return inMemory(await download(), onProgress);
}

/** Start the model's download, failing with a DownloadError if it can't. */
async function download(): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(MODEL_URL).catch((err: unknown) => {
    throw new DownloadError(`Model download failed: ${String(err)}`);
  });
  if (!response.ok || !response.body) throw new DownloadError(`Model download failed: ${response.status}`);
  return response.body;
}

async function inMemory(body: ReadableStream<Uint8Array>, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const { chunks, received } = await readAll(body, onProgress, true);
  if (received !== MODEL_BYTES) throw new DownloadError(`Model download incomplete: ${received} of ${MODEL_BYTES} bytes`);
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

/**
 * Bring in the runtime's own files: its JS glue into this page, and its wasm into the service worker's cache
 * (src/model-cache.ts says why). Without a service worker the wasm would only be fetched again later, so it waits.
 */
export async function loadRuntime(): Promise<void> {
  await import(/* @vite-ignore */ mjsUrl);
  if (!navigator.serviceWorker?.controller || (await caches.match(wasmUrl))) return;
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Model runtime: ${response.status}`);
  // Read to the end so the worker's copy is complete.
  await response.arrayBuffer();
}

let loading: Promise<PhoneModel> | null = null;
/** Everyone waiting on the load hears its download progress, not only whoever started it. */
const listeners = new Set<(fraction: number) => void>();

/** Load the recogniser, downloading it the first time. */
export function loadPhoneModel(onProgress?: (fraction: number) => void): Promise<PhoneModel> {
  if (onProgress) listeners.add(onProgress);
  const onAnyProgress = (fraction: number) => listeners.forEach((listener) => listener(fraction));
  loading ??= (async () => {
    // Single-threaded: threads need cross-origin isolation, which GitHub Pages can't turn on.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
    let session: ort.InferenceSession;
    try {
      session = await ort.InferenceSession.create(await fetchModel(onAnyProgress), { executionProviders: ['wasm'] });
    } catch (err) {
      // A stored copy the runtime can't parse is damaged: drop it so the next try downloads afresh.
      // Anything else (the runtime failing to load offline, running out of memory) says nothing about the model.
      if (/protobuf|load model/i.test(String(err))) await caches.open(CACHE).then((cache) => cache.delete(MODEL_URL)).catch(() => false);
      throw err;
    }
    return { recognise: (samples) => recognise(session, samples) };
  })();
  // Let a failed load be retried.
  loading.catch(() => {
    loading = null;
  });
  if (onProgress) void loading.finally(() => listeners.delete(onProgress)).catch(() => {});
  return loading;
}

/** The sounds in a recording. Also run by scripts/generate-audio.mjs, in Node, to check the card clips. */
export async function recognise(session: ort.InferenceSession, samples: Float32Array): Promise<Recognition> {
  const features = fbank(samples);
  const { data, frames } = features;
  if (frames === 0) return { sounds: [], timing: [], features };
  const outputs = await session.run({
    x: new ort.Tensor('float32', data, [1, frames, NUM_MEL_BINS]),
    x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
  });
  const logProbs = outputs[session.outputNames[0]];
  const [, steps, vocab] = logProbs.dims as number[];
  const values = logProbs.data as Float32Array;
  // Seconds per output step (the model subsamples the 10 ms frames).
  const stepSeconds = (frames / steps) * 0.01;
  // Greedy CTC decoding: best token per step, dropping blanks and repeats.
  const tokens: TimedToken[] = [];
  let previous = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    for (let v = 1; v < vocab; v++) if (values[t * vocab + v] > values[t * vocab + best]) best = v;
    if (best !== 0 && best !== previous) tokens.push({ token: TOKENS[best], start: t * stepSeconds, end: (t + 1) * stepSeconds });
    else if (best !== 0) tokens[tokens.length - 1].end = (t + 1) * stepSeconds;
    previous = best;
  }
  const sounds = groupTimed(tokens);
  return { sounds: sounds.map((s) => s.sound), timing: sounds.map(({ start, end }) => ({ start, end })), features };
}
