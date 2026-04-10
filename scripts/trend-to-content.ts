#!/usr/bin/env npx tsx
/**
 * Rewoz Trend-to-Content Pipeline
 *
 * Analyses current Instagram trends (viral tags, reel songs, cafe trends),
 * generates JSON prompts for image + video generation, then produces assets.
 *
 * Run: npx tsx scripts/trend-to-content.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  buildImagePromptEnhancement,
} from '../src/config/rewoz-brand-dna';
import { watermarkImage, watermarkVideo } from '../src/engines/visual-asset/watermark';

// ── Config ───────────────────────────────────────────────────────

const MIMO_KEY = process.env.MIMO_API_KEY!;
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;
const FAL_KEY = process.env.FAL_KEY;

const OUT_DIR = path.join(process.cwd(), 'output', 'trend-content');

// ── Trend Data (April 2026 — live research) ──────────────────────

export interface TrendData {
  id: string;
  category: 'reel_song' | 'hashtag_trend' | 'content_format' | 'cafe_trend';
  name: string;
  description: string;
  platform: 'instagram';
  engagementLevel: 'high' | 'medium' | 'emerging';
  posts?: string;
  businessSafe: boolean;
  rewozAngle: string;
}

export const CURRENT_TRENDS: TrendData[] = [
  {
    id: 'song-titanium-please-me',
    category: 'reel_song',
    name: 'Titanium x Please Me — TRUE CHAD, Unjaps',
    description: 'Slowed vocals + upbeat tempo. Transformation/glow-up energy. #1 on Instagram.',
    platform: 'instagram',
    engagementLevel: 'high',
    posts: '#1 trending',
    businessSafe: true,
    rewozAngle: 'Paper loyalty card crumpling → phone showing Rewoz digital stamps. Transformation reel.',
  },
  {
    id: 'song-who-is-me',
    category: 'reel_song',
    name: 'Who Is Me (unreleased) — Elle King',
    description: 'Relaxed sunny-day feel. Perfect for cafe morning routines and coffee runs.',
    platform: 'instagram',
    engagementLevel: 'high',
    posts: 'Early trending',
    businessSafe: true,
    rewozAngle: 'Morning cafe routine: open shop, fire up espresso machine, first customer scans Rewoz.',
  },
  {
    id: 'song-lucky-britney',
    category: 'reel_song',
    name: 'Lucky — Britney Spears',
    description: '"She\'s so lucky" trend — spotlight someone special. 44k posts.',
    platform: 'instagram',
    engagementLevel: 'high',
    posts: '44k',
    businessSafe: true,
    rewozAngle: '"She\'s so lucky to have regulars who come back 2x more" — spotlight loyal customer or barista.',
  },
  {
    id: 'song-loving-life',
    category: 'reel_song',
    name: 'Loving Life Again — @Browsbyzulema',
    description: 'Stitch together happy moments. 13k posts.',
    platform: 'instagram',
    engagementLevel: 'medium',
    posts: '13k',
    businessSafe: true,
    rewozAngle: 'Montage: latte art pour, stamp collection, happy customer, revenue dashboard going up.',
  },
  {
    id: 'format-does-he',
    category: 'content_format',
    name: '"Does he…? I do." trend',
    description: 'Questions on screen, confident zoom-in response. Hot take format.',
    platform: 'instagram',
    engagementLevel: 'high',
    businessSafe: true,
    rewozAngle: '"Does your cafe track customer data? $0 commission? Set up in 5 min?" → "I do." (Rewoz)',
  },
  {
    id: 'format-me-without',
    category: 'content_format',
    name: '"Me Without Happiness" trend',
    description: 'Show what makes you happy. Relatable, personal content.',
    platform: 'instagram',
    engagementLevel: 'emerging',
    posts: '1.3k',
    businessSafe: true,
    rewozAngle: 'What makes a cafe owner happy: regulars, latte art, full house, Rewoz dashboard showing growth.',
  },
  {
    id: 'cafe-floral-drinks',
    category: 'cafe_trend',
    name: 'Floral-forward cafe drinks',
    description: 'Rose lattes, pandan foam, hibiscus iced tea. Spring 2026\'s most photographed menu moment.',
    platform: 'instagram',
    engagementLevel: 'high',
    businessSafe: true,
    rewozAngle: 'Beautiful floral latte with Rewoz stamp card visible on phone beside it. Seasonal content.',
  },
  {
    id: 'cafe-signature-drinks',
    category: 'cafe_trend',
    name: 'Signature drinks over standard menus',
    description: 'Cafes using hero drinks, tiered pricing, premium origins. 2026 Australian cafe trend.',
    platform: 'instagram',
    engagementLevel: 'medium',
    businessSafe: true,
    rewozAngle: 'Showcase a signature drink + "Reward your regulars who try your signature" with Rewoz.',
  },
  {
    id: 'hashtag-cafe-loyalty',
    category: 'hashtag_trend',
    name: '#CafeLoyalty + #DigitalLoyalty rising',
    description: 'Loyalty app content gaining traction. Competitors StampMe, SimpleLoyalty posting heavily.',
    platform: 'instagram',
    engagementLevel: 'medium',
    businessSafe: true,
    rewozAngle: 'Own the #CafeLoyalty hashtag. $0 commission differentiator vs competitors.',
  },
  {
    id: 'hashtag-reels-60pct',
    category: 'content_format',
    name: 'Reels = 60%+ of Instagram time',
    description: 'Meta restructured algorithm to prioritize short-form video above everything else in 2026.',
    platform: 'instagram',
    engagementLevel: 'high',
    businessSafe: true,
    rewozAngle: 'Every Rewoz post should have a Reel version. Video-first strategy.',
  },
];


// ── Content Prompt Interfaces ────────────────────────────────────

export interface ContentPrompt {
  id: string;
  trend: TrendData;
  caption: string;
  hashtags: string[];
  cta: string;
  reelSong?: string;
  imagePrompt: string;
  videoPrompt: string;
  targetCity: string;
}

// ── LLM Helper ───────────────────────────────────────────────────

async function callLLMText(system: string, user: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
        body: JSON.stringify({
          model: 'mimo-v2-pro',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 500,
          temperature: attempt === 0 ? 0.7 : 0.3,
        }),
      });
      if (!res.ok) { console.log(`    ⚠️  LLM ${res.status}, attempt ${attempt + 1}`); continue; }
      const data = await res.json() as any;
      const text = data.choices?.[0]?.message?.content ?? '';
      if (text.trim().length > 20) return text;
      console.log(`    ⚠️  Attempt ${attempt + 1}: response too short`);
    } catch (e: any) {
      console.log(`    ⚠️  Attempt ${attempt + 1}: ${e.message}`);
    }
  }
  return null;
}

function extractField(text: string, label: string): string {
  // Try exact match first, then case-insensitive, then with variations
  for (const pattern of [
    `${label}:`,
    `${label} PROMPT:`,
    `${label.toLowerCase()}:`,
    `${label.toLowerCase()} prompt:`,
  ]) {
    const idx = text.toLowerCase().indexOf(pattern.toLowerCase());
    if (idx >= 0) {
      const after = text.substring(idx + pattern.length).trim();
      // Take until next label or end
      const nextLabel = after.match(/\n(?:IMAGE|VIDEO|CAPTION|HASHTAGS|CTA|IMAGE PROMPT|VIDEO PROMPT)\s*:/i);
      return nextLabel ? after.substring(0, nextLabel.index).trim() : after.trim();
    }
  }
  return '';
}

// ── Step 1: Analyse trends via LLM (split into 2 short calls) ───

async function analyseTrendsWithLLM(): Promise<ContentPrompt[]> {
  console.log('🔍 Step 1: Analysing trends via LLM...\n');

  const topTrends = CURRENT_TRENDS.filter(t => t.engagementLevel === 'high').slice(0, 3);
  const cities = ['Adelaide', 'Melbourne', 'Sydney'];
  const prompts: ContentPrompt[] = [];
  const sys = 'You are a social media expert for Rewoz (rewoz.com.au), a $39/month digital loyalty platform for Australian cafes. $0 commission, 90-day free trial, 2x repeat visits, 30% revenue growth.';

  for (let i = 0; i < topTrends.length; i++) {
    const trend = topTrends[i];
    const city = cities[i % cities.length];

    console.log(`  📊 Trend: ${trend.name}`);
    console.log(`     Angle: ${trend.rewozAngle}`);
    console.log(`     City: ${city}`);

    // Call 1: Caption + hashtags + CTA (text format — MiMo handles this reliably)
    const call1Raw = await callLLMText(sys,
      `Write an Instagram caption for Rewoz targeting ${city} cafe owners riding the "${trend.name}" trend. Angle: ${trend.rewozAngle}.
Format:
CAPTION: <100-150 chars with 1 Rewoz stat>
HASHTAGS: #Rewoz #CafeOwner <8 more hashtags>
CTA: <short call to action>`);

    if (!call1Raw) { console.log(`  ❌ Caption call failed\n`); continue; }
    const caption = extractField(call1Raw, 'CAPTION');
    const hashtags = extractField(call1Raw, 'HASHTAGS').split(/\s+/).filter(h => h.startsWith('#'));
    const cta = extractField(call1Raw, 'CTA');
    if (!caption) { console.log(`  ❌ Could not parse caption\n`); continue; }
    console.log(`  ✅ Caption generated`);

    // Call 2: MiMo as Ad Director — writes cinematic video script
    const adDirectorPrompt = `You are a world-class ad director creating a 12-second Instagram Reel for Rewoz, a digital loyalty app for Australian cafes.

TREND: "${trend.name}" — ${trend.description}
CITY: ${city}
ANGLE: ${trend.rewozAngle}

Write a cinematic shot-by-shot video description. Think David Fincher meets cafe lifestyle.

CRITICAL RULES:
- NO text, words, or letters in the video — AI video models render text as garbled nonsense
- NO phone screens with UI — they always look fake
- Instead show: physical objects (orange loyalty cards, coffee cups, warm cafe interiors)
- Use cinematic camera language: dolly, pan, rack focus, slow motion, tracking shot
- Include ambient audio direction: espresso machine hiss, milk steaming, cup on saucer, cafe chatter
- The video should tell a STORY: problem → discovery → delight
- Feature warm golden hour lighting, exposed brick, wooden tables
- Include a coral/orange colored loyalty card or sticker as the brand element

Format:
SCENE: <detailed 12-second shot-by-shot cinematic description for AI video generation, one continuous flowing description>
IMAGE: <matching still photo prompt for the hero frame, Canon EOS R5, 35mm f/1.4, 1080x1080>`;

    const adDirectorRaw = await callLLMText(
      'You are a cinematic ad director. Write vivid, visual shot descriptions. NO text in any scene. Use camera and audio direction.',
      adDirectorPrompt,
    );

    let videoPrompt: string;
    let imagePrompt: string;

    if (adDirectorRaw) {
      videoPrompt = extractField(adDirectorRaw, 'SCENE');
      imagePrompt = extractField(adDirectorRaw, 'IMAGE');
      if (videoPrompt) {
        console.log(`  🎬 Ad Director script generated`);
      }
    }

    // Fallback if MiMo didn't produce usable output
    if (!videoPrompt!) {
      videoPrompt = `12 second cinematic vertical video. Opens on a close-up of espresso pouring into a white ceramic cup, steam rising. Slow dolly back reveals a sunlit ${city} laneway cafe — exposed brick, industrial pendant lights, warm golden hour light. A barista slides the cup across a wooden counter. A customer's hand reaches for it — on the saucer sits a small coral orange loyalty card. The customer smiles (seen from behind, over-shoulder). Camera racks focus to the loyalty card. Ambient audio: espresso machine hiss, gentle cafe chatter, cup on saucer clink. NO text, NO words anywhere.`;
    }
    if (!imagePrompt!) {
      imagePrompt = `Cinematic over-the-shoulder shot in a sunlit ${city} laneway cafe. A barista's hand places a latte with beautiful art on a wooden counter. Warm golden hour light, shallow depth of field, Canon EOS R5, 35mm f/1.4, Kodak Portra 400 film grain. Coral orange loyalty card visible on the saucer. Exposed brick and industrial pendant lights. NO text, NO words. 1080x1080 square.`;
    }
    console.log(`  ✅ Prompts ready\n`);

    prompts.push({
      id: uuidv4(),
      trend,
      caption,
      hashtags: hashtags.length > 0 ? hashtags : ['#Rewoz', '#CafeOwner', '#CafeLoyalty'],
      cta,
      reelSong: trend.category === 'reel_song' ? trend.name : undefined,
      imagePrompt: imagePrompt,
      videoPrompt: videoPrompt || `15 second vertical cinematic video of a cozy ${city} cafe at golden hour. Barista pours latte art, customer picks up coffee cup with a small bold orange R logo sticker on it. Warm morning light, smooth slow dolly camera movement. NO text, NO words, NO UI screens. Just beautiful cafe atmosphere with coral orange color accents.`,
      targetCity: city,
    });
  }

  return prompts;
}


// ── Step 2: Generate Images ──────────────────────────────────────

async function generateImage(prompt: ContentPrompt): Promise<Buffer | null> {
  // Try Google AI Studio first (free), fall back to KLING
  if (GOOGLE_AI_KEY && !GOOGLE_AI_KEY.includes('your_')) {
    return generateImageGoogleAI(prompt.imagePrompt);
  }
  if (FAL_KEY) {
    return generateImageKling(prompt.imagePrompt);
  }
  console.log('  ⚠️  No image API key set (GOOGLE_AI_STUDIO_API_KEY or FAL_KEY)');
  return null;
}

async function generateImageGoogleAI(imagePrompt: string): Promise<Buffer | null> {
  const noTextRule = '\n\nCRITICAL: Do NOT render any readable text, words, or letters in the image. Instead of a "Rewoz" watermark, place a small bold geometric orange R logo mark (like a stylized R with an arrow cutout) in the bottom-right corner as a simple graphic shape. NO text anywhere.';
  const enhanced = imagePrompt + noTextRule + buildImagePromptEnhancement();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: enhanced }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      },
    );
    if (!res.ok) { console.log(`  ❌ Google AI ${res.status}`); return null; }
    const data = await res.json() as any;
    const img = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (img?.inlineData) {
      return Buffer.from(img.inlineData.data, 'base64');
    }
    console.log('  ⚠️  No image in Google AI response');
    return null;
  } catch (e: any) {
    console.log(`  ❌ Google AI error: ${e.message}`);
    return null;
  }
}

async function generateImageKling(imagePrompt: string): Promise<Buffer | null> {
  const noTextRule = '\n\nCRITICAL: Do NOT render any readable text, words, or letters. Place a small bold geometric orange R logo mark in the bottom-right corner as a simple graphic shape. NO text.';
  const enhanced = imagePrompt + noTextRule + buildImagePromptEnhancement();
  try {
    const res = await fetch('https://queue.fal.run/fal-ai/kling-image/v3/text-to-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${FAL_KEY}`,
      },
      body: JSON.stringify({ prompt: enhanced, aspect_ratio: '1:1', image_count: 1 }),
    });
    if (!res.ok) { console.log(`  ❌ KLING ${res.status}`); return null; }
    const data = await res.json() as any;
    if (data.images?.[0]?.url) {
      const imgRes = await fetch(data.images[0].url);
      return Buffer.from(await imgRes.arrayBuffer());
    }
    return null;
  } catch (e: any) {
    console.log(`  ❌ KLING error: ${e.message}`);
    return null;
  }
}

// ── Step 3: Generate Video (Seedance 2.0 via fal.ai) ─────────────

const SEEDANCE_MODEL = 'fal-ai/bytedance/seedance/v1.5/pro/text-to-video';

async function generateVideo(prompt: ContentPrompt): Promise<string | null> {
  if (!FAL_KEY) {
    console.log('  ⚠️  FAL_KEY not set — skipping video generation');
    return null;
  }

  try {
    console.log('  🎬 Submitting video to Seedance 2.0/fal.ai...');
    const res = await fetch(`https://queue.fal.run/${SEEDANCE_MODEL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${FAL_KEY}`,
      },
      body: JSON.stringify({
        prompt: prompt.videoPrompt + '\n\nCRITICAL: Do NOT render any readable text, words, or letters anywhere in the video. All text will appear garbled. Use only visual storytelling. Show a bold geometric orange R logo mark as a simple graphic shape, not as text.',
        duration: 12,
        aspect_ratio: '9:16',
        resolution: '720p',
        generate_audio: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.log(`  ❌ Seedance ${res.status}: ${err.substring(0, 200)}`);
      return null;
    }

    const data = await res.json() as any;

    // Direct result
    if (data.video?.url) {
      return data.video.url;
    }

    // Queued — poll for result
    if (data.request_id) {
      console.log(`  ⏳ Video queued (${data.request_id}), polling...`);
      const statusUrl = data.status_url ?? `https://queue.fal.run/${SEEDANCE_MODEL}/requests/${data.request_id}/status`;
      const resultUrl = data.response_url ?? `https://queue.fal.run/${SEEDANCE_MODEL}/requests/${data.request_id}`;

      for (let i = 0; i < 90; i++) {
        await sleep(3000);
        const statusRes = await fetch(statusUrl, {
          headers: { Authorization: `Key ${FAL_KEY}` },
        });
        const status = await statusRes.json() as any;

        if (status.status === 'COMPLETED') {
          const resultRes = await fetch(resultUrl, {
            headers: { Authorization: `Key ${FAL_KEY}` },
          });
          const result = await resultRes.json() as any;
          if (result.video?.url) return result.video.url;
          console.log('  ❌ Video completed but no URL');
          return null;
        }
        if (status.status === 'FAILED') {
          console.log('  ❌ Video generation failed');
          return null;
        }
        if (i % 10 === 0) console.log(`  ⏳ Still generating... (${i * 3}s)`);
      }
      console.log('  ❌ Video generation timed out');
      return null;
    }

    console.log('  ❌ No video result');
    return null;
  } catch (e: any) {
    console.log(`  ❌ Video error: ${e.message}`);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}


// ── Step 4: Save outputs ─────────────────────────────────────────

async function saveOutputs(
  prompts: ContentPrompt[],
  images: Map<string, Buffer>,
  videos: Map<string, string>,
) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const batchDir = path.join(OUT_DIR, `batch-${timestamp}`);
  fs.mkdirSync(batchDir, { recursive: true });

  // Save the full trend analysis JSON
  const analysisJson = {
    generatedAt: new Date().toISOString(),
    trendsAnalysed: CURRENT_TRENDS.length,
    contentGenerated: prompts.length,
    imagesGenerated: images.size,
    videosGenerated: videos.size,
    trends: CURRENT_TRENDS,
    content: prompts.map(p => ({
      id: p.id,
      trendName: p.trend.name,
      trendCategory: p.trend.category,
      targetCity: p.targetCity,
      caption: p.caption,
      hashtags: p.hashtags,
      cta: p.cta,
      reelSong: p.reelSong,
      imagePrompt: p.imagePrompt,
      videoPrompt: p.videoPrompt,
      hasImage: images.has(p.id),
      hasVideo: videos.has(p.id),
      videoUrl: videos.get(p.id) ?? null,
    })),
  };

  fs.writeFileSync(
    path.join(batchDir, 'trend-analysis.json'),
    JSON.stringify(analysisJson, null, 2),
  );

  // Save individual content files
  for (const prompt of prompts) {
    const slug = prompt.trend.id;

    // Save image (already watermarked)
    const imgBuf = images.get(prompt.id);
    if (imgBuf) {
      fs.writeFileSync(path.join(batchDir, `${slug}-image.png`), imgBuf);
    }

    // Watermark and save video
    const videoUrl = videos.get(prompt.id);
    if (videoUrl) {
      const videoPath = path.join(batchDir, `${slug}-video.mp4`);
      try {
        console.log(`  🎬 Watermarking video: ${slug}...`);
        await watermarkVideo(videoUrl, videoPath, {
          logoSize: 80,
          padding: 15,
          textOverlays: [
            {
              text: 'rewoz.com.au',
              position: 'bottom-center',
              fontSize: 24,
              color: 'white',
              startTime: 8,
              endTime: 12,
            },
            {
              text: prompt.cta || '90-day free trial',
              position: 'bottom-center',
              fontSize: 20,
              color: 'white',
              startTime: 9,
              endTime: 12,
            },
          ],
        });
        console.log(`  ✅ Video watermarked: ${videoPath}`);
      } catch (e: any) {
        console.log(`  ⚠️  Video watermark failed: ${e.message}, downloading raw`);
        const res = await fetch(videoUrl);
        fs.writeFileSync(videoPath, Buffer.from(await res.arrayBuffer()));
      }
    }

    // Save content card
    const card = [
      `═══ REWOZ INSTAGRAM POST ═══`,
      `Trend: ${prompt.trend.name}`,
      `City: ${prompt.targetCity}`,
      `Song: ${prompt.reelSong ?? 'N/A'}`,
      ``,
      `── CAPTION ──`,
      prompt.caption,
      ``,
      `── HASHTAGS ──`,
      prompt.hashtags.join(' '),
      ``,
      `── CTA ──`,
      prompt.cta,
      ``,
      `── IMAGE PROMPT ──`,
      prompt.imagePrompt,
      ``,
      `── VIDEO PROMPT ──`,
      prompt.videoPrompt,
      ``,
      videos.has(prompt.id) ? `── VIDEO URL ──\n${videos.get(prompt.id)}` : '── VIDEO: Not generated ──',
      ``,
      `═══ END ═══`,
    ].join('\n');

    fs.writeFileSync(path.join(batchDir, `${slug}-content.txt`), card);
  }

  return batchDir;
}

// ── Main Pipeline ────────────────────────────────────────────────

async function main() {
  console.log('🚀 Rewoz Trend-to-Content Pipeline');
  console.log('═══════════════════════════════════\n');

  // Print trend summary
  console.log('📊 Current Trends (April 2026):');
  console.log('───────────────────────────────');
  for (const t of CURRENT_TRENDS) {
    const icon = t.category === 'reel_song' ? '🎵' :
                 t.category === 'hashtag_trend' ? '#️⃣' :
                 t.category === 'content_format' ? '📱' : '☕';
    console.log(`  ${icon} [${t.engagementLevel.toUpperCase()}] ${t.name}`);
    console.log(`     → ${t.rewozAngle}`);
  }
  console.log('');

  // Step 1: Generate content prompts via LLM
  if (!MIMO_KEY && !process.env.OPENROUTER_API_KEY) {
    console.log('❌ Neither MIMO_API_KEY nor OPENROUTER_API_KEY set — cannot generate content');
    console.log('   Set one in .env and try again');
    // Still save the trend analysis JSON
    const batchDir = await saveOutputs([], new Map(), new Map());
    console.log(`\n📁 Trend analysis saved to: ${batchDir}`);
    return;
  }

  const prompts = await analyseTrendsWithLLM();

  if (prompts.length === 0) {
    console.log('❌ No content generated');
    return;
  }

  // Step 2: Generate images
  console.log('\n🎨 Step 2: Generating images...\n');
  const images = new Map<string, Buffer>();
  for (const p of prompts) {
    console.log(`  🖼️  Generating image for: ${p.trend.name}`);
    const img = await generateImage(p);
    if (img) {
      images.set(p.id, img);
      console.log(`  ✅ Image generated (${Math.round(img.length / 1024)} KB)\n`);
    } else {
      console.log(`  ⚠️  Image skipped\n`);
    }
  }

  // Step 3: Generate videos
  console.log('🎬 Step 3: Generating videos...\n');
  const videos = new Map<string, string>();
  for (const p of prompts) {
    console.log(`  🎥 Generating video for: ${p.trend.name}`);
    const videoUrl = await generateVideo(p);
    if (videoUrl) {
      videos.set(p.id, videoUrl);
      console.log(`  ✅ Video generated: ${videoUrl.substring(0, 60)}...\n`);
    } else {
      console.log(`  ⚠️  Video skipped\n`);
    }
  }

  // Step 4: Watermark images with Rewoz logo
  console.log('🏷️  Step 4: Adding Rewoz logo watermark...\n');
  for (const [id, buf] of images) {
    try {
      const watermarked = await watermarkImage(buf, { logoSize: 100, padding: 25 });
      images.set(id, watermarked);
      console.log(`  ✅ Image watermarked (${Math.round(watermarked.length / 1024)} KB)`);
    } catch (e: any) {
      console.log(`  ⚠️  Image watermark failed: ${e.message}`);
    }
  }
  console.log('');

  // Step 5: Save everything
  const batchDir = await saveOutputs(prompts, images, videos);

  // Print summary
  console.log('\n═══════════════════════════════════');
  console.log('  REWOZ CONTENT BATCH — COMPLETE');
  console.log('═══════════════════════════════════\n');

  for (const p of prompts) {
    console.log(`📌 ${p.trend.name} (${p.targetCity})`);
    console.log(`   Caption: ${p.caption.substring(0, 80)}...`);
    console.log(`   Song: ${p.reelSong ?? 'N/A'}`);
    console.log(`   Image: ${images.has(p.id) ? '✅' : '❌'}`);
    console.log(`   Video: ${videos.has(p.id) ? '✅' : '❌'}`);
    console.log('');
  }

  console.log(`📁 All outputs saved to: ${batchDir}`);
  console.log(`   📄 trend-analysis.json — full trend data + prompts`);
  console.log(`   🖼️  *-image.png — generated images`);
  console.log(`   📝 *-content.txt — ready-to-post content cards`);
  console.log(`\n💡 Tip: Use the reel songs with your video clips in Instagram!`);
}

main().catch(console.error);
