import 'dotenv/config';

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.log('❌ No OPENROUTER_API_KEY'); process.exit(1); }

const models = [
  'qwen/qwen3.6-plus:free',
  'qwen/qwen3.6-plus',
  'qwen/qwen3-235b-a22b-07-25:free',
  'qwen/qwen3-235b-a22b:free',
  'qwen/qwen3.5-27b:free',
  'google/gemma-3-12b-it:free',
  'openrouter/free',
];

async function test(model: string) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'http://localhost:3000' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Write a 1-line Instagram caption for a cafe loyalty app. Include a stat.' }], max_tokens: 100 }),
    });
    const d = await res.json() as any;
    if (d.error) { console.log(`❌ ${model}: ${d.error.message?.substring(0, 80)}`); return; }
    const text = d.choices?.[0]?.message?.content ?? '';
    console.log(`✅ ${model}: "${text.substring(0, 100)}"`);
  } catch (e: any) { console.log(`❌ ${model}: ${e.message}`); }
}

async function main() {
  console.log('🔍 Testing OpenRouter free models...\n');
  for (const m of models) await test(m);
}
main();
