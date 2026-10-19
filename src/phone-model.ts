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
import { groupTokens } from './phonetics';
import TOKENS from './phone-tokens.json';

/** Pinned to a revision so the model can't change under the app. */
export const MODEL_URL =
  'https://huggingface.co/anyspeech/zipa-small-crctc-500k/resolve/dfe87c97662606fa6db90ad06f627d4363314744/model.int8.onnx';
const MODEL_BYTES = 70677672;
const CACHE = 'pinoy-prompt-models-v1';

export interface Recognition {
  /** The sounds heard, in IPA. */
  sounds: string[];
}

export interface PhoneModel {
  recognise(samples: Float32Array): Promise<Recognition>;
}

/** Whether the model is already on the device. */
export async function modelDownloaded(): Promise<boolean> {
  try {
    return (await (await caches.open(CACHE)).match(MODEL_URL)) !== undefined;
  } catch {
    return false;
  }
}

async function fetchModel(onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(MODEL_URL);
    if (hit) return hit.arrayBuffer();
  } catch {
    // No Cache API (e.g. private mode): download every time.
  }
  const response = await fetch(MODEL_URL);
  if (!response.ok || !response.body) throw new Error(`Model download failed: ${response.status}`);
  const total = Number(response.headers.get('content-length')) || MODEL_BYTES;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    await cache?.put(MODEL_URL, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    // Out of storage: it still works this time.
  }
  return bytes.buffer;
}

let loading: Promise<PhoneModel> | null = null;

/** Load the recogniser, downloading it the first time. */
export function loadPhoneModel(onProgress?: (fraction: number) => void): Promise<PhoneModel> {
  loading ??= (async () => {
    // Single-threaded: threads need cross-origin isolation, which GitHub Pages can't turn on.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
    const session = await ort.InferenceSession.create(await fetchModel(onProgress), { executionProviders: ['wasm'] });
    return { recognise: (samples) => recognise(session, samples) };
  })();
  // Let a failed load be retried.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

async function recognise(session: ort.InferenceSession, samples: Float32Array): Promise<Recognition> {
  const { data, frames } = fbank(samples);
  if (frames === 0) return { sounds: [] };
  const outputs = await session.run({
    x: new ort.Tensor('float32', data, [1, frames, NUM_MEL_BINS]),
    x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
  });
  const logProbs = outputs[session.outputNames[0]];
  const [, steps, vocab] = logProbs.dims as number[];
  const values = logProbs.data as Float32Array;
  // Greedy CTC decoding: best token per step, dropping blanks and repeats.
  const tokens: string[] = [];
  let previous = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    for (let v = 1; v < vocab; v++) if (values[t * vocab + v] > values[t * vocab + best]) best = v;
    if (best !== 0 && best !== previous) tokens.push(TOKENS[best]);
    previous = best;
  }
  return { sounds: groupTokens(tokens) };
}
