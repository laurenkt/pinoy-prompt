// Where the phone model is kept, and whether it's there yet. Kept apart from
// phone-model.ts so checking doesn't load the model runtime.

/** Pinned to a revision so the model can't change under the app. */
export const MODEL_URL =
  'https://huggingface.co/anyspeech/zipa-small-crctc-500k/resolve/dfe87c97662606fa6db90ad06f627d4363314744/model.int8.onnx';
// public/sw.js checks for this cache by name to keep the model's runtime offline too.
export const CACHE = 'pinoy-prompt-models-v1';

/** Whether the model is already on the device. */
export async function modelDownloaded(): Promise<boolean> {
  try {
    // caches.open would create the cache, which the service worker takes as a sign speaking is in use.
    if (!(await caches.has(CACHE))) return false;
    return (await (await caches.open(CACHE)).match(MODEL_URL)) !== undefined;
  } catch {
    return false;
  }
}
