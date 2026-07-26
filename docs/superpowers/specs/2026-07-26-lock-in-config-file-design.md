# Lock In — single config file for rule numbers (design)

Move the duplicated "rule" numbers (workout weekly target, streak day-tiers &
week-tiers, wave-badge thresholds) into one JSON file that feeds the Lambda, the
deployed `config.json`, and the page — removing the current duplication between
`tracker.mjs` and `plan/lockin.html`. Refactor; no behavior change.

## Single source of truth

`cdk/lambda/lockin-config.json` (in `lambda/` so the Lambda asset bundles it):

```json
{
  "workoutTarget": 3,
  "dayTiers":  [["bronze",7],["silver",30],["gold",90],["sapphire",180],["diamond",365]],
  "weekTiers": [["bronze",4],["silver",12],["gold",26],["sapphire",39],["diamond",52]],
  "waveTiers": [["Ripple",10],["Swell",50],["Breaker",100],["Tide",250],["Ocean",500]]
}
```

Values equal today's constants, so behavior is unchanged.

## Wiring (three consumers, one source)

1. **Lambda** — `cdk/lambda/tracker.mjs` imports the JSON (`import cfg from './lockin-config.json' with { type: 'json' }`) and re-exports `WORKOUT_TARGET = cfg.workoutTarget`, `DAY_TIERS = cfg.dayTiers`, `WEEK_TIERS = cfg.weekTiers`. (Node 22 supports JSON import attributes.) Its other exports (`TRACKER_POLL`, `PRAYERS`) stay as-is.
2. **CDK deploy** — `cdk/lib/site-stack.ts` reads the same file (`fs.readFileSync('../lambda/lockin-config.json')`, parsed) and merges it into the generated config:
   `s3deploy.Source.jsonData('config.json', { voteApiUrl: voteUrl.url, ...lockinConfig })`.
   So the served `config.json` gains `workoutTarget`/`dayTiers`/`weekTiers`/`waveTiers`.
3. **Page** — `plan/lockin.html` keeps its current arrays as **fallback defaults** (so opening the file locally still works), and in the `fetch('./config.json')` success handler overrides them from config when present:
   `if (cfg.dayTiers) DAY_TIERS = cfg.dayTiers; if (cfg.weekTiers) WEEK_TIERS = cfg.weekTiers; if (cfg.waveTiers) WAVE_TIERS = cfg.waveTiers;` (before `refresh()`).
   The page reads the workout target from `summary.workout.target` already (Lambda-computed), so it needs the three tier arrays only.

## Keeping the tested pure function config-driven

`celebrationsFor` currently hardcodes its own wave thresholds so it stays self-contained
for the extraction test. Change its signature to **take the wave tiers as a parameter**:
`celebrationsFor(prev, next, waveTiers)`, with a built-in fallback if omitted. The page's
`runCelebrations` passes `WAVE_TIERS` (now config-sourced); the reward test passes an
explicit tiers array. This removes the last duplication while keeping the function pure and
testable.

## Files
- **Create** `cdk/lambda/lockin-config.json`.
- **Modify** `cdk/lambda/tracker.mjs` (import + re-export constants).
- **Modify** `cdk/lib/site-stack.ts` (read file, merge into config.json).
- **Modify** `plan/lockin.html` (defaults + override from config; `celebrationsFor` param; `runCelebrations` passes tiers).
- **Modify** `cdk/lambda/tracker.test.mjs` (unchanged assertions — now verify config→constants) and `cdk/lambda/reward.test.mjs` (pass waveTiers to `celebrationsFor`).

No new AWS infrastructure. Deploy via existing `npm run deploy`.

## Testing
- **tracker.test.mjs** `constants` test still asserts `WORKOUT_TARGET===3` and the tier
  thresholds — now proving the JSON import wired through (values unchanged).
- **reward.test.mjs** calls `celebrationsFor(prev, next, waveTiers)` with an explicit tiers
  array; wave-badge crossing tests unchanged in behavior.
- `node --check` the page; confirm the config-override runs before `refresh()`; deploy and
  confirm `config.json` now carries the numbers and the app behaves identically.

## Out of scope (YAGNI)
Front-end-only cosmetics (animation timings, ring geometry, colours) stay in the page —
they don't belong in a backend-deployed config. No behavior/threshold changes; values are
copied verbatim. `PRAYERS`/`TRACKER_POLL` stay in code (not "numbers").
