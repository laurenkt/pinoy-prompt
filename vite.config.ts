/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the build works from any path (GitHub Pages, a subfolder, or a root domain).
export default defineConfig({
  base: './',
  test: {
    // A zone with daylight saving, so date tests cover clock changes.
    env: { TZ: 'America/New_York' },
  },
});
