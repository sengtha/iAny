/**
 * EUDR geometry regression test — the area maths decides whether a plot needs a
 * polygon (>= 4 ha) under EU 2023/1115, so a silent error here would produce
 * non-compliant Due Diligence data. Run: npm run test:eudr
 */
import { buildPlot, polygonAreaHa, eudrCoord, eudrNeedsPolygon, plotGeoJson } from './trace'
let pass = 0; const fails: string[] = []
const ok = (n: string, c: boolean) => { c ? (pass++, console.log('  ✓', n)) : (fails.push(n), console.log('  ✗', n)) }

// 6-decimal precision (EUDR minimum)
ok('keeps 6 decimals', eudrCoord(11.5566778899) === 11.556678)

// A ~1 km x 1 km square near Kampot (10.6°N) should be ~100 ha.
const lat = 10.6, dLat = 1000 / 111320, dLng = 1000 / (111320 * Math.cos(lat * Math.PI / 180))
const sq = [
  { lat, lng: 104.2 }, { lat, lng: 104.2 + dLng },
  { lat: lat + dLat, lng: 104.2 + dLng }, { lat: lat + dLat, lng: 104.2 },
]
const area = polygonAreaHa(sq)
console.log('  1km square →', area, 'ha')
ok('1km square ≈ 100 ha (±2%)', Math.abs(area - 100) < 2)

// A 100 m x 100 m plot = 1 ha
const s2 = 100 / 111320, s2lng = 100 / (111320 * Math.cos(lat * Math.PI / 180))
const small = [
  { lat, lng: 104.2 }, { lat, lng: 104.2 + s2lng },
  { lat: lat + s2, lng: 104.2 + s2lng }, { lat: lat + s2, lng: 104.2 },
]
console.log('  100m square →', polygonAreaHa(small), 'ha')
ok('100m square ≈ 1 ha', Math.abs(polygonAreaHa(small) - 1) < 0.05)

// Winding order must not flip the sign
ok('reversed winding same area', Math.abs(polygonAreaHa([...sq].reverse()) - area) < 0.001)
ok('<3 points → 0 ha', polygonAreaHa([sq[0]!, sq[1]!]) === 0)

// Threshold
ok('4 ha needs polygon', eudrNeedsPolygon(4) && eudrNeedsPolygon(9.2))
ok('3.9 ha does not', !eudrNeedsPolygon(3.9))

// GeoJSON shape: lng,lat order + closed ring
const p1 = buildPlot([{ lat: 10.6, lng: 104.2 }])
const g1 = plotGeoJson(p1) as { type: string; coordinates: number[] }
ok('single point → GeoJSON Point', g1.type === 'Point' && g1.coordinates[0] === 104.2 && g1.coordinates[1] === 10.6)
const g2 = plotGeoJson(buildPlot(sq)) as { type: string; coordinates: number[][][] }
const ring = g2.coordinates[0]!
ok('polygon → closed ring', g2.type === 'Polygon' && ring.length === 5 &&
   ring[0]![0] === ring[4]![0] && ring[0]![1] === ring[4]![1])
ok('polygon is lng,lat', ring[0]![0]! > 100 && ring[0]![1]! < 20)
ok('buildPlot rounds to 6dp', buildPlot([{ lat: 10.123456789, lng: 104.987654321 }]).points[0]!.lat === 10.123457)

console.log(`\n${fails.length ? '❌' : '✅'} ${pass} passed, ${fails.length} failed`)
if (fails.length) throw new Error(fails.join('; '))
