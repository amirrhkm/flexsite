# Lock In — single config file (plan)

> REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`. Refactor — values unchanged, suite stays green.

**Goal:** One `lockin-config.json` feeds the Lambda, the deployed `config.json`, and the page — removing duplicated rule numbers.

## Global Constraints
- Behavior unchanged (config values equal today's constants). No new infra. Deploy via `npm run deploy`.
- Config lives in `cdk/lambda/` so the Lambda asset bundles it and the CDK stack can read it.
- Page keeps current arrays as fallback defaults (local-open still works); overrides from `config.json` at load, before `refresh()`.

---

### Task 1: Config file + Lambda import

**Files:** create `cdk/lambda/lockin-config.json`; modify `cdk/lambda/tracker.mjs`.

- [ ] **Step 1:** Create `cdk/lambda/lockin-config.json`:

```json
{
  "workoutTarget": 3,
  "dayTiers": [["bronze", 7], ["silver", 30], ["gold", 90], ["sapphire", 180], ["diamond", 365]],
  "weekTiers": [["bronze", 4], ["silver", 12], ["gold", 26], ["sapphire", 39], ["diamond", 52]],
  "waveTiers": [["Ripple", 10], ["Swell", 50], ["Breaker", 100], ["Tide", 250], ["Ocean", 500]]
}
```

- [ ] **Step 2:** In `cdk/lambda/tracker.mjs`, replace the three hardcoded constants:

```js
export const TRACKER_POLL = 'lockin';
export const PRAYERS = ['subuh', 'zohor', 'asar', 'maghrib', 'isya'];
export const WORKOUT_TARGET = 4;
export const DAY_TIERS = [['bronze', 7], ['silver', 30], ['gold', 90], ['sapphire', 180], ['diamond', 365]];
export const WEEK_TIERS = [['bronze', 4], ['silver', 12], ['gold', 26], ['sapphire', 39], ['diamond', 52]];
```

with (note the actual current file has `WORKOUT_TARGET = 3`):

```js
import cfg from './lockin-config.json' with { type: 'json' };

export const TRACKER_POLL = 'lockin';
export const PRAYERS = ['subuh', 'zohor', 'asar', 'maghrib', 'isya'];
export const WORKOUT_TARGET = cfg.workoutTarget;
export const DAY_TIERS = cfg.dayTiers;
export const WEEK_TIERS = cfg.weekTiers;
```

- [ ] **Step 3:** `cd cdk && npm test` → all pass (the `constants` test now verifies the config wiring: `WORKOUT_TARGET===3`, tiers `[7,30,90,180,365]`/`[4,12,26,39,52]`).
- [ ] **Step 4:** commit `feat(config): lockin-config.json; tracker.mjs sources rule numbers from it`

---

### Task 2: CDK merges config into the served config.json

**Files:** `cdk/lib/site-stack.ts`

- [ ] **Step 1:** Add `import * as fs from 'node:fs';` after the existing `import * as path` line.
- [ ] **Step 2:** Just before the `new s3deploy.BucketDeployment(...)`, read the config:

```ts
    const lockinConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'lambda', 'lockin-config.json'), 'utf8'),
    );
```

- [ ] **Step 3:** Change the config.json source to merge it:

```ts
        s3deploy.Source.jsonData('config.json', { voteApiUrl: voteUrl.url, ...lockinConfig }),
```

- [ ] **Step 4:** `cd cdk && npx cdk synth >/dev/null` (or `npm run build` if present) to confirm the stack still compiles. Commit `feat(config): merge lockin-config into the served config.json`

---

### Task 3: Page reads tiers from config; celebrationsFor takes wave tiers

**Files:** `plan/lockin.html`, `cdk/lambda/reward.test.mjs`

- [ ] **Step 1:** `celebrationsFor` takes wave tiers (param, with fallback). Change its signature and its `WAVE` line:
  - `function celebrationsFor(prev, next) {` → `function celebrationsFor(prev, next, waveTiers) {`
  - `var WAVE = [['Ripple', 10], ['Swell', 50], ['Breaker', 100], ['Tide', 250], ['Ocean', 500]];` → `var WAVE = waveTiers || [['Ripple', 10], ['Swell', 50], ['Breaker', 100], ['Tide', 250], ['Ocean', 500]];`

- [ ] **Step 2:** `runCelebrations` passes the (config-sourced) tiers: `var c = celebrationsFor(prev, next);` → `var c = celebrationsFor(prev, next, WAVE_TIERS);`

- [ ] **Step 3:** Override defaults from config at load. Change the config fetch success handler:
  `.then(function (cfg) { apiUrl = cfg.voteApiUrl; refresh(); })`
  →
```js
      .then(function (cfg) {
        apiUrl = cfg.voteApiUrl;
        if (cfg.dayTiers) DAY_TIERS = cfg.dayTiers;
        if (cfg.weekTiers) WEEK_TIERS = cfg.weekTiers;
        if (cfg.waveTiers) WAVE_TIERS = cfg.waveTiers;
        refresh();
      })
```

  (The `var DAY_TIERS`/`WEEK_TIERS`/`WAVE_TIERS` declarations stay as fallback defaults.)

- [ ] **Step 4:** Add a reward test proving the wave-tier param overrides. In `cdk/lambda/reward.test.mjs`, append:

```js
test('celebrationsFor uses the passed wave tiers', () => {
  var s = function (total) { return state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total: total },
  } }); };
  assert.deepEqual(celebrationsFor(s(2), s(3), [['Tiny', 3]]).waveBadges, ['Tiny']);
});
```

- [ ] **Step 5:** `node --check` the page script; `cd cdk && npm test` → all pass. Open locally to confirm the app still renders with fallback defaults. Commit `feat(config): page reads tiers from config.json; wave tiers passed to celebrationsFor`

---

### Task 4: Deploy + verify
- [ ] `cd cdk && npm test` (all pass); `npm run deploy` (user).
- [ ] After deploy: `curl <BaseUrl>config.json` shows `workoutTarget`/`dayTiers`/`weekTiers`/`waveTiers`; app behaves identically (streaks, medals, achievements, workout /3). Change one number in `lockin-config.json` + redeploy → both backend and page reflect it.

## Self-Review
Covers spec: config file (T1), Lambda import (T1), CDK merge (T2), page override + celebrationsFor param (T3). Values unchanged → suite green; new test proves the param wiring. Page fallback defaults preserve local-open. No infra change.
