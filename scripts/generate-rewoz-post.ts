/**
 * Generate a complete Rewoz Instagram post with image.
 * Uses MiMo V2 Pro for content + Google AI Studio for image.
 * Saves output to output/ folder.
 *
 * Run: npx tsx scripts/generate-rewoz-post.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { REWOZ_BRAND_DNA, buildContentSystemPrompt, buildImagePromptEnhancement } from '../src/config/rewoz-brand-dna';

const MIMO_KEY = process.env.MIMO_API_KEY!;
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY!;

// Brand DNA is loaded from src/config/rewoz-brand-dna.ts

async function generateContent(): Promise<string> {
  console.log('📝 Generating Rewoz Instagram post via MiMo V2 Pro...');

  const res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
    body: JSON.stringify({
      model: 'mimo-v2-pro',
      messages: [
        {
          role: 'system',
          content: buildContentSystemPrompt(),
        },
        {
          role: 'user',
          content: `Create an Instagram post for Rewoz targeting cafe owners in Melbourne.

The post should:
1. Hook them with a relatable cafe owner pain point
2. Present Rewoz as the simple solution
3. Include specific stats/numbers from our proven results
4. End with a clear CTA for the 90-day free trial
5. Include 10-15 relevant hashtags mixing local Melbourne + cafe + loyalty

Format your response EXACTLY like this:
TEXT: <the full Instagram caption>
HASHTAGS: <hashtags separated by spaces>
CTA: <call to action text>
IMAGE_PROMPT: <a detailed cinematic image generation prompt following these STRICT rules:

CINEMATIC HUMAN DIRECTION (think James Cameron):
- Include 1-2 people but ALWAYS use cinematic angles that avoid showing faces directly
- CAMERA ANGLES: over-the-shoulder, from behind, silhouette against window light, side profile in shadow
- HANDS: show one hand holding a coffee cup, shot from above/behind POV — natural, not posed
- DEPTH TRICK: person slightly out of focus in mid-ground, sharp focus on coffee cup in foreground
- GOLDEN RULE: if you can clearly see the face, the angle is WRONG — faces must be turned away, in shadow, or blurred

PHOTOGRAPHY:
- Shot on Canon EOS R5, 35mm f/1.4 lens, natural window light from the left
- Shallow depth of field with creamy bokeh
- Warm golden hour tones, Kodak Portra 400 film grain
- Melbourne laneway cafe aesthetic: exposed brick, industrial pendant lights

REWOZ BRAND:
- Use coral/salmon (#F97066) as the dominant accent color — NOT green, NOT blue
- Include coral-colored elements: napkin, coffee sleeve, saucer, or coaster
- Include small "Rewoz" watermark text in bottom-right corner, white on dark strip
- If showing a phone screen, keep it SIMPLE — just colored dots/circles, NO readable text

AVOID: cartoon, illustration, 3D render, stock photo look, front-facing portraits, neon colors
Square format 1080x1080>`,
        },
      ],
      max_tokens: 800,
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(`MiMo error: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  const text = data.choices[0].message.content;
  const tokens = data.usage?.total_tokens || 0;
  const cost = ((data.usage?.prompt_tokens || 0) / 1e6) * 1 + ((data.usage?.completion_tokens || 0) / 1e6) * 3;

  console.log(`✅ Content generated (${tokens} tokens, $${cost.toFixed(4)})`);
  return text;
}

async function generateImage(prompt: string): Promise<Buffer> {
  console.log('🎨 Generating Rewoz branded image via Google AI Studio...');

  // Enhance the prompt with Rewoz brand DNA image rules
  const enhancedPrompt = prompt + buildImagePromptEnhancement();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_AI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: enhancedPrompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    },
  );

  if (!res.ok) throw new Error(`Google AI error: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p: any) => p.inlineData);

  if (!imgPart?.inlineData) throw new Error('No image in response');

  const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
  const kb = Math.round(buffer.length / 1024);
  console.log(`✅ Image generated (${kb} KB, ${imgPart.inlineData.mimeType})`);
  return buffer;
}

function parseContent(raw: string) {
  const extract = (label: string) => {
    const regex = new RegExp(`${label}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, 's');
    return raw.match(regex)?.[1]?.trim() ?? '';
  };
  return {
    text: extract('TEXT'),
    hashtags: extract('HASHTAGS'),
    cta: extract('CTA'),
    imagePrompt: extract('IMAGE_PROMPT'),
  };
}

async function main() {
  console.log('🚀 Rewoz Content Generator');
  console.log('==========================\n');

  // Step 1: Generate content
  const rawContent = await generateContent();
  const content = parseContent(rawContent);

  // Step 2: Generate image
  let imageBuffer: Buffer | null = null;
  if (content.imagePrompt) {
    try {
      imageBuffer = await generateImage(content.imagePrompt);
    } catch (e: any) {
      console.log(`⚠️ Image generation failed: ${e.message}`);
    }
  }

  // Step 3: Save outputs
  const outDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Save content
  const contentFile = path.join(outDir, `rewoz-post-${timestamp}.txt`);
  fs.writeFileSync(contentFile, [
    `═══ REWOZ INSTAGRAM POST ═══`,
    `Generated: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Adelaide' })}`,
    ``,
    `── CAPTION ──`,
    content.text,
    ``,
    `── HASHTAGS ──`,
    content.hashtags,
    ``,
    `── CTA ──`,
    content.cta,
    ``,
    `── IMAGE PROMPT ──`,
    content.imagePrompt,
    ``,
    `═══ END ═══`,
  ].join('\n'));

  // Save image
  if (imageBuffer) {
    const imageFile = path.join(outDir, `rewoz-post-${timestamp}.png`);
    fs.writeFileSync(imageFile, imageBuffer);
    console.log(`\n📁 Image saved: ${imageFile}`);
  }

  console.log(`📁 Content saved: ${contentFile}`);

  // Print the post
  console.log('\n══════════════════════════════════════');
  console.log('  REWOZ INSTAGRAM POST — READY TO USE');
  console.log('══════════════════════════════════════\n');
  console.log('📝 CAPTION:');
  console.log(content.text);
  console.log('\n#️⃣ HASHTAGS:');
  console.log(content.hashtags);
  console.log('\n👉 CTA:');
  console.log(content.cta);
  if (imageBuffer) {
    console.log(`\n🖼️ IMAGE: Saved to output/ folder (${Math.round(imageBuffer.length / 1024)} KB)`);
  }
  console.log('\n══════════════════════════════════════');
}

main().catch(console.error);
