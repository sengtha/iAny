# Where Grove's CO₂ number comes from

The figure a grower sees is not one measurement and not one citation. It is four
components multiplied together, and they do not have the same standing: one is a
published pantropical model, two are our own approximations, and one is a
constant whose attribution we have not been able to verify.

This file exists because the app used to label the whole number after the single
component that *is* published, which flattered the other three. Nothing here
changes a number or a formula. It records what each part rests on.

Line references are to `grove/core/grove.ts` unless stated otherwise.

---

## 1. The components

```
AGB (kg) = 0.0673 · (ρ · D² · H)^0.976        ← Chave et al. (2014) Eq. 4
carbon   = AGB · 0.47                          ← UNRESOLVED, see §3
CO₂e     = carbon · 3.6667                     ← stoichiometry, 44/12
```

with `ρ` wood density, `D` diameter at breast height (cm), `H` height (m).

| # | Component | Where it lives | Source | Standing |
|---|---|---|---|---|
| 1 | Above-ground biomass model | `:196-213` (`estimateCarbon`) | Chave et al. (2014), **Equation 4** — the height-inclusive pantropical model | **Published** |
| 2 | Carbon fraction, `0.47` | `:96-117` (`CARBON_FRACTION`) | Attributed in-code to an "IPCC default". Not verified. | **UNRESOLVED — §3** |
| 3 | CO₂ per unit carbon, `3.6667` | `:118-119` (`CO2_PER_C`) | Stoichiometry: molar mass of CO₂ over molar mass of C, 44/12. **No citation exists or is needed** — please do not go looking for one. | **Definitional** |
| 4 | Wood density, 27 species | `:127-155` (`WOOD_DENSITY`) | Our own compilation of average published values per species. **Uncited.** | **In-house** |
| 5 | Default wood density, `0.6` | `:120-121` (`DEFAULT_WOOD_DENSITY`) | A constant assumption applied to every species not in the table above | **In-house** |
| 6 | Height from DBH | `:215-218` (`estHeightFromDbh`) | `H = min(30, 3·√D)`. Appears in no published paper. Ours. | **In-house** |
| 7 | Height-only fallback | `:206-208` | `D = 2H`, then AGB halved. Appears in no published paper. Ours. | **In-house** |
| 8 | Directly supplied biomass | `:199-200` | `method: 'manual'` bypasses the allometry entirely and uses the caller's `biomassKg` | **Caller-supplied** |

So of the four multiplied terms, **one is published, one is definitional, one is
in-house, and one is unresolved** — and depending on what was measured, the
height that feeds the published model may itself be in-house (rows 6 and 7).

### Which path ran

Resolution order for `ρ` is at `:197`: an explicit `measure.woodDensity`, then the
species table, then `0.6`.

| `measure.method` | Biomass path | Height |
|---|---|---|
| `dbh_height` | Chave Eq. 4 | **measured** |
| `dbh` | Chave Eq. 4 | in-house, row 6 |
| `height` | in-house, row 7 | measured, but diameter is guessed |
| `manual` | none — caller's figure | n/a |

Only the first row is fully attributable to the published model. The garden panel
distinguishes these two cases in what it says.

### Wood density caveats, which belong here and not buried in the table

Three entries in `WOOD_DENSITY` carry inline warnings and they matter more than
their placement suggests:

- **`coconut: 0.6`** (`:130`) — "palms differ; treated approximately". Palms are
  monocots with no secondary growth; a dicot allometry is the wrong shape for them.
  The same applies to `sugar-palm` and `areca-palm`, which carry no comment.
- **`banana: 0.3`** (`:135`) — "herbaceous pseudostem, mostly water".
- **`papaya: 0.2`** (`:138`) — "soft, pithy, hollow stem".

The intent is stated at `:190-195`: herbaceous plants return ≈0 rather than being
over-credited. That is deliberate conservatism, not accuracy.

The standard source for wood density is the Global Wood Density Database (Zanne
et al. 2009; the accompanying paper is Chave et al. 2009). **We do not draw from
it programmatically and our table is not extracted from it.** It is listed in §4
because it is what a reader should consult, not because it is what we used.

---

## 2. What we have not implemented

Chave et al. (2014) also give a model (their Eq. 6/7) that estimates biomass
without a measured height, using a fitted environmental stress factor **E**. That
is the published answer to the problem rows 6 and 7 solve by guesswork.

**We have not implemented it.** Rows 6 and 7 are a deliberately conservative
in-house approximation, and calling them anything else would be untrue.

---

## 3. The carbon fraction is UNRESOLVED

The comment at `:96-117` used to call `0.47` an "IPCC default" and cite nothing
further. We have not been able to confirm that, so the comment now records the
state of the question and this section is the long form of it.

**What is established:**

- **No source exists anywhere in this repository or its history.** `git log -S
  "0.47" -- grove/` and `git log -S CARBON_FRACTION` each return only the initial
  Grove commit (`2231472`, 2026-07-20). That commit's message sources the
  allometry — "conservative Chave-2014 carbon estimate" — and says nothing about
  the carbon fraction. Across the repo, Chave et al. (2014) is named in five
  files; "IPCC" appears twice, both times as the bare word with no document,
  edition, volume, chapter, or table.
- The 2006 IPCC Guidelines, Volume 4, Chapter 4 **do** contain Table 4.3,
  "Carbon fraction of aboveground forest biomass", in t C (t d.m.)⁻¹, at page 4.48.

**What is NOT established, and must not be written down until someone reads it:**

- **Nobody has read that table's rows.** It is *not* established that `0.47` is its
  tropical value. Complicating this: a worked example elsewhere in the same
  chapter applies `0.47` to a **temperate continental** zone.
- **Volume 4, Chapter 2 (Generic) is unchecked.** If a generic carbon-fraction
  default lives there, that is the more natural home for something called "the
  IPCC default", and it would be a different citation entirely.
- **Whether the 2019 Refinement supersedes Table 4.3 is unchecked.**

**The finding that does not depend on reading the PDF.** Every candidate source
is about **forest** biomass — Table 4.3's own title says so. Grove applies the
constant to a home garden: mango, jackfruit, durian, pomelo, lime, papaya. A
national-inventory default for forest land is being used as a per-tree constant
for an orchard. **Even if the number turns out to be right, the scope of the
attribution is wrong**, and that is checkable without opening anything.

**To close this**, someone with access should read page 4.48 of Vol. 4 Ch. 4, then
Vol. 4 Ch. 2 (Generic), then the 2019 Refinement's Chapter 4, and record what each
says. Both documents are free downloads.

Until then, **the garden panel does not name a source for this component at all**
and does not print the word "IPCC" — it names the biomass model, says whether the
height was measured, and links here. An unverified attribution in front of a
grower is worse than no attribution, because she cannot check either but only the
first one implies she could.

**Why we are not tidying this away.** `0.47` is repeated everywhere as "the IPCC
default", which is exactly the kind of attribution that turns out to trace to
something narrower than claimed. Writing a plausible table number here would
replace an honest gap with an unfalsifiable one.

---

## 4. Citations

**The biomass model** — component 1:

> Chave, J., Réjou-Méchain, M., Búrquez, A., Chidumayo, E., Colgan, M. S.,
> Delitti, W. B. C., Duque, A., Eid, T., Fearnside, P. M., Goodman, R. C.,
> Henry, M., Martínez-Yrízar, A., Mugasha, W. A., Muller-Landau, H. C.,
> Mencuccini, M., Nelson, B. W., Ngomanda, A., Nogueira, E. M.,
> Ortiz-Malavassi, E., Pélissier, R., Ploton, P., Ryan, C. M., Saldarriaga, J. G.,
> & Vieilledent, G. (2014). Improved allometric models to estimate the aboveground
> biomass of tropical trees. *Global Change Biology*, 20(10), 3177–3190.
> https://doi.org/10.1111/gcb.12629

Cite **Equation 4** specifically, not just the year — a reader needs to know
whether the measured-height or the no-height model was used. We use the
height-inclusive one.

**Wood density — what a reader should consult, not what we used** (see §1):

> Zanne, A. E., Lopez-Gonzalez, G., Coomes, D. A., Ilic, J., Jansen, S.,
> Lewis, S. L., Miller, R. B., Swenson, N. G., Wiemann, M. C., & Chave, J. (2009).
> Data from: Towards a worldwide wood economics spectrum. *Dryad*.
> https://doi.org/10.5061/dryad.234

> Chave, J., Coomes, D., Jansen, S., Lewis, S. L., Swenson, N. G., & Zanne, A. E.
> (2009). Towards a worldwide wood economics spectrum. *Ecology Letters*, 12(4),
> 351–366. https://doi.org/10.1111/j.1461-0248.2009.01285.x

Note the Dryad dataset has **ten** authors. The seven-author form that circulates
widely omits Ilic, Swenson and Wiemann.

**Verification status of the citations themselves.** The Chave et al. (2014) entry
was checked against the Edinburgh Research Explorer record. The Zanne et al. (2009)
dataset entry was checked on Dryad. The Chave et al. (2009) volume and pages come
from indexing records rather than the publisher's page.

---

## 5. What this number is not

`co2Kg` is an estimate produced by the chain of assumptions above. It is not a
measurement, not a certified credit, and not tradable. Nothing in CSB mints
against it: the chain records **trees**, a count somebody can walk out and
falsify. See `grove/SPEC.md` §6 and CSB `docs/grove.md` §1.
