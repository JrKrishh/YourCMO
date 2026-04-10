/**
 * End-to-End CMO Persona Test — hits the real MiMo API to demonstrate
 * the CMO persona shaping LLM responses through both the agent brain
 * and the content generation engine.
 *
 * Run: npx tsx scripts/test-cmo-e2e.ts
 */
import 'dotenv/config';
import { buildDefaultCMOPersona } from '../src/config/rewoz-brand-dna';
import { MiMoAgentBrain } from '../src/core/mimo-agent-brain';
import { ContentGenerationEngine } from '../src/engines/content-generation/content-generation-engine';
import { ContentTone, Platform, TrendLifecyclePhase } from '../src/models/enums';
import { Trend } from '../src/models';
import { CostGuard } from '../src/utils/cost-guard';

function section(title: string) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'━'.repeat(60)}`);
}

const MIMO_KEY = process.env.MIMO_API_KEY;

async function testBrainWithPersona() {
  section('1. MiMo Brain — Trend Evaluation WITH CMO Persona');

  const persona = buildDefaultCMOPersona();
  const brain = new MiMoAgentBrain(undefined, undefined, persona);

  const trends = [
    { id: 'trend-1', topic: 'Cafe loyalty programs going digital', score: 0.85, platform: 'INSTAGRAM' },
    { id: 'trend-2', topic: 'UberEats commission complaints from small businesses', score: 0.72, platform: 'FACEBOOK' },
    { id: 'trend-3', topic: 'Melbourne coffee culture weekend events', score: 0.65, platform: 'INSTAGRAM' },
  ];

  console.log('Sending trends to MiMo with CMO persona...');
  const result = await brain.evaluateTrends(trends, 'Rewoz — digital loyalty for Australian cafes');

  console.log(`\nDecision: ${result.decision}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Reasoning: ${result.reasoning.substring(0, 500)}`);
  console.log(`Actions: ${JSON.stringify(result.actions, null, 2)}`);
  console.log(`Tokens used: ${result.tokensUsed}`);
  return true;
}

async function testBrainWithoutPersona() {
  section('2. MiMo Brain — Trend Evaluation WITHOUT Persona (baseline)');

  const brain = new MiMoAgentBrain(); // no persona

  const trends = [
    { id: 'trend-1', topic: 'Cafe loyalty programs going digital', score: 0.85, platform: 'INSTAGRAM' },
    { id: 'trend-2', topic: 'UberEats commission complaints from small businesses', score: 0.72, platform: 'FACEBOOK' },
  ];

  console.log('Sending trends to MiMo WITHOUT persona...');
  const result = await brain.evaluateTrends(trends, 'Rewoz — digital loyalty for Australian cafes');

  console.log(`\nDecision: ${result.decision}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Reasoning: ${result.reasoning.substring(0, 500)}`);
  console.log(`Tokens used: ${result.tokensUsed}`);
  return true;
}

async function testContentWithPersona() {
  section('3. Content Engine — Generate Post WITH CMO Persona');

  const persona = buildDefaultCMOPersona();
  const costGuard = new CostGuard();
  const engine = new ContentGenerationEngine({
    provider: 'mimo',
    model: 'mimo-v2-pro',
    maxTokens: 512,
  }, undefined, costGuard);

  const trend: Trend = {
    trendId: 'trend-001',
    platform: Platform.INSTAGRAM,
    topic: 'Independent cafes fighting back against delivery app commissions',
    hashtags: ['#supportlocal', '#cafes', '#nocommission', '#australia'],
    engagementScore: 0.82,
    velocity: 0.6,
    timestamp: new Date(),
    relatedContent: [],
    demographics: { ageGroups: {}, genderDistribution: {}, topLocations: ['Melbourne', 'Adelaide'] },
    predictedLifecycle: {
      currentPhase: TrendLifecyclePhase.GROWING,
      estimatedPeakDate: new Date(),
      estimatedEndDate: new Date(),
      confidence: 0.8,
    },
  };

  const brand = {
    name: 'Rewoz',
    voice: 'friendly, approachable, cafe-focused',
    guidelines: ['Target Australian cafe owners', 'Highlight $0 commission and 90-day free trial', 'Keep tone friendly and approachable'],
  };

  console.log('Generating content with CMO persona...');
  const suggestions = await engine.generateSuggestions(trend, brand, { count: 1, tones: [ContentTone.CASUAL] }, persona);

  if (suggestions.length > 0) {
    const s = suggestions[0];
    console.log(`\nText: ${s.text}`);
    console.log(`Caption: ${s.caption}`);
    console.log(`Hashtags: ${s.hashtags.join(' ')}`);
    console.log(`CTA: ${s.callToAction}`);
    console.log(`Tone: ${s.tone}`);
    console.log(`Engagement estimate: ${s.estimatedEngagement.toFixed(2)}`);
  } else {
    console.log('No suggestions generated (LLM may have returned unparseable content)');
  }
  return true;
}

async function main() {
  console.log('🚀 CMO Persona End-to-End Test (Real API Calls)');
  console.log('================================================\n');

  if (!MIMO_KEY) {
    console.log('❌ MIMO_API_KEY not set in .env — cannot run e2e test');
    process.exit(1);
  }
  console.log('✅ MiMo API key found');

  try {
    await testBrainWithPersona();
    await testBrainWithoutPersona();
    await testContentWithPersona();
    console.log('\n🎉 All end-to-end tests completed!');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  }
}

main();
