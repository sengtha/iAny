// Renders the PWA manifest PNG icons from public/icon.svg.
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp'

for (const size of [192, 512]) {
  await sharp('public/icon.svg', { density: 300 })
    .resize(size, size)
    .png()
    .toFile(`public/icon-${size}.png`)
  console.log(`public/icon-${size}.png`)
}
