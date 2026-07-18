# Khmer Braille — usage & implementer's guide

iAny includes an offline **Khmer → Braille** converter: no ML, no network, pure
text transformation. This document explains **how to use it**, **how it works**,
and **how to verify or re-implement it** on another platform.

> **Status:** usable now for display and for generating embosser files. The
> character→cell mapping follows the official Khmer Braille standard and was
> cross-checked against *World Braille Usage* (3rd ed.), but the **full**
> vowel / independent-vowel / punctuation set should be **proofread by a Khmer
> Braille expert (e.g. Krousar Thmey) before you emboss important material.**
> Braille mistakes matter for blind readers — treat this as a solid base that
> deserves a human check for production embossing.

Source of truth: [`packages/core/src/khmerbraille.ts`](../packages/core/src/khmerbraille.ts).
It is dependency-free TypeScript, so it ports easily to any language.

---

## 1. Using it

### In code (`@iany/core`)

```ts
import { khmerToBraille, khmerToBrf, brfToUnicodeBraille } from '@iany/core'

khmerToBraille('សួស្ដី')   // → Unicode Braille dots (U+2800–28FF), for display
khmerToBrf('សួស្ដី')       // → Braille-ASCII (BRF), for embossers / .brf files
brfToUnicodeBraille('...')  // → BRF string to Unicode dots
```

- **Unicode Braille** (`khmerToBraille`) is what you show on screen or copy.
- **BRF / Braille-ASCII** (`khmerToBrf`) is the interchange format embossers and
  refreshable Braille displays expect; write it to a `.brf` file.

### In the app (`/braille`)

The standalone **`/braille`** page wraps the same functions: type Khmer, or
**📷 From a photo** (on-device Khmer OCR fills the text in), then **Copy** the
Braille or **Download `.brf`**. Fully offline after first load.

---

## 2. How it works (the pipeline)

Khmer is an abugida: vowels attach to a base consonant, some vowel signs are
written *before* the base but pronounced after, and consonants stack via a
subscript marker (coeng `្`). Braille is linear, so the converter reorders and
maps per **orthographic syllable**:

```
text ─▶ tokenize ─▶ (per token) markToken ─▶ reorder ─▶ combine ─▶ map cells ─▶ BRF ─▶ Unicode
```

1. **Tokenize** — split into units so reordering stays within one syllable:
   Khmer orthographic syllables (a base consonant/independent vowel + its
   following coeng clusters and vowel signs/diacritics), Latin words, digit
   runs, and single other characters.

2. **markToken** — prepend Braille indicator cells:
   - a **number sign** (`#`, ⠼) before a run of digits;
   - a **capital sign** (`,`, ⠠) before each uppercase Latin letter, or a
     double capital for all-caps words.

3. **Reorder** (the key Khmer rule) — within a syllable, move to the **front**:
   - **pre-base vowel signs** `េ ែ ៃ ើ` (written before the base in Khmer, but
     the Braille cell comes first), and
   - **coeng-រ** (`្រ`, a subscript "ro"),
   so the linear Braille order matches how it's read.

4. **Combine** — merge **composite vowels** that are two Unicode code points but
   a **single Braille cell**, e.g. `ោះ`, `ុះ`, `េះ`, `ុំ`, `ាំ`.

5. **Map to cells** — look each glyph up in `KHMER_TO_BRF` (the coeng `្` maps to
   `v` → ⠧, which **links a conjunct**). Then `BRF_TO_UNICODE` turns the
   Braille-ASCII into Unicode Braille dots for display.

### Rules worth knowing (cross-checked vs *World Braille Usage*)

- Core cells: `ក`=⠛ (`g`), `ខ`=⠅ (`k`), `គ`=⠠⠛ (`,g`).
- **ô-class (voiced) consonants** take a **point-6 prefix** — our `,` (⠠) —
  distinguishing e.g. `គ` from `ក`.
- **Conjuncts** (stacked consonants) link with **⠧** (the coeng `្` → `v`).
- Digits use the number sign then `a–j` (⠼ + ⠁⠃⠉…), the standard Braille digits.

---

## 3. The mapping tables

Two tables in `khmerbraille.ts`:

- **`KHMER_TO_BRF`** — Khmer glyph (and composite key) → Braille-ASCII code.
  Consonants, independent vowels, dependent vowels, composite vowels, digits
  (both Khmer `០–៩` and ASCII `0–9`), diacritics, and punctuation
  (e.g. `។` khan, `៕` bariyoosan).
- **`BRF_TO_UNICODE`** — Braille-ASCII char → Unicode Braille cell (U+2800–28FF).

Braille-ASCII (BRF) is the 64-cell ASCII encoding embossers use; keeping it as an
intermediate means the same pipeline emits **both** a `.brf` file and on-screen
dots, and makes the mapping easy to read and audit.

---

## 4. Verifying & contributing

Because a human proofread is the remaining step, corrections are the most
valuable contribution:

1. Compare converter output against the **official Khmer Braille chart**
   (Krousar Thmey's "Khmer Braille Signs") and *World Braille Usage* (3rd ed.).
2. For any wrong cell, fix the entry in **`KHMER_TO_BRF`** (or add a composite to
   the `COMBOS` list / a pre-base sign to `VOWEL_SIGNS`). Add a test case.
3. Focus areas most likely to need review: the **independent vowels**
   (`ឥ ឦ ឧ …`), **composite vowels**, and **punctuation**.
4. Ideally, get sign-off from a Khmer Braille teacher or a blind Khmer reader.

There is an open issue to add unit tests for the converter — a great place to
lock in verified mappings.

---

## 5. Re-implementing on another platform

The converter is ~200 lines of dependency-free logic, so porting it (Python, C,
Dart, Rust, an embosser plugin…) is straightforward:

1. Copy the two tables (`KHMER_TO_BRF`, `BRF_TO_UNICODE`).
2. Reproduce the five pipeline steps (tokenize → mark → reorder → combine → map).
3. The reorder + combine steps are the only Khmer-specific logic; everything
   else is table lookups.

Unicode Braille is `U+2800 + dot-bitmask`, so you can also derive dots directly
from the 6-dot pattern if you prefer not to go through BRF.

---

## 6. References

- **World Braille Usage**, 3rd ed. (UNESCO / Perkins / NLS) — the authoritative
  cross-language Braille reference, including Khmer.
- **Krousar Thmey** — developed Khmer Braille materials used in Cambodian schools
  for blind students ("Khmer Braille Signs").
- **liblouis** — the open Braille translation library; contributing a verified
  Khmer table upstream would benefit the whole ecosystem.
- iAny's implementation was written independently, using
  IDRI-LAB/Khmer-Braille-Translation only as a reference (that repo carries no
  license, so no code was copied).

---

Licensing: this converter is part of iAny and is **Apache-2.0** (code). Braille
charts/standards belong to their respective bodies.
