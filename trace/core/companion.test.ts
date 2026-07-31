/**
 * End-to-end crypto regression test for the companion custody layer.
 *
 * Runs in plain Node's Web Crypto (the same `crypto.subtle` the Cloudflare
 * Worker uses), no browser or network. Bundled + run via `npm run test:companion`.
 * Asserts the happy paths AND every rejection path — a broken signature,
 * wrong-key signature, tampered field, unbound delegation, or expired delegation
 * must never resolve to a company. Throws on any failure (non-zero exit).
 */
import {
  generateKey,
  signPartner, verifyPartner,
  signDelegation, verifyDelegation,
  signCustody, verifyCustody,
  type CustodyRecord,
} from './companion'

let pass = 0
const fails: string[] = []
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fails.push(name); console.log('  ✗ FAIL:', name) }
}

const CAPSULE = 'a'.repeat(64) // a valid 64-hex capsule id
const NOW = '2026-07-31T00:00:00.000Z'
const LATER_OK = '2026-09-01T00:00:00.000Z' // within 365d
const WAY_LATER = '2027-09-01T00:00:00.000Z' // > 365d → expired

const company = await generateKey()
const staffA = await generateKey()
const staffB = await generateKey()
const other = await generateKey() // an unrelated / attacker company key

console.log('\n1. Partner registration (root-signed)')
{
  const reg = await signPartner({ company: company.pub, name: 'DHL Cambodia', region: 'PP', at: NOW }, company.keyPair)
  ok('valid registration verifies', await verifyPartner(reg))
  ok('tampered name rejected', !(await verifyPartner({ ...reg, name: 'FedEx' })))
  ok('key-mismatch rejected', !(await verifyPartner({ ...reg, company: other.pub })))
}

console.log('\n2. Delegation (company → staff)')
const delA = await signDelegation(
  { company: company.pub, staff: staffA.pub, staffName: 'Sok Dara', role: 'carrier', days: 365, now: NOW },
  company.keyPair,
)
{
  ok('valid delegation verifies (in window)', (await verifyDelegation(delA, LATER_OK)).ok)
  const late = await verifyDelegation(delA, WAY_LATER)
  ok('expired delegation rejected', !late.ok && late.expired)
  const forged = await signDelegation(
    { company: company.pub, staff: staffB.pub, staffName: 'Mallory', role: 'carrier', now: NOW },
    other.keyPair, // signed by the WRONG key but claims `company`
  )
  ok('delegation signed by wrong key rejected', !(await verifyDelegation(forged, LATER_OK)).sigOk)
}

console.log('\n3. Custody event — self-claimed (no delegation)')
{
  const rec = await signCustody(
    { capsule: CAPSULE, actor: staffA.pub, actorName: 'Sok Dara', role: 'carrier', event: 'handoff', at: NOW },
    staffA.keyPair,
  )
  const v = await verifyCustody(rec, LATER_OK)
  ok('self-claim: sig valid', v.sigOk)
  ok('self-claim: ok=true', v.ok)
  ok('self-claim: company=null', v.company === null)
}

console.log('\n4. Custody event — with valid delegation (company attributed)')
{
  const base = await signCustody(
    { capsule: CAPSULE, actor: staffA.pub, actorName: 'Sok Dara', role: 'carrier', event: 'deliver', at: NOW },
    staffA.keyPair,
  )
  const rec: CustodyRecord = { ...base, delegation: delA }
  const v = await verifyCustody(rec, LATER_OK)
  ok('sig valid', v.sigOk)
  ok('delegation ok + bound', v.delegation?.ok === true && v.staffBound)
  ok('company resolved to root key', v.company === company.pub)
  ok('overall ok=true', v.ok)
}

console.log('\n5. Tamper detection')
{
  const rec = await signCustody(
    { capsule: CAPSULE, actor: staffA.pub, actorName: 'Sok Dara', role: 'carrier', event: 'handoff', at: NOW },
    staffA.keyPair,
  )
  ok('mutated event → sig invalid', !(await verifyCustody({ ...rec, event: 'deliver' }, LATER_OK)).sigOk)
  ok('swapped actor → sig invalid', !(await verifyCustody({ ...rec, actor: staffB.pub }, LATER_OK)).sigOk)
}

console.log('\n6. Unbound delegation (staffA delegation on a staffB event)')
{
  const recB = await signCustody(
    { capsule: CAPSULE, actor: staffB.pub, actorName: 'Someone else', role: 'carrier', event: 'handoff', at: NOW },
    staffB.keyPair,
  )
  const v = await verifyCustody({ ...recB, delegation: delA }, LATER_OK) // delA authorizes staffA, not staffB
  ok('actor sig still valid', v.sigOk)
  ok('staffBound=false', !v.staffBound)
  ok('company=null (not attributed)', v.company === null)
  ok('overall ok=false (broken company claim)', v.ok === false)
}

console.log('\n7. Expired delegation on an otherwise-valid event')
{
  const base = await signCustody(
    { capsule: CAPSULE, actor: staffA.pub, actorName: 'Sok Dara', role: 'carrier', event: 'store', at: NOW },
    staffA.keyPair,
  )
  const v = await verifyCustody({ ...base, delegation: delA }, WAY_LATER)
  ok('sig valid but delegation expired', v.sigOk && v.delegation?.expired === true)
  ok('company=null when expired', v.company === null)
  ok('overall ok=false when expired', v.ok === false)
}

console.log(`\n${fails.length === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fails.length} failed`)
if (fails.length > 0) throw new Error(`companion crypto test failed: ${fails.join('; ')}`)
