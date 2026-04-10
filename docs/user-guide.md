# Rewoz Marketing Agent — User Guide

## Getting Started

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Google AI Studio API Key** (free) — [Get one here](https://aistudio.google.com/apikey)

### Installation

```bash
# Clone the repo
git clone https://github.com/your-org/rewoz-marketing-agent.git
cd rewoz-marketing-agent

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Setting Up API Keys

Open `.env` in any text editor and add your Google AI Studio key:

```env
GOOGLE_AI_STUDIO_API_KEY=your_key_here
```

That's the only required key. The agent uses Google AI Studio for both text (Gemma 4 31B) and image generation (Gemini).

**Optional keys for extra features:**

| Key | What For | Where to Get |
|-----|----------|-------------|
| `MIMO_API_KEY` | MiMo V2 Pro agent brain (fallback LLM) | xiaomimimo.com |
| `OPENROUTER_API_KEY` | Free LLM fallback | openrouter.ai |
| `FAL_KEY` | Video generation (Seedance 2.0) | fal.ai ($10 free) |
| `FIGMA_ACCESS_TOKEN` | Extract frames from Figma API | figma.com/developers |

### Starting the Dashboard

```bash
npx tsx scripts/dashboard-server.ts
```

You'll see:
```
🚀 Rewoz Dashboard Server running at http://localhost:3333
   📊 Dashboard: http://localhost:3333/
   🤖 MiMo: ✅  Google AI: ✅  fal.ai: ✅
```

Open **http://localhost:3333** in your browser.

---

## Daily Workflow

### Morning Routine (5 min)

1. Start the dashboard: `npx tsx scripts/dashboard-server.ts`
2. Go to **Suggestions** tab
3. Review overnight suggestions from the autopilot
4. **Approve** the best ones (auto-schedules them)
5. **Copy All** on any you want to post right now
6. Paste into Instagram/Facebook

### Creating Content On-Demand

1. Go to **Generate** tab
2. Pick your target city (Adelaide, Melbourne, Sydney, Brisbane)
3. Pick a trend to ride
4. Choose a visual style:
   - **Random** — best for keeping your feed diverse
   - Pick a specific style if you have a theme in mind
5. Optionally select an app screen to include in the image
6. Click **Generate Image + Caption**
7. Wait ~10-15 seconds
8. Copy the caption, download the image
9. Post to Instagram/Facebook

### Scheduling Posts

1. Go to **Calendar** tab
2. Set the date and time
3. Pick city and platform
4. Optionally pick a trend
5. Leave caption empty — the agent auto-generates it at the scheduled time
6. Click **Schedule Post**
7. The calendar shows colored dots for each post status:
   - 🟠 Orange = Scheduled
   - 🟡 Yellow = Generating
   - 🔵 Blue = Ready
   - 🟢 Green = Published
   - 🔴 Red = Failed

---

## Understanding the Autopilot

The Marketing Autopilot runs every hour in the background. Here's what it does:

1. **Trend Research** — Uses Gemma 4 31B to research current Instagram trends for Australian cafe content
2. **Pattern Matching** — Checks day of week, time of day, and seasonal patterns
3. **Content Generation** — Creates city-specific captions with trending hashtags and reel audio suggestions
4. **Confidence Scoring** — Each suggestion gets a confidence score (0-100%) based on trend relevance
5. **Optimal Timing** — Suggests the best posting time for each city based on audience data

### Suggestion Actions

| Button | What It Does |
|--------|-------------|
| ✅ Approve | Accepts the suggestion and auto-schedules it in the calendar |
| 📋 Copy All | Copies caption + hashtags + CTA to clipboard for manual posting |
| ✕ Dismiss | Removes the suggestion (won't show again) |

---

## Visual Styles Explained

The agent uses 10 different visual styles to keep your Instagram feed looking diverse and professional. Here's when to use each:

| Style | Best For |
|-------|----------|
| 📸 **Cinematic Photo** | Hero posts, product launches, premium feel |
| 🎨 **Cartoon Flat** | Fun announcements, feature highlights, younger audience |
| 🧊 **3D Render** | Tech-forward posts, app features, modern feel |
| 🖌️ **Watercolor** | Seasonal content, artistic cafes, weekend vibes |
| 🏄 **Retro Aussie** | Local pride, community posts, nostalgia |
| ◻️ **Minimal Graphic** | Stats, facts, clean professional content |
| 📷 **Street Photo** | Authentic moments, behind-the-scenes, real cafe life |
| ✂️ **Mixed Media** | Creative posts, collabs, event announcements |
| 💜 **Neon Pop** | Promotions, sales, attention-grabbing offers |
| ☕ **Cozy Editorial** | Food photography, menu items, cafe atmosphere |

**Pro tip:** Leave it on "Random" most of the time. A mixed feed performs better on Instagram than a uniform look.

---

## Using App Screens in Content

The agent can include real Rewoz app screenshots in generated marketing images. This is great for showing the app in action.

### Available Screens

The `assets/figma-screens/` folder contains 11 screens:

| Screen | Shows |
|--------|-------|
| onboard1-5 | Onboarding flow (splash, welcome, paperless, boost, discounts) |
| Home | Main home screen |
| home1-4 | Home screen variants |
| business | Business dashboard |

### Adding New Screens

1. Export screens from Figma as PNG (1x or 2x)
2. Drop them into `assets/figma-screens/`
3. They'll automatically appear in the Generate page dropdown
4. Restart the dashboard server if it's running

---

## API Reference

The dashboard server exposes REST APIs you can call from scripts or other tools.

### Generate Caption

```bash
curl -X POST http://localhost:3333/api/generate-caption \
  -H "Content-Type: application/json" \
  -d '{"city": "Adelaide", "trend": "Titanium x Please Me"}'
```

Response:
```json
{
  "caption": "Ditch the paper. Keep the regulars. Adelaide cafes see 2x more repeat visits with Rewoz ☕",
  "hashtags": "#Rewoz #AdelaideCafe #CafeLoyalty #CafeOwner ...",
  "cta": "Start free → rewoz.com.au"
}
```

### Generate Image

```bash
curl -X POST http://localhost:3333/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{"city": "Melbourne", "caption": "Your caption here", "trend": "Cafe loyalty", "style": "cartoon-flat"}'
```

Response:
```json
{
  "url": "/output/dashboard/img-1712345678.png",
  "size": 245000,
  "style": "cartoon-flat"
}
```

### Schedule a Post

```bash
curl -X POST http://localhost:3333/api/schedule \
  -H "Content-Type: application/json" \
  -d '{"city": "Sydney", "platform": "instagram", "scheduledAt": "2026-04-10T08:00:00Z"}'
```

### Check Status

```bash
curl http://localhost:3333/api/status
```

---

## Running Scripts Directly

Beyond the dashboard, you can run individual scripts:

```bash
# Full pipeline: trends → captions → images
npx tsx scripts/trend-to-content.ts

# Generate images only
npx tsx scripts/generate-images.ts

# Load Figma screens into frame store
npx tsx scripts/load-figma-screens.ts

# Capture Figma prototype screenshots
npx tsx scripts/capture-figma-proto.ts
```

---

## Troubleshooting

### "Image generation failed"
- Check that `GOOGLE_AI_STUDIO_API_KEY` is set in `.env`
- Google AI Studio has a 500 images/day free limit
- Try again — sometimes the model declines certain prompts

### "Autopilot not generating suggestions"
- The first analysis runs 5 seconds after server start
- Check the Suggestions page — it shows autopilot status
- Ensure at least one LLM key is configured

### "Dashboard won't load"
- Make sure port 3333 is free: `npx tsx scripts/dashboard-server.ts`
- Check the terminal for error messages
- Try `http://localhost:3333` (not https)

### "Copy button doesn't work"
- Clipboard API requires HTTPS or localhost
- Make sure you're accessing via `http://localhost:3333`, not an IP address

---

## Docker Deployment

```bash
# Build
docker build -t rewoz-agent .

# Run
docker run -d \
  -p 3333:3333 \
  --env-file .env \
  --name rewoz-agent \
  rewoz-agent

# View logs
docker logs -f rewoz-agent
```

Or with Docker Compose:

```bash
docker-compose up -d
```

---

## Cost Breakdown

| Service | Cost | Usage |
|---------|------|-------|
| Google AI Studio (Gemma 4 + Gemini) | **Free** | 500 images/day, unlimited text |
| OpenRouter free tier | **Free** | Rate-limited fallback |
| fal.ai (Seedance 2.0 video) | **$10 free credits** | ~$0.05/video |
| MiMo V2 Pro | Varies | Optional fallback |

**Total cost to run: $0/month** with just Google AI Studio.
