# YourCMO — AI Marketing Agent 🚀

Your personal AI Chief Marketing Officer. Set up your brand once, and the agent analyses trends, generates content (captions + images), schedules posts, and manages campaigns — all from a single dashboard.

Works for any product, any industry, any country.

## Features

- **Brand Setup** — Configure your brand DNA once: name, logo, colors, product details, target audience, regions, voice
- **24/7 Marketing Autopilot** — Hourly trend analysis on Instagram/social media for your target regions using Gemma 4 31B
- **AI Content Generation** — Captions via LLM chain (Google AI Studio → OpenRouter → MiMo), images via Google Gemini
- **10 Visual Styles** — Cinematic photo, cartoon, 3D render, watercolor, retro vintage, minimal graphic, street photo, collage, neon pop, editorial
- **Content Calendar** — Schedule posts with auto-generation triggers at optimal times
- **Smart Image Prompts** — Images generated from actual caption content, not generic stock photos
- **App Screen Integration** — Use real app screenshots as reference images in marketing content
- **Brand Watermark** — Auto-applies your logo to all generated assets
- **Copy & Post** — One-click copy for manual posting (no API keys needed)
- **REST API** — Full API for all features

## Quick Start

```bash
git clone https://github.com/JrKrishh/YourCMO.git
cd YourCMO
npm install
cp .env.example .env
```

Add your Google AI Studio key (free) to `.env`:

```env
GOOGLE_AI_STUDIO_API_KEY=your_key_here
```

Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

Start the dashboard:

```bash
npx tsx scripts/dashboard-server.ts
```

Open **http://localhost:3333** — you'll be guided through brand setup.

## How It Works

```
1. Set up your brand (name, product, audience, regions)
       ↓
2. Autopilot analyses trends hourly for your target regions
       ↓
3. Generates city-specific suggestions with confidence scores
       ↓
4. You approve → auto-schedules in calendar
       ↓
5. At scheduled time → auto-generates caption + image
       ↓
6. Copy content → post to Instagram/Facebook/TikTok
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 18+ / TypeScript |
| Primary LLM | Gemma 4 31B (Google AI Studio, free) |
| Fallback LLMs | OpenRouter free → MiMo V2 Pro |
| Image Gen | Google Gemini |
| Video Gen | Seedance 2.0 (fal.ai) |
| Image Processing | Sharp |
| Dashboard | Single-page HTML + vanilla JS |
| Server | Node.js HTTP (zero framework deps) |
| Tests | Vitest |

## Dashboard Pages

| Page | What It Does |
|------|-------------|
| ⚙️ Brand Setup | Configure your brand DNA — identity, product, audience, voice |
| 📊 Overview | Stats, app screens, status |
| 📱 App Screens | Upload screenshots for use in content generation |
| 💡 Suggestions | AI autopilot suggestions — approve, copy, or dismiss |
| ✨ Generate | On-demand content — pick city, trend, visual style |
| 📅 Calendar | Visual calendar, schedule posts, auto-generation |

## Visual Styles

| Style | Vibe |
|-------|------|
| 📸 Cinematic Photo | Canon EOS R5, golden hour, shallow DOF |
| 🎨 Cartoon Flat | Bold outlines, vibrant flat colors |
| 🧊 3D Render | Pixar-style, soft lighting |
| 🖌️ Watercolor | Hand-painted, artistic |
| 🏄 Retro Vintage | 1970s poster style |
| ◻️ Minimal Graphic | Swiss design, geometric |
| 📷 Street Photo | Candid, natural light |
| ✂️ Mixed Media | Collage, scrapbook |
| 💜 Neon Pop | Saturated, bold |
| ☕ Cozy Editorial | Flat lay, magazine quality |

## API Keys

| Key | Required | Cost |
|-----|----------|------|
| `GOOGLE_AI_STUDIO_API_KEY` | Yes | Free |
| `OPENROUTER_API_KEY` | No | Free |
| `MIMO_API_KEY` | No | Varies |
| `FAL_KEY` | No | $10 free |

**Total cost: $0/month** with just Google AI Studio.

## API Endpoints

```
POST /api/generate-caption    — Generate caption
POST /api/generate-image      — Generate image with style
GET  /api/brand               — Get brand config
POST /api/brand               — Save brand config
GET  /api/screens             — List app screens
GET  /api/output              — List generated images
GET  /api/status              — Server status
GET  /api/schedule            — Scheduled posts
POST /api/schedule            — Schedule a post
GET  /api/suggestions         — Autopilot suggestions
POST /api/suggestions/:id/approve
POST /api/suggestions/:id/dismiss
```

## Docker

```bash
docker build -t yourcmo .
docker run -p 3333:3333 --env-file .env yourcmo
```

## Docs

- [User Guide](docs/user-guide.md) — Detailed how-to
- [Deployment](docs/deployment.md) — Production deployment

## License

MIT
