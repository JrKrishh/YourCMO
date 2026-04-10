#!/usr/bin/env npx tsx
/**
 * Generate marketing image with real Rewoz app screen composited onto phone.
 * 
 * Step 1: AI generates cafe scene with person holding a blank/dark phone
 * Step 2: sharp composites the real Figma UI screen onto the phone area
 * Step 3: Rewoz logo watermark added
 *
 * Run: npx tsx scripts/generate-phone-mockup.ts
 */
import 'dotenv/config';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { buildImagePromptEnhancement } from '../src/config/rewoz-brand-dna';
import { watermarkImage } from '../src/engines/visual-asset/watermark';

const GOOGLE_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const OUT = path.join(process.cwd(), 'output', 'phone-mockups');

// Which Rewoz screen to composite onto the phone
const SCREEN_PATH = path.join(process.cwd(), 'assets', 'figma-screens', 'onboard1.png');

async function generateCafeScene(): Promise<Buffer | null> {
  // Prompt specifically asks for a BLANK/BLACK phone screen — we'll replace it
  const prompt = `Photorealistic editorial photo. A person sitting at a cozy Melbourne laneway cafe, seen from over-the-shoulder angle (back of head visible, face NOT shown). They are holding an iPhone in their right hand, the phone screen is COMPLETELY BLACK and BLANK — a solid dark rectangle with no content on it. The phone is held at a natural angle, screen facing the camera. On the wooden table: a latte with art, warm golden hour sunlight streaming through the window. Exposed brick walls, industrial pendant lights. Canon EOS R5, 35mm f/1.4, shallow depth of field, Kodak Portra 400 warm tones. The phone screen must be a clear, flat, dark rectangle — NO reflections, NO content, NO text. 1080x1080 square format.`;

  const enhanced = prompt + '\n\nCRITICAL: The phone screen MUST be completely black/blank — a solid dark rectangle. Do NOT put any content, text, or UI on the phone screen. It will be added in post-production.' + buildImagePromptEnhancement();

  console.log('🎨 Generating cafe scene with blank phone...');

  if (GOOGLE_KEY && !GOOGLE_KEY.includes('your_')) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: enhanced }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    });
    if (!res.ok) { console.log(`❌ Google AI ${res.status}`); return null; }
    const d = await res.json() as any;
    const img = d.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (img?.inlineData) return Buffer.from(img.inlineData.data, 'base64');
  }

  if (FAL_KEY) {
    const res = await fetch('https://queue.fal.run/fal-ai/kling-image/v3/text-to-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Key ${FAL_KEY}` },
      body: JSON.stringify({ prompt: enhanced, aspect_ratio: '1:1', image_count: 1 }),
    });
    if (!res.ok) return null;
    const d = await res.json() as any;
    if (d.images?.[0]?.url) { const r = await fetch(d.images[0].url); return Buffer.from(await r.arrayBuffer()); }
  }

  return null;
}

async function compositeScreenOnPhone(sceneBuffer: Buffer, screenPath: string): Promise<Buffer> {
  console.log('📱 Compositing Rewoz screen onto phone...');

  const scene = sharp(sceneBuffer);
  const meta = await scene.metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;

  // Phone screen area — approximate position for a phone held in right hand
  // These values work for a ~1024x1024 image with phone roughly center-right
  const phoneScreen = {
    x: Math.round(w * 0.38),  // left edge of phone screen
    y: Math.round(h * 0.25),  // top edge of phone screen
    w: Math.round(w * 0.22),  // width of phone screen area
    h: Math.round(w * 0.40),  // height of phone screen area
  };

  // Resize the Rewoz screen to fit the phone area
  const screen = await sharp(screenPath)
    .resize(phoneScreen.w, phoneScreen.h, { fit: 'cover' })
    .toBuffer();

  // Composite the screen onto the scene
  const result = await scene
    .composite([{
      input: screen,
      top: phoneScreen.y,
      left: phoneScreen.x,
    }])
    .toBuffer();

  return result;
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  if (!fs.existsSync(SCREEN_PATH)) {
    console.log(`❌ Screen not found: ${SCREEN_PATH}`);
    console.log('   Upload onboard1.png to assets/figma-screens/');
    return;
  }

  // Step 1: Generate cafe scene with blank phone
  const scene = await generateCafeScene();
  if (!scene) { console.log('❌ Failed to generate scene'); return; }
  console.log(`✅ Scene generated (${Math.round(scene.length / 1024)} KB)`);

  // Save raw scene for reference
  const ts = Date.now();
  fs.writeFileSync(path.join(OUT, `raw-scene-${ts}.png`), scene);

  // Step 2: Composite Rewoz screen onto phone
  const composited = await compositeScreenOnPhone(scene, SCREEN_PATH);
  console.log(`✅ Screen composited`);

  // Step 3: Add Rewoz logo watermark
  console.log('🏷️  Adding Rewoz logo...');
  const final = await watermarkImage(composited, { logoSize: 80, padding: 20 });

  // Save final
  const outputPath = path.join(OUT, `rewoz-phone-mockup-${ts}.png`);
  fs.writeFileSync(outputPath, final);
  console.log(`\n✅ Done! Saved to: ${outputPath}`);
  console.log(`   📸 Raw scene: raw-scene-${ts}.png`);
  console.log(`   📱 With Rewoz screen + logo: rewoz-phone-mockup-${ts}.png`);
  console.log(`\n💡 The phone screen position is approximate — adjust phoneScreen coordinates in the script if needed.`);
}

main().catch(console.error);
