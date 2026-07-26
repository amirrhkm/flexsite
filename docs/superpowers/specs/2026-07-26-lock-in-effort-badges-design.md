# Lock In — extra-effort flame badges (design)

A new badge family rewarding workout days **beyond** the weekly target. Each workout day
past the weekly 3 is an "extra day"; extras accumulate across all weeks into a lifetime
total that unlocks tiered **flame** badges (Ember/Flame/Blaze/Furnace/Inferno), shown in
the Achievements grid and minted on crossing — exactly like the wave badges. Extends the
tracker/reward/config work.

## Numbers (in the config file)

Add to `cdk/lambda/lockin-config.json`:

```json
"effortTiers": [["Ember", 3], ["Flame", 10], ["Blaze", 25], ["Furnace", 60], ["Inferno", 150]]
```

(Thresholds = total extra workout days across all weeks. Counted **live**, including the
current in-progress week — a 4th session today adds to the total immediately.)

## Backend (`computeSummary`)

Add `extra` to the workout summary: sum, over every Mon–Sun week, of
`max(0, sessions − WORKOUT_TARGET)`.

```
let workoutExtra = 0;
for (const [ws, c] of weekCounts) if (c > WORKOUT_TARGET) workoutExtra += c - WORKOUT_TARGET;
// workout return gains:  extra: workoutExtra
```

`summary.workout.extra` = lifetime extra-effort days.

## Decision function (`celebrationsFor`)

Detect effort-badge crossings, mirroring wave badges. Add a 4th param and return field:

- Signature: `celebrationsFor(prev, next, waveTiers, effortTiers)` (both optional, with
  built-in fallbacks).
- Add `effortBadges: []` to the returned object (and the first-load return).
- Compute from `prev/next.summary.workout.extra` crossing `effortTiers` thresholds.

## Page (`plan/lockin.html`)

- `EFFORT_TIERS` default array; overridden from `config.json` (`if (cfg.effortTiers) EFFORT_TIERS = cfg.effortTiers;`) at load, like the other tiers.
- `flameSvg(size)` — warm circular badge with a flame motif (unique gradient id via `svgSeq`), as approved.
- `renderAchievements`: append an effort-badge cell per `EFFORT_TIERS` — earned when
  `summary.workout.extra >= threshold` (count 1), else locked/blurred; `data-why` =
  `threshold + ' extra workout days'`. (Same `acell` + explainer as waves.)
- `runCelebrations`: pass `EFFORT_TIERS` to `celebrationsFor` and mint any `effortBadges`
  (a `mintEffort(name)` = the wave-mint mechanic with flame art), after the wave mints.

## Files
- `cdk/lambda/lockin-config.json` (+ effortTiers)
- `cdk/lambda/tracker.mjs` (workout.extra) + `tracker.test.mjs`
- `plan/lockin.html` (EFFORT_TIERS default + config override, flameSvg, renderAchievements cells, celebrationsFor param + effortBadges, mintEffort, runCelebrations)
- `cdk/lambda/reward.test.mjs` (update full-deepEqual assertions to include `effortBadges: []`; add an effort-crossing test)

No new infra. Deploy via existing `npm run deploy`.

## Testing
- **tracker.test.mjs:** a week with 5 sessions (target 3) → `workout.extra === 2`; extras sum across weeks; a ≤3-session week adds 0.
- **reward.test.mjs:** first-load/no-change deepEqual now includes `effortBadges: []`; an
  effort-crossing test (e.g. extra 2→3 with the config tiers → `['Ember']`); passing custom
  effortTiers overrides.
- Front-end: `node --check`; deploy + confirm a 4th weekly session bumps the extra total and
  crossing 3 mints Ember; badge shows in Achievements; sober/streak untouched.

## Out of scope (YAGNI)
Extra-effort for prayers/sober (workout-only); per-week breakdown; changing the streak rule
(still 3/week). Badges earn once each (cumulative total only rises), like waves.
