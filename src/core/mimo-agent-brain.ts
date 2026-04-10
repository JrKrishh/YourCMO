/**
 * MiMo V2 Pro Agent Brain — powers the OpenClaw framework's
 * autonomous decision-making using Xiaomi's MiMo-V2-Pro model.
 *
 * MiMo V2 Pro is specifically designed for agentic workflows:
 * - 1T+ total params, 42B active, 1M token context
 * - Multi-step reasoning and tool execution
 * - Ranked #1 in its price tier on agent benchmarks
 *
 * Uses the OpenAI-compatible API at platform.xiaomimimo.com.
 *
 * This brain handles:
 * 1. Campaign strategy decisions (which trends to pursue)
 * 2. Content quality evaluation (is this post good enough?)
 * 3. Budget allocation reasoning (where to spend ad dollars)
 * 4. Performance adaptation (what to change when metrics dip)
 */

import { createLogger } from '../utils/logger';
import { getEnv, getEnvOrDefault } from '../utils/env';
import { CMOPersona } from '../models/agent-config';

const log = createLogger('MiMoAgentBrain');

/** MiMo V2 Pro API configuration */
export interface MiMoBrainConfig {
  /** API base URL (default: platform.xiaomimimo.com) */
  baseUrl: string;
  /** Model identifier */
  model: string;
  /** Max tokens for responses */
  maxTokens: number;
  /** Temperature for reasoning (lower = more deterministic) */
  temperature: number;
}

const DEFAULT_CONFIG: MiMoBrainConfig = {
  baseUrl: 'https://api.xiaomimimo.com/v1',
  model: 'mimo-v2-pro',
  maxTokens: 1024,
  temperature: 0.3, // low temp for consistent agent reasoning
};

/** A reasoning request to the agent brain */
export interface ReasoningRequest {
  task: string;
  context: Record<string, unknown>;
  constraints?: string[];
}

/** A structured reasoning response */
export interface ReasoningResponse {
  decision: string;
  reasoning: string;
  confidence: number;
  actions: AgentAction[];
  tokensUsed: number;
}

/** An action the agent brain recommends */
export interface AgentAction {
  type: 'select_trend' | 'approve_content' | 'allocate_budget' | 'adjust_strategy' | 'skip' | 'pause';
  target: string;
  parameters: Record<string, unknown>;
  priority: number;
}

/** Abstraction for the MiMo API client (for testing) */
export interface IMiMoClient {
  chat(messages: Array<{ role: string; content: string }>, config: MiMoBrainConfig): Promise<{ text: string; tokensUsed: number }>;
}

/**
 * Default MiMo V2 Pro API client.
 * Uses the OpenAI-compatible chat/completions endpoint.
 */
export class MiMoApiClient implements IMiMoClient {
  async chat(
    messages: Array<{ role: string; content: string }>,
    config: MiMoBrainConfig,
  ): Promise<{ text: string; tokensUsed: number }> {
    const apiKey = getEnv('MIMO_API_KEY', true);
    const tokenPlan = getEnv('MIMO_TOKEN_PLAN');
    const baseUrl = getEnvOrDefault('MIMO_BASE_URL', config.baseUrl);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    // Attach token plan ID if available (prepaid token plan auth)
    if (tokenPlan) {
      headers['X-Token-Plan'] = tokenPlan;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`MiMo API error: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { total_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content ?? '',
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  }
}

/**
 * MiMo Agent Brain — the reasoning engine powering the OpenClaw framework.
 *
 * Provides structured decision-making for:
 * - Trend evaluation and selection
 * - Content quality assessment
 * - Budget allocation reasoning
 * - Strategy adaptation based on performance data
 */
export class MiMoAgentBrain {
  private readonly config: MiMoBrainConfig;
  private readonly client: IMiMoClient;
  private totalTokensUsed = 0;
  private cmoPersona?: CMOPersona;

  constructor(config?: Partial<MiMoBrainConfig>, client?: IMiMoClient, cmoPersona?: CMOPersona) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = client ?? new MiMoApiClient();
    this.cmoPersona = cmoPersona;
  }

  /**
   * Evaluate which trends are worth pursuing for a campaign.
   * Returns a ranked list of trend IDs with reasoning.
   */
  async evaluateTrends(trends: Array<{ id: string; topic: string; score: number; platform: string }>, brandContext: string): Promise<ReasoningResponse> {
    const baseConstraints = [
      'Select trends that align with the brand voice',
      'Prioritize trends with high engagement potential',
      'Avoid controversial or off-brand topics',
      'Consider cross-platform synergy',
    ];

    const constraints = this.cmoPersona
      ? [
          ...baseConstraints,
          ...this.cmoPersona.strategicPriorities,
          'Consider strategic brand alignment and long-term audience building',
        ]
      : baseConstraints;

    const context: Record<string, unknown> = { trends, brandContext };
    if (this.cmoPersona) {
      context.competitiveContext = this.cmoPersona.competitiveContext;
    }

    const request: ReasoningRequest = {
      task: 'evaluate_trends',
      context,
      constraints,
    };
    return this.reason(request);
  }

  /**
   * Assess whether generated content meets quality standards.
   * Returns approve/reject with reasoning.
   */
  async assessContent(content: { text: string; hashtags: string[]; tone: string }, brandGuidelines: string[]): Promise<ReasoningResponse> {
    const baseConstraints = [
      'Content must align with brand voice',
      'Hashtags must be relevant and not spammy',
      'Call-to-action must be clear',
      'No offensive or controversial language',
    ];

    const constraints = this.cmoPersona
      ? [
          ...baseConstraints,
          "Evaluate whether content reflects the CMO's strategic voice and positioning",
        ]
      : baseConstraints;

    const request: ReasoningRequest = {
      task: 'assess_content',
      context: { content, brandGuidelines },
      constraints,
    };
    return this.reason(request);
  }

  /**
   * Decide how to allocate budget across campaigns and platforms.
   */
  async allocateBudget(campaigns: Array<{ id: string; roi: number; spend: number; platform: string }>, totalBudget: number): Promise<ReasoningResponse> {
    const baseConstraints = [
      'Maximize ROI across all campaigns',
      'Never exceed total budget',
      'Minimum $5 per active campaign',
      'Shift budget from underperforming to overperforming campaigns',
    ];

    const constraints = this.cmoPersona
      ? [
          ...baseConstraints,
          'Reason about customer acquisition cost',
          'Consider lifetime value',
          'Evaluate channel efficiency',
        ]
      : baseConstraints;

    const request: ReasoningRequest = {
      task: 'allocate_budget',
      context: { campaigns, totalBudget },
      constraints,
    };
    return this.reason(request);
  }

  /**
   * Analyze performance data and recommend strategy changes.
   */
  async adaptStrategy(metrics: Record<string, unknown>, currentStrategy: Record<string, unknown>): Promise<ReasoningResponse> {
    const baseConstraints = [
      'Only recommend changes backed by data',
      'Avoid drastic changes — prefer incremental adjustments',
      'Consider platform-specific best practices',
      'Factor in time-of-day and day-of-week patterns',
    ];

    const constraints = this.cmoPersona
      ? [
          ...baseConstraints,
          ...this.cmoPersona.decisionPrinciples,
        ]
      : baseConstraints;

    const context: Record<string, unknown> = { metrics, currentStrategy };
    if (this.cmoPersona) {
      context.competitiveContext = this.cmoPersona.competitiveContext;
    }

    const request: ReasoningRequest = {
      task: 'adapt_strategy',
      context,
      constraints,
    };
    return this.reason(request);
  }

  /**
   * Core reasoning method — sends a structured request to MiMo V2 Pro
   * and parses the response into actions.
   */
  async reason(request: ReasoningRequest): Promise<ReasoningResponse> {
    log.info({ task: request.task }, 'MiMo brain reasoning');

    const systemPrompt = this.cmoPersona
      ? this.buildPersonaSystemPrompt(request)
      : this.buildDefaultSystemPrompt(request);

    const userMessage = JSON.stringify(request.context);

    try {
      const result = await this.client.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        this.config,
      );

      this.totalTokensUsed += result.tokensUsed;

      return this.parseResponse(result.text, result.tokensUsed);
    } catch (err) {
      log.error({ task: request.task, err }, 'MiMo brain reasoning failed');
      // Return a safe fallback — don't crash the pipeline
      return {
        decision: 'fallback',
        reasoning: `MiMo reasoning failed: ${err instanceof Error ? err.message : String(err)}`,
        confidence: 0,
        actions: [],
        tokensUsed: 0,
      };
    }
  }

  /**
   * Build the default (hardcoded) system prompt — used when no CMO persona is set.
   * Preserves the original behaviour for backward compatibility.
   */
  private buildDefaultSystemPrompt(request: ReasoningRequest): string {
    return [
      'You are the autonomous marketing brain for a brand,',
      'helping grow their business through digital marketing.',
      'You create content, analyse trends, and optimize campaigns.',
      'You act as the brand\'s Chief Marketing Officer.',
      'Target audience: independent cafe owners in Australia (Adelaide, Melbourne, Sydney, Brisbane).',
      '',
      'You make strategic decisions about social media campaigns, content, and budget allocation.',
      'Always respond in valid JSON with this structure:',
      '{"decision": "brief summary", "reasoning": "detailed explanation",',
      ' "confidence": 0.0-1.0, "actions": [{"type": "action_type", "target": "id",',
      ' "parameters": {}, "priority": 1-10}]}',
      '',
      `Task: ${request.task}`,
      request.constraints ? `Constraints: ${request.constraints.join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * Build a persona-driven system prompt from the CMO persona fields.
   * Merges persona.decisionPrinciples with request.constraints for the constraints section.
   */
  private buildPersonaSystemPrompt(request: ReasoningRequest): string {
    const persona = this.cmoPersona!;

    const priorities = persona.strategicPriorities
      .map((p) => `- ${p}`)
      .join('\n');

    const principles = persona.decisionPrinciples
      .map((p) => `- ${p}`)
      .join('\n');

    const mergedConstraints = [
      ...persona.decisionPrinciples,
      ...(request.constraints ?? []),
    ].join('; ');

    return [
      `You are the ${persona.role}.`,
      '',
      'STRATEGIC PRIORITIES:',
      priorities,
      '',
      'BRAND POSITIONING:',
      persona.brandPositioning,
      '',
      'COMPETITIVE CONTEXT:',
      persona.competitiveContext,
      '',
      'DECISION PRINCIPLES (apply to every decision):',
      principles,
      '',
      'You make strategic decisions about social media campaigns, content, and budget allocation.',
      'When evaluating trends, consider strategic brand alignment and long-term audience building, not only engagement scores.',
      'When allocating budget, reason about customer acquisition cost, lifetime value, and channel efficiency.',
      "When assessing content, evaluate whether it reflects the CMO's strategic voice and positioning.",
      '',
      'Always respond in valid JSON with this structure:',
      '{"decision": "...", "reasoning": "...", "confidence": 0.0-1.0, "actions": [...]}',
      '',
      `Task: ${request.task}`,
      `Constraints: ${mergedConstraints}`,
    ].join('\n');
  }

  /** Parse MiMo's JSON response into a structured ReasoningResponse */
  private parseResponse(text: string, tokensUsed: number): ReasoningResponse {
    try {
      // Extract JSON from the response (MiMo may wrap it in markdown)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.fallbackResponse(text, tokensUsed);
      }

      const parsed = JSON.parse(jsonMatch[0]) as Partial<ReasoningResponse>;
      return {
        decision: parsed.decision ?? 'unknown',
        reasoning: parsed.reasoning ?? text,
        confidence: Math.min(Math.max(parsed.confidence ?? 0.5, 0), 1),
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        tokensUsed,
      };
    } catch {
      return this.fallbackResponse(text, tokensUsed);
    }
  }

  private fallbackResponse(text: string, tokensUsed: number): ReasoningResponse {
    return {
      decision: 'parsed_as_text',
      reasoning: text,
      confidence: 0.5,
      actions: [],
      tokensUsed,
    };
  }

  /** Total tokens consumed by this brain instance */
  get totalTokens(): number {
    return this.totalTokensUsed;
  }

  /** Estimated cost based on MiMo V2 Pro pricing ($1/1M input, $3/1M output) */
  get estimatedCost(): number {
    // Rough estimate: assume 60% input, 40% output
    const inputTokens = this.totalTokensUsed * 0.6;
    const outputTokens = this.totalTokensUsed * 0.4;
    return (inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 3.0;
  }
}
