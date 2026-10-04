import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const b = await chromium.launch(); const pg = await b.newPage();
pg.on('console', (m) => console.log(m.text()));
await pg.goto(process.argv[2]); await pg.waitForFunction(() => window.__done, null, { timeout: 600000 });
fs.writeFileSync(process.argv[3], JSON.stringify(await pg.evaluate(() => window.__out), null, 1)); await b.close();
