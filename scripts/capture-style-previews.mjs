// Renders the Settings previews of the two public cube styles from the real 3D model:
// Classic Stickered and Premium Stickerless (the approved v2 renderer with k2 lighting).
// Usage: npm run build && npm run preview (port 4317) in another shell, then:
//        node scripts/capture-style-previews.mjs
// Each style is shown solved at the home view on High; everything but the
// WebGL canvas is hidden and the page is transparent, so the preview keeps the
// cube's own contact shadow on a transparent background. The page is drawn at
// twice its size and the capture is downscaled and encoded to WebP in the
// browser (no image tooling needed). SIZE covers the card on a 2x desktop
// (about 200 CSS px wide) and on a 3x phone (about 110 CSS px).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.CUBELAB_URL ?? 'http://localhost:4317/';
const OUT = 'src/assets/cube-styles';
const SIZE = 432;
const PREVIEWS = [
  { file: 'stickered', cubeStyle: 'stickered', query: '', renderer: null },
  { file: 'stickerless-v2', cubeStyle: 'stickerless', query: '', renderer: 'v2' },
];
mkdirSync(OUT, { recursive: true });
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args });

for (const { file, cubeStyle, query, renderer } of PREVIEWS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript((style) => {
    localStorage.setItem('cubelab.gestureHintSeen', '1');
    localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: { cubeStyle: style, quality: 'high' } }));
  }, cubeStyle);
  const page = await context.newPage();
  await page.goto(BASE + query);
  await page.waitForFunction((s) => window.__CUBELAB__?.renderedStyle?.() === s && !window.__CUBELAB__.lookPending?.(), cubeStyle, { timeout: 120000 });
  if (renderer) {
    const drawn = await page.evaluate(() => window.__CUBELAB__.stickerlessRenderer?.());
    if (drawn !== renderer) throw new Error(`${file}: expected the ${renderer} renderer, the page drew ${drawn}`);
  }
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
  writeFileSync(`${OUT}/${file}.webp`, Buffer.from(webp, 'base64'));
  console.log(`${OUT}/${file}.webp`, Math.round(Buffer.from(webp, 'base64').length / 1024), 'KB');
  await context.close();
}
await browser.close();
