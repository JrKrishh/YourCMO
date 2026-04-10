import { describe, it, expect, vi } from 'vitest';
import { MiMoAgentBrain, IMiMoClient, MiMoBrainConfig } from './mimo-agent-brain';

function mockClient(response?: string): IMiMoClient {
  return {
    chat: vi.fn().mockResolvedValue({
      text: response ?? JSON.stringify({
        decision: 'pursue_trend',
        reasoning: 'High engagement potential with brand alignment',
        confidence: 0.85,
        actions: [
          { type: 'select_trend', target: 'trend-1', parameters: { score: 0.9 }, priority: 1 },
        ],
      }),
      tokensUsed: 500,
    }),
  };
}

describe('MiMoAgentBrain', () => {
  it('evaluates trends and returns structured response', async () => {
    const brain = new MiMoAgentBrain({}, mockClient());
    const result = await brain.evaluateTrends(
      [{ id: 'trend-1', topic: 'AI marketing', score: 0.8, platform: 'INSTAGRAM' }],
      'Tech brand, professional voice',
    );

    expect(result.decision).toBe('pursue_trend');
    expect(result.confidence).toBe(0.85);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('select_trend');
    expect(result.tokensUsed).toBe(500);
  });

  it('assesses content quality', async () => {
    const client = mockClient(JSON.stringify({
      decision: 'approve',
      reasoning: 'Content aligns with brand voice',
      confidence: 0.92,
      actions: [{ type: 'approve_content', target: 'content-1', parameters: {}, priority: 1 }],
    }));
    const brain = new MiMoAgentBrain({}, client);

    const result = await brain.assessContent(
      { text: 'Check out our new product!', hashtags: ['#tech'], tone: 'professional' },
      ['Avoid slang', 'Keep it professional'],
    );

    expect(result.decision).toBe('approve');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('allocates budget across campaigns', async () => {
    const client = mockClient(JSON.stringify({
      decision: 'reallocate',
      reasoning: 'Shift budget to high-ROI campaign',
      confidence: 0.78,
      actions: [
        { type: 'allocate_budget', target: 'camp-1', parameters: { amount: 300 }, priority: 1 },
        { type: 'allocate_budget', target: 'camp-2', parameters: { amount: 200 }, priority: 2 },
      ],
    }));
    const brain = new MiMoAgentBrain({}, client);

    const result = await brain.allocateBudget(
      [
        { id: 'camp-1', roi: 3.0, spend: 100, platform: 'INSTAGRAM' },
        { id: 'camp-2', roi: 1.5, spend: 100, platform: 'FACEBOOK' },
      ],
      500,
    );

    expect(result.actions).toHaveLength(2);
    expect(result.decision).toBe('reallocate');
  });

  it('adapts strategy based on metrics', async () => {
    const client = mockClient(JSON.stringify({
      decision: 'adjust_timing',
      reasoning: 'Engagement peaks at 6pm, shift posting schedule',
      confidence: 0.7,
      actions: [{ type: 'adjust_strategy', target: 'timing', parameters: { peakHour: 18 }, priority: 1 }],
    }));
    const brain = new MiMoAgentBrain({}, client);

    const result = await brain.adaptStrategy(
      { engagementRate: 0.03, reach: 5000 },
      { postingTime: '10:00' },
    );

    expect(result.decision).toBe('adjust_timing');
    expect(result.actions[0].type).toBe('adjust_strategy');
  });

  it('handles API failure gracefully with fallback response', async () => {
    const client: IMiMoClient = {
      chat: vi.fn().mockRejectedValue(new Error('API timeout')),
    };
    const brain = new MiMoAgentBrain({}, client);

    const result = await brain.reason({ task: 'test', context: {} });

    expect(result.decision).toBe('fallback');
    expect(result.confidence).toBe(0);
    expect(result.actions).toHaveLength(0);
    expect(result.reasoning).toContain('API timeout');
  });

  it('handles non-JSON response gracefully', async () => {
    const brain = new MiMoAgentBrain({}, mockClient('This is just plain text, not JSON'));
    const result = await brain.reason({ task: 'test', context: {} });

    expect(result.decision).toBe('parsed_as_text');
    expect(result.reasoning).toContain('plain text');
    expect(result.confidence).toBe(0.5);
  });

  it('handles JSON wrapped in markdown code blocks', async () => {
    const wrapped = '```json\n{"decision":"ok","reasoning":"works","confidence":0.9,"actions":[]}\n```';
    const brain = new MiMoAgentBrain({}, mockClient(wrapped));
    const result = await brain.reason({ task: 'test', context: {} });

    expect(result.decision).toBe('ok');
    expect(result.confidence).toBe(0.9);
  });

  it('tracks total tokens used', async () => {
    const brain = new MiMoAgentBrain({}, mockClient());
    await brain.reason({ task: 'test1', context: {} });
    await brain.reason({ task: 'test2', context: {} });

    expect(brain.totalTokens).toBe(1000);
  });

  it('estimates cost based on MiMo V2 Pro pricing', async () => {
    const brain = new MiMoAgentBrain({}, mockClient());
    await brain.reason({ task: 'test', context: {} });

    // 500 tokens: ~300 input ($1/1M) + ~200 output ($3/1M)
    expect(brain.estimatedCost).toBeGreaterThan(0);
    expect(brain.estimatedCost).toBeLessThan(0.01); // very cheap for 500 tokens
  });

  it('clamps confidence to [0, 1]', async () => {
    const client = mockClient(JSON.stringify({
      decision: 'test',
      reasoning: 'test',
      confidence: 1.5,
      actions: [],
    }));
    const brain = new MiMoAgentBrain({}, client);
    const result = await brain.reason({ task: 'test', context: {} });

    expect(result.confidence).toBe(1);
  });

  it('passes correct config to the API client', async () => {
    const client = mockClient();
    const config: Partial<MiMoBrainConfig> = {
      baseUrl: 'https://custom.api.com/v1',
      model: 'MiMo-V2-Pro-Custom',
      maxTokens: 2048,
      temperature: 0.1,
    };
    const brain = new MiMoAgentBrain(config, client);
    await brain.reason({ task: 'test', context: {} });

    expect(client.chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        baseUrl: 'https://custom.api.com/v1',
        model: 'MiMo-V2-Pro-Custom',
        maxTokens: 2048,
        temperature: 0.1,
      }),
    );
  });
});


// Feature: cmo-agent-persona, Property 1: System prompt includes all persona fields for every task type
import * as fc from 'fast-check';
import { CMOPersona } from '../models/agent-config';

/**
 * Arbitrary that generates valid CMOPersona objects with non-empty strings
 * and at least one entry in each array field.
 */
const cmoPersonaArb: fc.Arbitrary<CMOPersona> = fc.record({
  role: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  strategicPriorities: fc
    .array(fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0), { minLength: 1, maxLength: 5 }),
  decisionPrinciples: fc
    .array(fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0), { minLength: 1, maxLength: 5 }),
  competitiveContext: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  brandPositioning: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
});

describe('Property 1: System prompt includes all persona fields for every task type', () => {
  /**
   * Helper: creates a mock client that captures the messages passed to chat().
   * Returns the captured messages array and the mock client.
   */
  function capturingMockClient(): { captured: Array<{ role: string; content: string }>[], client: IMiMoClient } {
    const captured: Array<{ role: string; content: string }>[] = [];
    const client: IMiMoClient = {
      chat: vi.fn().mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
        captured.push(messages);
        return {
          text: JSON.stringify({
            decision: 'test',
            reasoning: 'test',
            confidence: 0.5,
            actions: [],
          }),
          tokensUsed: 10,
        };
      }),
    };
    return { captured, client };
  }

  /**
   * Calls the appropriate brain method for the given task type and returns
   * the system prompt string captured by the mock client.
   */
  async function getSystemPromptForTask(
    taskType: string,
    persona: CMOPersona,
    client: IMiMoClient,
    captured: Array<{ role: string; content: string }>[],
  ): Promise<string> {
    const brain = new MiMoAgentBrain({}, client, persona);

    switch (taskType) {
      case 'evaluate_trends':
        await brain.evaluateTrends(
          [{ id: 't1', topic: 'test', score: 0.5, platform: 'INSTAGRAM' }],
          'test brand context',
        );
        break;
      case 'assess_content':
        await brain.assessContent(
          { text: 'test content', hashtags: ['#test'], tone: 'neutral' },
          ['guideline1'],
        );
        break;
      case 'allocate_budget':
        await brain.allocateBudget(
          [{ id: 'c1', roi: 2.0, spend: 100, platform: 'INSTAGRAM' }],
          500,
        );
        break;
      case 'adapt_strategy':
        await brain.adaptStrategy(
          { engagementRate: 0.05 },
          { postingTime: '10:00' },
        );
        break;
    }

    const lastCall = captured[captured.length - 1];
    const systemMessage = lastCall.find((m) => m.role === 'system');
    return systemMessage?.content ?? '';
  }

  const taskTypes = ['evaluate_trends', 'assess_content', 'allocate_budget', 'adapt_strategy'] as const;

  it('system prompt contains all persona fields for every task type', async () => {
    await fc.assert(
      fc.asyncProperty(cmoPersonaArb, async (persona) => {
        for (const taskType of taskTypes) {
          const { captured, client } = capturingMockClient();
          const systemPrompt = await getSystemPromptForTask(taskType, persona, client, captured);

          // role
          expect(systemPrompt).toContain(persona.role);

          // every strategic priority
          for (const priority of persona.strategicPriorities) {
            expect(systemPrompt).toContain(priority);
          }

          // every decision principle
          for (const principle of persona.decisionPrinciples) {
            expect(systemPrompt).toContain(principle);
          }

          // competitive context
          expect(systemPrompt).toContain(persona.competitiveContext);

          // brand positioning
          expect(systemPrompt).toContain(persona.brandPositioning);
        }
      }),
      { numRuns: 100 },
    );
  });
  // **Validates: Requirements 2.1, 2.3, 5.1, 5.2, 5.3, 6.1**
});


describe('MiMoAgentBrain backward compatibility and persona prompt tests', () => {
  // Requirements: 1.3, 2.4, 2.5, 6.3

  /**
   * Creates a mock client that captures the messages array passed to chat(),
   * so we can inspect the system prompt.
   */
  function capturingClient(): { captured: Array<{ role: string; content: string }>[]; client: IMiMoClient } {
    const captured: Array<{ role: string; content: string }>[] = [];
    const client: IMiMoClient = {
      chat: vi.fn().mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
        captured.push(messages);
        return {
          text: JSON.stringify({ decision: 'ok', reasoning: 'ok', confidence: 0.5, actions: [] }),
          tokensUsed: 10,
        };
      }),
    };
    return { captured, client };
  }

  const testPersona: CMOPersona = {
    role: 'Chief Marketing Officer',
    strategicPriorities: ['Grow cafe sign-ups', 'Increase trial conversion'],
    decisionPrinciples: ['Prioritise organic growth', 'Lead with pain-point storytelling'],
    competitiveContext: 'Competes against delivery apps charging 30%+ commission',
    brandPositioning: 'Affordable zero-commission digital loyalty platform for Australian cafes',
  };

  it('uses hardcoded system prompt when no persona is provided (backward compatible)', async () => {
    const { captured, client } = capturingClient();
    const brain = new MiMoAgentBrain({}, client);

    await brain.reason({ task: 'test_task', context: {} });

    const systemPrompt = captured[0].find((m) => m.role === 'system')!.content;
    expect(systemPrompt).toContain('autonomous marketing brain');
  });

  it('evaluateTrends prompt contains "strategic brand alignment" and "long-term audience building" when persona is set', async () => {
    const { captured, client } = capturingClient();
    const brain = new MiMoAgentBrain({}, client, testPersona);

    await brain.evaluateTrends(
      [{ id: 't1', topic: 'latte art', score: 0.7, platform: 'INSTAGRAM' }],
      'Brand context',
    );

    const systemPrompt = captured[0].find((m) => m.role === 'system')!.content;
    expect(systemPrompt).toContain('strategic brand alignment');
    expect(systemPrompt).toContain('long-term audience building');
  });

  it('allocateBudget prompt contains "customer acquisition cost", "lifetime value", "channel efficiency" when persona is set', async () => {
    const { captured, client } = capturingClient();
    const brain = new MiMoAgentBrain({}, client, testPersona);

    await brain.allocateBudget(
      [{ id: 'c1', roi: 2.5, spend: 100, platform: 'INSTAGRAM' }],
      500,
    );

    const systemPrompt = captured[0].find((m) => m.role === 'system')!.content;
    expect(systemPrompt).toContain('customer acquisition cost');
    expect(systemPrompt).toContain('lifetime value');
    expect(systemPrompt).toContain('channel efficiency');
  });

  it('assessContent prompt contains "CMO\'s strategic voice and positioning" when persona is set', async () => {
    const { captured, client } = capturingClient();
    const brain = new MiMoAgentBrain({}, client, testPersona);

    await brain.assessContent(
      { text: 'Try our product today!', hashtags: ['#cafe'], tone: 'friendly' },
      ['Keep it casual'],
    );

    const systemPrompt = captured[0].find((m) => m.role === 'system')!.content;
    expect(systemPrompt).toContain("CMO's strategic voice and positioning");
  });
});
