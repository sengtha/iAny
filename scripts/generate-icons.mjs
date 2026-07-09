// Renders all PWA icons from the SVG sources in public/.
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp'

const jobs = [
  // Standard manifest icons (rounded-square logo, transparent corners)
  { src: 'public/icon.svg', out: 'public/icon-192.png', size: 192 },
  { src: 'public/icon.svg', out: 'public/icon-512.png', size: 512 },
  // Maskable icons (full-bleed, glyph in the 80% safe zone)
  { src: 'public/icon-maskable.svg', out: 'public/icon-maskable-192.png', size: 192 },
  { src: 'public/icon-maskable.svg', out: 'public/icon-maskable-512.png', size: 512 },
  // iOS home screen (full-bleed; iOS applies its own corner rounding)
  { src: 'public/icon-maskable.svg', out: 'public/apple-touch-icon.png', size: 180 },
  // Legacy favicon fallback
  { src: 'public/icon.svg', out: 'public/favicon-96.png', size: 96 },
]

for (const { src, out, size } of jobs) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(out)
  console.log(out)
}
