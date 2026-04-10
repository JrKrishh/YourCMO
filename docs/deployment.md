# Deployment Guide

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Agent Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `AGENT_FRAMEWORK_TYPE` | No | `OpenClaw` | Agent framework (`OpenClaw`, `LangChain`, `AutoGPT`) |
| `LLM_PROVIDER` | No | `OpenAI` | LLM provider (`OpenAI`, `Anthropic`, `Google`, `Cohere`) |
| `LOG_LEVEL` | No | `info` | Log level (`debug`, `info`, `warn`, `error`, `fatal`) |
| `PLATFORMS` | No | `INSTAGRAM,FACEBOOK` | Comma-separated target platforms |
| `BRAND_NAME` | No | `Default Brand` | Brand name for content generation |
| `BRAND_VOICE` | No | `professional` | Brand voice tone |

### LLM API Keys

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes* | OpenAI API key (required if LLM_PROVIDER=OpenAI) |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key (required if LLM_PROVIDER=Anthropic) |

### Social Media Platform Keys

| Variable | Required | Description |
|---|---|---|
| `INSTAGRAM_CLIENT_ID` | Yes | Instagram OAuth client ID |
| `INSTAGRAM_CLIENT_SECRET` | Yes | Instagram OAuth client secret |
| `FACEBOOK_APP_ID` | Yes | Facebook app ID |
| `FACEBOOK_APP_SECRET` | Yes | Facebook app secret |
| `TWITTER_API_KEY` | Yes | Twitter/X API key |
| `TWITTER_API_SECRET` | Yes | Twitter/X API secret |
| `TIKTOK_CLIENT_KEY` | Yes | TikTok client key |
| `TIKTOK_CLIENT_SECRET` | Yes | TikTok client secret |

### WhatsApp Business API

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Yes | WhatsApp Business account ID |
| `WHATSAPP_API_TOKEN` | Yes | WhatsApp API access token |

### Advertising Platforms

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_ADS_CLIENT_ID` | Yes | Google Ads OAuth client ID |
| `GOOGLE_ADS_CLIENT_SECRET` | Yes | Google Ads OAuth client secret |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Yes | Google Ads developer token |
| `INSTAGRAM_ADS_ACCESS_TOKEN` | Yes | Instagram Ads (Facebook Marketing API) token |

### Asset Generation

| Variable | Required | Description |
|---|---|---|
| `IMAGE_GENERATION_API_KEY` | Yes | Image generation service API key |
| `VIDEO_GENERATION_API_KEY` | Yes | Video generation service API key |

### Budget Defaults

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEFAULT_DAILY_BUDGET_LIMIT` | No | `100` | Daily budget limit (USD) |
| `DEFAULT_TOTAL_BUDGET_LIMIT` | No | `1000` | Total campaign budget limit (USD) |
| `BUDGET_CURRENCY` | No | `USD` | Budget currency code |

---

## Platform API Authentication Setup

### Instagram / Facebook

1. Create a Facebook Developer account at [developers.facebook.com](https://developers.facebook.com)
2. Create a new app and add the Instagram Graph API product
3. Configure OAuth redirect URIs for your deployment domain
4. Copy the App ID → `FACEBOOK_APP_ID`, App Secret → `FACEBOOK_APP_SECRET`
5. Generate an Instagram client → `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`
6. For Instagram Ads, generate a long-lived access token → `INSTAGRAM_ADS_ACCESS_TOKEN`

### Twitter/X

1. Apply for a Twitter Developer account at [developer.twitter.com](https://developer.twitter.com)
2. Create a project and app
3. Copy API Key → `TWITTER_API_KEY`, API Secret → `TWITTER_API_SECRET`

### TikTok

1. Register at [developers.tiktok.com](https://developers.tiktok.com)
2. Create an app and request the required scopes
3. Copy Client Key → `TIKTOK_CLIENT_KEY`, Client Secret → `TIKTOK_CLIENT_SECRET`

### WhatsApp Business

1. Set up a WhatsApp Business account via Facebook Business Manager
2. Create a WhatsApp Business API app
3. Copy Business Account ID → `WHATSAPP_BUSINESS_ACCOUNT_ID`
4. Generate a permanent token → `WHATSAPP_API_TOKEN`

### Google Ads

1. Create a Google Ads Manager account
2. Apply for a developer token at [developers.google.com/google-ads](https://developers.google.com/google-ads/api/docs/first-call/dev-token)
3. Create OAuth 2.0 credentials in Google Cloud Console
4. Copy Client ID → `GOOGLE_ADS_CLIENT_ID`, Client Secret → `GOOGLE_ADS_CLIENT_SECRET`
5. Copy Developer Token → `GOOGLE_ADS_DEVELOPER_TOKEN`

---

## Deployment

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Build

```bash
npm install
npm run build
```

The compiled output is in `dist/`.

### Run

```bash
# Production
node dist/index.js

# Development
npm run dev
```

### AWS (EC2 / ECS)

**EC2:**
```bash
# On the EC2 instance
git clone <repo-url> && cd social-media-marketing-agent
npm ci --production
npm run build
# Use PM2 or systemd to manage the process
npx pm2 start dist/index.js --name smma
```

**ECS (Fargate):**
1. Build and push the Docker image to ECR
2. Create a task definition referencing the image
3. Store secrets in AWS Secrets Manager and reference them as environment variables in the task definition
4. Create an ECS service with the desired replica count

### GCP (Cloud Run / GCE)

**Cloud Run:**
```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/smma
gcloud run deploy smma \
  --image gcr.io/PROJECT_ID/smma \
  --platform managed \
  --set-env-vars "LOG_LEVEL=info" \
  --set-secrets "OPENAI_API_KEY=openai-key:latest"
```

**GCE:**
Same as EC2 — provision a VM, clone, build, and run with a process manager.

### Azure (Container Apps / App Service)

**Container Apps:**
```bash
az containerapp create \
  --name smma \
  --resource-group mygroup \
  --image <acr-name>.azurecr.io/smma:latest \
  --env-vars "LOG_LEVEL=info" \
  --secrets "openai-key=<value>" \
  --secret-env-vars "OPENAI_API_KEY=secretref:openai-key"
```

---

## Troubleshooting

### Configuration validation failed

The app validates all environment variables on startup. Check the error message for the specific field:

```
Configuration validation failed: frameworkType: Unsupported framework: X
```

Fix: ensure `AGENT_FRAMEWORK_TYPE` is one of `OpenClaw`, `LangChain`, `AutoGPT`.

### API key errors

If platform API calls fail with 401/403:
- Verify the key is set in `.env` and not expired
- For OAuth tokens, check if the token needs refreshing
- For Google Ads, ensure the developer token is approved (not in test mode)

### Port already in use

The API server defaults to port 3000. Set a custom port via the `PORT` environment variable or stop the conflicting process.

### Docker build fails

- Ensure `package-lock.json` is committed (required for `npm ci`)
- Check Node.js version matches `engines` field in `package.json` (>=18)

### High memory usage

- Reduce `LOG_LEVEL` to `warn` or `error` in production
- If running in a container, set memory limits and monitor with `docker stats`

### Rate limiting from social media APIs

All platform clients implement retry logic with exponential backoff. If you see persistent rate limit errors:
- Reduce the number of concurrent campaigns
- Increase the `RATE_LIMIT_DELAY` between batch operations
- Check your API tier/quota on the platform's developer dashboard
