/**
 * Grove → CSB anchoring — optional, dependency-free, and strictly additive.
 *
 * Grove's contract with the world is that THE PHONE IS THE SOURCE OF TRUTH: a
 * record is valid because it verifies, not because a server or a chain vouches
 * for it. Nothing in this file changes that. A Grove record that was never
 * anchored is exactly as valid as one that was, and every consumer verifies it
 * the same way (SPEC.md §§4–5).
 *
 * What anchoring adds is the one thing a device signature structurally cannot
 * carry, and the one thing a survival-based payment needs:
 *
 *   A DATE SOMEBODY ELSE AGREES WITH. `observedAt` is the phone's own clock, set
 *   by the person making the claim — fine for a garden diary, useless as proof
 *   that a tree was standing in July. A block timestamp is agreed by a validator
 *   set that has never met the grower.
 *
 * ONLY THE HASH IS SENT. `observationId` is the record's own SHA-256 content
 * hash and `plotId` is keccak256 of the plot string, so the chain learns neither
 * the garden's name, its coordinates, the photo, nor the device key. A farmer's
 * fruit trees are worth stealing, and a permissioned national chain is still
 * readable by everyone on it.
 *
 * TWO DIFFERENT KEYS, deliberately. Grove's device identity is an ECDSA P-256
 * key that never leaves the phone and signs the record. A CSB transaction is
 * signed by a secp256k1 wallet key belonging to a KYC-verified person. They are
 * not interchangeable and this file does not pretend otherwise: it builds the
 * calldata, and a wallet the grower controls sends it. Whoever sends the FIRST
 * anchor for a plot becomes that plot's steward on chain and is the only address
 * that can extend its history afterwards.
 *
 * Nothing here is a carbon credit. CSB records TREES — a claim somebody can walk
 * out and falsify — and pays for them only when a licensed field verifier
 * confirms they are still standing. See grove/ANCHORING.md.
 */
import type { GardenObservation } from "./grove";

/* ------------------------------------------------------------------ keccak */

/**
 * Keccak-256. Web Crypto does not offer it, and `SHA3-256` is the NIST variant —
 * one padding byte different, an entirely different digest, and a silent failure
 * mode where every lookup returns "never anchored". ~60 lines is cheaper than
 * that bug.
 *
 * BigInt lanes: this hashes a handful of short strings, so clarity beats speed.
 */
const MASK = (1n << 64n) - 1n;
const RATE = 136; // (1600 - 2*256) / 8

// prettier-ignore
const ROT = [
  0n, 1n, 62n, 28n, 27n, 36n, 44n, 6n, 55n, 20n, 3n, 10n, 43n, 25n, 39n,
  41n, 45n, 15n, 21n, 8n, 18n, 2n, 61n, 56n, 14n,
];
// prettier-ignore
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const rotl = (v: bigint, n: bigint) => (n === 0n ? v : ((v << n) | (v >> (64n - n))) & MASK);

function permute(A: bigint[]): void {
  const B = new Array<bigint>(25);
  const C = new Array<bigint>(5);
  const D = new Array<bigint>(5);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) A[x + 5 * y] ^= D[x];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        A[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y] & MASK);
      }
    }
    A[0] ^= RC[round];
  }
}

export function keccak256Bytes(input: Uint8Array): Uint8Array {
  // Keccak padding is 0x01 … 0x80. SHA-3's is 0x06 … 0x80.
  const padLen = RATE - (input.length % RATE);
  const padded = new Uint8Array(input.length + padLen);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const A = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]); // little-endian
      A[i] ^= lane;
    }
    permute(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

/** Keccak-256 of a UTF-8 string, 0x-prefixed. Matches solidity's `keccak256(bytes(s))`. */
export function keccak256(text: string): string {
  return "0x" + hex(keccak256Bytes(new TextEncoder().encode(text)));
}

/* ------------------------------------------------------------------ keys */

/**
 * The 32-byte key CSB files a plot under. The plot STRING never goes on chain.
 *
 * That is NOT the same as the plot's name being private, and as of this writing
 * the interface no longer claims it is. Plot names have to be short, memorable
 * and speakable, because a verifier types one into a phone while standing in a
 * field — `home-garden-01`, `plot/peam-krasop/mangrove-01` are our own examples.
 * A wordlist of plausible names crossed with a two-digit index is a few million
 * candidates, which is seconds of hashing against the anchored plotIds. Beside
 * the liveCount and species committed in the same anchor, what that recovers is
 * an addressable inventory of a grower's most stealable assets. Hashing here
 * keeps the name from OUR server; it does nothing about a hash published on a
 * ledger every permitted party can read.
 *
 * The fix is a salted commitment — plotId = keccak256(plot ‖ salt), salt held on
 * the device and disclosed to a verifier on the visit. It is deliberately NOT
 * done here: it changes this derivation, the lookup path in every consumer that
 * resolves a name to a plot, and the recovery story when a phone is lost, so it
 * is a change across three repositories rather than a line edit. Until it lands,
 * the grower- and verifier-facing pages state the limit and advise picking an
 * unguessable name.
 */
export const plotKey = keccak256;

/** A Grove observation id (64 hex chars) as a 0x-prefixed bytes32. */
export function observationKey(id: string): string {
  const clean = String(id).replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("not a Grove observation id (64 hex chars)");
  return "0x" + clean;
}

/* --------------------------------------------------------------- calldata */

const strip = (h: string) => String(h).replace(/^0x/, "").toLowerCase();
const padWord = (h: string) => strip(h).padStart(64, "0");
const numWord = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");

/** A short ASCII tag (species) as a right-padded bytes32, like ethers' encodeBytes32String. */
export function tag32(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 31) throw new Error("tag too long for bytes32");
  return "0x" + hex(bytes).padEnd(64, "0");
}

/** The 4-byte selector for a solidity signature. */
export const selector = (signature: string) => keccak256(signature).slice(0, 10);

export const ANCHOR_SIGNATURE = "anchor(bytes32,bytes32,bytes32,uint32,bytes32)";

export interface AnchorCall {
  /** ABI calldata for GroveAnchor.anchor — hand this to a wallet to send. */
  data: string;
  /** The values it encodes, so a UI can show the grower what they are signing. */
  observationId: string;
  plotId: string;
  prevId: string;
  liveCount: number;
  species: string;
}

/**
 * Build the calldata that anchors one signed observation.
 *
 * @param obs   A Grove observation, already verified locally. Anchoring a record
 *              you have not verified would be committing somebody else's forgery
 *              to a permanent ledger under your own name.
 * @param opts  `liveCount` overrides the record's `count` for the rare case where
 *              a record covers plants that are no longer all standing; by default
 *              the record speaks for itself.
 *
 * This does not send anything and cannot: the grower's CSB wallet signs and
 * submits it. Gas on CSB is free, so the cost of anchoring is a signature.
 */
export function anchorCall(obs: GardenObservation, opts: { liveCount?: number } = {}): AnchorCall {
  const observationId = observationKey(obs.id);
  const plotId = plotKey(obs.plot);
  const prevId = obs.prev ? observationKey(obs.prev) : "0x" + "0".repeat(64);
  const liveCount = Math.max(0, Math.floor(opts.liveCount ?? obs.count));
  // Species names longer than 31 bytes are truncated rather than refused: the
  // tag is a legibility aid on chain, and `species` in the signed record — which
  // nothing here can alter — remains the authoritative value.
  const species = tag32(truncateUtf8(obs.species, 31));

  const data =
    selector(ANCHOR_SIGNATURE) +
    padWord(observationId) +
    padWord(plotId) +
    padWord(prevId) +
    numWord(liveCount) +
    padWord(species);

  return { data, observationId, plotId, prevId, liveCount, species };
}

/**
 * Living plants in a plot right now — the number CSB means by `liveCount`.
 *
 * NOT the newest record's own `count`. A Grove record covers one planting; a
 * plot usually holds several (a jackfruit, a guava and a longan are three
 * plants, recorded three times). Anchoring the newest record's count would tell
 * the chain a three-tree garden has one tree, and since `verifiedCountOf` feeds
 * the title's supply and a pledge's survival threshold, that understatement
 * propagates into how many shares exist and whether a sponsor's money releases.
 *
 * The rule mirrors the one CamboVerse renders from, so the twin and the chain
 * cannot disagree: follow each `prev` chain back, treat a change of species as
 * a different plant (the phone links a plot's records linearly regardless of
 * what was measured), and sum the LATEST record of each chain.
 */
export function plotLiveCount(observations: GardenObservation[], plot: string): number {
  const inPlot = observations.filter((o) => o.plot === plot);
  if (!inPlot.length) return 0;

  const byId = new Map(inPlot.map((o) => [o.id, o]));
  const referenced = new Set<string>();
  for (const o of inPlot) if (o.prev) referenced.add(o.prev);

  const seen = new Set<string>();
  let total = 0;
  // A "tail" is a record nothing points back to — the newest in its chain.
  for (const tail of inPlot.filter((o) => !referenced.has(o.id))) {
    let cur: GardenObservation | undefined = tail;
    let latest: GardenObservation | null = null;
    while (cur && !seen.has(cur.id)) {
      if (latest && cur.species !== latest.species) break; // a different plant
      seen.add(cur.id);
      latest = latest ?? cur;
      cur = cur.prev ? byId.get(cur.prev) : undefined;
    }
    if (latest) total += Math.max(0, Math.floor(latest.count));
  }
  // Anything left over (a broken or cyclic prev link) is its own plant.
  for (const o of inPlot) {
    if (!seen.has(o.id)) {
      seen.add(o.id);
      total += Math.max(0, Math.floor(o.count));
    }
  }
  return total;
}

/** Truncate to at most `max` UTF-8 bytes without splitting a character. */
function truncateUtf8(text: string, max: number): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= max) return text;
  let out = "";
  for (const ch of text) {
    if (enc.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}

/* ----------------------------------------------------------------- reading */

/** Chain status for a plot, as CSB's public `/grove` endpoint reports it. */
export interface CsbPlotStatus {
  available: boolean;
  plot: string;
  anchored: boolean;
  reason?: string;
  steward?: string;
  records?: number;
  verifiedCount?: number;
  head?: {
    observationId: string;
    prevId: string | null;
    species: string;
    liveCount: number;
    anchoredBy: string;
    anchoredAt: number;
    confirms: number;
    disputes: number;
    verified: boolean;
  };
  verifier?: { address: string; label: string; classes: string[]; licenceRef: string } | null;
  title?: { token: string; symbol: string; supply: number; inSync: boolean } | null;
  pledges?: unknown[];
}

/**
 * Ask a CSB node what it knows about a plot. Public, read-only, no key.
 *
 * Returns `{ available: false }` rather than throwing when the endpoint is
 * absent or unreachable — an offline-first app must never make a chain a
 * prerequisite for showing somebody their own garden.
 */
export async function readPlotStatus(base: string, plot: string): Promise<CsbPlotStatus> {
  const key = plotKey(plot);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/grove?plot=${key}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CSB responded ${res.status}`);
    const body = (await res.json()) as CsbPlotStatus;
    return body?.available ? body : { available: false, plot: key, anchored: false, reason: body?.reason };
  } catch (e) {
    return { available: false, plot: key, anchored: false, reason: (e as Error).message };
  }
}

/**
 * The next `prev` value for a plot: whatever the chain currently holds as its
 * head.
 *
 * CSB refuses an anchor whose `prev` is not the plot's current head, so a garden
 * cannot quietly carry two histories. Call this before building the calldata
 * when a plot may have been anchored from another device — the local `prev` from
 * the Grove record chain is right only if this phone made every anchor.
 */
export async function chainHead(base: string, plot: string): Promise<string | null> {
  const s = await readPlotStatus(base, plot);
  if (!s.available || !s.anchored) return null;
  return s.head?.observationId ?? null;
}
