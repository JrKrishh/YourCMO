#!/usr/bin/env npx tsx
/**
 * Generate marketing image using Rewoz app screen as reference image.
 * Uses KLING image-to-image (fal.ai) — passes the onboard screen as reference
 * so the AI generates a cafe scene with the actual Rewoz UI visible on a phone.
 *
 * Run: npx tsx scripts/generate-with-screen-ref.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { watermarkImage } from '../src/engines/visual-asset/watermark';
import { buildImagePromptEnhancement } from '../src/config/rewoz-brand-dna';

const FAL_KEY = process.env.FAL_KEY!;
const GOOGLE_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;
const OUT = path.join(process.cwd(), 'output', 'screen-ref');
const SCREEN = path.join(process.cwd(), 'assets', 'figma-screens', 'onboard1.png');

async function generateWithKlingRef(screenBase64: string): Promise<Buffer | null> {
  console.log('🎨 Generating via KLING image-to-image with Rewoz screen reference...');

  const prompt = `A photorealistic marketing image for a cafe loyalty app. Show a smartphone displaying this app screen, held by a person in a cozy Australian cafe. The phone screen should clearly show the app interface from the reference image. Warm golden hour lighting, wooden table, latte with art nearby. Over-the-shoulder angle, shallow depth of field. The app on the phone must be clearly visible and recognizable. 1080x1080 square.` + buildImagePromptEnhancement();

  const dataUrl = `data:image/png;base64,${screenBase64}`;

  const res = await fetch('https://queue.fal.run/fal-ai/kling-image/v3/text-to-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${FAL_KEY}` },
    body: JSON.stringify({
      prompt,
      image_url: dataUrl,
      aspect_ratio: '1:1',
      image_count: 1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.log(`❌ KLING ${res.status}: ${err.substring(0, 200)}`);
    return null;
  }

  const data = await res.json() as any;

  if (data.images?.[0]?.url) {
    const imgRes = await fetch(data.images[0].url);
    return Buffer.from(await imgRes.arrayBuffer());
  }

  // Poll if queued
  if (data.request_id) {
    console.log(`⏳ Queued (${data.request_id}), polling...`);
    const model = 'fal-ai/kling-image/v3/text-to-image';
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const sUrl = data.status_url ?? `https://queue.fal.run/${model}/requests/${data.request_id}/status`;
      const rUrl = data.response_url ?? `https://queue.fal.run/${model}/requests/${data.request_id}`;
      const sRes = await fetch(sUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
      const status = await sRes.json() as any;
      if (status.status === 'COMPLETED') {
        const rRes = await fetch(rUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
        const result = await rRes.json() as any;
        if (result.images?.[0]?.url) {
          const imgRes = await fetch(result.images[0].url);
          return Buffer.from(await imgRes.arrayBuffer());
        }
      }
      if (status.status === 'FAILED') return null;
      if (i % 5 === 0) console.log(`⏳ ${i * 3}s...`);
    }
  }

  return null;
}

async function generateWithGoogleRef(screenBase64: string): Promise<Buffer | null> {
  if (!GOOGLE_KEY || GOOGLE_KEY.includes('your_')) return null;

  console.log('🎨 Generating via Google AI with Rewoz screen reference...');

  const prompt = `Create a photorealistic marketing image for this cafe loyalty app. Show a smartphone displaying this exact app screen, held naturally by a person sitting in a cozy Australian laneway cafe. The phone screen should clearly show the app from the reference image. Warm golden hour lighting, wooden table, latte nearby. Over-the-shoulder angle. 1080x1080 square.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/png', data: screenBase64 } },
        ],
      }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });

  if (!res.ok) { console.log(`❌ Google AI ${res.status}`); return null; }
  const d = await res.json() as any;
  const img = d.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  return img?.inlineData ? Buffer.from(img.inlineData.data, 'base64') : null;
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  if (!fs.existsSync(SCREEN)) {
    console.log(`❌ Screen not found: ${SCREEN}`);
    return;
  }

  const screenBuf = fs.readFileSync(SCREEN);
  const screenBase64 = screenBuf.toString('base64');
  console.log(`📱 Using screen: onboard1.png (${Math.round(screenBuf.length / 1024)} KB)\n`);

  // Try Google AI first (supports image+text input natively), then KLING
  let img = await generateWithGoogleRef(screenBase64);
  if (!img) img = await generateWithKlingRef(screenBase64);
  if (!img) { console.log('❌ Both methods failed'); return; }

  console.log(`✅ Image generated (${Math.round(img.length / 1024)} KB)`);

  // Watermark
  console.log('🏷️  Adding Rewoz logo...');
  img = await watermarkImage(img, { logoSize: 80, padding: 20 });

  const ts = Date.now();
  const outputPath = path.join(OUT, `rewoz-screen-ref-${ts}.png`);
  fs.writeFileSync(outputPath, img);
  console.log(`\n✅ Saved: ${outputPath}`);
}

main().catch(console.error);
