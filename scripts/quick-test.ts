/**
 * Quick test — just MiMo + Content + Image (skips OpenRouter which has provider issues)
 * Run: npx tsx scripts/quick-test.ts
 */
import 'dotenv/config';

const MIMO_KEY = process.env.MIMO_API_KEY;
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY;

async function testMiMo(): Promise<boolean> {
  console.log('\n━━━ Test 1: MiMo V2 Pro (Agent Brain) ━━━');
  if (!MIMO_KEY) { console.log('❌ MIMO_API_KEY not set'); return false; }

  try {
    const res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
      body: JSON.stringify({
        model: 'mimo-v2-pro',
        messages: [
          { role: 'system', content: 'You are the marketing brain for Rewoz, a digital loyalty app for Australian cafes. Respond in JSON.' },
          { role: 'user', content: 'Should Rewoz target Melbourne cafes with a "winter warmers loyalty" campaign? Give decision, reasoning, confidence 0-1.' },
        ],
        max_tokens: 300, temperature: 0.3,
      }),
    });
    if (!res.ok) { console.log(`❌ MiMo ${res.status}: ${await res.text()}`); return false; }
    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || '';
    const tokens = data.usage?.total_tokens || 0;
    console.log(`✅ MiMo working (${tokens} tokens)`);
    console.log(`   ${text.substring(0, 200)}`);
    return true;
  } catch (e: any) { console.log(`❌ ${e.message}`); return false; }
}

async function testContent(): Promise<boolean> {
  console.log('\n━━━ Test 2: Content Generation (MiMo) ━━━');
  if (!MIMO_KEY) { console.log('❌ MIMO_API_KEY not set'); return false; }

  try {
    const res = await fetch(`${MIMO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
      body: JSON.stringify({
        model: 'mimo-v2-pro',
        messages: [
          { role: 'system', content: 'You are a social media expert for Rewoz (rewoz.com.au), a $39/month digital loyalty platform for Australian cafes. $0 commission, 90-day free trial.' },
          { role: 'user', content: 'Write an Instagram post targeting cafe owners in Adelaide. Format:\nTEXT: <post>\nHASHTAGS: <hashtags>\nCTA: <call to action>' },
        ],
        max_tokens: 400, temperature: 0.7,
      }),
    });
    if (!res.ok) { console.log(`❌ MiMo ${res.status}`); return false; }
    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || '';
    console.log(`✅ Content generated`);
    console.log(text.split('\n').map((l: string) => `   ${l}`).join('\n'));
    return true;
  } catch (e: any) { console.log(`❌ ${e.message}`); return false; }
}

async function testImage(): Promise<boolean> {
  console.log('\n━━━ Test 3: Image Generation (Google AI Studio — FREE) ━━━');
  if (!GOOGLE_AI_KEY || GOOGLE_AI_KEY.includes('your_')) {
    console.log('❌ GOOGLE_AI_STUDIO_API_KEY not set');
    console.log('   Get free key: https://aistudio.google.com/apikey');
    return false;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'A cozy Australian cafe interior with morning sunlight, a latte with beautiful art on a wooden table, and a phone showing a digital loyalty stamp card. Warm, inviting, Instagram-worthy photo style.' }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.log(`❌ Google AI ${res.status}: ${err.substring(0, 200)}`);
      return false;
    }
    const data = await res.json() as any;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p: any) => p.inlineData);
    if (img?.inlineData) {
      const kb = Math.round(img.inlineData.data.length * 0.75 / 1024);
      console.log(`✅ Image generated (${kb} KB, ${img.inlineData.mimeType})`);
      console.log(`   Cost: $0.00 (free tier — 500/day)`);
      return true;
    }
    console.log('❌ No image in response');
    return false;
  } catch (e: any) { console.log(`❌ ${e.message}`); return false; }
}

async function main() {
  console.log('🧪 Rewoz Marketing Agent — Quick API Test');
  console.log('==========================================');

  const r1 = await testMiMo();
  const r2 = await testContent();
  const r3 = await testImage();

  console.log('\n━━━ Results ━━━');
  console.log(`MiMo V2 Pro (brain):     ${r1 ? '✅' : '❌'}`);
  console.log(`Content Gen (MiMo):      ${r2 ? '✅' : '❌'}`);
  console.log(`Image Gen (Google, free): ${r3 ? '✅' : '❌'}`);
  console.log(r1 && r2 && r3 ? '\n🎉 All working — ready to market Rewoz!' : '\n⚠️  Check errors above');
}

main().catch(console.error);
