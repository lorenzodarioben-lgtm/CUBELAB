// Renders the Settings previews of both cube styles from the real 3D model.
// Usage: npm run build && npm run preview (port 4317) in another shell, then:
//        node scripts/capture-style-previews.mjs
// Each style is shown solved at the home view; everything but the WebGL canvas
// is hidden and the page is transparent, so the preview keeps the cube's own
// contact shadow on a transparent background. The capture is downscaled and
// encoded to WebP in the browser (no image tooling needed).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.CUBELAB_URL ?? 'http://localhost:4317/';
const OUT = 'src/assets/cube-styles';
const SIZE = 288;
mkdirSync(OUT, { recursive: true });
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args });

for (const style of ['stickered', 'stickerless']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript((cubeStyle) => {
    localStorage.setItem('cubelab.gestureHintSeen', '1');
    localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: { cubeStyle, quality: 'high' } }));
  }, style);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForFunction((s) => window.__CUBELAB__?.renderedStyle?.() === s, style, { timeout: 60000 });
  await page.addStyleTag({
    content: `* { background: transparent !important; box-shadow: none !important; }
      body * { visibility: hidden !important; }
      canvas { visibility: visible !important; }`,
  });
  await page.waitForTimeout(900);
  const png = await page.screenshot({ clip: { x: 400, y: 150, width: 640, height: 640 }, omitBackground: true });
  const webp = await page.evaluate(
    async ({ data, size }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/webp', 0.9).split(',')[1];
    },
    { data: png.toString('base64'), size: SIZE },
  );
  writeFileSync(`${OUT}/${style}.webp`, Buffer.from(webp, 'base64'));
  console.log(`${OUT}/${style}.webp`, Math.round(Buffer.from(webp, 'base64').length / 1024), 'KB');
  await context.close();
}
await browser.close();
