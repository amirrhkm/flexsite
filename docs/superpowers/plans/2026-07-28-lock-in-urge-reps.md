# Lock In — urge reps + seawall badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the guided breathing wave with a physical response — logging an urge prescribes push-ups you do immediately and record — and make reps paid the counted currency behind a new seawall badge family.

**Architecture:** Raw daily ticks stay the only stored truth; a new per-day `urgeReps` integer joins the existing `urges` count, and `computeSummary` derives `repsToday`/`repsTotal` on read with a backfill for days recorded before the field existed. The page swaps its canvas wave overlay for a static reps-entry overlay and its wave badge art for stone seawall art. Tier numbers stay in `cdk/lambda/lockin-config.json`, read by both the Lambda and the served `config.json`.

**Tech Stack:** Node 20 ESM Lambda, `@aws-sdk/lib-dynamodb`, `node:test`, AWS CDK (TypeScript), vanilla ES5-style JS inline in a single static HTML file.

**Spec:** [docs/superpowers/specs/2026-07-28-lock-in-urge-reps-design.md](../specs/2026-07-28-lock-in-urge-reps-design.md)

**Branch:** `feat/urge-reps-seawall` (already created; the spec is committed as `9960e19`)

## Global Constraints

- **Single self-contained HTML file.** `BucketDeployment` syncs only `*.html` — no sibling `.js`/`.css`. Everything inline in `plan/lockin.html`.
- **DOM order matters.** Any element the page's IIFE wires at load must appear **before** `<script>`. Overlays go with the other overlays around line 249.
- **No emoji. Spare copy.** No paragraphs, no pep-talk. No punishing red.
- **Colours:** `--sea` blue for the urge block, `--gold` for reward, stone-grey for seawall art. Reuse existing CSS variables; do not introduce new palette entries.
- **`state.today` (server, MYT) is the only source of "today".** Never the browser clock.
- **Celebrations fire only on POST success** — never on first load, `refresh()`, or the revert path.
- **Medal/badge SVG gradient ids must be unique** — always `svgSeq++`, since many render at once in the grid.
- **The user runs the deploy** (`cd cdk && npm run deploy`). Never run it.
- **No browser in this environment.** Verify with `node --check` on the extracted script, `npm test`, and structural greps.
- **ES5-style page JS:** `var`, `function`, no arrow functions or template literals in `plan/lockin.html` (matches existing style and the `new Function` test extraction).
- Run tests from the `cdk/` directory: `cd cdk && npm test`.

---

### Task 1: Backend derivation — `repsToday` / `repsTotal` with backfill

**Files:**
- Modify: `cdk/lambda/lockin-config.json:5`
- Modify: `cdk/lambda/tracker.mjs:5-7` (exports), `cdk/lambda/tracker.mjs:70-146` (`computeSummary`)
- Modify: `cdk/lambda/lib/site-stack.ts:62` — comment only (see Step 7)
- Test: `cdk/lambda/tracker.test.mjs:137-149` (update), plus new tests appended

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `REPS_PER_URGE` (number) exported from `tracker.mjs`; `computeSummary(days, today).urges` gains `repsToday: number` and `repsTotal: number`. Config gains `repsPerUrge: number` and `repTiers: Array<[string, number]>`, and loses `waveTiers`.

- [ ] **Step 1: Update the config file**

In `cdk/lambda/lockin-config.json`, replace the `waveTiers` line with these two lines (keep `workoutTarget`, `dayTiers`, `weekTiers`, `effortTiers` exactly as they are):

```json
  "repsPerUrge": 10,
  "repTiers": [["Stone", 100], ["Jetty", 500], ["Breakwater", 1000], ["Seawall", 2500], ["Bastion", 5000]],
```

The whole file afterwards:

```json
{
  "workoutTarget": 3,
  "dayTiers": [["bronze", 7], ["silver", 30], ["gold", 90], ["sapphire", 180], ["diamond", 365]],
  "weekTiers": [["bronze", 4], ["silver", 12], ["gold", 26], ["sapphire", 39], ["diamond", 52]],
  "repsPerUrge": 10,
  "repTiers": [["Stone", 100], ["Jetty", 500], ["Breakwater", 1000], ["Seawall", 2500], ["Bastion", 5000]],
  "effortTiers": [["Ember", 3], ["Flame", 10], ["Blaze", 25], ["Furnace", 60], ["Inferno", 150]]
}
```

- [ ] **Step 2: Write the failing tests**

In `cdk/lambda/tracker.test.mjs`, **replace** the existing test at lines 137-149 (`'computeSummary sums urges (today + all-time), missing = 0'`) with the following. The first test is the old one with the two new fields added to its assertions; the rest are new.

```js
test('computeSummary sums urges (today + all-time), missing = 0', () => {
  const days = [
    { date: '2026-07-19', prayers: {}, workout: false, sober: false, urges: 3 },
    { date: '2026-07-20', prayers: {}, workout: false, sober: false, urges: 2 },
    { date: '2026-07-21', prayers: {}, workout: false, sober: false, urges: 4 },
  ];
  const s = computeSummary(days, '2026-07-21');
  // No urgeReps on any day: each urge is backfilled at repsPerUrge (10).
  assert.deepEqual(s.urges, { today: 4, total: 9, repsToday: 40, repsTotal: 90 });
  assert.deepEqual(
    computeSummary([{ date: '2026-07-21', prayers: {}, workout: false, sober: false }], '2026-07-21').urges,
    { today: 0, total: 0, repsToday: 0, repsTotal: 0 },
  );
});

test('computeSummary sums explicit urgeReps (today + all-time)', () => {
  const days = [
    { date: '2026-07-20', prayers: {}, workout: false, sober: false, urges: 2, urgeReps: 35 },
    { date: '2026-07-21', prayers: {}, workout: false, sober: false, urges: 3, urgeReps: 48 },
  ];
  const s = computeSummary(days, '2026-07-21');
  assert.equal(s.urges.repsToday, 48);
  assert.equal(s.urges.repsTotal, 83);
  assert.equal(s.urges.total, 5);
});

test('computeSummary backfills reps only for days with no urgeReps field', () => {
  const days = [
    // pre-feature day: no urgeReps -> 4 * 10 = 40
    { date: '2026-07-19', prayers: {}, workout: false, sober: false, urges: 4 },
    // post-feature day: explicit reps win over the urge count
    { date: '2026-07-20', prayers: {}, workout: false, sober: false, urges: 1, urgeReps: 25 },
    // explicit zero is NOT backfilled
    { date: '2026-07-21', prayers: {}, workout: false, sober: false, urges: 1, urgeReps: 0 },
  ];
  const s = computeSummary(days, '2026-07-21');
  assert.equal(s.urges.repsTotal, 65);
  assert.equal(s.urges.repsToday, 0);
});

test('computeSummary coerces junk urgeReps to 0 without backfilling', () => {
  const days = [{ date: '2026-07-21', prayers: {}, workout: false, sober: false, urges: 2, urgeReps: -9 }];
  assert.equal(computeSummary(days, '2026-07-21').urges.repsTotal, 0);
});

test('urge reps do not touch streaks, medals or workout.extra', () => {
  const base = { prayers: { subuh: true, zohor: true, asar: true, maghrib: true, isya: true }, workout: false, sober: true };
  const withReps = [{ date: '2026-07-21', ...base, urges: 9, urgeReps: 900 }];
  const without = [{ date: '2026-07-21', ...base }];
  const a = computeSummary(withReps, '2026-07-21');
  const b = computeSummary(without, '2026-07-21');
  assert.equal(a.sober.current, b.sober.current);
  assert.deepEqual(a.medals, b.medals);
  assert.equal(a.workout.extra, b.workout.extra);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd cdk && npm test`
Expected: FAIL. The first test fails on the `deepEqual` (actual `urges` has no `repsToday`/`repsTotal`); the reps tests fail with `undefined` values.

- [ ] **Step 4: Add the `REPS_PER_URGE` export**

In `cdk/lambda/tracker.mjs`, after line 7 (`export const WEEK_TIERS = cfg.weekTiers;`) add:

```js
export const REPS_PER_URGE = cfg.repsPerUrge;
```

- [ ] **Step 5: Accumulate reps in `computeSummary`**

In `cdk/lambda/tracker.mjs`, replace the two counter declarations at lines 75-76:

```js
  let urgesTotal = 0;
  let urgesToday = 0;
```

with:

```js
  let urgesTotal = 0;
  let urgesToday = 0;
  let repsTotal = 0;
  let repsToday = 0;
```

Then replace lines 80-82 inside the `for (const d of days)` loop:

```js
    const u = Number(d.urges) > 0 ? Math.floor(Number(d.urges)) : 0;
    urgesTotal += u;
    if (d.date === today) urgesToday = u;
```

with:

```js
    const u = Number(d.urges) > 0 ? Math.floor(Number(d.urges)) : 0;
    urgesTotal += u;
    // Days recorded before urgeReps existed are valued at the old fixed
    // prescription. An explicit urgeReps (including 0) is never backfilled.
    const r = d.urgeReps == null
      ? u * REPS_PER_URGE
      : (Number(d.urgeReps) > 0 ? Math.floor(Number(d.urgeReps)) : 0);
    repsTotal += r;
    if (d.date === today) { urgesToday = u; repsToday = r; }
```

- [ ] **Step 6: Return the new fields**

In `cdk/lambda/tracker.mjs`, replace line 144:

```js
    urges: { today: urgesToday, total: urgesTotal },
```

with:

```js
    urges: { today: urgesToday, total: urgesTotal, repsToday, repsTotal },
```

- [ ] **Step 7: Fix the stale comment in the CDK stack**

In `cdk/lib/site-stack.ts` line 62, the comment names the retired tier family. Replace:

```ts
    // Single source of truth for rule numbers (workout target, streak/wave tiers),
```

with:

```ts
    // Single source of truth for rule numbers (workout target, streak/rep/effort tiers),
```

No logic change — the stack spreads the whole config object into the served `config.json`, so the new keys flow automatically.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd cdk && npm test`
Expected: `# pass 31`, `# fail 0`. (Baseline is 27: `tracker.test.mjs` had 16, and this task replaces 1 test with a 5-test block → 20.)

- [ ] **Step 9: Verify the CDK stack still synthesizes**

Run: `cd cdk && npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 10: Commit**

```bash
git add cdk/lambda/lockin-config.json cdk/lambda/tracker.mjs cdk/lambda/tracker.test.mjs cdk/lib/site-stack.ts
git commit -m "feat(lockin): derive urge reps totals with pre-feature backfill

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lambda — validate and store `urgeReps`

**Files:**
- Modify: `cdk/lambda/index.mjs:58-62` (add normalizer), `:70-77` (`trackerDays`), `:110-122` (POST `UpdateCommand`)
- Test: `cdk/lambda/index.test.mjs`

**Interfaces:**
- Consumes: `computeSummary` reading `d.urgeReps` with `== null` meaning "absent" (Task 1).
- Produces: `normalizeUrgeReps(v) -> number` exported from `index.mjs`, clamped `0..100000`. The `POST` body accepts `urgeReps`. `trackerDays` rows carry `urgeReps: number | undefined`.

- [ ] **Step 1: Write the failing test**

Append to `cdk/lambda/index.test.mjs`, and add `normalizeUrgeReps` to the import on line 3 so it reads:

```js
import { validTrackerDate, normalizePrayers, normalizeUrges, normalizeUrgeReps } from './index.mjs';
```

```js
test('normalizeUrgeReps coerces to a clamped non-negative integer', () => {
  assert.equal(normalizeUrgeReps('15'), 15);
  assert.equal(normalizeUrgeReps(12.7), 12);
  assert.equal(normalizeUrgeReps(-4), 0);
  assert.equal(normalizeUrgeReps(999999), 100000);
  assert.equal(normalizeUrgeReps(undefined), 0);
  assert.equal(normalizeUrgeReps('x'), 0);
  assert.equal(normalizeUrgeReps(0), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cdk && npm test`
Expected: FAIL with `normalizeUrgeReps is not a function`.

- [ ] **Step 3: Add the normalizer**

In `cdk/lambda/index.mjs`, after the `normalizeUrges` function (ends line 62) add:

```js
export function normalizeUrgeReps(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100000);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cdk && npm test`
Expected: PASS, 32 tests.

- [ ] **Step 5: Pass `urgeReps` through `trackerDays` preserving absence**

In `cdk/lambda/index.mjs`, replace the `map` body at lines 70-76:

```js
  return Items.map((it) => ({
    date: it.voter,
    prayers: it.prayers || {},
    workout: it.workout === true,
    sober: it.sober === true,
    urges: normalizeUrges(it.urges),
  })).sort((a, b) => a.date.localeCompare(b.date));
```

with:

```js
  return Items.map((it) => ({
    date: it.voter,
    prayers: it.prayers || {},
    workout: it.workout === true,
    sober: it.sober === true,
    urges: normalizeUrges(it.urges),
    // Left undefined when the attribute is absent, so computeSummary can tell a
    // pre-feature day (backfill) from a real zero. Do NOT coerce this to 0.
    urgeReps: it.urgeReps == null ? undefined : normalizeUrgeReps(it.urgeReps),
  })).sort((a, b) => a.date.localeCompare(b.date));
```

- [ ] **Step 6: Store `urgeReps` on POST**

In `cdk/lambda/index.mjs`, replace the `UpdateExpression` string at lines 113-114:

```js
          UpdateExpression:
            'SET prayers = :pr, workout = :w, sober = :s, urges = :ur, updatedAt = :u, createdAt = if_not_exists(createdAt, :u)',
```

with:

```js
          UpdateExpression:
            'SET prayers = :pr, workout = :w, sober = :s, urges = :ur, urgeReps = :urr, updatedAt = :u, createdAt = if_not_exists(createdAt, :u)',
```

and add the value to the `ExpressionAttributeValues` object (after the `':ur'` line, currently line 119):

```js
            ':urr': normalizeUrgeReps(body.urgeReps),
```

- [ ] **Step 7: Verify the whole suite still passes and the wiring is present**

Run: `cd cdk && npm test`
Expected: PASS, 32 tests.

Run: `grep -c "normalizeUrgeReps" lambda/index.mjs`
Expected: `3` (the definition, `trackerDays`, and the POST value).

- [ ] **Step 8: Commit**

```bash
git add cdk/lambda/index.mjs cdk/lambda/index.test.mjs
git commit -m "feat(lockin): validate and persist urgeReps on the day item

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Decision function — `waveBadges` becomes `repBadges`

**Files:**
- Modify: `plan/lockin.html:491-520` (the `/*__CELEB_START__*/` … `/*__CELEB_END__*/` block), `plan/lockin.html:364-374` (`runCelebrations`)
- Test: `cdk/lambda/reward.test.mjs`

**Interfaces:**
- Consumes: `summary.urges.repsTotal` (Task 1).
- Produces: `celebrationsFor(prev, next, repTiers, effortTiers)` returning `{ countUp, mints, dailyComplete, repBadges, effortBadges }`. `repBadges` is an array of tier names crossed. `mintRep(name)` is referenced by `runCelebrations` and defined in Task 4 — until then it is the existing `mintWave`, renamed in Task 4.

**Note on the sentinels:** `cdk/lambda/reward.test.mjs` extracts this block with a regex and evaluates it via `new Function`. Keep both sentinel comments exactly as they are, and keep the block free of any reference to page globals or the DOM — it must stay pure.

- [ ] **Step 1: Write the failing tests**

In `cdk/lambda/reward.test.mjs`, make these changes.

First, update the shared `state()` helper (lines 12-22) so its `urges` object carries the new fields — replace line 19:

```js
      urges: { today: 0, total: 0 },
```

with:

```js
      urges: { today: 0, total: 0, repsToday: 0, repsTotal: 0 },
```

Second, replace `waveBadges: []` with `repBadges: []` in the three full-object `deepEqual` assertions (lines 26, 47, 50), so they read:

```js
  assert.deepEqual(r, { countUp: [], mints: [], dailyComplete: false, repBadges: [], effortBadges: [] });
```

```js
  assert.deepEqual(celebrationsFor(state(), state()), { countUp: [], mints: [], dailyComplete: false, repBadges: [], effortBadges: [] });
```

```js
  assert.deepEqual(celebrationsFor(state(), lower), { countUp: [], mints: [], dailyComplete: false, repBadges: [], effortBadges: [] });
```

Third, **replace** the two wave tests (lines 61-80, named `'celebrationsFor flags a wave badge when total crosses a threshold'` and `'celebrationsFor uses the passed wave tiers'`) with:

```js
test('celebrationsFor flags a rep badge when reps total crosses a threshold', () => {
  const withReps = (repsTotal) => state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total: 1, repsToday: 10, repsTotal },
  } });
  assert.deepEqual(celebrationsFor(withReps(95), withReps(105)).repBadges, ['Stone']);
  assert.deepEqual(celebrationsFor(withReps(499), withReps(512)).repBadges, ['Jetty']);
  // one entry per threshold crossed, even if a single set clears two
  assert.deepEqual(celebrationsFor(withReps(90), withReps(600)).repBadges, ['Stone', 'Jetty']);
  assert.deepEqual(celebrationsFor(withReps(120), withReps(130)).repBadges, []);
  assert.deepEqual(celebrationsFor(null, withReps(105)).repBadges, []);
});

test('celebrationsFor uses the passed rep tiers', () => {
  var s = function (repsTotal) { return state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total: 1, repsToday: 3, repsTotal: repsTotal },
  } }); };
  assert.deepEqual(celebrationsFor(s(2), s(3), [['Tiny', 3]]).repBadges, ['Tiny']);
});

test('celebrationsFor ignores the urge count — only reps earn badges', () => {
  var s = function (total, repsTotal) { return state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total: total, repsToday: 0, repsTotal: repsTotal },
  } }); };
  // urge count leaps past every old wave threshold; reps do not move
  assert.deepEqual(celebrationsFor(s(9, 50), s(600, 50)).repBadges, []);
});
```

Finally, in the effort-badge test (lines 82-91), update the `urges` line inside its `state()` override to include the new fields:

```js
    urges: { today: 0, total: 0, repsToday: 0, repsTotal: 0 },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cdk && npm test`
Expected: FAIL — `repBadges` is `undefined` in the new tests, and the full-object `deepEqual`s mismatch because the actual object still has `waveBadges`.

- [ ] **Step 3: Rewrite the decision block**

In `plan/lockin.html`, replace the whole sentinel-bracketed block at lines 491-520 with:

```js
    /*__CELEB_START__*/
    function celebrationsFor(prev, next, repTiers, effortTiers) {
      var PR = ['subuh', 'zohor', 'asar', 'maghrib', 'isya'];
      var TIERS = ['bronze', 'silver', 'gold', 'sapphire', 'diamond', 'comeback'];
      var out = { countUp: [], mints: [], dailyComplete: false, repBadges: [], effortBadges: [] };
      if (!prev) return out;
      ['prayers', 'sober', 'workout'].forEach(function (h) {
        if (next.summary[h].current > prev.summary[h].current) out.countUp.push(h);
      });
      TIERS.forEach(function (t) {
        if ((next.summary.medals[t] || 0) > (prev.summary.medals[t] || 0)) out.mints.push(t);
      });
      var complete = function (st) {
        var d = null, i;
        for (i = 0; i < st.days.length; i++) if (st.days[i].date === st.today) d = st.days[i];
        if (!d) return false;
        return PR.every(function (p) { return d.prayers && d.prayers[p] === true; }) && d.sober === true;
      };
      if (complete(next) && !complete(prev)) out.dailyComplete = true;
      // Badges track reps paid, never the urge count.
      var REPS = repTiers || [['Stone', 100], ['Jetty', 500], ['Breakwater', 1000], ['Seawall', 2500], ['Bastion', 5000]];
      var pr = (prev.summary.urges && prev.summary.urges.repsTotal) || 0;
      var nr = (next.summary.urges && next.summary.urges.repsTotal) || 0;
      REPS.forEach(function (w) { if (pr < w[1] && nr >= w[1]) out.repBadges.push(w[0]); });
      var EFFORT = effortTiers || [['Ember', 3], ['Flame', 10], ['Blaze', 25], ['Furnace', 60], ['Inferno', 150]];
      var pe = (prev.summary.workout && prev.summary.workout.extra) || 0;
      var ne = (next.summary.workout && next.summary.workout.extra) || 0;
      EFFORT.forEach(function (w) { if (pe < w[1] && ne >= w[1]) out.effortBadges.push(w[0]); });
      return out;
    }
    /*__CELEB_END__*/
```

- [ ] **Step 4: Update `runCelebrations`**

In `plan/lockin.html`, replace lines 364-374:

```js
    function runCelebrations(prev, next) {
      var c = celebrationsFor(prev, next, WAVE_TIERS, EFFORT_TIERS);
```

…through the `effortBadges` line, with:

```js
    function runCelebrations(prev, next) {
      var c = celebrationsFor(prev, next, REP_TIERS, EFFORT_TIERS);
      c.countUp.forEach(function (h) {
        var cap = h.charAt(0).toUpperCase() + h.slice(1);
        countUp(el('num' + cap), prev.summary[h].current, next.summary[h].current);
      });
      c.mints.forEach(function (tier, i) { setTimeout(function () { mint(tier); }, i * 320); });
      c.repBadges.forEach(function (name, i) { setTimeout(function () { mintRep(name); }, (c.mints.length + i) * 320); });
      c.effortBadges.forEach(function (name, i) { setTimeout(function () { mintEffort(name); }, (c.mints.length + c.repBadges.length + i) * 320); });
      if (c.dailyComplete) setTimeout(celebrateDaily, c.mints.length ? 400 : 0);
    }
```

`REP_TIERS` and `mintRep` do not exist yet — they arrive in Task 4. The page will throw on a celebration until then, which is why Task 4 must land before any deploy. Tests in this task exercise only the extracted pure block, so they pass regardless.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd cdk && npm test`
Expected: `# pass 33`, `# fail 0`. (`reward.test.mjs` goes 8 → 9: two wave tests removed, three rep tests added.)

- [ ] **Step 6: Verify no `waveBadges` reference survives**

Run: `grep -rn "waveBadges" plan/ cdk/lambda/`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add plan/lockin.html cdk/lambda/reward.test.mjs
git commit -m "feat(lockin): celebrationsFor decides rep badges from repsTotal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Seawall art, tiers, card stat line and achievements grid

**Files:**
- Modify: `plan/lockin.html:207` (the urge stat markup), `:382` and `:384-392` (tiers + art), `:402-409` (`currentWaveBadge`), `:410-423` (`mintWave`), `:438-444` (`paintUrges`), `:596-599` (`renderAchievements`), `:762` (config load)

**Interfaces:**
- Consumes: `summary.urges.repsTotal` / `.repsToday` / `.total` (Task 1); `repTiers` and `repsPerUrge` in the served `config.json` (Task 1); `mintRep` is called by `runCelebrations` (Task 3).
- Produces: `REP_TIERS` (array), `REPS_PER_URGE` (number, page-side), `wallSvg(size) -> string`, `currentRepBadge(repsTotal) -> {earned, next, toGo}`, `mintRep(name)`. Task 5 consumes `REPS_PER_URGE` for the prescription and calls `paintUrges` indirectly via `save()`.

- [ ] **Step 1: Replace the tier constants**

In `plan/lockin.html`, replace line 382:

```js
    var WAVE_TIERS = [['Ripple', 10], ['Swell', 50], ['Breaker', 100], ['Tide', 250], ['Ocean', 500]];
```

with:

```js
    var REP_TIERS = [['Stone', 100], ['Jetty', 500], ['Breakwater', 1000], ['Seawall', 2500], ['Bastion', 5000]];
    var REPS_PER_URGE = 10;
```

- [ ] **Step 2: Replace `waveBadgeSvg` with `wallSvg`**

In `plan/lockin.html`, replace the `waveBadgeSvg` function at lines 384-392 with the seawall art (prototype variant C — a wave curling into a solid vertical wall). Note the two ids: one for the gradient, one for the clip path, both seeded from `svgSeq` so the grid can render many at once.

```js
    function wallSvg(size) {
      var id = 'wl_' + (svgSeq++);
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 102 102">' +
        '<defs><radialGradient id="' + id + '" cx="40%" cy="27%" r="76%">' +
        '<stop offset="0%" stop-color="#e4edf4"/><stop offset="52%" stop-color="#5f7890"/>' +
        '<stop offset="100%" stop-color="#1e2b37"/></radialGradient>' +
        '<clipPath id="' + id + 'c"><circle cx="51" cy="51" r="42"/></clipPath></defs>' +
        '<circle cx="51" cy="51" r="42" fill="url(#' + id + ')"/>' +
        '<g clip-path="url(#' + id + 'c)">' +
        '<path d="M58 9 h13 v84 H58 z" fill="#f0f5fa" opacity=".95"/>' +
        '<path d="M58 30 h13 M58 51 h13 M58 72 h13" stroke="#93a8bb" stroke-width="2.2" opacity=".65"/>' +
        '<path d="M14 72 q4 -26 24 -26 q14 0 18 14 q-10 -6 -16 2 q-6 8 2 14 q-16 4 -28 -4 z" fill="#4b90d4" opacity=".92"/>' +
        '<path d="M12 82 q12 -7 24 -1 t22 -1" fill="none" stroke="#bfdff7" stroke-width="3.6" stroke-linecap="round" opacity=".85"/>' +
        '</g>' +
        '<circle cx="51" cy="51" r="42" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2"/></svg>';
    }
```

- [ ] **Step 3: Rename the tier lookup**

In `plan/lockin.html`, replace `currentWaveBadge` at lines 402-409 with:

```js
    function currentRepBadge(total) {
      var earned = null, next = null, i;
      for (i = 0; i < REP_TIERS.length; i++) {
        if (total >= REP_TIERS[i][1]) earned = REP_TIERS[i][0];
        else { next = REP_TIERS[i]; break; }
      }
      return { earned: earned, next: next, toGo: next ? next[1] - total : 0 };
    }
```

- [ ] **Step 4: Rename `mintWave` to `mintRep` and use the new art**

In `plan/lockin.html`, in the function at lines 410-423, change the declaration line from `function mintWave(name) {` to `function mintRep(name) {`, and change line 415 from `waveBadgeSvg(120)` to `wallSvg(120)`. Everything else in that function stays as it is.

- [ ] **Step 5: Update the Sober-card stat markup**

In `plan/lockin.html`, replace line 207:

```html
        <div class="urgestat"><span class="wavebadge" id="waveBadge"></span><span class="urgecount"><b id="urToday">0</b> today · <b id="urAll">0</b> all-time</span></div>
```

with:

```html
        <div class="urgestat"><span class="wavebadge" id="repBadge"></span><span class="urgecount"><b id="urReps">0</b> reps · <b id="urAll">0</b> urges</span></div>
        <div class="urgetogo" id="urgeToGo"></div>
```

- [ ] **Step 6: Add the to-go line's style**

In `plan/lockin.html`, after line 80 (`.urgecount b{...}`) add:

```css
  .urgetogo{text-align:center;font-size:10.5px;color:var(--dim);margin-top:5px}
  .urgetogo b{font-family:'Fraunces',serif;color:var(--sea-ink2)}
```

- [ ] **Step 7: Rewrite `paintUrges`**

In `plan/lockin.html`, replace `paintUrges` at lines 438-444 with:

```js
    function paintUrges(s) {
      var u = s.urges || {};
      var reps = u.repsTotal || 0, urges = u.total || 0;
      el('urReps').textContent = reps.toLocaleString();
      el('urAll').textContent = urges.toLocaleString();
      var b = currentRepBadge(reps);
      el('repBadge').innerHTML = b.earned ? wallSvg(30) : '';
      el('urgeToGo').innerHTML = b.next
        ? '<b>' + b.toGo.toLocaleString() + '</b> reps to ' + b.next[0]
        : 'Bastion — the last one.';
    }
```

- [ ] **Step 8: Swap the achievements cells**

In `plan/lockin.html`, replace lines 596-599:

```js
      var total = (s.urges && s.urges.total) || 0;
      WAVE_TIERS.forEach(function (w) {
        cells += acell(w[0], waveBadgeSvg(46), total >= w[1] ? 1 : 0, w[1] + ' urges ridden');
      });
```

with:

```js
      var reps = (s.urges && s.urges.repsTotal) || 0;
      var urgeCt = (s.urges && s.urges.total) || 0;
      REP_TIERS.forEach(function (w) {
        cells += acell(w[0], wallSvg(46), reps >= w[1] ? 1 : 0, w[1].toLocaleString() + ' reps paid',
          reps.toLocaleString() + ' reps across ' + urgeCt.toLocaleString() + ' urges');
      });
```

Then give `acell` the optional 5th argument. Replace lines 585-589:

```js
    function acell(nm, art, ct, why) {
      var locked = ct === 0;
      return '<div class="amed ' + (locked ? 'locked' : '') + '" data-nm="' + nm + '" data-ct="' + ct + '" data-why="' + why + '">' +
        art + '<span class="nm">' + nm + '</span><span class="ct">' + (locked ? '—' : '×' + ct) + '</span></div>';
    }
```

with:

```js
    function acell(nm, art, ct, why, ctx) {
      var locked = ct === 0;
      return '<div class="amed ' + (locked ? 'locked' : '') + '" data-nm="' + nm + '" data-ct="' + ct +
        '" data-why="' + why + '"' + (ctx ? ' data-ctx="' + ctx + '"' : '') + '>' +
        art + '<span class="nm">' + nm + '</span><span class="ct">' + (locked ? '—' : '×' + ct) + '</span></div>';
    }
```

And in the `awardsGrid` click handler, replace the `exc` span line (line 734) so a badge carrying context shows it instead of the meaningless `×1`:

```js
        '<span class="exc">' + (c.dataset.ctx ? c.dataset.ctx : (earned ? 'Collected ×' + ct : 'Not yet collected')) + '</span>';
```

- [ ] **Step 9: Read the new config keys**

In `plan/lockin.html`, replace line 762:

```js
        if (cfg.waveTiers) WAVE_TIERS = cfg.waveTiers;
```

with:

```js
        if (cfg.repTiers) REP_TIERS = cfg.repTiers;
        if (cfg.repsPerUrge) REPS_PER_URGE = cfg.repsPerUrge;
```

- [ ] **Step 10: Verify the script parses and no retired name survives**

Extract and syntax-check the page script (there is no browser in this environment):

```bash
cd /Users/amirnurhakim/jarvis/personal
python3 - <<'PY' > /tmp/lockin-check.js
import re
h = open('plan/lockin.html').read()
for m in re.finditer(r'<script>(.*?)</script>', h, re.S):
    print(m.group(1))
PY
node --check /tmp/lockin-check.js && echo "JS OK"
```

Expected: `JS OK`

Run: `grep -n "waveBadgeSvg\|WAVE_TIERS\|currentWaveBadge\|mintWave\|waveTiers\|urToday" plan/lockin.html`
Expected: no output.

Run: `grep -c "wallSvg" plan/lockin.html`
Expected: `4` (definition, `mintRep`, `paintUrges`, `renderAchievements`).

- [ ] **Step 11: Confirm the tests still pass**

Run: `cd cdk && npm test`
Expected: `# pass 33`, `# fail 0`. (The sentinel block is untouched by this task; this guards against an accidental edit inside it.)

- [ ] **Step 12: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(lockin): seawall badge art, rep tiers and reps-based card stat

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Reps-entry overlay replaces the guided wave

**Files:**
- Modify: `plan/lockin.html:82-95` (overlay CSS), `:249-254` (overlay markup), `:445-484` (canvas wave JS — deleted and replaced), `:714-723` (urge button + overlay buttons), `:549-550` (`todayRow` seeding), `:685` (POST body)

**Interfaces:**
- Consumes: `REPS_PER_URGE` (Task 4), `wallSvg` indirectly via `mintRep` (Task 4), `save()` and `todayRow` (existing), `normalizeUrgeReps` server-side (Task 2).
- Produces: nothing consumed by later tasks.

**Why the wave code goes rather than stays:** it is ~40 lines of canvas animation plus a `resize` listener, all reachable only from the retired overlay. Leaving it in place would be dead code in a file that is already the largest artifact in the repo.

- [ ] **Step 1: Replace the overlay CSS**

In `plan/lockin.html`, replace lines 82-95 (from `#ov{position:fixed;...}` through `#doneBtn{background:var(--gold);...}`) with:

```css
  #ov{position:fixed;inset:0;background:#07101a;display:none;flex-direction:column;align-items:center;
    justify-content:center;z-index:70;padding:28px}
  :root[data-theme="dawn"] #ov{background:#f4ecdd}
  #ov.on{display:flex}
  .rx{font-family:'Fraunces',serif;font-weight:900;font-size:38px;color:var(--sea-ink);line-height:1;text-align:center}
  .rxs{color:var(--mut);font-size:12px;margin-top:8px;text-align:center}
  .stepper{display:flex;align-items:center;gap:18px;margin-top:34px}
  .stepper button{width:56px;height:56px;border-radius:50%;border:1px solid var(--edge);background:var(--card);
    color:var(--ink);font-size:25px;line-height:1;cursor:pointer;transition:transform .08s}
  .stepper button:active{transform:scale(.94)}
  .repnum{font-family:'Fraunces',serif;font-weight:900;font-size:56px;color:var(--gold);min-width:116px;
    text-align:center;line-height:1}
  .chips{display:flex;gap:8px;margin-top:20px}
  .chips button{border:1px solid var(--edge);background:transparent;color:var(--mut);border-radius:999px;
    padding:8px 15px;font:500 12px/1 'Inter';cursor:pointer}
  .chips button.on{border-color:var(--sea);color:var(--sea-ink);background:var(--seabg)}
  .ovline{color:var(--dim);font-size:11.5px;margin-top:26px;text-align:center}
  #doneBtn{margin-top:22px;width:100%;max-width:300px;border:none;border-radius:12px;padding:15px;
    font:600 15px/1 'Inter';cursor:pointer;background:var(--gold);color:#0d141c}
```

- [ ] **Step 2: Replace the overlay markup**

In `plan/lockin.html`, replace lines 249-254:

```html
  <div id="ov" aria-hidden="true">
    <canvas id="ovCanvas"></canvas>
    <div class="ovtop"><div class="phase" id="ovPhase">Building</div><div class="guide" id="ovGuide">It rises and passes. Ride it.</div></div>
    <div class="breath"><div class="bring" id="ovRing"></div><div class="word" id="ovWord">Breathe in</div></div>
    <div class="ovbtns"><button id="okBtn" type="button">I'm okay now</button><button id="doneBtn" type="button">Done</button></div>
  </div>
```

with:

```html
  <div id="ov" aria-hidden="true">
    <div class="rx" id="rxTitle">10 push-ups</div>
    <div class="rxs">Do them now. Then log what you did.</div>
    <div class="stepper">
      <button id="repMinus" type="button" aria-label="fewer reps">−</button>
      <div class="repnum" id="repNum">10</div>
      <button id="repPlus" type="button" aria-label="more reps">+</button>
    </div>
    <div class="chips" id="repChips"></div>
    <div class="ovline">It came. You paid it. That is the record.</div>
    <button id="doneBtn" type="button">Done</button>
  </div>
```

This stays before `<script>`, as the wave overlay did.

- [ ] **Step 3: Delete the canvas wave JS and add the reps overlay JS**

In `plan/lockin.html`, delete lines 445-484 in full — that is `var OV_DUR = 60000, ...` through the `addEventListener('resize', ...)` line, covering `ovSize`, `ovFrame`, `ovFinish`, `ovOpen`, `ovClose` and the resize handler. Replace them with:

```js
    var REP_CHIPS = [10, 15, 20, 25];
    var pendingReps = 10;
    function setPendingReps(n) {
      pendingReps = Math.max(1, Math.min(500, n));
      el('repNum').textContent = pendingReps;
      Array.prototype.forEach.call(el('repChips').children, function (b) {
        b.classList.toggle('on', +b.dataset.n === pendingReps);
      });
    }
    function ovOpen() {
      el('rxTitle').textContent = REPS_PER_URGE + ' push-ups';
      setPendingReps(REPS_PER_URGE);
      el('ov').classList.add('on');
      el('ov').setAttribute('aria-hidden', 'false');
    }
    function ovClose() { el('ov').classList.remove('on'); el('ov').setAttribute('aria-hidden', 'true'); }
```

Note `el` is declared at line 486 (after this point) but as a `var` function expression assigned before any of these run — the existing code already calls `el` from functions defined above it, so this matches the file's established pattern.

- [ ] **Step 4: Seed and send `urgeReps`**

In `plan/lockin.html`, replace lines 549-550:

```js
      todayRow = todayItem ? { prayers: Object.assign({}, todayItem.prayers), workout: todayItem.workout, sober: todayItem.sober, urges: todayItem.urges || 0 }
                           : { prayers: {}, workout: false, sober: false, urges: 0 };
```

with:

```js
      todayRow = todayItem ? { prayers: Object.assign({}, todayItem.prayers), workout: todayItem.workout, sober: todayItem.sober, urges: todayItem.urges || 0, urgeReps: todayItem.urgeReps || 0 }
                           : { prayers: {}, workout: false, sober: false, urges: 0, urgeReps: 0 };
```

Then in the POST body at line 685, add `urgeReps` after `urges`:

```js
        body: JSON.stringify({ poll: POLL, date: today, prayers: todayRow.prayers, workout: todayRow.workout, sober: todayRow.sober, urges: todayRow.urges, urgeReps: todayRow.urgeReps }),
```

- [ ] **Step 5: Rewire the urge button and the overlay controls**

In `plan/lockin.html`, replace lines 714-723:

```js
    el('urgeBtn').addEventListener('click', function () {
      todayRow.urges = (todayRow.urges || 0) + 1;      // the choice to surf is the win — bank on tap
      el('urToday').textContent = +el('urToday').textContent + 1;
      el('urAll').textContent = +el('urAll').textContent + 1;
      buzz(15);
      save();                                          // POST includes urges; response re-renders + wave-badge mint
      ovOpen();
    });
    el('okBtn').addEventListener('click', ovClose);
    el('doneBtn').addEventListener('click', ovClose);
```

with:

```js
    el('repChips').innerHTML = REP_CHIPS.map(function (n) {
      return '<button type="button" data-n="' + n + '">' + n + '</button>';
    }).join('');
    el('repChips').addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.n) { setPendingReps(+e.target.dataset.n); buzz(10); }
    });
    el('repMinus').addEventListener('click', function () { setPendingReps(pendingReps - 1); });
    el('repPlus').addEventListener('click', function () { setPendingReps(pendingReps + 1); });

    // Tap opens the prescription; nothing is recorded until Done, so the count
    // reflects the set actually done.
    el('urgeBtn').addEventListener('click', function () { buzz(15); ovOpen(); });
    el('doneBtn').addEventListener('click', function () {
      ovClose();
      todayRow.urges = (todayRow.urges || 0) + 1;
      todayRow.urgeReps = (todayRow.urgeReps || 0) + pendingReps;
      buzz(15);
      save();      // POST carries both; the response re-renders and mints any rep badge
    });
```

- [ ] **Step 6: Verify the script parses and the retired wave code is gone**

```bash
cd /Users/amirnurhakim/jarvis/personal
python3 - <<'PY' > /tmp/lockin-check.js
import re
h = open('plan/lockin.html').read()
for m in re.finditer(r'<script>(.*?)</script>', h, re.S):
    print(m.group(1))
PY
node --check /tmp/lockin-check.js && echo "JS OK"
```

Expected: `JS OK`

Run: `grep -n "ovCanvas\|ovFrame\|ovPhase\|ovGuide\|ovWord\|ovRing\|okBtn\|OV_DUR\|BR_IN\|BR_OUT\|ovSize\|ovFinish\|devicePixelRatio" plan/lockin.html`
Expected: no output.

- [ ] **Step 7: Verify every wired element exists before the script**

Every id the IIFE touches must appear earlier in the file than `<script>`, or the page throws at load and nothing works. Check the new ones:

```bash
cd /Users/amirnurhakim/jarvis/personal
python3 - <<'PY'
import re
h = open('plan/lockin.html').read()
si = h.index('<script>')
ids = set(re.findall(r'id="([^"]+)"', h[:si]))
wired = set(re.findall(r"el\('([^']+)'\)", h))
missing = sorted(w for w in wired if w not in ids)
print('MISSING:', missing if missing else 'none')
PY
```

Expected: `MISSING: none`

- [ ] **Step 8: Check the markup is well-formed**

Run: `tidy -q -e plan/lockin.html 2>&1 | grep -i "error" || echo "no errors"`
Expected: `no errors` (warnings are acceptable; the file already produces some).

- [ ] **Step 9: Confirm the suite still passes**

Run: `cd cdk && npm test`
Expected: `# pass 33`, `# fail 0`.

- [ ] **Step 10: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(lockin): reps-entry overlay replaces the guided breathing wave

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Documentation and final verification

**Files:**
- Modify: `HANDOVER.md:44-51` (summary shape), `:56-67` (config block), `:69-92` (feature inventory), `:84` (achievements bullet), `:109` (DOM-order gotcha), `:118` (colours)
- Modify: `README.md:59` (feature summary line)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Update the summary shape in HANDOVER.md**

In `HANDOVER.md`, in the `summary` shape block (lines 44-51), replace the `urges` line:

```
  urges:         { today, total }
```

with:

```
  urges:         { today, total, repsToday, repsTotal }
```

- [ ] **Step 2: Update the config block in HANDOVER.md**

In `HANDOVER.md`, in the JSON block at lines 56-62, replace the `waveTiers` line:

```json
  "waveTiers": [["Ripple",10],["Swell",50],["Breaker",100],["Tide",250],["Ocean",500]],
```

with:

```json
  "repsPerUrge": 10,
  "repTiers":  [["Stone",100],["Jetty",500],["Breakwater",1000],["Seawall",2500],["Bastion",5000]],
```

Then in the bullets below it (lines 63-67), replace `WORKOUT_TARGET`, `DAY_TIERS`, `WEEK_TIERS` with `WORKOUT_TARGET`, `DAY_TIERS`, `WEEK_TIERS`, `REPS_PER_URGE`, and replace `dayTiers`/`weekTiers`/`waveTiers`/`effortTiers` with `dayTiers`/`weekTiers`/`repTiers`/`repsPerUrge`/`effortTiers`.

- [ ] **Step 3: Update the feature inventory in HANDOVER.md**

In `HANDOVER.md`, replace the **Urge surfing** bullet (lines 79-81):

```
- **Urge surfing:** "Ride out an urge" on the Sober card → a guided **wave overlay** (swell/
  crest/recede + breath cue), banks a "wave ridden" on tap; **wave badges** (Ripple…Ocean)
  at urge-total milestones.
```

with:

```
- **Urge reps:** "Ride out an urge" on the Sober card → an overlay prescribing
  **10 push-ups** (`repsPerUrge`); you do them, adjust the count, tap Done — which banks one
  urge and the reps. **Seawall badges** (Stone…Bastion) at **reps-paid** milestones. The urge
  count is context, never a badge: a badge on urges logged would be a badge for having urges.
  Days recorded before `urgeReps` existed are backfilled at 10 reps per urge on read.
```

Then in the `celebrationsFor` bullet (lines 90-92), replace `celebrationsFor(prev, next, waveTiers, effortTiers)` with `celebrationsFor(prev, next, repTiers, effortTiers)`.

Then in the Colours line (line 118), replace `calming blue for the urge wave` with `calming blue for the urge block, stone-grey for seawall badges`.

- [ ] **Step 4: Fix the three remaining stale references**

These use the bare word "wave" and so are not caught by the Step 5 grep — do them explicitly.

In `HANDOVER.md` line 84, the Achievements bullet, replace:

```
- **Achievements tab:** one centered grid of every badge (streak tiers + Comeback + wave +
```

with:

```
- **Achievements tab:** one centered grid of every badge (streak tiers + Comeback + seawall +
```

In `HANDOVER.md` line 109, the DOM-order gotcha names an element that no longer exists. Keep the lesson, drop the stale reference — replace:

```
  `<script>`. Putting the wave overlay *after* the script once made `el('okBtn')` null →
```

with:

```
  `<script>`. Putting an overlay *after* the script once made a wired `el(...)` lookup null →
```

In `README.md` line 59, replace `with wave badges, extra-effort flame badges,` with `with seawall rep badges, extra-effort flame badges,`.

- [ ] **Step 5: Verify no retired vocabulary survives anywhere**

Run: `grep -rn "waveTiers\|WAVE_TIERS\|waveBadge\|urge surfing\|Ripple\|Swell\|Breaker\|Ocean" plan/ cdk/lambda/ cdk/lib/ HANDOVER.md README.md`
Expected: no output. (The retired **spec** at `docs/superpowers/specs/2026-07-23-lock-in-urge-surfing-design.md` keeps its wording — it is a historical record and is deliberately excluded from this grep.)

- [ ] **Step 6: Full verification sweep**

Run each and confirm the expected result before claiming completion:

```bash
cd /Users/amirnurhakim/jarvis/personal/cdk && npm test
```
Expected: `# pass 33`, `# fail 0`

```bash
cd /Users/amirnurhakim/jarvis/personal/cdk && npx tsc --noEmit -p tsconfig.json
```
Expected: clean, no output

```bash
cd /Users/amirnurhakim/jarvis/personal
python3 - <<'PY' > /tmp/lockin-check.js
import re
h = open('plan/lockin.html').read()
for m in re.finditer(r'<script>(.*?)</script>', h, re.S):
    print(m.group(1))
PY
node --check /tmp/lockin-check.js && echo "JS OK"
```
Expected: `JS OK`

```bash
cd /Users/amirnurhakim/jarvis/personal && git status --porcelain
```
Expected: empty (everything committed)

- [ ] **Step 7: Commit**

```bash
git add HANDOVER.md README.md
git commit -m "docs: HANDOVER + README — urge reps and seawall badges replace the wave

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Hand the deploy to the user**

Do **not** run the deploy. Report to the user:

> All six tasks are done: 33 tests pass, the page script parses, and the CDK stack
> type-checks. Deploy with `cd cdk && npm run deploy`, then on your phone check:
> tap **Ride out an urge** → the overlay reads `10 push-ups` → adjust to 15 → **Done**
> → the card shows reps +15 and urges +1; crossing 100 reps mints **Stone**; the
> Achievements grid shows five seawall badges with locked ones blurred; the sober
> streak and the flame badges are unchanged; and your previously earned badges are
> still there (backfilled at 10 reps per past urge).

---

## Notes for the implementer

**On the backfill (the one non-obvious decision).** `computeSummary` distinguishes a
pre-feature day (attribute absent → value it at `urges * REPS_PER_URGE`) from a real zero
(`urgeReps: 0` → contributes 0). This only works because `trackerDays` in Task 2 leaves
`urgeReps` **undefined** rather than coercing it to 0. If you "tidy" that into
`normalizeUrgeReps(it.urgeReps)`, every historical day silently drops to 0 reps and the user
loses every seawall badge they had. The test `'computeSummary backfills reps only for days
with no urgeReps field'` is what catches this.

**On intermediate breakage.** Task 3 introduces references to `REP_TIERS` and `mintRep`,
which Task 4 defines. Between those two commits the page would throw during a celebration.
That is acceptable because the user deploys only after Task 6, and every commit keeps
`npm test` green (the tested block is pure and self-contained). Do not deploy mid-plan.

**Rep badge art.** Variant C from the brainstorming prototype
(`scratchpad/urge-reps-proto.html`, served during design). If the user wants a different
variant after seeing it on a real screen, the change is confined to the body of `wallSvg`.
