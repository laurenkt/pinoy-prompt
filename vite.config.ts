/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the build works from any path (GitHub Pages, a subfolder, or a root domain).
export default defineConfig({
  base: './',
  // Lists the built files, so the service worker can find the speech model's runtime (see public/sw.js).
  // Two pages: the app, and the About page beside it (about.html, served at /about).
  build: { manifest: 'asset-manifest.json', rollupOptions: { input: { main: 'index.html', about: 'about.html' } } },
  test: {
    // A zone with daylight saving, so date tests cover clock changes.
    env: { TZ: 'America/New_York' },
    // Vitest leaves CSS empty unless asked; src/screens/layout.test.ts reads the layout rules.
    css: { include: [/style\.css/] },
  },
});
