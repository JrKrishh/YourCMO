#!/usr/bin/env npx tsx
/**
 * Image-only content generator — MiMo captions + Google AI images + Rewoz logo watermark
 * Run: npx tsx scripts/generate-images.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { buildImagePromptEnhancement } from '../src/config/rewoz-brand-dna';
import { watermarkImage } from '../src/engines/visual-asset/watermark';

const MIMO_KEY = process.env.MIMO_API_KEY!;
const MIMO_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const GOOGLE_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const OUT = path.join(process.cwd(), 'output', 'images');

const POSTS = [
  { city: 'Adelaide', trend: 'Titanium x Please Me', angle: 'Paper loyalty card → digital stamps transformation',
    scene: 'Adelaide cafe, barista sliding a latte across a wooden counter toward a customer seen from behind. A crumpled paper loyalty card lies discarded on the counter. Next to the latte sits a sleek coral orange digital loyalty card. Warm golden hour light through the window, exposed brick, industrial pendant lights.' },
  { city: 'Melbourne', trend: 'Who Is Me — Elle King', angle: 'Morning cafe routine, first customer scans Rewoz',
    scene: 'Melbourne laneway cafe at dawn. Over-the-shoulder shot of a barista in an apron pouring steaming milk into a latte, creating beautiful art. On the wooden counter: a coral orange loyalty card and a white ceramic cup. Morning sunlight streaming through tall windows, exposed brick walls, vintage pendant lights.' },
  { city: 'Sydney', trend: 'Lucky — Britney Spears', angle: 'Lucky to have regulars who come back 2x more',
    scene: 'Sydney harbour-side cafe. A customer (seen from behind, sitting at a window table) holds a coffee cup. On the table: a coral orange loyalty card, a pastry on a plate, and warm sunlight casting long shadows. The cafe has modern clean aesthetics with plants and wooden furniture.' },
];

async function callMiMo(prompt: string): Promise<string> {
  const res = await fetch(`${MIMO_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
    body: JSON.stringify({
      model: 'mimo-v2-pro', max_tokens: 300, temperature: 0.7,
      messages: [
        { role: 'system', content: 'You are a social media expert for Rewoz (rewoz.com.au), $39/month digital loyalty for Australian cafes. $0 commission, 90-day free trial, 2x repeat visits.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const d = await res.json() as any;
  return d.choices?.[0]?.message?.content ?? '';
}

async function generateImage(prompt: string): Promise<Buffer | null> {
  const enhanced = prompt + '\n\nNO text, NO words, NO letters anywhere. Pure visual only.' + buildImagePromptEnhancement();
  if (GOOGLE_KEY && !GOOGLE_KEY.includes('your_')) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: enhanced }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    });
    if (!res.ok) return null;
    const d = await res.json() as any;
    const img = d.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    return img?.inlineData ? Buffer.from(img.inlineData.data, 'base64') : null;
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

async function main() {
  console.log('🖼️  Rewoz Image Generator — 3 trend-based Instagram posts\n');
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const batchDir = path.join(OUT, `batch-${ts}`);
  fs.mkdirSync(batchDir, { recursive: true });

  for (const post of POSTS) {
    console.log(`📊 ${post.trend} → ${post.city}`);

    // 1. MiMo caption
    console.log('  📝 Generating caption...');
    const raw = await callMiMo(`Instagram caption for Rewoz targeting ${post.city} cafe owners. Trend: "${post.trend}". Angle: ${post.angle}.\nFormat:\nCAPTION: <100-150 chars with 1 stat>\nHASHTAGS: #Rewoz #CafeOwner <8 more>\nCTA: <short CTA>`);
    const caption = raw.match(/CAPTION:\s*(.+?)(?=\n|HASHTAGS|$)/s)?.[1]?.trim() ?? `Rewoz: 2x more repeat visits for ${post.city} cafes ☕`;
    const hashtags = raw.match(/HASHTAGS:\s*(.+?)(?=\n|CTA|$)/s)?.[1]?.trim() ?? '#Rewoz #CafeOwner #CafeLoyalty';
    const cta = raw.match(/CTA:\s*(.+?)$/s)?.[1]?.trim() ?? 'Start free → rewoz.com.au';
    console.log(`  ✅ "${caption.substring(0, 60)}..."`);

    // 2. Generate image
    console.log('  🎨 Generating image...');
    const imgPrompt = `Cinematic photorealistic shot. ${post.scene} Canon EOS R5, 35mm f/1.4 lens, shallow depth of field, Kodak Portra 400 warm film grain. Coral orange #E8692D color accents throughout. 1080x1080 square format.`;
    let img = await generateImage(imgPrompt);
    if (!img) { console.log('  ❌ Image failed\n'); continue; }
    console.log(`  ✅ Image (${Math.round(img.length / 1024)} KB)`);

    // 3. Watermark with real Rewoz logo
    console.log('  🏷️  Adding Rewoz logo...');
    img = await watermarkImage(img, { logoSize: 100, padding: 25 });
    console.log(`  ✅ Watermarked (${Math.round(img.length / 1024)} KB)`);

    // 4. Save
    const slug = post.city.toLowerCase();
    fs.writeFileSync(path.join(batchDir, `${slug}-image.png`), img);
    fs.writeFileSync(path.join(batchDir, `${slug}-content.txt`), [
      `═══ REWOZ INSTAGRAM POST ═══`,
      `City: ${post.city} | Trend: ${post.trend}`,
      `\n── CAPTION ──\n${caption}`,
      `\n── HASHTAGS ──\n${hashtags}`,
      `\n── CTA ──\n${cta}`,
      `\n═══ END ═══`,
    ].join('\n'));
    console.log(`  📁 Saved to ${batchDir}/${slug}-image.png\n`);
  }

  console.log(`✅ All done! Check ${batchDir}/`);
}

main().catch(console.error);
