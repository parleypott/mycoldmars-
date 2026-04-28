import { chromium } from 'playwright';

const VIEW = process.argv[2] || 'home';    // home | library | editor | sequencer
const OUTPUT = process.argv[3] || '/tmp/interpreter-screenshot.png';
const PORT = process.argv[4] || '5173';

const BASE = `http://localhost:${PORT}/translation/`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(BASE);
  await page.waitForTimeout(1000);

  // Bypass access gate if present
  const gate = await page.$('#gate:not(.hidden)');
  if (gate) {
    await page.waitForTimeout(500);
  }

  // Navigate to requested view
  if (VIEW === 'library') {
    await page.click('#btn-library');
    await page.waitForTimeout(500);
  } else if (VIEW === 'sequencer') {
    await page.click('#btn-sequencer');
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: OUTPUT, fullPage: true });
  await browser.close();
  console.log(OUTPUT);
})();
