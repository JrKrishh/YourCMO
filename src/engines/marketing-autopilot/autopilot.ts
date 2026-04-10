/**
 * Marketing Autopilot — runs 24/7 in the background.
 * 
 * Every hour it:
 * 1. Analyses current trends for the brand's domain
 * 2. Identifies optimal posting times for each target city
 * 3. Generates content suggestions using the LLM chain
 * 4. Stores suggestions for user review in the dashboard
 * 
 * All content is driven by the brand config — no hardcoded brand references.
 */
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger';
import {
  BrandConfig, buildCaptionSystemPrompt, buildCaptionUserPrompt,
  buildTrendResearchPrompt, buildTrendSystemPrompt,
} from '../../config/brand-setup';

const log = createLogger('MarketingAutopilot');

export type SuggestionStatus = 'new' | 'approved' | 'dismissed' | 'scheduled';

export interface ContentSuggestion {
  id: string;
  city: string;
  platform: string;
  trend: string;
  reason: string;
  caption: string;
  hashtags: string;
  cta: string;
  reelAudio?: string;
  trendingTags?: string[];
  visualStyle?: string;
  bestTime: string;
  confidence: number;
  status: SuggestionStatus;
  createdAt: string;
}

export interface AutopilotConfig {
  intervalMs: number;
  cities: string[];
  mimoKey: string;
  mimoUrl: string;
  googleKey?: string;
  callLLM?: (system: string, user: string) => Promise<string>;
  brand?: BrandConfig;
}

const STORE_PATH = path.join(process.cwd(), 'data', 'suggestions.json');

// Default posting times (can be overridden per city)
const DEFAULT_BEST_TIMES = ['07:00', '12:00', '17:30'];

// Generic content patterns (work for any brand)
const PATTERNS = [
  { trigger: 'monday', idea: 'Monday motivation — start the week strong with your product' },
  { trigger: 'wednesday', idea: 'Midweek value — show why customers choose you' },
  { trigger: 'friday', idea: 'Friday feature — highlight a key benefit for the weekend' },
  { trigger: 'morning', idea: 'Morning routine — show your product in daily life' },
  { trigger: 'weekend', idea: 'Weekend vibes — relaxed lifestyle content featuring your brand' },
  { trigger: 'holiday', idea: 'Seasonal special — tie your product to the current season' },
  { trigger: 'newmonth', idea: 'New month fresh start — reset and re-engage your audience' },
];

const VISUAL_STYLES = [
  'cinematic-photo', 'cartoon-flat', '3d-render', 'watercolor',
  'retro-vintage', 'minimal-graphic', 'street-photo', 'collage-mixed',
  'neon-pop', 'cozy-editorial',
];

export class MarketingAutopilot {
  private suggestions: ContentSuggestion[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: AutopilotConfig;
  private lastRunAt: string | null = null;

  constructor(config: AutopilotConfig) {
    this.config = config;
    this.load();
  }

  private get brand(): BrandConfig | undefined { return this.config.brand; }

  private load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        this.suggestions = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      }
    } catch { this.suggestions = []; }
  }

  private save() {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(this.suggestions, null, 2));
  }

  start() {
    if (this.timer) return;
    log.info({ intervalMs: this.config.intervalMs }, 'Marketing Autopilot started');
    this.timer = setInterval(() => this.analyse(), this.config.intervalMs);
    setTimeout(() => this.analyse(), 5000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  updateConfig(partial: Partial<AutopilotConfig>) {
    Object.assign(this.config, partial);
  }

  getAll(): ContentSuggestion[] {
    return [...this.suggestions].sort((a, b) => b.confidence - a.confidence);
  }

  getNew(): ContentSuggestion[] {
    return this.suggestions.filter(s => s.status === 'new').sort((a, b) => b.confidence - a.confidence);
  }

  updateStatus(id: string, status: SuggestionStatus): ContentSuggestion | undefined {
    const s = this.suggestions.find(x => x.id === id);
    if (s) { s.status = status; this.save(); }
    return s;
  }

  dismiss(id: string) { return this.updateStatus(id, 'dismissed'); }
  approve(id: string) { return this.updateStatus(id, 'approved'); }

  getStats() {
    return {
      total: this.suggestions.length,
      new: this.suggestions.filter(s => s.status === 'new').length,
      approved: this.suggestions.filter(s => s.status === 'approved').length,
      dismissed: this.suggestions.filter(s => s.status === 'dismissed').length,
      lastRunAt: this.lastRunAt,
    };
  }

  /** Core analysis loop */
  private async analyse() {
    if (!this.brand?.setupComplete) {
      log.info('Brand setup not complete, skipping analysis');
      return;
    }

    log.info('Running marketing analysis...');
    this.lastRunAt = new Date().toISOString();

    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-AU', { weekday: 'long' }).toLowerCase();
    const hour = now.getHours();
    const dayOfMonth = now.getDate();
    const isWeekend = dayOfWeek === 'saturday' || dayOfWeek === 'sunday';
    const isMorning = hour >= 5 && hour <= 9;
    const isNewMonth = dayOfMonth <= 3;

    // Step 1: Live trend research using brand's domain
    let liveTrends = { trend: '', reelAudio: '', tags: [] as string[], angle: '' };
    const llm = this.config.callLLM;
    if (llm && this.brand) {
      try {
        const trendRaw = await llm(
          buildTrendSystemPrompt(this.brand),
          buildTrendResearchPrompt(this.brand),
        );
        liveTrends.trend = trendRaw.match(/TREND:\s*(.+?)(?=\n|REEL|$)/s)?.[1]?.trim() ?? '';
        liveTrends.reelAudio = trendRaw.match(/REEL_AUDIO:\s*(.+?)(?=\n|TAGS|$)/s)?.[1]?.trim() ?? '';
        const tagsRaw = trendRaw.match(/TAGS:\s*(.+?)(?=\n|ANGLE|$)/s)?.[1]?.trim() ?? '';
        liveTrends.tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0);
        liveTrends.angle = trendRaw.match(/ANGLE:\s*(.+?)$/s)?.[1]?.trim() ?? '';
        if (liveTrends.trend) log.info({ trend: liveTrends.trend, reelAudio: liveTrends.reelAudio }, 'Live trend research complete');
      } catch (err: any) {
        log.warn({ error: err.message }, 'Live trend research failed');
      }
    }

    const trendAngle = liveTrends.trend
      ? { trend: liveTrends.trend, angle: liveTrends.angle, weight: 0.9 }
      : { trend: `${this.brand.targetDomain} trending content`, angle: 'Evergreen brand content', weight: 0.6 };

    // Pick relevant day patterns
    const relevantPatterns = PATTERNS.filter(p => {
      if (p.trigger === dayOfWeek) return true;
      if (p.trigger === 'morning' && isMorning) return true;
      if (p.trigger === 'weekend' && isWeekend) return true;
      if (p.trigger === 'newmonth' && isNewMonth) return true;
      return false;
    });

    // Step 2: Generate suggestions for each target city
    for (const city of this.config.cities) {
      const todayStr = now.toISOString().split('T')[0];
      const existingToday = this.suggestions.find(s =>
        s.city === city && s.status === 'new' && s.createdAt.startsWith(todayStr)
      );
      if (existingToday) continue;

      const pattern = relevantPatterns[0] || { idea: `Showcase ${this.brand.brandName} benefits`, trigger: 'general' };
      const bestTime = DEFAULT_BEST_TIMES[Math.floor(Math.random() * DEFAULT_BEST_TIMES.length)];

      try {
        const caption = await this.generateWithLLM(city, pattern.idea, trendAngle.trend, liveTrends.reelAudio);

        const suggestion: ContentSuggestion = {
          id: uuidv4(),
          city,
          platform: this.brand.targetPlatforms?.[0] || 'instagram',
          trend: trendAngle.trend,
          reason: `${pattern.idea}. Riding "${trendAngle.trend}" trend. ${trendAngle.angle ? `Angle: ${trendAngle.angle}` : ''}`,
          caption: caption.caption,
          hashtags: caption.hashtags,
          cta: caption.cta,
          reelAudio: liveTrends.reelAudio || undefined,
          trendingTags: liveTrends.tags.length > 0 ? liveTrends.tags : undefined,
          visualStyle: VISUAL_STYLES[Math.floor(Math.random() * VISUAL_STYLES.length)],
          bestTime: `${todayStr}T${bestTime}:00`,
          confidence: trendAngle.weight * (relevantPatterns.length > 0 ? 1.0 : 0.7),
          status: 'new',
          createdAt: now.toISOString(),
        };

        this.suggestions.push(suggestion);
        log.info({ city, trend: trendAngle.trend, confidence: suggestion.confidence.toFixed(2) }, 'New suggestion generated');
      } catch (err: any) {
        log.warn({ city, error: err.message }, 'Failed to generate suggestion');
      }
    }

    // Prune old dismissed
    const dismissed = this.suggestions.filter(s => s.status === 'dismissed');
    if (dismissed.length > 50) {
      const toRemove = dismissed.slice(0, dismissed.length - 50);
      this.suggestions = this.suggestions.filter(s => !toRemove.includes(s));
    }

    this.save();
    log.info({ newSuggestions: this.getNew().length, total: this.suggestions.length }, 'Analysis complete');
  }

  private async generateWithLLM(city: string, idea: string, trend: string, reelAudio?: string): Promise<{ caption: string; hashtags: string; cta: string }> {
    if (!this.brand) return { caption: '', hashtags: '', cta: '' };

    const llm = this.config.callLLM;
    const sys = buildCaptionSystemPrompt(this.brand);
    const prompt = `Instagram post for ${this.brand.brandName} targeting ${this.brand.targetUsers} in ${city}. Idea: ${idea}. Trend: "${trend}".${reelAudio ? ` Suggested reel audio: "${reelAudio}".` : ''}
CAPTION: <100-150 chars with 1 stat or benefit, engaging hook, emoji>
HASHTAGS: ${this.brand.hashtagPrefix || '#' + this.brand.brandName} <8 more trending + local hashtags>
CTA: <short compelling CTA>`;

    let raw = '';
    if (llm) {
      try { raw = await llm(sys, prompt); } catch {}
    }
    if ((!raw || raw.length < 30) && this.config.mimoKey) {
      const res = await fetch(`${this.config.mimoUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.mimoKey}` },
        body: JSON.stringify({ model: 'mimo-v2-pro', max_tokens: 300, temperature: 0.8, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }] }),
      });
      const d = await res.json() as any;
      raw = d.choices?.[0]?.message?.content ?? '';
    }

    const brandTag = this.brand.hashtagPrefix || `#${this.brand.brandName}`;
    return {
      caption: raw.match(/CAPTION:\s*(.+?)(?=\n|HASHTAGS|$)/s)?.[1]?.trim() ?? `${this.brand.brandName} — ${this.brand.tagline} ✨`,
      hashtags: raw.match(/HASHTAGS:\s*(.+?)(?=\n|CTA|$)/s)?.[1]?.trim() ?? brandTag,
      cta: raw.match(/CTA:\s*(.+?)$/s)?.[1]?.trim() ?? (this.brand.website || 'Learn more'),
    };
  }
}
