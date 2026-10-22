// Downloading and keeping the model, with stand-ins for the network, Cache Storage and the runtime.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} },
  InferenceSession: { create: (...args: unknown[]) => create(...args) },
  Tensor: class {},
}));

const MODEL_BYTES = 70677672;

/** A minimal Cache Storage that keeps whole responses in memory. */
class FakeCache {
  entries = new Map<string, ArrayBuffer>();
  async match(url: string) {
    const body = this.entries.get(url);
    return body ? new Response(body) : undefined;
  }
  async put(url: string, response: Response) {
    this.entries.set(url, await response.arrayBuffer());
  }
  async delete(url: string) {
    return this.entries.delete(url);
  }
}

let cache: FakeCache;

/** A download that delivers `bytes` of the model in a few chunks. */
function serve(bytes: number) {
  const chunk = 8 * 1024 * 1024;
  return vi.fn(async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        const n = Math.min(chunk, bytes - sent);
        sent += n;
        controller.enqueue(new Uint8Array(n));
      },
    });
    return new Response(body, { headers: { 'content-length': String(MODEL_BYTES) } });
  });
}

beforeEach(() => {
  vi.resetModules();
  create.mockReset().mockResolvedValue({ outputNames: ['log_probs'] });
  cache = new FakeCache();
  vi.stubGlobal('caches', { open: async () => cache, has: async () => cache.entries.size > 0 });
});

describe('loadPhoneModel', () => {
  it('downloads once, reports progress, and keeps the model for next time', async () => {
    vi.stubGlobal('fetch', serve(MODEL_BYTES));
    const { loadPhoneModel, modelDownloaded, MODEL_URL } = await import('./phone-model');
    expect(await modelDownloaded()).toBe(false);
    const progress: number[] = [];
    await loadPhoneModel((p) => progress.push(p));
    expect(progress.at(-1)).toBe(1);
    expect(cache.entries.get(MODEL_URL)?.byteLength).toBe(MODEL_BYTES);
    expect(await modelDownloaded()).toBe(true);
  });

  it('loads a kept model without downloading it or reporting download progress', async () => {
    const { MODEL_URL } = await import('./model-cache');
    cache.entries.set(MODEL_URL, new ArrayBuffer(MODEL_BYTES));
    const download = serve(MODEL_BYTES);
    vi.stubGlobal('fetch', download);
    const { loadPhoneModel } = await import('./phone-model');
    const progress: number[] = [];
    await loadPhoneModel((p) => progress.push(p));
    expect(download).not.toHaveBeenCalled();
    expect(progress).toEqual([]);
  });

  it('tells everyone waiting on the download how it is going, not only whoever started it', async () => {
    vi.stubGlobal('fetch', serve(MODEL_BYTES));
    const { loadPhoneModel } = await import('./phone-model');
    const first: number[] = [];
    const second: number[] = [];
    await Promise.all([loadPhoneModel((p) => first.push(p)), loadPhoneModel((p) => second.push(p))]);
    expect(second.at(-1)).toBe(1);
    expect(second).toEqual(first);
  });

  it("never keeps a download that was cut short, so the next try starts afresh", async () => {
    vi.stubGlobal('fetch', serve(40_000_000));
    const { loadPhoneModel, modelDownloaded } = await import('./phone-model');
    const failure = loadPhoneModel();
    await expect(failure).rejects.toThrow(/incomplete/);
    await expect(failure).rejects.toBeInstanceOf((await import('./model-cache')).DownloadError);
    expect(await modelDownloaded()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('counts no connection as a failed download', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Load failed'))));
    const { loadPhoneModel } = await import('./phone-model');
    const { DownloadError } = await import('./model-cache');
    await expect(loadPhoneModel()).rejects.toBeInstanceOf(DownloadError);
  });

  it("doesn't count running out of memory as a failed download", async () => {
    vi.stubGlobal('fetch', serve(MODEL_BYTES));
    create.mockRejectedValueOnce(new RangeError('Out of memory'));
    const { loadPhoneModel } = await import('./phone-model');
    const { DownloadError } = await import('./model-cache');
    await expect(loadPhoneModel()).rejects.not.toBeInstanceOf(DownloadError);
  });

  it("drops a stored model the runtime can't load", async () => {
    vi.stubGlobal('fetch', serve(MODEL_BYTES));
    create.mockRejectedValueOnce(new Error('Failed to load model because protobuf parsing failed.'));
    const { loadPhoneModel, modelDownloaded } = await import('./phone-model');
    await expect(loadPhoneModel()).rejects.toThrow();
    expect(await modelDownloaded()).toBe(false);
  });

  it("keeps the stored model when it's the runtime that couldn't load (e.g. offline)", async () => {
    vi.stubGlobal('fetch', serve(MODEL_BYTES));
    create.mockRejectedValueOnce(new Error('no available backend found'));
    const { loadPhoneModel, modelDownloaded } = await import('./phone-model');
    await expect(loadPhoneModel()).rejects.toThrow();
    expect(await modelDownloaded()).toBe(true);
  });
});

describe('when the model can\'t be stored', () => {
  it('still loads it for this session', async () => {
    vi.stubGlobal('fetch', serve(MODEL_BYTES));
    cache.put = async () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    const { loadPhoneModel, modelDownloaded } = await import('./phone-model');
    await expect(loadPhoneModel()).resolves.toBeTruthy();
    expect(create).toHaveBeenCalledOnce();
    expect(await modelDownloaded()).toBe(false);
  });

  it('still loads it when the stored copy is gone as soon as it was kept', async () => {
    const download = serve(MODEL_BYTES);
    vi.stubGlobal('fetch', download);
    cache.match = async () => undefined;
    const { loadPhoneModel } = await import('./phone-model');
    await expect(loadPhoneModel()).resolves.toBeTruthy();
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("keeps a good stored model when the phone runs out of memory loading it", async () => {
    vi.stubGlobal('fetch', serve(MODEL_BYTES));
    create.mockRejectedValueOnce(new RangeError('Out of memory'));
    const { loadPhoneModel, modelDownloaded } = await import('./phone-model');
    await expect(loadPhoneModel()).rejects.toThrow();
    expect(await modelDownloaded()).toBe(true);
  });
});
