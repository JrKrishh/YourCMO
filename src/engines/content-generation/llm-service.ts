import { createLogger } from '../../utils/logger';
import { getEnv, getEnvOrDefault } from '../../utils/env';
import type { CostGuard } from '../../utils/cost-guard';

const log = createLogger('LLMService');

/** Supported LLM providers — OpenRouter is the primary gateway */
export type LLMProvider = 'openrouter' | 'mimo' | 'openai' | 'anthropic';

/** Configuration for the LLM service */
export interface LLMServiceConfig {
  provider: LLMProvider;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** A single message in a prompt conversation */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Response from the LLM */
export interface LLMResponse {
  text: string;
  tokensUsed: number;
  model: string;
}

/** Token usage tracking */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

/** Abstraction for LLM API clients */
export interface ILLMClient {
  generate(messages: PromptMessage[], config: LLMServiceConfig): Promise<LLMResponse>;
}

/**
 * Prompt template system — builds structured prompts from named templates
 * with variable interpolation.
 */
export class PromptTemplate {
  constructor(
    private readonly template: string,
    private readonly variables: string[],
  ) {}

  render(values: Record<string, string>): string {
    let result = this.template;
    for (const variable of this.variables) {
      const value = values[variable] ?? '';
      result = result.replaceAll(`{{${variable}}}`, value);
    }
    return result;
  }
}

/** Pre-built prompt templates for content generation */
export const PROMPT_TEMPLATES = {
  contentGeneration: new PromptTemplate(
    [
      'You are a social media marketing expert.',
      'Brand: {{brandName}} — Voice: {{brandVoice}}',
      'Brand guidelines: {{brandGuidelines}}',
      '',
      'Trending topic: {{trendTopic}}',
      'Trending hashtags: {{trendHashtags}}',
      'Engagement score: {{engagementScore}}',
      '',
      'Generate a social media post that:',
      '1. Aligns with the brand voice and guidelines',
      '2. Leverages the trending topic naturally',
      '3. Includes a compelling call-to-action',
      '4. Suggests relevant hashtags (include trending ones where appropriate)',
      '',
      'Respond in this exact format:',
      'TEXT: <main post text>',
      'CAPTION: <caption/subtitle>',
      'HASHTAGS: <comma-separated hashtags with # prefix>',
      'CTA: <call to action>',
      'TONE: {{tone}}',
    ].join('\n'),
    ['brandName', 'brandVoice', 'brandGuidelines', 'trendTopic', 'trendHashtags', 'engagementScore', 'tone'],
  ),

  variationGeneration: new PromptTemplate(
    [
      'You are a social media marketing expert.',
      'Create a variation of the following post with a different angle but same message.',
      '',
      'Original post: {{originalText}}',
      'Brand voice: {{brandVoice}}',
      'Target tone: {{tone}}',
      '',
      'Respond in this exact format:',
      'TEXT: <main post text>',
      'CAPTION: <caption/subtitle>',
      'HASHTAGS: <comma-separated hashtags with # prefix>',
      'CTA: <call to action>',
      'TONE: {{tone}}',
    ].join('\n'),
    ['originalText', 'brandVoice', 'tone'],
  ),
};

/**
 * Cost per 1K tokens by provider/model.
 * Free models on OpenRouter have $0 cost.
 */
const TOKEN_COSTS: Record<string, { input: number; output: number }> = {
  // OpenRouter free models — $0 cost
  'openrouter:qwen/qwen3.6-plus:free': { input: 0, output: 0 },
  'openrouter:stepfun/step-3.5-flash:free': { input: 0, output: 0 },
  // OpenRouter paid models (fallbacks)
  'openrouter:qwen/qwen3.6-plus': { input: 0.00014, output: 0.00068 },
  'openrouter:google/gemini-2.5-flash-image': { input: 0.00015, output: 0.0006 },
  // Xiaomi MiMo V2 — token plan pricing ($1/$3 per 1M tokens for Pro)
  'mimo:mimo-v2-pro': { input: 0.001, output: 0.003 },
  'mimo:mimo-v2-flash': { input: 0.0001, output: 0.0003 },
  // Legacy direct-provider models
  'openai:gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'openai:gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'openai:gpt-4': { input: 0.03, output: 0.06 },
  'anthropic:claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'anthropic:claude-3-sonnet': { input: 0.003, output: 0.015 },
};

/**
 * Recommended cost-efficient models per provider.
 * OpenRouter free models are the default — $0 per call.
 */
export const COST_EFFICIENT_MODELS: Record<string, string> = {
  openrouter: 'qwen/qwen3.6-plus:free',
  mimo: 'mimo-v2-pro',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-haiku',
};

/** Fallback model if the primary free model is rate-limited */
export const OPENROUTER_FALLBACK_MODEL = 'stepfun/step-3.5-flash:free';

/**
 * Estimates token count from text using a simple heuristic
 * (~4 characters per token for English text).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculates estimated cost for a given token usage.
 */
export function estimateCost(provider: LLMProvider, model: string, usage: { promptTokens: number; completionTokens: number }): number {
  const key = `${provider}:${model}`;
  const costs = TOKEN_COSTS[key];
  if (!costs) return 0;
  return (usage.promptTokens / 1000) * costs.input + (usage.completionTokens / 1000) * costs.output;
}

/**
 * OpenRouter LLM client — routes through OpenRouter's unified API
 * to access free models like Qwen3 and StepFun.
 *
 * Uses the OpenAI-compatible /api/v1/chat/completions endpoint.
 */
export class OpenRouterClient implements ILLMClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://openrouter.ai/api/v1';
  }

  async generate(messages: PromptMessage[], config: LLMServiceConfig): Promise<LLMResponse> {
    const apiKey = getEnv('OPENROUTER_API_KEY', true);
    const model = config.model ?? COST_EFFICIENT_MODELS.openrouter;

    log.info({ model }, 'Calling OpenRouter');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': getEnvOrDefault('APP_URL', 'http://localhost:3000'),
        'X-Title': 'Social Media Marketing Agent',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: config.maxTokens ?? 512,
        temperature: config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      // If rate-limited on free model, try fallback
      if (response.status === 429 && model.endsWith(':free')) {
        log.warn({ model }, 'Free model rate-limited, trying fallback');
        return this.generate(messages, { ...config, model: OPENROUTER_FALLBACK_MODEL });
      }
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model?: string;
    };

    return {
      text: data.choices[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens ?? 0,
      model: data.model ?? model,
    };
  }
}

/**
 * Default LLM client — supports OpenRouter (primary), MiMo, OpenAI, and Anthropic.
 */
export class DefaultLLMClient implements ILLMClient {
  private readonly openRouterClient = new OpenRouterClient();

  async generate(messages: PromptMessage[], config: LLMServiceConfig): Promise<LLMResponse> {
    const provider = config.provider;
    const model = config.model ?? COST_EFFICIENT_MODELS[provider] ?? COST_EFFICIENT_MODELS.openrouter;

    log.info({ provider, model }, 'Generating LLM response');

    if (provider === 'openrouter') {
      return this.openRouterClient.generate(messages, { ...config, model });
    } else if (provider === 'mimo') {
      return this.callMiMo(messages, model, config);
    } else if (provider === 'openai') {
      return this.callOpenAI(messages, model, config);
    } else if (provider === 'anthropic') {
      return this.callAnthropic(messages, model, config);
    }
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  private async callMiMo(messages: PromptMessage[], model: string, config: LLMServiceConfig): Promise<LLMResponse> {
    const apiKey = getEnv('MIMO_API_KEY', true);
    const baseUrl = getEnvOrDefault('MIMO_BASE_URL', 'https://api.xiaomimimo.com/v1');
    const tokenPlan = getEnvOrDefault('MIMO_TOKEN_PLAN', '');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (tokenPlan) {
      headers['X-Token-Plan'] = tokenPlan;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: config.maxTokens ?? 512,
        temperature: config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`MiMo API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model?: string;
    };

    return {
      text: data.choices[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens ?? 0,
      model: data.model ?? model,
    };
  }

  private async callOpenAI(messages: PromptMessage[], model: string, config: LLMServiceConfig): Promise<LLMResponse> {
    const apiKey = getEnv('OPENAI_API_KEY', true);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: config.maxTokens ?? 512,
        temperature: config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens ?? 0,
      model,
    };
  }

  private async callAnthropic(messages: PromptMessage[], model: string, config: LLMServiceConfig): Promise<LLMResponse> {
    const apiKey = getEnv('ANTHROPIC_API_KEY', true);
    const systemMessage = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessages = messages.filter((m) => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: config.maxTokens ?? 512,
        system: systemMessage,
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content: { text: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };

    const totalTokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

    return {
      text: data.content[0]?.text ?? '',
      tokensUsed: totalTokens,
      model,
    };
  }
}

/**
 * LLM Service — high-level abstraction over LLM providers with
 * prompt management, token counting, and cost tracking.
 * Integrates with CostGuard for spending limits and response caching.
 *
 * Default: OpenRouter with free Qwen3/StepFun models ($0 cost).
 */
export class LLMService {
  private totalTokensUsed = 0;
  private totalCost = 0;
  private readonly config: LLMServiceConfig;
  private readonly costGuard?: CostGuard;

  constructor(
    config: LLMServiceConfig,
    private readonly client: ILLMClient = new DefaultLLMClient(),
    costGuard?: CostGuard,
  ) {
    this.config = { ...config };
  }

  async generate(messages: PromptMessage[]): Promise<LLMResponse> {
    const promptTokens = messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
    const estimatedCompletionTokens = this.config.maxTokens ?? 512;
    const model = this.config.model ?? COST_EFFICIENT_MODELS[this.config.provider] ?? COST_EFFICIENT_MODELS.openrouter;

    // Estimate cost before calling
    const estimatedCost = estimateCost(
      this.config.provider,
      model,
      { promptTokens, completionTokens: estimatedCompletionTokens },
    );

    // Check cost guard before making the call
    if (this.costGuard) {
      const cacheKey = `llm:${model}:${messages.map(m => m.content).join('|')}`;
      const cached = this.costGuard.getCached<LLMResponse>(cacheKey);
      if (cached) {
        log.info('LLM response served from cache — $0 cost');
        return cached;
      }

      const check = this.costGuard.canSpend('llm', estimatedCost);
      if (!check.allowed) {
        throw new Error(`LLM call blocked by cost guard: ${check.reason}`);
      }
    }

    log.debug({ promptTokens, estimatedCost: estimatedCost.toFixed(6) }, 'Estimated LLM call cost');

    const response = await this.client.generate(messages, this.config);

    const actualCost = estimateCost(
      this.config.provider,
      response.model,
      { promptTokens, completionTokens: response.tokensUsed - promptTokens },
    );
    this.totalTokensUsed += response.tokensUsed;
    this.totalCost += actualCost;

    // Record cost and cache response
    if (this.costGuard) {
      this.costGuard.recordCost('llm', actualCost, `${response.model}: ${response.tokensUsed} tokens`);
      const cacheKey = `llm:${model}:${messages.map(m => m.content).join('|')}`;
      this.costGuard.setCache(cacheKey, response);
    }

    log.info({ tokensUsed: response.tokensUsed, cost: actualCost.toFixed(6) }, 'LLM generation complete');
    return response;
  }

  getUsage(): TokenUsage {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: this.totalTokensUsed,
      estimatedCost: this.totalCost,
    };
  }
}
