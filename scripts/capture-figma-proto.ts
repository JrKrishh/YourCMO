/**
 * Capture screenshots from the Rewoz Figma prototype using Playwright.
 * Run: npx tsx scripts/capture-figma-proto.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const PROTO_URL = 'https://www.figma.com/proto/DX3DUhjIYbhJ1sA9FQYZyz/RewOz?node-id=774-2820&starting-point-node-id=774-2820&scaling=scale-down';
const OUT_DIR = path.join(process.cwd(), 'assets', 'figma-screens');

async function main() {
  const { chromium } = await import('playwright');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('🚀 Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    console.log('📱 Loading Figma prototype...');
    await page.goto(PROTO_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Accept cookies if dialog appears
    try {
      const cookieBtn = page.locator('button:has-text("Allow all cookies")');
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch { /* no cookie dialog */ }

    // Wait for prototype to render
    await page.waitForTimeout(8000);

    // Take initial screenshot (full board view)
    console.log('📸 Capturing initial view...');
    await page.screenshot({ path: path.join(OUT_DIR, 'board-01-initial.png'), fullPage: false });

    // Try zooming out to see more of the board
    // Figma proto: press Z to zoom to fit, or use scroll
    await page.keyboard.press('z');
    await page.waitForTimeout(2000);
    console.log('📸 Capturing zoomed-to-fit view...');
    await page.screenshot({ path: path.join(OUT_DIR, 'board-02-zoomed.png'), fullPage: false });

    // Navigate through screens by clicking at various positions
    const clicks = [
      { name: 'board-03-click-center', x: 720, y: 450 },
      { name: 'board-04-click-right', x: 1100, y: 450 },
      { name: 'board-05-click-left', x: 300, y: 450 },
      { name: 'board-06-click-bottom', x: 720, y: 700 },
    ];

    for (const c of clicks) {
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(2000);
      console.log(`📸 Capturing ${c.name}...`);
      await page.screenshot({ path: path.join(OUT_DIR, `${c.name}.png`), fullPage: false });
    }

    // Also try pressing arrow keys to navigate between frames
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(2000);
      console.log(`📸 Capturing arrow-right-${i + 1}...`);
      await page.screenshot({ path: path.join(OUT_DIR, `board-07-arrow-${i + 1}.png`), fullPage: false });
    }

    console.log(`\n✅ Screenshots saved to ${OUT_DIR}/`);
    const files = fs.readdirSync(OUT_DIR);
    files.forEach(f => console.log(`   📸 ${f}`));

  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
