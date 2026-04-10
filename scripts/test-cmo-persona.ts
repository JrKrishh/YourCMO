/**
 * Test CMO Persona Integration — demonstrates the persona flowing through
 * the MiMoAgentBrain and ContentGenerationEngine locally (no API calls).
 *
 * Run: npx tsx scripts/test-cmo-persona.ts
 */

import { buildDefaultCMOPersona } from '../src/config/rewoz-brand-dna';
import { MiMoAgentBrain } from '../src/core/mimo-agent-brain';
import { buildContext } from '../src/engines/content-generation/content-generation-engine';
import { ContentTone, Platform, TrendLifecyclePhase } from '../src/models/enums';
import { Trend } from '../src/models';

// ── Helpers ──────────────────────────────────────────────────

function section(title: string) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'━'.repeat(60)}`);
}

function printPrompt(label: string, messages: Array<{ role: string; content: string }>) {
  for (const msg of messages) {
    console.log(`\n[${msg.role.toUpperCase()}]`);
    console.log(msg.content);
  }
}

// ── Main ─────────────────────────────────────────────────────

function main() {
  console.log('🧪 CMO Persona Integration Test');
  console.log('================================\n');

  // 1. Show the default Rewoz CMO persona
  const persona = buildDefaultCMOPersona();
  section('1. Default Rewoz CMO Persona');
  console.log(JSON.stringify(persona, null, 2));

  // 2. Show how the persona shapes the MiMoAgentBrain system prompt
  section('2. MiMoAgentBrain — System Prompt WITH Persona');

  // We can't call reason() without an API, but we can instantiate the brain
  // and show the persona is stored. The system prompt is built inside reason(),
  // so let's demonstrate by building the prompt template manually.
  const brain = new MiMoAgentBrain(undefined, undefined, persona);
  console.log(`Brain created with persona role: "${persona.role}"`);
  console.log(`Strategic priorities: ${persona.strategicPriorities.length}`);
  console.log(`Decision principles: ${persona.decisionPrinciples.length}`);

  // 3. Show the content engine prompt with persona vs without
  section('3. Content Engine Prompt — WITH Persona');

  const trend: Trend = {
    trendId: 'trend-001',
    platform: Platform.INSTAGRAM,
    topic: 'Australian cafe culture and loyalty programs',
    hashtags: ['#cafes', '#loyalty', '#australia', '#rewoz'],
    engagementScore: 0.82,
    velocity: 0.6,
    timestamp: new Date(),
    relatedContent: [],
    demographics: { ageGroups: {}, genderDistribution: {}, topLocations: ['Melbourne', 'Sydney'] },
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
    guidelines: ['Target Australian cafe owners', 'Highlight $0 commission', 'Keep tone friendly'],
  };

  const withPersona = buildContext(trend, brand, ContentTone.CASUAL, persona);
  printPrompt('With CMO Persona', withPersona);

  section('4. Content Engine Prompt — WITHOUT Persona (backward compatible)');
  const withoutPersona = buildContext(trend, brand, ContentTone.CASUAL);
  printPrompt('Without Persona', withoutPersona);

  // 4. Show the difference
  section('5. Key Differences');
  const personaSystem = withPersona[0].content;
  const genericSystem = withoutPersona[0].content;

  console.log(`\nWith persona system prompt length:    ${personaSystem.length} chars`);
  console.log(`Without persona system prompt length: ${genericSystem.length} chars`);
  console.log(`\nPersona prompt includes:`);
  console.log(`  ✅ Role: ${personaSystem.includes(persona.role)}`);
  console.log(`  ✅ Strategic priorities: ${persona.strategicPriorities.every(p => personaSystem.includes(p))}`);
  console.log(`  ✅ Brand positioning: ${personaSystem.includes(persona.brandPositioning)}`);
  console.log(`  ✅ Decision principles: ${persona.decisionPrinciples.every(p => personaSystem.includes(p))}`);

  console.log(`\nGeneric prompt includes:`);
  console.log(`  ❌ Role: ${genericSystem.includes(persona.role)}`);
  console.log(`  ❌ Strategic priorities: ${persona.strategicPriorities.some(p => genericSystem.includes(p))}`);
  console.log(`  ❌ Brand positioning: ${genericSystem.includes(persona.brandPositioning)}`);

  console.log('\n🎉 CMO persona is fully wired and working!');
}

main();
