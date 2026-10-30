/** Repeatable section CPU-work benchmark; not an overall GPU FPS claim. */
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const { chromium } = createRequire(new URL('../../AetherStudio/core/files/package.json', import.meta.url))('@playwright/test');
const destination = process.argv[2] ?? 'build/section-performance.json';
const vite = await createServer({
  configFile: false,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'section-profile',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/section-check')) return next();
        res.setHeader('content-type', 'text/html');
        res.end('<script type="module" src="/scripts/browser/section-scene.ts"></script>');
      });
    },
  }],
});
await vite.listen();
const browser = await chromium.launch({headless:true, args:['--enable-unsafe-webgpu', '--use-angle=metal']});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/section-check`);
  await page.waitForFunction(() => window.sectionCheck);
  const result = await page.evaluate(() => window.sectionCheck.benchmark());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await browser.close();
  await vite.close();
}
