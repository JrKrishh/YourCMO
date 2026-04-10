/**
 * Smoke Test — verifies your API keys are working and generates
 * a sample Rewoz marketing post for Australian cafes.
 *
 * Run: npx tsx scripts/smoke-test.ts
 */

import 'dotenv/config';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MIMO_KEY = process.env.MIMO_API_KEY;
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;

async function testOpenRouter(): Promise<boolean> {
  console.log('\n━━━ Test 1: OpenRouter (Qwen3 free) ━━━');
  if (!OPENROUTER_KEY) {
    console.log('❌ OPENROUTER_API_KEY not set in .env');
    return false;
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://rewoz.com.au',
        'X-Title': 'Rewoz Marketing Agent',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-plus:free',
        providers: { order: ['alibaba'], allow_fallbacks: true },
        messages: [
          { role: 'system', content: 'You are a social media marketing expert for Australian cafes.' },
          { role: 'user', content: 'Write a short Instagram caption for Rewoz, a digital loyalty app for independent Australian cafes. Keep it under 150 characters. Include 3 hashtags.' },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`❌ OpenRouter returned ${res.status}: ${err}`);
      return false;
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || '';
    const tokens = data.usage?.total_tokens || 0;
    const model = data.model || 'unknown';

    console.log(`✅ OpenRouter working`);
    console.log(`   Model: ${model}`);
    console.log(`   Tokens: ${tokens}`);
    console.log(`   Cost: $0.00 (free model)`);
    console.log(`   Response:\n   "${text.trim()}"`);
    return true;
  } catch (err: any) {
    console.log(`❌ OpenRouter error: ${err.message}`);
    return false;
  }
}

async function testMiMoBrain(): Promise<boolean> {
  console.log('\n━━━ Test 2: MiMo V2 Pro (Agent Brain) ━━━');
  if (!MIMO_KEY) {
    console.log('❌ MIMO_API_KEY not set in .env');
    return false;
  }

  try {
    const res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MIMO_KEY}`,
      },
      body: JSON.stringify({
        model: 'mimo-v2-pro',
        messages: [
          {
            role: 'system',
            content: [
              'You are the marketing brain for Rewoz (rewoz.com.au),',
              'a digital loyalty platform for Australian cafes.',
              'Respond in JSON: {"decision": "...", "reasoning": "...", "confidence": 0.0-1.0}',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'evaluate_trend',
              trend: { topic: 'Australian cafe culture', platform: 'Instagram', score: 0.7 },
              question: 'Should Rewoz create content about this trend to reach cafe owners in Melbourne and Sydney?',
            }),
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`❌ MiMo returned ${res.status}: ${err}`);
      return false;
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || '';
    const tokens = data.usage?.total_tokens || 0;
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;

    // Estimate cost: $1/1M input, $3/1M output
    const cost = (inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 3.0;

    console.log(`✅ MiMo V2 Pro working`);
    console.log(`   Tokens: ${tokens} (${inputTokens} in / ${outputTokens} out)`);
    console.log(`   Cost: $${cost.toFixed(6)}`);
    console.log(`   Response:\n   ${text.trim().substring(0, 300)}`);
    return true;
  } catch (err: any) {
    console.log(`❌ MiMo error: ${err.message}`);
    return false;
  }
}

async function testContentGeneration(): Promise<boolean> {
  console.log('\n━━━ Test 3: Full Rewoz Content Generation (via MiMo) ━━━');
  if (!MIMO_KEY) {
    console.log('⏭️  Skipping (no MiMo key)');
    return false;
  }

  try {
    const res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MIMO_KEY}`,
      },
      body: JSON.stringify({
        model: 'mimo-v2-pro',
        messages: [
          {
            role: 'system',
            content: [
              'You are a social media marketing expert.',
              'Brand: Rewoz — Voice: friendly, approachable, cafe-focused',
              'Rewoz is a digital loyalty platform for independent Australian cafes.',
              'Key features: $0 commission, digital stamp cards, order-ahead, 90-day free trial, $39/month.',
              'Target: independent cafe owners in Australia (Adelaide, Melbourne, Sydney, Brisbane).',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              'Generate a social media post for Instagram targeting Australian cafe owners.',
              'The post should promote Rewoz as a way to turn first-time customers into loyal regulars.',
              '',
              'Respond in this exact format:',
              'TEXT: <main post text>',
              'CAPTION: <caption/subtitle>',
              'HASHTAGS: <comma-separated hashtags with # prefix>',
              'CTA: <call to action>',
            ].join('\n'),
          },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`❌ MiMo content gen returned ${res.status}: ${err}`);
      return false;
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || '';

    console.log(`✅ Content generated for Rewoz`);
    console.log(`   ─────────────────────────────`);
    console.log(text.trim().split('\n').map((l: string) => `   ${l}`).join('\n'));
    console.log(`   ─────────────────────────────`);
    return true;
  } catch (err: any) {
    console.log(`❌ MiMo content gen error: ${err.message}`);
    return false;
  }
}

async function testImageGeneration(): Promise<boolean> {
  console.log('\n━━━ Test 4: Image Generation (Google AI Studio) ━━━');
  if (!GOOGLE_AI_KEY || GOOGLE_AI_KEY === 'your_google_ai_studio_api_key') {
    console.log('⏭️  Skipping — set GOOGLE_AI_STUDIO_API_KEY in .env');
    console.log('   Get your free key at: https://aistudio.google.com/apikey');
    return false;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: 'Generate a warm, inviting image of a cozy Australian cafe with a latte art coffee on a wooden table, morning sunlight, and a small digital loyalty card on a phone screen. Style: modern, clean, Instagram-worthy.' }],
          }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      console.log(`❌ Google AI Studio returned ${res.status}: ${err.substring(0, 200)}`);
      return false;
    }

    const data = await res.json() as any;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p.inlineData);
    const textPart = parts.find((p: any) => p.text);

    if (imagePart?.inlineData) {
      const sizeKb = Math.round(imagePart.inlineData.data.length * 0.75 / 1024);
      console.log(`✅ Image generated (${sizeKb} KB, ${imagePart.inlineData.mimeType})`);
      console.log(`   Cost: $0.00 (free tier)`);
      if (textPart?.text) {
        console.log(`   Description: ${textPart.text.substring(0, 100)}...`);
      }
      return true;
    }

    console.log('❌ No image in response');
    return false;
  } catch (err: any) {
    console.log(`❌ Image gen error: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('🧪 Rewoz Marketing Agent — Smoke Test');
  console.log('=====================================');

  const results = {
    openrouter: await testOpenRouter(),
    mimo: await testMiMoBrain(),
    content: await testContentGeneration(),
    image: await testImageGeneration(),
  };

  console.log('\n━━━ Summary ━━━');
  console.log(`OpenRouter (free LLM):  ${results.openrouter ? '✅' : '❌'}`);
  console.log(`MiMo V2 Pro (brain):   ${results.mimo ? '✅' : '❌'}`);
  console.log(`Content Generation:    ${results.content ? '✅' : '❌'}`);
  console.log(`Image Generation:      ${results.image ? '✅' : '❌'}`);

  const allPassed = Object.values(results).every(Boolean);
  console.log(`\n${allPassed ? '🎉 All tests passed — ready to go!' : '⚠️  Some tests failed — check the errors above.'}`);
}

main().catch(console.error);
