/**
 * Load uploaded Figma UI screens into the UIFrameStore.
 * Run: npx tsx scripts/load-figma-screens.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { UIFrameStore } from '../src/engines/visual-asset/figma/ui-frame-store';

const SCREENS_DIR = path.join(process.cwd(), 'assets', 'figma-screens');

const SCREEN_MAP: Record<string, { source: string; description: string }> = {
  'onboard1': { source: 'splash-logo', description: 'Splash screen with large orange R logo' },
  'onboard2': { source: 'welcome', description: 'Welcome screen - Rewoz Plus branding' },
  'onboard3': { source: 'onboarding-paperless', description: 'Paperless Loyalty, Smarter Business' },
  'onboard4': { source: 'onboarding-boost', description: 'Boost Sales with Buy X Get Y' },
  'onboard5': { source: 'onboarding-discounts', description: 'Off-Peak Hour Discounts' },
  'Home': { source: 'home-main', description: 'Main home screen' },
  'home1': { source: 'home-variant-1', description: 'Home screen variant 1' },
  'home2': { source: 'home-variant-2', description: 'Home screen variant 2' },
  'home3': { source: 'home-variant-3', description: 'Home screen variant 3' },
  'home4': { source: 'home-variant-4', description: 'Home screen variant 4' },
  'business': { source: 'business-dashboard', description: 'Business owner dashboard' },
};

async function main() {
  const store = new UIFrameStore({ baseDir: 'output/ui-frames', ttlMs: 365 * 24 * 60 * 60 * 1000 }); // 1 year TTL

  console.log('📱 Loading Figma UI screens into UIFrameStore...\n');

  for (const [filename, info] of Object.entries(SCREEN_MAP)) {
    const ext = fs.existsSync(path.join(SCREENS_DIR, `${filename}.png`)) ? 'png' : 'jpg';
    const filePath = path.join(SCREENS_DIR, `${filename}.${ext}`);

    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️  ${filename} not found, skipping`);
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    await store.save(info.source, buffer, {
      frameName: info.source,
      source: 'playwright',
      sourceId: `figma-upload:${filename}`,
      dimensions: { width: 390, height: 844 },
      format: 'png',
    });

    console.log(`  ✅ ${info.source} — ${info.description} (${Math.round(buffer.length / 1024)} KB)`);
  }

  const all = await store.list();
  console.log(`\n📦 UIFrameStore now has ${all.length} frames`);
  all.forEach(m => console.log(`   📸 ${m.frameName} (${m.source})`));
}

main().catch(console.error);
