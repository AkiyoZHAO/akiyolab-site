#!/usr/bin/env node
// 验收依赖只装在 CI 临时目录，不进入网站资产或前端运行时。
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateManifest, validateEdition } from '../plays/playground/model.js';

const base = process.env.LAB_PLAY_URL || 'http://127.0.0.1:4173';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const context = await browser.newContext(); // 独立匿名上下文，不读 Owner 会话。
const page = await context.newPage();
const read = async path => {
  const response = await fetch(new URL(path, base), { cache: 'no-store' });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
};

try {
  const manifest = validateManifest(await read('/plays/playground/index.json'));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: manifest.timezone }).format(new Date());
  let screenshotsTaken = false;
  for (const date of [...manifest.dates].sort().reverse()) {
    const edition = validateEdition(await read(`/plays/playground/editions/${date}.json`));
    const previews = edition.items.filter(item => item.preview);
    await page.goto(`${base}/plays/playground/${date <= today ? `?date=${date}` : ''}`);
    // 即使未来期尚未进入页面导航，也验收全部待发布图片的真实解码与尺寸。
    for (const item of previews) {
      const url = new URL(`/plays/playground/${item.preview.url}`, base).href;
      const response = await context.request.get(url);
      assert(response.ok(), `${item.id}: preview HTTP ${response.status()}`);
      assert(/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers()['content-type'] || ''), `${item.id}: expected PNG/JPEG/WebP MIME`);
      const size = await page.evaluate(async url => {
        const image = new Image();
        image.src = url;
        await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('Preview decode timed out')), 15000))]);
        return [image.naturalWidth, image.naturalHeight];
      }, url);
      assert(size[0] >= 320 && size[1] >= 180, `${item.id}: preview too small (${size.join('×')})`);
    }
    if (date > today) continue;
    await page.locator('#edition:not([hidden])').waitFor();
    assert.equal(await page.locator('#items > article').count(), edition.items.length);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width > 640 ? 1000 : 844 });
      for (const item of previews.filter(item => item.type !== 'news')) {
        const image = page.locator(`#${item.id} img.preview`);
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(image => image.decode());
        const bounds = await image.boundingBox();
        assert(bounds && bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width, `${item.id}: preview overflows at ${width}px`);
        assert.equal(await image.locator('..').getAttribute('href'), item.url);
        const caption = page.locator(`#${item.id} figcaption`);
        const license = caption.getByRole('link', { name: item.preview.rights.basis, exact: true });
        assert.equal(await license.getAttribute('href'), item.preview.rights.url);
        assert(await license.isVisible(), `${item.id}: visible license link missing`);
        assert((await caption.textContent()).includes(item.preview.rights.note), `${item.id}: preview attribution missing`);
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${date}: page overflows at ${width}px`);
      if (process.env.PLAYGROUND_SCREENSHOTS && !screenshotsTaken && width !== 320) {
        await mkdir(process.env.PLAYGROUND_SCREENSHOTS, { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: join(process.env.PLAYGROUND_SCREENSHOTS, `${date}-${width}.png`), fullPage: true });
      }
    }
    screenshotsTaken = true;
    // 对第一张真实图片模拟访问失败，确认原站入口继续可用。
    if (previews.length) {
      const item = previews.find(item => item.type !== 'news');
      if (item) {
        const pattern = `**/plays/playground/${item.preview.url}`;
        await page.route(pattern, route => route.abort());
        await page.reload();
        const article = page.locator(`#${item.id}`);
        await article.scrollIntoViewIfNeeded();
        await article.locator('.media-fallback').waitFor();
        assert(await article.locator('.item-actions a').isVisible(), 'Original-source fallback missing');
        await page.unroute(pattern);
      }
    }
    console.log(`OK: ${date}, ${previews.length} real previews decoded, desktop/390/320px and image failure fallback`);
  }
} finally {
  await browser.close();
}
