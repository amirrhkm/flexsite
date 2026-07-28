# Lock In — urge reps + seawall badges (design)

Replaces the guided breathing wave with a **physical response**: logging an urge prescribes
push-ups, you do them now, and you record how many. Reps paid become the counted currency and
unlock a new **seawall** badge family. Supersedes the urge-surfing design
([2026-07-23](2026-07-23-lock-in-urge-surfing-design.md)) while keeping its data and its
core principle. Backend + front-end.

## Why the change

The wave overlay didn't work in practice: **60 seconds of paced breathing does not kill the
urge.** It was the calm-down tool where a burn-it-off tool was needed. Acute physical
exertion has better standing as an in-the-moment craving intervention than breathwork alone,
and it has a second benefit here — the effort compounds into something worth having.

What carries over from the old design, unchanged:

- **Never a weakness tally.** The badge is for reps paid, not urges had. See "One family, not
  two" below — this is the load-bearing principle, and it is why the urge count gets no badge.
- **Streak independence.** Urges and reps never read or write the sober day-tick. Having
  urges is normal; what you do about them is the record.
- **Tone.** No emoji. Spare copy. No punishing red. The cost is real but it is not a fine —
  it converts the urge into strength, which is why the reps feed a badge rather than deduct
  from anything.

## The flow (chosen: "do it now")

Tap **"Ride out an urge"** on the Sober card →

1. An overlay states the prescription: **`10 push-ups`**.
2. You do them.
3. You confirm the count — `10` prefilled, adjustable — and tap **Done**.

The count is entered **after** the set, not before: it records what you actually did. The
prefill keeps the fast path at two taps. Nothing gates the log — the urge is recorded on
Done regardless of the number entered, including a number lower than prescribed.

**Rejected: the debt ledger.** An "owed reps" balance that carries across the day was
considered and dropped. A debt that compounds to 200 produces despair, and despair means you
stop logging on exactly the days the data matters. No deferred state exists in this design.

## Numbers (in the config file)

In `cdk/lambda/lockin-config.json`, replace `waveTiers` with:

```json
"repsPerUrge": 10,
"repTiers": [["Stone", 100], ["Jetty", 500], ["Breakwater", 1000], ["Seawall", 2500], ["Bastion", 5000]]
```

`repsPerUrge` serves two purposes: the prescription shown in the overlay, and the historical
the prescription shown in the overlay. `repTiers` thresholds are total reps paid, all-time.

## Badges: one family, not two

Because reps are now variable, reps and urge count carry different information — so two badge
families are *possible*. They are still wrong.

A badge on "urges logged" is a badge for having urges: precisely the weakness tally the
original spec identified as backfiring. A badge on reps paid is a badge for what you did about
them. Only the second is worth minting.

So: **one family keyed on reps.** The urge count survives as context, never as a trophy —
shown on the Sober card and in the badge explainer:

```
Bastion · 5,000 reps · across 412 urges
```

Reps-per-urge is thereby legible without any new badge: an average climbing from 10 to 18
over months is visible progress under the same pressure.

### Thresholds

Thresholds are 10× the retired wave tiers — a sensible ramp at the default 10-rep
prescription, not a mapping onto anything.

| Badge | Reps paid | = urges at 10 |
|---|---|---|
| Stone | 100 | 10 |
| Jetty | 500 | 50 |
| Breakwater | 1,000 | 100 |
| Seawall | 2,500 | 250 |
| Bastion | 5,000 | 500 |

**Reps start at zero.** An earlier version of this design backfilled pre-feature days at
10 reps per logged urge to carry the retired wave badges forward. That was dropped by
request: the seawall family is earned from scratch. Days predating `urgeReps` contribute 0,
and any wave badge previously showing is simply gone.

The family keeps the wave lineage inverted: the urge is still a wave, you are now what it
breaks against. Art is cool stone-grey with a wave breaking at the base — distinct from both
the metal streak medals and the warm flame badges.

### Separate from flame badges

Urge reps do **not** feed `workout.extra` or the flame badges. Those count workout days beyond
the weekly target — a training-discipline metric. Folding urge reps in would make a bad urge
week read as a great training week. The two families stay independent.

## Data model (backend)

Add `urgeReps` (non-negative integer, default 0) to the day item — total reps paid that day,
alongside the existing `urges` (count of urges ridden that day).

- `POST` accepts `urgeReps`, stored via `SET` like the rest of the day record.
- Validation mirrors `urges`: coerce to non-negative integer, clamp `0..100000`.
- No other schema change. Still one item per day.

## Derivation (`computeSummary`)

Extend the urges block:

```
urges: { today, total, repsToday, repsTotal }
```

`urges`/`today`/`total` are unchanged. Reps for a day are only ever what was recorded:

```js
var dayReps = Number(d.urgeReps) > 0 ? Math.floor(Number(d.urgeReps)) : 0;
```

Nothing is inferred from the urge count, so a day with `urges` but no `urgeReps` contributes
0. `repsPerUrge` in the config is therefore the **prescription only** — the page reads it for
the overlay default; the Lambda does not need it.

Badge tier is derived client-side from `repsTotal` against `repTiers`, mirroring how the wave
and ring tiers already work.

## Decision function (`celebrationsFor`)

`waveBadges` becomes `repBadges`, computed from `prev/next.summary.urges.repsTotal` crossing
`repTiers`. Signature keeps its shape: `celebrationsFor(prev, next, repTiers, effortTiers)`.
First-load return includes `repBadges: []`. Crossing mints with the seawall art via the
existing mint mechanic.

## Front-end (`plan/lockin.html`)

- **Sober card:** the urge block keeps its position and `--sea` palette. Button label
  unchanged. The stat line becomes the current seawall badge + `N reps · M urges` with
  progress to the next tier.
- **Reps overlay replaces the wave overlay.** The canvas wave, breathing ring, phase copy,
  and `I'm okay now` / `Done` pair are retired. The new overlay is static: the prescription
  (`10 push-ups`), a number control (prefilled from `repsPerUrge`, quick chips + steppers),
  one brief line, and **Done**. Being static, it needs no reduce-motion gating.
  It still sits **before** `<script>` with the other overlays.
- **`wallSvg(size)`** — stone badge with a wave breaking at the base; unique gradient id via
  `svgSeq`. Replaces `waveBadgeSvg`.
- **`REP_TIERS`** default array, overridden from `config.json` (`if (cfg.repTiers) ...`), plus
  `REPS_PER_URGE` from `cfg.repsPerUrge`, following the existing tier-override pattern.
- **`renderAchievements`:** the five seawall cells replace the five wave cells; `data-why` =
  `threshold + ' reps paid'`. Flame and medal cells untouched.
- **Save path:** on Done, increment `todayRow.urges` by 1 and `todayRow.urgeReps` by the
  entered count, then the existing `save()`. Optimistic, with the existing revert on failure.
  Celebrations still fire only on POST success.

## Files

- `cdk/lambda/lockin-config.json` — `repsPerUrge`, `repTiers` (remove `waveTiers`)
- `cdk/lambda/tracker.mjs` — `repsToday`/`repsTotal`,
  `celebrationsFor` → `repBadges`
- `cdk/lambda/index.mjs` — validate/store `urgeReps`
- `plan/lockin.html` — overlay swap, `wallSvg`, `REP_TIERS`, card stat line, achievements
  cells, save path
- Tests: `cdk/lambda/tracker.test.mjs`, `cdk/lambda/reward.test.mjs`, `cdk/lambda/index.test.mjs`

**No new AWS infrastructure.** Deploy via the existing `npm run deploy` (the user runs it).

## Testing

**Unit (`tracker.test.mjs`):**
- `repsTotal` sums `urgeReps` across days; `repsToday` picks today's.
- A day with `urges: 4` and no `urgeReps` contributes 0 — reps are never inferred from urges.
- A day with `urgeReps: 0` and `urges: 1` contributes 0.
- Mixed old and new days sum to the recorded reps only.

**Unit (`index.test.mjs`):** `urgeReps` coerces non-integers, clamps negatives to 0 and
oversize to 100000, defaults to 0 when absent.

**Unit (`reward.test.mjs`):** first-load and no-change deepEqual include `repBadges: []`;
`repsTotal` 95 → 105 yields `['Stone']`; a non-crossing increment yields none; custom
`repTiers` override honored.

**Manual (deploy, on phone):** tap urge → overlay shows `10 push-ups` → adjust to 15 → Done →
urge count +1, reps +15; crossing 100 mints Stone; seawall badges render in Achievements with
locked ones blurred; the explainer line reads correctly; sober streak and flame badges
untouched; existing history still shows the badges it showed before.

## Out of scope (YAGNI)

Escalating prescriptions (more reps as urges pile up); partial credit or per-set breakdown;
deferred/owed reps; a floor on the entered count; exercise types other than push-ups;
retiring the `urges` field; any effect on the sober streak or the workout target.
