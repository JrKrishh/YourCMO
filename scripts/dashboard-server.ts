#!/usr/bin/env npx tsx
/**
 * YourCMO Dashboard Server — serves the dashboard + API endpoints.
 * All content generation uses the brand config from data/brand-config.json.
 * Run: npx tsx scripts/dashboard-server.ts
 * Open: http://localhost:3333
 */
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { watermarkImage } from '../src/engines/visual-asset/watermark';
import { ContentScheduler, ScheduledPost } from '../src/engines/content-scheduler/content-scheduler';
import { MarketingAutopilot } from '../src/engines/marketing-autopilot/autopilot';
import {
  loadBrandConfig, saveBrandConfig, isBrandSetupComplete,
  buildCaptionSystemPrompt, buildCaptionUserPrompt, buildImagePrompt,
  BrandConfig,
} from '../src/config/brand-setup';

const PORT = 3333;
const MIMO_KEY = process.env.MIMO_API_KEY!;
const MIMO_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const GOOGLE_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// Load brand config (user sets this up once via dashboard)
let brand = loadBrandConfig();

const MIME: Record<string, string> = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.mp4': 'video/mp4',
};

function serveStatic(res: http.ServerResponse, urlPath: string): boolean {
  let filePath = '';
  if (urlPath === '/' || urlPath === '/dashboard') {
    // Redirect to setup if brand not configured
    if (!brand.setupComplete) filePath = path.join('public', 'setup.html');
    else filePath = path.join('public', 'dashboard.html');
  }
  else if (urlPath === '/setup') filePath = path.join('public', 'setup.html');
  else if (urlPath.startsWith('/assets/')) filePath = urlPath.slice(1);
  else if (urlPath.startsWith('/public/')) filePath = urlPath.slice(1);
  else if (urlPath.startsWith('/output/')) filePath = urlPath.slice(1);
  else return false;
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) return false;
  const ext = path.extname(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(fullPath).pipe(res);
  return true;
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString());
}

function json(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// ── LLM Helper (Google AI Studio → OpenRouter → MiMo) ───────────

async function callLLM(system: string, user: string): Promise<string> {
  if (GOOGLE_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${GOOGLE_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
        }),
      });
      if (res.ok) {
        const d = await res.json() as any;
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.length > 20) return text;
      }
    } catch {}
  }
  if (OPENROUTER_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}`, 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'YourCMO Agent' },
        body: JSON.stringify({ model: 'openrouter/free', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 300, temperature: 0.7 }),
      });
      if (res.ok) {
        const d = await res.json() as any;
        const text = d.choices?.[0]?.message?.content;
        if (text && text.length > 20) return text;
      }
    } catch {}
  }
  if (MIMO_KEY) {
    const res = await fetch(`${MIMO_URL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
      body: JSON.stringify({ model: 'mimo-v2-pro', max_tokens: 300, temperature: 0.7, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const d = await res.json() as any;
    return d.choices?.[0]?.message?.content ?? '';
  }
  return '';
}

// ── Caption Generation (uses brand config) ───────────────────────

async function handleGenerateCaption(body: any): Promise<any> {
  const { city, trend } = body;
  const sys = buildCaptionSystemPrompt(brand);
  const user = buildCaptionUserPrompt(brand, city || brand.targetCities[0] || 'your city', trend);
  const raw = await callLLM(sys, user);
  const caption = raw.match(/CAPTION:\s*(.+?)(?=\n|HASHTAGS|$)/s)?.[1]?.trim() ?? '';
  const hashtags = raw.match(/HASHTAGS:\s*(.+?)(?=\n|CTA|$)/s)?.[1]?.trim() ?? '';
  const cta = raw.match(/CTA:\s*(.+?)$/s)?.[1]?.trim() ?? '';
  return { caption, hashtags, cta, raw };
}

// ── Visual Style Mixer ──────────────────────────────────────────

const VISUAL_STYLES = [
  { name: 'cinematic-photo', prompt: 'Cinematic photography, Canon EOS R5, 35mm f/1.4, shallow depth of field, golden hour lighting, film grain' },
  { name: 'cartoon-flat', prompt: 'Modern flat illustration style, bold outlines, vibrant flat colors, vector art, playful cartoon characters, clean design' },
  { name: '3d-render', prompt: '3D rendered scene, soft lighting, clay/plastic material, Pixar-style, rounded shapes, isometric view' },
  { name: 'watercolor', prompt: 'Watercolor painting style, soft washes, hand-painted feel, artistic brush strokes, warm palette' },
  { name: 'retro-vintage', prompt: 'Retro vintage poster style, 1970s color palette, bold typography layout, nostalgic feel' },
  { name: 'minimal-graphic', prompt: 'Minimalist graphic design, geometric shapes, bold color blocks, Swiss design inspired, clean whitespace' },
  { name: 'street-photo', prompt: 'Street photography style, candid moment, natural light, urban setting, authentic and raw' },
  { name: 'collage-mixed', prompt: 'Mixed media collage style, cut-out photos layered with illustrations, paper texture, scrapbook aesthetic' },
  { name: 'neon-pop', prompt: 'Neon pop art style, bright saturated colors, bold graphic elements, Andy Warhol meets modern social media' },
  { name: 'cozy-editorial', prompt: 'Editorial photography, overhead flat lay, styled props, warm tones, magazine quality' },
];

async function handleGenerateImage(body: any): Promise<any> {
  const { city, screen, caption, trend, style } = body;
  const targetCity = city || brand.targetCities[0] || 'your city';
  const captionText = caption || `${brand.brandName} for ${targetCity}`;
  const trendText = trend || '';

  // Pick visual style
  const visualStyle = style
    ? VISUAL_STYLES.find(s => s.name === style) || VISUAL_STYLES[Math.floor(Math.random() * VISUAL_STYLES.length)]
    : VISUAL_STYLES[Math.floor(Math.random() * VISUAL_STYLES.length)];

  const prompt = buildImagePrompt(brand, captionText, trendText, targetCity, visualStyle.name, visualStyle.prompt);

  let imgBuf: Buffer | null = null;

  // Screen reference → image+text generation
  if (screen) {
    const screenPath = path.join(process.cwd(), 'assets', 'figma-screens', screen);
    if (fs.existsSync(screenPath) && GOOGLE_KEY) {
      const screenB64 = fs.readFileSync(screenPath).toString('base64');
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GOOGLE_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: `${prompt}\n\nIncorporate this app screen naturally — show it on a phone in the scene.` },
            { inlineData: { mimeType: 'image/png', data: screenB64 } },
          ] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });
      if (res.ok) {
        const d = await res.json() as any;
        const img = d.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
        if (img?.inlineData) imgBuf = Buffer.from(img.inlineData.data, 'base64');
      }
    }
  }

  // Text-only image generation
  if (!imgBuf && GOOGLE_KEY) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GOOGLE_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    });
    if (res.ok) {
      const d = await res.json() as any;
      const img = d.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (img?.inlineData) imgBuf = Buffer.from(img.inlineData.data, 'base64');
    }
  }

  if (!imgBuf) return { error: 'Image generation failed' };

  imgBuf = await watermarkImage(imgBuf, { logoSize: 80, padding: 20 });

  const ts = Date.now();
  const outDir = path.join(process.cwd(), 'output', 'dashboard');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filename = `img-${ts}.png`;
  fs.writeFileSync(path.join(outDir, filename), imgBuf);

  return { url: `/output/dashboard/${filename}`, size: imgBuf.length, style: visualStyle.name };
}

async function handleListScreens(): Promise<any> {
  const dir = path.join(process.cwd(), 'assets', 'figma-screens');
  if (!fs.existsSync(dir)) return { screens: [] };
  const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
  return { screens: files.map(f => ({ file: f, url: `/assets/figma-screens/${f}` })) };
}

async function handleListOutput(): Promise<any> {
  const dir = path.join(process.cwd(), 'output', 'dashboard');
  if (!fs.existsSync(dir)) return { images: [] };
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().reverse().slice(0, 20);
  return { images: files.map(f => ({ file: f, url: `/output/dashboard/${f}` })) };
}

// ── Scheduler (uses brand config for auto-generation) ────────────

const scheduler = new ContentScheduler(async (post: ScheduledPost) => {
  const sys = buildCaptionSystemPrompt(brand);
  const user = buildCaptionUserPrompt(brand, post.city || brand.targetCities[0], post.trend);
  const raw = await callLLM(sys, user);
  post.caption = raw.match(/CAPTION:\s*(.+?)(?=\n|HASHTAGS|$)/s)?.[1]?.trim() ?? `${brand.brandName}: Check us out ☕`;
  post.hashtags = raw.match(/HASHTAGS:\s*(.+?)(?=\n|CTA|$)/s)?.[1]?.trim() ?? (brand.hashtagPrefix || `#${brand.brandName}`);
  post.cta = raw.match(/CTA:\s*(.+?)$/s)?.[1]?.trim() ?? (brand.website || '');
  return post;
});

scheduler.startAutoTrigger();

// ── Marketing Autopilot ─────────────────────────────────────────

const autopilot = new MarketingAutopilot({
  intervalMs: 60 * 60 * 1000,
  cities: brand.targetCities.length > 0 ? brand.targetCities : ['Your City'],
  mimoKey: MIMO_KEY,
  mimoUrl: MIMO_URL,
  googleKey: GOOGLE_KEY,
  callLLM,
  brand, // pass brand config to autopilot
});
if (brand.setupComplete) autopilot.start();

// ── Server ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }

  if (serveStatic(res, url.pathname)) return;

  try {
    // ── Brand Setup API ──────────────────────────────────────
    if (url.pathname === '/api/brand' && req.method === 'GET') {
      json(res, 200, { brand, setupComplete: brand.setupComplete });
    } else if (url.pathname === '/api/brand' && req.method === 'POST') {
      const body = await readBody(req);
      brand = saveBrandConfig(body);
      // Restart autopilot with new brand config
      autopilot.stop();
      autopilot.updateConfig({
        cities: brand.targetCities.length > 0 ? brand.targetCities : ['Your City'],
        brand,
      });
      autopilot.start();
      json(res, 200, { ok: true, brand, message: 'Brand setup saved' });

    // ── Content APIs ─────────────────────────────────────────
    } else if (url.pathname === '/api/generate-caption' && req.method === 'POST') {
      json(res, 200, await handleGenerateCaption(await readBody(req)));
    } else if (url.pathname === '/api/generate-image' && req.method === 'POST') {
      json(res, 200, await handleGenerateImage(await readBody(req)));
    } else if (url.pathname === '/api/screens' && req.method === 'GET') {
      json(res, 200, await handleListScreens());
    } else if (url.pathname === '/api/output' && req.method === 'GET') {
      json(res, 200, await handleListOutput());
    } else if (url.pathname === '/api/status' && req.method === 'GET') {
      json(res, 200, { status: 'online', brandSetup: brand.setupComplete, brandName: brand.brandName, mimo: !!MIMO_KEY, google: !!GOOGLE_KEY, fal: !!FAL_KEY });

    // ── Schedule APIs ────────────────────────────────────────
    } else if (url.pathname === '/api/schedule' && req.method === 'GET') {
      json(res, 200, { posts: scheduler.getAll(), stats: scheduler.getStats() });
    } else if (url.pathname === '/api/schedule' && req.method === 'POST') {
      json(res, 201, scheduler.schedule(await readBody(req)));
    } else if (url.pathname.startsWith('/api/schedule/') && req.method === 'DELETE') {
      json(res, 200, { deleted: scheduler.delete(url.pathname.split('/').pop()!) });
    } else if (url.pathname.startsWith('/api/schedule/') && req.method === 'PUT') {
      const id = url.pathname.split('/')[3];
      const updated = scheduler.update(id, await readBody(req));
      json(res, updated ? 200 : 404, updated || { error: 'Not found' });

    // ── Suggestion APIs ──────────────────────────────────────
    } else if (url.pathname === '/api/suggestions' && req.method === 'GET') {
      json(res, 200, { suggestions: autopilot.getNew(), stats: autopilot.getStats() });
    } else if (url.pathname === '/api/suggestions/all' && req.method === 'GET') {
      json(res, 200, { suggestions: autopilot.getAll(), stats: autopilot.getStats() });
    } else if (url.pathname.match(/\/api\/suggestions\/[^/]+\/approve$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      const s = autopilot.approve(id);
      if (s) scheduler.schedule({ city: s.city, platform: s.platform as any, trend: s.trend, caption: s.caption, hashtags: s.hashtags, cta: s.cta, scheduledAt: s.bestTime });
      json(res, s ? 200 : 404, s || { error: 'Not found' });
    } else if (url.pathname.match(/\/api\/suggestions\/[^/]+\/dismiss$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      json(res, 200, autopilot.dismiss(id) || { error: 'Not found' });
    } else {
      json(res, 404, { error: 'Not found' });
    }
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
});

const name = brand.brandName || 'YourCMO';
server.listen(PORT, () => {
  console.log(`\n🚀 ${name} Dashboard running at http://localhost:${PORT}`);
  console.log(`   📊 Dashboard: http://localhost:${PORT}/`);
  console.log(`   🔧 Brand Setup: ${brand.setupComplete ? '✅ Complete' : '⚠️  Not configured — open dashboard to set up'}`);
  console.log(`   🤖 Google AI: ${GOOGLE_KEY ? '✅' : '❌'}  MiMo: ${MIMO_KEY ? '✅' : '❌'}  fal.ai: ${FAL_KEY ? '✅' : '❌'}\n`);
});
