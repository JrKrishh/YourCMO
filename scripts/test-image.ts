/**
 * Quick image generation test
 * Run: npx tsx scripts/test-image.ts
 */
import 'dotenv/config';
import { ImageGenerator } from '../src/engines/visual-asset/image-generator';
import { Platform } from '../src/models/enums';

async function main() {
  console.log('🖼️  Image Generation Test');
  console.log('========================\n');
  console.log('FAL_KEY:', process.env.FAL_KEY ? '✅ set' : '❌ NOT SET');
  console.log('GOOGLE_AI_STUDIO_API_KEY:', process.env.GOOGLE_AI_STUDIO_API_KEY ? '✅ set' : '❌ NOT SET');
  console.log('IMAGE_PROVIDER:', process.env.IMAGE_PROVIDER ?? '(not set)');

  const gen = new ImageGenerator();
  try {
    console.log('\nGenerating image via KLING/fal.ai (this may take 30-60s for queue processing)...');
    const asset = await gen.generateImage(
      'A cozy Australian cafe with morning sunlight and a latte on a wooden table',
      { type: 'IMAGE', dimensions: { width: 1080, height: 1080 }, format: 'jpg', maxFileSize: 5_000_000 },
      Platform.INSTAGRAM,
    );
    console.log(`\n✅ Success!`);
    console.log(`Asset ID: ${asset.assetId}`);
    console.log(`URL: ${asset.url.substring(0, 120)}...`);
    console.log(`File size: ${asset.fileSize} bytes`);
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
  }
}

main();
