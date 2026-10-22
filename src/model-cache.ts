// Where the phone model is kept, and whether it's there yet. Kept apart from
// phone-model.ts so checking doesn't load the model runtime.

/** Pinned to a revision so the model can't change under the app. */
export const MODEL_URL =
  'https://huggingface.co/anyspeech/zipa-small-crctc-500k/resolve/dfe87c97662606fa6db90ad06f627d4363314744/model.int8.onnx';
// public/sw.js checks for this cache by name to keep the model's runtime offline too.
export const CACHE = 'pinoy-prompt-models-v1';

/** The model couldn't be fetched: no connection, a server error, or a download cut short. Anything else that stops it loading is not this. */
export class DownloadError extends Error {
  override name = 'DownloadError';
}

/** What modelDownloaded() last found, for a screen that has to decide as it's drawn. */
let lastFound = false;

/** Whether the model was on the device when last checked (the app checks as it opens). */
export function modelKnownDownloaded(): boolean {
  return lastFound;
}

/** Whether the model is already on the device. */
export async function modelDownloaded(): Promise<boolean> {
  try {
    // caches.open would create the cache, which the service worker takes as a sign speaking is in use.
    if (!(await caches.has(CACHE))) return (lastFound = false);
    return (lastFound = (await (await caches.open(CACHE)).match(MODEL_URL)) !== undefined);
  } catch {
    return false;
  }
}

/**
 * Once the model is on the device, load the code that runs it now rather than at the first Speak question.
 * Those files are named by the build, and an installed app can stay open across a deploy that replaces them,
 * after which this page could no longer fetch its own copies ("Importing a module script failed").
 */
export async function keepSpeakingReady(): Promise<void> {
  if (!(await modelDownloaded())) return;
  await (await import('./phone-model')).loadRuntime();
}
