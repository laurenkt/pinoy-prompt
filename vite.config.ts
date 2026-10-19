/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the build works from any path (GitHub Pages, a subfolder, or a root domain).
export default defineConfig({
  base: './',
  // Lists the built files, so the service worker can find the speech model's runtime (see public/sw.js).
  build: { manifest: 'asset-manifest.json' },
  test: {
    // A zone with daylight saving, so date tests cover clock changes.
    env: { TZ: 'America/New_York' },
  },
});
