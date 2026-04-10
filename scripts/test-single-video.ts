#!/usr/bin/env npx tsx
/**
 * Single video test — MiMo Ad Director + Seedance 2.0 + ffmpeg watermark with text
 * Run: npx tsx scripts/test-single-video.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { watermarkVideo } from '../src/engines/visual-asset/watermark';

const MIMO_KEY = process.env.MIMO_API_KEY!;
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const FAL_KEY = process.env.FAL_KEY!;
const OUT_DIR = path.join(process.cwd(), 'output', 'test-video');

async function main() {
  console.log('🎬 Single Video Test — MiMo Ad Director + Seedance 2.0\n');

  // Step 1: MiMo writes cinematic ad script
  console.log('📝 Step 1: MiMo Ad Director writing script...');
  const directorRes = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
    body: JSON.stringify({
      model: 'mimo-v2-pro',
      messages: [
        { role: 'system', content: 'You are a cinematic ad director. Write vivid visual shot descriptions for AI video generation. NEVER include any text, words, or letters in the scene — AI cannot render text.' },
        { role: 'user', content: `Write a 12-second cinematic vertical video ad for Rewoz, a digital loyalty app for Australian cafes.

Setting: Melbourne laneway cafe, golden hour morning light.
Story: A cafe opens for the day → first customer arrives → warm connection between barista and regular.

Write ONE continuous scene description. Include:
- Specific camera movements (dolly, pan, rack focus)
- Lighting details (golden hour, warm tones)
- Audio direction (espresso machine, milk steaming, ambient chatter)
- Physical props: coral/orange colored loyalty card on the counter, warm wooden surfaces
- Human direction: show people from behind or over-shoulder, NEVER front-facing

CRITICAL: NO text, NO words, NO letters, NO signs, NO menus, NO phone screens in the scene. Pure visual storytelling only.

Reply with just the scene description, nothing else.` },
      ],
      max_tokens: 400,
      temperature: 0.7,
    }),
  });

  const directorData = await directorRes.json() as any;
  const videoScript = directorData.choices?.[0]?.message?.content ?? '';
  console.log(`✅ Script: ${videoScript.substring(0, 150)}...\n`);

  // Step 2: Send to Seedance 2.0
  console.log('🎥 Step 2: Generating video via Seedance 2.0...');
  const seedancePrompt = videoScript + '\n\nCRITICAL: Do NOT render any readable text, words, or letters anywhere in the video. Use only visual storytelling with warm cafe atmosphere.';

  const seedRes = await fetch('https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/text-to-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${FAL_KEY}` },
    body: JSON.stringify({
      prompt: seedancePrompt,
      duration: 12,
      aspect_ratio: '9:16',
      resolution: '720p',
      generate_audio: true,
    }),
  });

  if (!seedRes.ok) {
    console.log(`❌ Seedance error: ${seedRes.status} ${await seedRes.text()}`);
    return;
  }

  const seedData = await seedRes.json() as any;
  let videoUrl = seedData.video?.url;

  if (!videoUrl && seedData.request_id) {
    console.log(`⏳ Queued (${seedData.request_id}), polling...`);
    const statusUrl = seedData.status_url ?? `https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/text-to-video/requests/${seedData.request_id}/status`;
    const resultUrl = seedData.response_url ?? `https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/text-to-video/requests/${seedData.request_id}`;

    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const sRes = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
      const status = await sRes.json() as any;
      if (i % 10 === 0) console.log(`⏳ ${i * 3}s...`);
      if (status.status === 'COMPLETED') {
        const rRes = await fetch(resultUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
        const result = await rRes.json() as any;
        videoUrl = result.video?.url;
        break;
      }
      if (status.status === 'FAILED') { console.log('❌ Failed'); return; }
    }
  }

  if (!videoUrl) { console.log('❌ No video URL'); return; }
  console.log(`✅ Video: ${videoUrl.substring(0, 60)}...\n`);

  // Step 3: Watermark with logo + text overlays
  console.log('🏷️  Step 3: Adding Rewoz logo + text overlays via ffmpeg...');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outputPath = path.join(OUT_DIR, `rewoz-ad-${Date.now()}.mp4`);

  await watermarkVideo(videoUrl, outputPath, {
    logoSize: 90,
    padding: 20,
    textOverlays: [
      { text: 'rewoz.com.au', position: 'bottom-center', fontSize: 28, color: 'white', startTime: 8, endTime: 12 },
      { text: '90-day free trial | $0 commission', position: 'bottom-center', fontSize: 20, color: 'white', startTime: 9, endTime: 12 },
    ],
  });

  console.log(`\n✅ Done! Video saved to: ${outputPath}`);
  console.log(`   - Rewoz logo watermark (bottom-right)`);
  console.log(`   - "rewoz.com.au" text (seconds 8-12)`);
  console.log(`   - "90-day free trial | $0 commission" (seconds 9-12)`);
}

main().catch(console.error);
