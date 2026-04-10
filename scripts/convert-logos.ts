import sharp from 'sharp';

async function main() {
  await sharp('assets/rewoz-logo.jpeg').resize(200).png().toFile('assets/rewoz-logo.png');
  console.log('✅ assets/rewoz-logo.png (white R on orange bg)');

  await sharp('assets/rewoz-logo-white.jpeg').resize(200).png().toFile('assets/rewoz-logo-on-white.png');
  console.log('✅ assets/rewoz-logo-on-white.png (orange R on white bg)');
}

main().catch(console.error);
