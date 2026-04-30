import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests run against the production build (`vite build` + `vite preview`).
 *
 * WebGL: on Windows the GPU is used through ANGLE/D3D11 (fast and faithful);
 * elsewhere Chromium falls back to SwiftShader. Override with CUBELAB_GL=swiftshader.
 */
const gpuArgs =
  process.env.CUBELAB_GL === 'swiftshader' || process.platform !== 'win32'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

const PORT = 4317;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: gpuArgs },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.CUBELAB_USE_CHROME === '1' ? 'chrome' : undefined, viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, testMatch: /mobile\.spec/ },
    // Cross-browser smoke (Firefox / WebKit run only the smoke spec, without Chromium GPU flags).
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 }, launchOptions: { args: [] } },
      testMatch: /browsers\.spec/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, launchOptions: { args: [] } },
      testMatch: /browsers\.spec/,
    },
  ],
  webServer: {
    // Always exercise the real production bundle.
    command: 'npm run build && npm run preview',
    port: PORT,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
