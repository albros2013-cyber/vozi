import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const url = process.argv[2]; const timeout = +(process.argv[3] || 600000);
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage();
pg.on('console', (m) => console.log('[console]', m.text()));
pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.goto(url);
await pg.waitForFunction(() => window.__done, null, { timeout });
await b.close();
