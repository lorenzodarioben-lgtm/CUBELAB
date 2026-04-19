import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * cubing.js runs its scrambler and solver in a module worker whose entry
 * (`search-worker-entry.js`) imports cubing's shared internal chunks. Three
 * things keep that worker free of app code in the production bundle:
 *
 *  1. cubing's statically shared modules are grouped into their own chunk, so
 *     the bundler never hoists them into the app entry chunk (which touches
 *     `document` and would crash inside a worker);
 *  2. `modulePreload` is off, so dynamic imports are not wrapped in Vite's
 *     DOM-based preload helper (also unusable inside a worker);
 *  3. the worker entry keeps its exact name, `assets/search-worker-entry.js`.
 *     cubing.js first resolves the worker relative to its own chunk; with a
 *     hashed name that request falls through to index.html, which WebKit
 *     reports as a script error before cubing.js tries its fallback.
 *
 * In dev the package is excluded from dependency pre-bundling, which would
 * otherwise flatten it and break the relative worker entry URL.
 */
const CUBING_SHARED =
  /node_modules[\\/](?:cubing[\\/]dist[\\/]lib[\\/]cubing[\\/](?:chunks[\\/]chunk-[^\\/]+|[a-z-]+[\\/]index)\.js|@cubing[\\/]|random-uint-below[\\/])/;

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['cubing'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: false,
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) => (chunk.name === 'search-worker-entry' ? 'assets/search-worker-entry.js' : 'assets/[name]-[hash].js'),
        codeSplitting: {
          groups: [
            { name: 'cubing-core', test: CUBING_SHARED },
            { name: 'three', test: /node_modules[\\/](?:three|@react-three|three-stdlib|three-mesh-bvh|maath|camera-controls)[\\/]/ },
          ],
        },
      },
    },
  },
  server: { port: 5317, strictPort: true },
  preview: { port: 4317, strictPort: true },
});
