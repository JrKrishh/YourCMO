/**
 * Creates the Rewoz logo watermark asset (white R on transparent background).
 * Run once: npx tsx scripts/create-logo-asset.ts
 */
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

const ASSETS_DIR = path.join(process.cwd(), 'assets');

async function main() {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // Create a white "R" logo on transparent background using SVG
  // This matches the Rewoz brand R with the arrow/play cutout
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" rx="30" fill="#E8692D"/>
    <path d="M50 160V40h55c25 0 42 15 42 37 0 18-12 31-28 35l32 48h-28l-28-44H78v44H50zm28-68h24c12 0 20-7 20-18s-8-18-20-18H78v36z" fill="white"/>
    <polygon points="85,65 85,90 105,77.5" fill="#E8692D"/>
  </svg>`;

  // Full color logo (orange bg, white R) — for video watermark
  await sharp(Buffer.from(svg))
    .resize(200, 200)
    .png()
    .toFile(path.join(ASSETS_DIR, 'rewoz-logo.png'));

  console.log('✅ Created assets/rewoz-logo.png (200x200, orange bg, white R)');

  // White-only version on transparent bg — for image watermark on dark areas
  const svgWhite = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" rx="30" fill="white" fill-opacity="0.9"/>
    <path d="M50 160V40h55c25 0 42 15 42 37 0 18-12 31-28 35l32 48h-28l-28-44H78v44H50zm28-68h24c12 0 20-7 20-18s-8-18-20-18H78v36z" fill="#E8692D"/>
    <polygon points="85,65 85,90 105,77.5" fill="white"/>
  </svg>`;

  await sharp(Buffer.from(svgWhite))
    .resize(200, 200)
    .png()
    .toFile(path.join(ASSETS_DIR, 'rewoz-logo-white.png'));

  console.log('✅ Created assets/rewoz-logo-white.png (200x200, white bg, orange R)');
}

main().catch(console.error);
