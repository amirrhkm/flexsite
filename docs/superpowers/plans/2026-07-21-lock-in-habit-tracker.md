# Lock In — Habit Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private single-user daily habit tracker (prayers / workout / sober) as a new static page on the existing S3 + Lambda Function URL + DynamoDB stack, with streak + medal progress visualisation.

**Architecture:** A new static page `plan/lockin.html` is auto-deployed by the existing `BucketDeployment`. The existing `VoteFn` Lambda is extended to handle a tracker contract (routed by poll id `"lockin"`) alongside gokart voting, which is left untouched. All motivational state (streaks, medals, trophy case) is derived on read from raw daily-tick items by a new **pure** module `cdk/lambda/tracker.mjs`, so a slip can never corrupt the medal bank. No new AWS infrastructure.

**Tech Stack:** AWS CDK (TypeScript), Node.js 22 ESM Lambda, `@aws-sdk/lib-dynamodb`, `node:test` for unit tests, vanilla HTML/CSS/JS (no build step), Google Fonts (Fraunces + Inter).

## Global Constraints

- Reuse the single existing CDK stack and `VotesTable` (PK `poll` STRING, SK `voter` STRING); **no new tables, buckets, or stacks**.
- Tracker data lives under partition `poll = "lockin"`; the SK attribute `voter` holds the ISO date. Never collide with any voting poll.
- The gokart voting path in `cdk/lambda/index.mjs` must keep working unchanged.
- Pages fetch `./config.json` at runtime for `voteApiUrl`; **never hard-code the endpoint**.
- Event-based updates only: fetch on load, use the POST response as fresh state (no second GET), and re-fetch on `visibilitychange`. **No timers, no WebSockets.**
- Public/unauthenticated by design; share the HTTPS S3 object URL.
- Day boundary is **midnight Malaysia time (UTC+8)**, computed server-side.
- Backfill grace: a POST is accepted only for **today or yesterday (MYT)**.
- Sober is an affirmative daily "clean today" tick.
- Colour rules: green = done/progress, gold = reward/achievement, quiet neutral = not-yet, **no punishing red**. Type: Fraunces (hero numbers, tier names, headings) + Inter (UI). Default theme **Night & Gold**, with a **Dawn** light toggle saved to `localStorage`.
- Medal tiers (tunable constants): Prayers/Sober by days — Bronze 7, Silver 30, Gold 90, Sapphire 180, Diamond 365. Workout by on-target weeks — Bronze 4, Silver 12, Gold 26, Sapphire 39, Diamond 52. Comeback = a non-first streak run that reaches Bronze. A run banks one medal per threshold it crosses; `×N` counts accumulate across runs.
- Approved visual reference (exact layout/colour the page must match): `.superpowers/brainstorm/53994-1784638278/content/dashboard-v3.html` and `palettes.html`.

**Prerequisite:** the project root (`/Users/amirnurhakim/jarvis/personal`) is not yet a git repo. Before Task 1, run `git init` there so the commit steps work:
```bash
cd /Users/amirnurhakim/jarvis/personal && git init && printf ".superpowers/\ncdk/cdk.out/\ncdk/node_modules/\n" > .gitignore && git add -A && git commit -m "chore: baseline before Lock In tracker"
```

---

### Task 1: Tracker constants + date helpers

**Files:**
- Create: `cdk/lambda/tracker.mjs`
- Create: `cdk/lambda/tracker.test.mjs`
- Modify: `cdk/package.json` (add `test` script)

**Interfaces:**
- Produces: `TRACKER_POLL='lockin'`, `PRAYERS=['subuh','zohor','asar','maghrib','isya']`, `WORKOUT_TARGET=4`, `DAY_TIERS`, `WEEK_TIERS` (arrays of `[name, threshold]`), and helpers `todayInMYT(nowMs)→'YYYY-MM-DD'`, `addDays(dateStr,n)→'YYYY-MM-DD'`, `dayNum(dateStr)→int`, `weekStart(dateStr)→'YYYY-MM-DD'` (Monday of that week), `weekNum(dateStr)→int`.

- [ ] **Step 1: Write the failing test**

```js
// cdk/lambda/tracker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayInMYT, addDays, dayNum, weekStart, weekNum,
  DAY_TIERS, WEEK_TIERS, PRAYERS, WORKOUT_TARGET, TRACKER_POLL,
} from './tracker.mjs';

test('constants', () => {
  assert.equal(TRACKER_POLL, 'lockin');
  assert.equal(WORKOUT_TARGET, 4);
  assert.deepEqual(PRAYERS, ['subuh', 'zohor', 'asar', 'maghrib', 'isya']);
  assert.deepEqual(DAY_TIERS.map((t) => t[1]), [7, 30, 90, 180, 365]);
  assert.deepEqual(WEEK_TIERS.map((t) => t[1]), [4, 12, 26, 39, 52]);
});

test('todayInMYT shifts UTC+8 across the date line', () => {
  // 2026-07-20 20:00 UTC == 2026-07-21 04:00 MYT
  assert.equal(todayInMYT(Date.parse('2026-07-20T20:00:00Z')), '2026-07-21');
  // 2026-07-20 15:00 UTC == 2026-07-20 23:00 MYT
  assert.equal(todayInMYT(Date.parse('2026-07-20T15:00:00Z')), '2026-07-20');
});

test('addDays and dayNum', () => {
  assert.equal(addDays('2026-07-21', -1), '2026-07-20');
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(dayNum('2026-07-21') - dayNum('2026-07-20'), 1);
});

test('weekStart returns Monday; weekNum increments weekly', () => {
  // 2026-07-21 is a Tuesday -> Monday is 2026-07-20
  assert.equal(weekStart('2026-07-21'), '2026-07-20');
  assert.equal(weekStart('2026-07-20'), '2026-07-20');
  assert.equal(weekStart('2026-07-26'), '2026-07-20'); // Sunday still same week
  assert.equal(weekNum('2026-07-27') - weekNum('2026-07-21'), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: FAIL — `Cannot find module './tracker.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// cdk/lambda/tracker.mjs
export const TRACKER_POLL = 'lockin';
export const PRAYERS = ['subuh', 'zohor', 'asar', 'maghrib', 'isya'];
export const WORKOUT_TARGET = 4;
export const DAY_TIERS = [['bronze', 7], ['silver', 30], ['gold', 90], ['sapphire', 180], ['diamond', 365]];
export const WEEK_TIERS = [['bronze', 4], ['silver', 12], ['gold', 26], ['sapphire', 39], ['diamond', 52]];

export function todayInMYT(nowMs) {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function dayNum(dateStr) {
  return Math.round(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
}
export function addDays(dateStr, n) {
  return new Date((dayNum(dateStr) + n) * 86400000).toISOString().slice(0, 10);
}
export function weekStart(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  return addDays(dateStr, -(dow === 0 ? 6 : dow - 1));
}
export function weekNum(dateStr) {
  return Math.floor(dayNum(weekStart(dateStr)) / 7);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the test script and commit**

Add to `cdk/package.json` `scripts`: `"test": "node --test lambda/"`.

```bash
git add cdk/lambda/tracker.mjs cdk/lambda/tracker.test.mjs cdk/package.json
git commit -m "feat(tracker): constants and MYT date helpers"
```

---

### Task 2: Streak primitives (current, best, runs)

**Files:**
- Modify: `cdk/lambda/tracker.mjs`
- Modify: `cdk/lambda/tracker.test.mjs`

**Interfaces:**
- Consumes: `dayNum` (Task 1).
- Produces: `streakCurrent(ordSet, endOrd)→int` (run length ending at `endOrd`, or `endOrd-1` if only the previous ordinal qualifies — the grace/"today not logged yet" case; else 0), `bestRun(ordSet)→int`, `runLengths(ordSet)→int[]` (consecutive-run lengths, chronological order). `ordSet` is a `Set<int>` of qualifying ordinals.

- [ ] **Step 1: Write the failing test**

```js
// append to cdk/lambda/tracker.test.mjs
import { streakCurrent, bestRun, runLengths } from './tracker.mjs';

test('streakCurrent counts back from today', () => {
  const s = new Set([10, 11, 12]); // 3 in a row ending at 12
  assert.equal(streakCurrent(s, 12), 3);      // today qualifies
  assert.equal(streakCurrent(s, 13), 3);      // today not logged yet, ends yesterday -> still alive
  assert.equal(streakCurrent(s, 14), 0);      // full gap -> broken
  assert.equal(streakCurrent(new Set(), 12), 0);
});

test('bestRun finds the longest run', () => {
  assert.equal(bestRun(new Set([1, 2, 3, 10, 11])), 3);
  assert.equal(bestRun(new Set([5])), 1);
  assert.equal(bestRun(new Set()), 0);
});

test('runLengths returns each run in chronological order', () => {
  assert.deepEqual(runLengths(new Set([1, 2, 3, 10, 11, 20])), [3, 2, 1]);
  assert.deepEqual(runLengths(new Set()), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: FAIL — `streakCurrent is not a function` (export missing).

- [ ] **Step 3: Write minimal implementation**

```js
// append to cdk/lambda/tracker.mjs
export function streakCurrent(ordSet, endOrd) {
  let end;
  if (ordSet.has(endOrd)) end = endOrd;
  else if (ordSet.has(endOrd - 1)) end = endOrd - 1;
  else return 0;
  let n = 0;
  for (let d = end; ordSet.has(d); d--) n++;
  return n;
}
export function bestRun(ordSet) {
  const a = [...ordSet].sort((x, y) => x - y);
  let best = 0, run = 0, prev = null;
  for (const o of a) { run = prev !== null && o === prev + 1 ? run + 1 : 1; if (run > best) best = run; prev = o; }
  return best;
}
export function runLengths(ordSet) {
  const a = [...ordSet].sort((x, y) => x - y);
  const runs = []; let run = 0, prev = null;
  for (const o of a) {
    if (prev !== null && o === prev + 1) run++;
    else { if (run) runs.push(run); run = 1; }
    prev = o;
  }
  if (run) runs.push(run);
  return runs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add cdk/lambda/tracker.mjs cdk/lambda/tracker.test.mjs
git commit -m "feat(tracker): streak primitives (current, best, runs)"
```

---

### Task 3: Medals, comeback, and forging tier

**Files:**
- Modify: `cdk/lambda/tracker.mjs`
- Modify: `cdk/lambda/tracker.test.mjs`

**Interfaces:**
- Consumes: `DAY_TIERS`, `WEEK_TIERS` (Task 1).
- Produces: `medalsFromRuns(runs, tiers)→{bronze,silver,gold,sapphire,diamond}` (one medal per threshold each run crosses), `comebackCount(runs, bronzeThreshold)→int` (non-first runs reaching Bronze), `forging(current, tiers)→{tier,threshold}|null` (lowest tier not yet reached, or `null` when maxed).

- [ ] **Step 1: Write the failing test**

```js
// append to cdk/lambda/tracker.test.mjs
import { medalsFromRuns, comebackCount, forging } from './tracker.mjs';

test('medalsFromRuns banks one medal per crossed threshold', () => {
  // a 95-day run crosses Bronze+Silver+Gold
  assert.deepEqual(medalsFromRuns([95], DAY_TIERS),
    { bronze: 1, silver: 1, gold: 1, sapphire: 0, diamond: 0 });
  // two separate 7-day runs -> Bronze x2
  assert.deepEqual(medalsFromRuns([7, 7], DAY_TIERS),
    { bronze: 2, silver: 0, gold: 0, sapphire: 0, diamond: 0 });
  // a 6-day run crosses nothing
  assert.deepEqual(medalsFromRuns([6], DAY_TIERS),
    { bronze: 0, silver: 0, gold: 0, sapphire: 0, diamond: 0 });
});

test('comebackCount excludes the first run', () => {
  assert.equal(comebackCount([30], 7), 0);        // only ever one streak
  assert.equal(comebackCount([30, 8], 7), 1);     // rebuilt to Bronze once
  assert.equal(comebackCount([30, 8, 5, 9], 7), 2); // 8 and 9 count; 5 does not
});

test('forging returns the next unreached tier, or null when maxed', () => {
  assert.deepEqual(forging(42, DAY_TIERS), { tier: 'gold', threshold: 90 });
  assert.deepEqual(forging(0, DAY_TIERS), { tier: 'bronze', threshold: 7 });
  assert.equal(forging(365, DAY_TIERS), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: FAIL — `medalsFromRuns is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to cdk/lambda/tracker.mjs
export function medalsFromRuns(runs, tiers) {
  const m = {}; for (const [name] of tiers) m[name] = 0;
  for (const len of runs) for (const [name, thr] of tiers) if (len >= thr) m[name]++;
  return m;
}
export function comebackCount(runs, bronzeThreshold) {
  return runs.slice(1).filter((len) => len >= bronzeThreshold).length;
}
export function forging(current, tiers) {
  for (const [name, thr] of tiers) if (current < thr) return { tier: name, threshold: thr };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add cdk/lambda/tracker.mjs cdk/lambda/tracker.test.mjs
git commit -m "feat(tracker): medals, comeback, forging tier"
```

---

### Task 4: computeSummary — assemble the full state

**Files:**
- Modify: `cdk/lambda/tracker.mjs`
- Modify: `cdk/lambda/tracker.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `computeSummary(days, today)→summary`, where `days` is `[{date, prayers:{subuh..isya:bool}, workout:bool, sober:bool}]` and `today` is `'YYYY-MM-DD'`. Returns:
  ```
  {
    prayers: { current, best, thisWeek:[7 bools Mon..Sun], forging },
    sober:   { current, best, thisWeek:[7 bools], forging },
    workout: { current, best, thisWeekSessions, target, forging },
    medals:  { bronze, silver, gold, sapphire, diamond, comeback },   // pooled
    totals:  { medals, bestStreak, daysTracked },
  }
  ```

- [ ] **Step 1: Write the failing test**

```js
// append to cdk/lambda/tracker.test.mjs
import { computeSummary } from './tracker.mjs';

const allPrayers = { subuh: true, zohor: true, asar: true, maghrib: true, isya: true };
function cleanDay(date, over = {}) {
  return { date, prayers: allPrayers, workout: true, sober: true, ...over };
}

test('empty history -> all zeros, forging Bronze', () => {
  const s = computeSummary([], '2026-07-21');
  assert.equal(s.prayers.current, 0);
  assert.equal(s.totals.medals, 0);
  assert.equal(s.totals.daysTracked, 0);
  assert.deepEqual(s.prayers.forging, { tier: 'bronze', threshold: 7 });
  assert.deepEqual(s.prayers.thisWeek, [false, false, false, false, false, false, false]);
});

test('a clean 8-day run ending today: streak alive, Bronze banked, medals survive a later gap', () => {
  const days = [];
  for (let i = 7; i >= 0; i--) days.push(cleanDay(addDays('2026-07-21', -i)));
  const s = computeSummary(days, '2026-07-21');
  assert.equal(s.prayers.current, 8);
  assert.equal(s.prayers.best, 8);
  assert.equal(s.medals.bronze >= 3, true); // prayers+sober+? each earned Bronze
  // now evaluate two days later with no new logs -> current resets, Bronze count unchanged
  const s2 = computeSummary(days, '2026-07-23');
  assert.equal(s2.prayers.current, 0);
  assert.equal(s2.medals.bronze, s.medals.bronze);
});

test('an incomplete prayer day does not count; sober can still count', () => {
  const days = [cleanDay('2026-07-21', { prayers: { ...allPrayers, isya: false } })];
  const s = computeSummary(days, '2026-07-21');
  assert.equal(s.prayers.current, 0);
  assert.equal(s.sober.current, 1);
  assert.equal(s.totals.daysTracked, 1);
});

test('workout: a week with >=4 sessions is on-target', () => {
  // Mon..Thu of the week containing 2026-07-21 (week starts 2026-07-20)
  const days = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23']
    .map((d) => ({ date: d, prayers: {}, workout: true, sober: false }));
  const s = computeSummary(days, '2026-07-23');
  assert.equal(s.workout.thisWeekSessions, 4);
  assert.equal(s.workout.current, 1); // one on-target week
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: FAIL — `computeSummary is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to cdk/lambda/tracker.mjs
export function computeSummary(days, today) {
  const prayerOrd = new Set();
  const soberOrd = new Set();
  const weekCounts = new Map(); // weekStart date -> workout-day count
  const activeDates = new Set();

  for (const d of days) {
    activeDates.add(d.date);
    if (PRAYERS.every((p) => d.prayers && d.prayers[p] === true)) prayerOrd.add(dayNum(d.date));
    if (d.sober === true) soberOrd.add(dayNum(d.date));
    if (d.workout === true) {
      const ws = weekStart(d.date);
      weekCounts.set(ws, (weekCounts.get(ws) || 0) + 1);
    }
  }

  const weekOrd = new Set();
  for (const [ws, c] of weekCounts) if (c >= WORKOUT_TARGET) weekOrd.add(weekNum(ws));

  const todayOrd = dayNum(today);
  const wsToday = weekStart(today);

  const dayHabit = (ordSet) => {
    const runs = runLengths(ordSet);
    return {
      current: streakCurrent(ordSet, todayOrd),
      best: bestRun(ordSet),
      thisWeek: Array.from({ length: 7 }, (_, i) => ordSet.has(dayNum(addDays(wsToday, i)))),
      forging: forging(streakCurrent(ordSet, todayOrd), DAY_TIERS),
      _medals: medalsFromRuns(runs, DAY_TIERS),
      _comeback: comebackCount(runs, 7),
    };
  };

  const prayers = dayHabit(prayerOrd);
  const sober = dayHabit(soberOrd);

  const wRuns = runLengths(weekOrd);
  const wCurrent = streakCurrent(weekOrd, weekNum(today));
  const workout = {
    current: wCurrent,
    best: bestRun(weekOrd),
    thisWeekSessions: weekCounts.get(wsToday) || 0,
    target: WORKOUT_TARGET,
    forging: forging(wCurrent, WEEK_TIERS),
    _medals: medalsFromRuns(wRuns, WEEK_TIERS),
    _comeback: comebackCount(wRuns, 4),
  };

  const names = ['bronze', 'silver', 'gold', 'sapphire', 'diamond'];
  const medals = {};
  for (const n of names) medals[n] = prayers._medals[n] + sober._medals[n] + workout._medals[n];
  medals.comeback = prayers._comeback + sober._comeback + workout._comeback;
  const totalMedals = names.reduce((s, n) => s + medals[n], 0) + medals.comeback;

  const strip = ({ _medals, _comeback, ...rest }) => rest;
  return {
    prayers: strip(prayers),
    sober: strip(sober),
    workout: strip(workout),
    medals,
    totals: {
      medals: totalMedals,
      bestStreak: Math.max(prayers.best, sober.best),
      daysTracked: activeDates.size,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cdk && node --test lambda/tracker.test.mjs`
Expected: PASS (14 tests total).

- [ ] **Step 5: Commit**

```bash
git add cdk/lambda/tracker.mjs cdk/lambda/tracker.test.mjs
git commit -m "feat(tracker): computeSummary assembles full derived state"
```

---

### Task 5: Route the tracker contract through the Lambda handler

**Files:**
- Modify: `cdk/lambda/index.mjs`
- Create: `cdk/lambda/index.test.mjs`

**Interfaces:**
- Consumes: `TRACKER_POLL`, `PRAYERS`, `computeSummary`, `todayInMYT`, `addDays` from `tracker.mjs`.
- Produces: extended `handler`. For `poll === "lockin"`: `GET` returns `{days, summary}`; `POST {poll,date,prayers,workout,sober}` upserts one day item (Key `{poll, voter:date}`) and returns `{days, summary}`. Adds helper `trackerDays(poll)→Promise<day[]>`.

- [ ] **Step 1: Write the failing test**

The date validation is the risky pure part; test it via an exported helper.

```js
// cdk/lambda/index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validTrackerDate, normalizePrayers } from './index.mjs';

test('validTrackerDate accepts today and yesterday (MYT), rejects others', () => {
  const now = Date.parse('2026-07-21T05:00:00Z'); // 13:00 MYT on 2026-07-21
  assert.equal(validTrackerDate('2026-07-21', now), true);
  assert.equal(validTrackerDate('2026-07-20', now), true);
  assert.equal(validTrackerDate('2026-07-19', now), false);
  assert.equal(validTrackerDate('2026-07-22', now), false);
  assert.equal(validTrackerDate('garbage', now), false);
});

test('normalizePrayers coerces to exactly the five booleans', () => {
  assert.deepEqual(
    normalizePrayers({ subuh: true, zohor: 'yes', asar: true, isya: true, junk: true }),
    { subuh: true, zohor: false, asar: true, maghrib: false, isya: true },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cdk && node --test lambda/index.test.mjs`
Expected: FAIL — `validTrackerDate is not a function`.

- [ ] **Step 3: Write minimal implementation**

At the top of `cdk/lambda/index.mjs`, add the import and the two exported helpers:

```js
import { TRACKER_POLL, PRAYERS, computeSummary, todayInMYT, addDays } from './tracker.mjs';

export function validTrackerDate(date, nowMs) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = todayInMYT(nowMs);
  return date === today || date === addDays(today, -1);
}
export function normalizePrayers(input) {
  const out = {};
  for (const p of PRAYERS) out[p] = input && input[p] === true;
  return out;
}
async function trackerDays(poll) {
  const { Items = [] } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: '#p = :p',
    ExpressionAttributeNames: { '#p': 'poll' },
    ExpressionAttributeValues: { ':p': poll },
  }));
  return Items.map((it) => ({
    date: it.voter,
    prayers: it.prayers || {},
    workout: it.workout === true,
    sober: it.sober === true,
  })).sort((a, b) => a.date.localeCompare(b.date));
}
async function trackerState(poll) {
  const days = await trackerDays(poll);
  const today = todayInMYT(Date.now());
  return { days, today, summary: computeSummary(days, today) };
}
```

Then route inside `handler`. In the `GET` branch, immediately after `if (!poll) ...`:

```js
      if (poll === TRACKER_POLL) return resp(200, await trackerState(poll));
```

In the `POST` branch, right after `body` is parsed and `const poll = clean(body.poll, 60);`:

```js
      if (poll === TRACKER_POLL) {
        if (!validTrackerDate(body.date, Date.now())) {
          return resp(400, { error: 'date must be today or yesterday (MYT)' });
        }
        const now = new Date().toISOString();
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { poll, voter: body.date },
          UpdateExpression:
            'SET prayers = :pr, workout = :w, sober = :s, updatedAt = :u, createdAt = if_not_exists(createdAt, :u)',
          ExpressionAttributeValues: {
            ':pr': normalizePrayers(body.prayers),
            ':w': body.workout === true,
            ':s': body.sober === true,
            ':u': now,
          },
        }));
        return resp(200, await trackerState(poll));
      }
```

(The existing gokart `voter`/`track`/`dates` validation and upsert stay below this block, unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cdk && node --test lambda/`
Expected: PASS — all of `tracker.test.mjs` (14) and `index.test.mjs` (2).

- [ ] **Step 5: Commit**

```bash
git add cdk/lambda/index.mjs cdk/lambda/index.test.mjs
git commit -m "feat(tracker): route lockin GET/POST through the Lambda"
```

---

### Task 6: Page shell — markup, theme tokens, and Night/Dawn toggle

**Files:**
- Create: `plan/lockin.html`

**Interfaces:**
- Produces: the static page structure with stable element ids the JS (Task 7) targets: `#appName`, `#today`, `#themeToggle`, `#scores` (holds `#sPrayers`, `#sSober`, `#sWorkout`), `#shelf`, `#caseSummary`, `#prayerPills`, `#prayerNote`, `#prayerWeek`, `#soberToggle`, `#soberWeek`, `#workoutToggle`, `#workoutSessions`, `#banner`.
- Visual reference: match `.superpowers/brainstorm/53994-1784638278/content/dashboard-v3.html` (layout) and `palettes.html` (Night & Gold + Dawn tokens).

- [ ] **Step 1: Create the page with theme system and static shell**

Create `plan/lockin.html`. Use CSS custom properties for the two themes; `data-theme="night"` is default, `data-theme="dawn"` is the light toggle. Fonts: Fraunces + Inter via Google Fonts. Colour rules from Global Constraints (green done, gold reward, neutral not-yet, no red).

```html
<!doctype html>
<html lang="en" data-theme="night">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lock In</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root[data-theme="night"]{--bg:#0d141c;--card:#111c27;--edge:#1d2c3a;--ink:#eaf2fb;--mut:#8ba0b6;--dim:#5f7386;--gold:#e8c65a;--done:#1f7a4d;--done-ink:#eafff2;--heroA:#16324a;--heroB:#0d141c}
  :root[data-theme="dawn"]{--bg:#f4ecdd;--card:#fffdf8;--edge:#e4dccb;--ink:#2a2620;--mut:#7a7160;--dim:#a99a7f;--gold:#b8860b;--done:#2e7d54;--done-ink:#ffffff;--heroA:#fffdf8;--heroB:#f4ecdd}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:'Inter',system-ui,sans-serif;padding:20px;max-width:820px;margin:0 auto}
  h1,.num,.tier,.hname{font-family:'Fraunces',Georgia,serif}
  .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  h1{font-size:22px;font-weight:700;margin:0}
  .date{font-size:13px;color:var(--mut)}
  #themeToggle{background:none;border:1px solid var(--edge);color:var(--mut);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
  .hero{background:radial-gradient(120% 140% at 50% 0%,var(--heroA),var(--heroB) 60%);border:1px solid var(--edge);border-radius:16px;padding:22px 16px;margin-bottom:16px}
  #scores{display:flex}
  .score{flex:1;text-align:center;padding:0 8px;border-left:1px solid var(--edge)}
  .score:first-child{border-left:none}
  .score .num{font-weight:900;font-size:48px;line-height:.82;color:var(--gold)}
  .score .num small{font-size:20px;color:var(--mut)}
  .score .u{font-size:10px;letter-spacing:.16em;color:var(--mut);margin-top:6px}
  .score .h{font-size:15px;margin-top:4px}
  .score .t{font-size:10px;color:var(--dim);margin-top:3px}
  .case{margin-top:16px;padding-top:14px;border-top:1px solid var(--edge)}
  .case .l{font-size:10px;letter-spacing:.2em;color:var(--mut)}
  #caseSummary{font-family:'Fraunces',serif;color:var(--gold);font-size:14px;float:right}
  #shelf{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:12px}
  .med{display:flex;flex-direction:column;align-items:center;gap:5px;width:74px;position:relative}
  .med .cap{font-size:9px;letter-spacing:.08em;color:var(--mut);text-transform:uppercase;text-align:center}
  .med .cnt{position:absolute;top:-4px;right:6px;background:var(--bg);border:1px solid var(--gold);color:var(--gold);font-family:'Fraunces',serif;font-size:11px;border-radius:20px;padding:1px 7px}
  .med.locked{opacity:.35}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .hcard{background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:16px}
  .hcard.wide{grid-column:1/-1}
  .hname{font-weight:700;font-size:16px;margin-bottom:10px}
  .pills{display:flex;gap:6px;flex-wrap:wrap}
  .pill,.toggle{cursor:pointer;font-weight:600;border-radius:9px;border:1px solid var(--edge);color:var(--mut);background:none}
  .pill{flex:1;min-width:44px;text-align:center;font-size:11px;padding:9px 4px}
  .pill.on{background:var(--done);border-color:var(--done);color:var(--done-ink)}
  .toggle{font-size:13px;padding:10px 16px;margin-top:2px}
  .toggle.on{background:var(--done);border-color:var(--done);color:var(--done-ink)}
  .note{font-size:11px;color:var(--mut);margin-top:8px}
  .wklabel{font-size:10px;letter-spacing:.14em;color:var(--dim);margin:12px 0 6px}
  .dots{display:flex;gap:6px}
  .dot{width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;border:1.4px dashed var(--edge);color:var(--dim)}
  .dot.on{background:var(--gold);border:none;color:var(--bg)}
  #banner{display:none;background:#3a2a12;color:#f4d9a6;border:1px solid #6b4f1e;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:14px}
  #banner.show{display:block}
</style>
</head>
<body>
  <div class="topbar">
    <h1 id="appName">Lock In</h1>
    <div style="display:flex;gap:10px;align-items:center">
      <span class="date" id="today"></span>
      <button id="themeToggle" type="button">☀ Dawn</button>
    </div>
  </div>

  <div id="banner"></div>

  <div class="hero">
    <div id="scores">
      <div class="score"><div class="num" id="sPrayers">0</div><div class="u">DAY STREAK</div><div class="h">Prayers</div><div class="t"></div></div>
      <div class="score"><div class="num" id="sSober">0</div><div class="u">DAY STREAK</div><div class="h">Sober</div><div class="t"></div></div>
      <div class="score"><div class="num" id="sWorkout">0</div><div class="u">ON TARGET</div><div class="h">Workout</div><div class="t"></div></div>
    </div>
    <div class="case">
      <span id="caseSummary"></span>
      <span class="l">THE TROPHY CASE — EVERY ACHIEVEMENT</span>
      <div id="shelf"></div>
    </div>
  </div>

  <div class="grid">
    <div class="hcard wide">
      <div class="hname">Prayers · today</div>
      <div class="pills" id="prayerPills"></div>
      <div class="note" id="prayerNote"></div>
      <div class="wklabel">THIS WEEK</div>
      <div class="dots" id="prayerWeek"></div>
    </div>
    <div class="hcard">
      <div class="hname">Sober · today</div>
      <button class="toggle" id="soberToggle" type="button">Mark clean today</button>
      <div class="wklabel">THIS WEEK</div>
      <div class="dots" id="soberWeek"></div>
    </div>
    <div class="hcard">
      <div class="hname">Workout · today</div>
      <button class="toggle" id="workoutToggle" type="button">Log a session</button>
      <div class="wklabel" id="workoutSessions">SESSIONS THIS WEEK</div>
      <div class="dots" id="workoutWeek"></div>
    </div>
  </div>

  <script>
  // Theme toggle (persisted). Rest of behaviour added in Task 7.
  (function () {
    var root = document.documentElement;
    var btn = document.getElementById('themeToggle');
    try { var saved = localStorage.getItem('lockinTheme'); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
    function sync() { btn.textContent = root.getAttribute('data-theme') === 'night' ? '☀ Dawn' : '☾ Night'; }
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'night' ? 'dawn' : 'night';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('lockinTheme', next); } catch (e) {}
      sync();
    });
    sync();
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify it renders and the toggle works**

Run: `open plan/lockin.html`
Expected: the Night & Gold shell renders with an empty hero (zeros), an empty shelf, and three cards. Clicking **☀ Dawn** flips to the parchment theme and back; the choice survives a reload.

- [ ] **Step 3: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(page): Lock In shell with Night/Dawn theme toggle"
```

---

### Task 7: Page behaviour — render state, ticking, and event-based fetch

**Files:**
- Modify: `plan/lockin.html`

**Interfaces:**
- Consumes: the `{days, summary}` shape from Task 5; the element ids from Task 6.
- Produces: the working page — renders the summary, ticks prayers/sober/workout with an optimistic POST + revert on failure, and refreshes on load / POST response / `visibilitychange`.

- [ ] **Step 1: Add the medal SVG helper and render functions**

Insert this block inside the existing `<script>` in `plan/lockin.html`, immediately before the final `</script>`. It reuses the tick/fetch pattern from `gokart-proposal.html:869-924`.

```js
  (function () {
    var POLL = 'lockin';
    var PRAYERS = ['subuh', 'zohor', 'asar', 'maghrib', 'isya'];
    var LABELS = { subuh: 'Subuh', zohor: 'Zohor', asar: 'Asar', maghrib: 'Maghrib', isya: "Isya'" };
    var TIERS = ['bronze', 'silver', 'gold', 'sapphire', 'diamond'];
    var TIER_CAP = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', sapphire: 'Sapphire', diamond: 'Diamond', comeback: 'Comeback' };
    var METAL = { // radial-gradient stops per tier
      bronze: ['#f0b877', '#c17f3c', '#7d4a1c'], silver: ['#ffffff', '#c2ccd4', '#7f8a93'],
      gold: ['#fff2b0', '#e3bf47', '#9c7a15'], sapphire: ['#b9d9ff', '#3f7fca', '#1c3f76'],
      diamond: ['#ffffff', '#c8f6fb', '#5fb6c4'], comeback: ['#ffd9a8', '#d9743f', '#8a3a1a'],
    };
    var apiUrl = null;
    var el = function (id) { return document.getElementById(id); };
    var today = null;      // 'YYYY-MM-DD' from the server, set on first render
    var todayRow = {};     // this device's optimistic view of today's ticks

    function medalSvg(tier, locked) {
      var m = METAL[tier];
      var id = 'g_' + tier + (locked ? 'L' : '');
      if (locked) {
        return '<svg width="52" height="52" viewBox="0 0 102 102"><circle cx="51" cy="51" r="40" fill="none" stroke="var(--edge)" stroke-width="2.5" stroke-dasharray="5 5"/></svg>';
      }
      return '<svg width="52" height="52" viewBox="0 0 102 102"><defs><radialGradient id="' + id + '" cx="38%" cy="30%" r="72%">' +
        '<stop offset="0%" stop-color="' + m[0] + '"/><stop offset="50%" stop-color="' + m[1] + '"/><stop offset="100%" stop-color="' + m[2] + '"/></radialGradient></defs>' +
        '<circle cx="51" cy="51" r="40" fill="url(#' + id + ')"/>' +
        '<rect x="34" y="34" width="34" height="34" rx="3" fill="' + m[2] + '" opacity=".5"/>' +
        '<rect x="34" y="34" width="34" height="34" rx="3" fill="' + m[2] + '" opacity=".5" transform="rotate(45 51 51)"/></svg>';
    }

    function dots(container, weekBools) {
      var names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      container.innerHTML = weekBools.map(function (on, i) {
        return '<span class="dot ' + (on ? 'on' : 'off') + '">' + names[i] + '</span>';
      }).join('');
    }

    function render(state) {
      var s = state.summary;
      today = state.today;                 // server owns "today" (MYT); day rolls at 00:00 UTC+8
      el('today').textContent = new Date(today + 'T00:00:00+08:00').toLocaleDateString('en-GB',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });
      var todayItem = findDay(state.days, today);
      todayRow = todayItem ? { prayers: Object.assign({}, todayItem.prayers), workout: todayItem.workout, sober: todayItem.sober }
                           : { prayers: {}, workout: false, sober: false };

      el('sPrayers').textContent = s.prayers.current;
      el('sSober').textContent = s.sober.current;
      el('sWorkout').innerHTML = s.workout.current + '<small> wk</small>';
      el('scores').children[0].querySelector('.t').textContent = tierLabel(s.prayers.forging);
      el('scores').children[1].querySelector('.t').textContent = tierLabel(s.sober.forging);
      el('scores').children[2].querySelector('.t').textContent = s.workout.thisWeekSessions + ' of ' + s.workout.target + ' this week';

      el('caseSummary').textContent = s.totals.medals + ' earned · best streak ' + s.totals.bestStreak + ' · ' + s.totals.daysTracked + ' days tracked';
      renderShelf(s.medals);

      renderPrayers();
      el('soberToggle').className = 'toggle' + (todayRow.sober ? ' on' : '');
      el('soberToggle').textContent = todayRow.sober ? '✓ Clean today' : 'Mark clean today';
      el('workoutToggle').className = 'toggle' + (todayRow.workout ? ' on' : '');
      el('workoutToggle').textContent = todayRow.workout ? '✓ Trained today' : 'Log a session';
      el('workoutSessions').textContent = 'SESSIONS THIS WEEK · ' + s.workout.thisWeekSessions + '/' + s.workout.target;

      dots(el('prayerWeek'), s.prayers.thisWeek);
      dots(el('soberWeek'), s.sober.thisWeek);
    }

    function renderShelf(medals) {
      var order = ['bronze', 'silver', 'gold', 'sapphire', 'diamond', 'comeback'];
      el('shelf').innerHTML = order.map(function (t) {
        var n = medals[t] || 0;
        var locked = n === 0 && t !== 'comeback';
        var cnt = n > 0 ? '<span class="cnt">×' + n + '</span>' : '';
        if (n === 0 && t === 'comeback') return '';
        return '<div class="med ' + (locked ? 'locked' : '') + '">' + cnt + medalSvg(t, locked) + '<span class="cap">' + TIER_CAP[t] + '</span></div>';
      }).join('');
    }

    function renderPrayers() {
      el('prayerPills').innerHTML = PRAYERS.map(function (p) {
        var on = todayRow.prayers[p] === true;
        return '<button type="button" class="pill ' + (on ? 'on' : '') + '" data-p="' + p + '">' + LABELS[p] + (on ? ' ✓' : '') + '</button>';
      }).join('');
      var done = PRAYERS.filter(function (p) { return todayRow.prayers[p]; }).length;
      el('prayerNote').textContent = done === 5 ? 'All 5 in — day locked ✓'
        : done + ' / 5 today — ' + (5 - done) + ' more before midnight to keep the streak alive.';
      Array.prototype.forEach.call(el('prayerPills').children, function (b) {
        b.addEventListener('click', function () {
          todayRow.prayers[b.dataset.p] = !todayRow.prayers[b.dataset.p];
          renderPrayers();
          save();
        });
      });
    }

    function tierLabel(f) { return f ? 'forging ' + TIER_CAP[f.tier] : 'maxed out'; }
    function findDay(days, d) { for (var i = 0; i < days.length; i++) if (days[i].date === d) return days[i]; return null; }

    function banner(msg) { var b = el('banner'); if (!msg) { b.className = ''; return; } b.textContent = msg; b.className = 'show'; }

    function refresh() {
      if (!apiUrl) return;
      fetch(apiUrl + '?poll=' + POLL)
        .then(function (r) { return r.json(); })
        .then(render)
        .catch(function () { banner("Can't reach the tracker — reopen the shared link to load your progress."); });
    }

    function save() {
      if (!apiUrl) { banner('Ticking only works on the shared link.'); return; }
      banner('');
      var snapshot = JSON.stringify(todayRow);
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poll: POLL, date: today, prayers: todayRow.prayers, workout: todayRow.workout, sober: todayRow.sober }),
      })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(render)
        .catch(function () { banner("Couldn't save that — tap it again to retry."); });
    }

    el('soberToggle').addEventListener('click', function () { todayRow.sober = !todayRow.sober; render({ summary: lastSummary, days: lastDays }); save(); });
    el('workoutToggle').addEventListener('click', function () { todayRow.workout = !todayRow.workout; save(); refresh(); });

    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });

    fetch('./config.json')
      .then(function (r) { return r.json(); })
      .then(function (cfg) { apiUrl = cfg.voteApiUrl; refresh(); })
      .catch(function () { banner('This page is live only on the shared link.'); });
  })();
```

- [ ] **Step 2: Simplify the toggle handlers to re-render from server state only**

The two toggle handlers above must not reference undefined `lastSummary`/`lastDays`. Replace both `soberToggle`/`workoutToggle` listeners with the optimistic-then-save pattern that reuses the last rendered `todayRow` and lets the POST response re-render:

```js
    el('soberToggle').addEventListener('click', function () {
      todayRow.sober = !todayRow.sober;
      el('soberToggle').className = 'toggle' + (todayRow.sober ? ' on' : '');
      el('soberToggle').textContent = todayRow.sober ? '✓ Clean today' : 'Mark clean today';
      save();
    });
    el('workoutToggle').addEventListener('click', function () {
      todayRow.workout = !todayRow.workout;
      el('workoutToggle').className = 'toggle' + (todayRow.workout ? ' on' : '');
      el('workoutToggle').textContent = todayRow.workout ? '✓ Trained today' : 'Log a session';
      save();
    });
```

- [ ] **Step 3: Add the workout week dots container render**

`#workoutWeek` shows the target as `target` slots filled up to `thisWeekSessions`. Add to `render()` after the sober dots line:

```js
      var wk = el('workoutWeek');
      wk.innerHTML = Array.from({ length: s.workout.target }, function (_, i) {
        return '<span class="dot ' + (i < s.workout.thisWeekSessions ? 'on' : 'off') + '">' + (i + 1) + '</span>';
      }).join('');
```

- [ ] **Step 4: Verify against a local mock**

Because the page needs `config.json`, verify the render path with a temporary inline mock. Temporarily add near the top of the IIFE (then remove after checking): `apiUrl = null;` stays, but paste a sample `render({days:[...], summary:{...}})` call using a summary shaped per Task 4. Confirm: hero shows the three numbers, the shelf shows earned tiers with `×N` and locked Sapphire/Diamond dim, prayer pills toggle green on click and the note updates, sober/workout toggles flip green. Remove the mock call before committing.

Run: `open plan/lockin.html`
Expected: with the mock, the dashboard matches `dashboard-v3.html`; toggles turn green (no red anywhere); reload keeps the theme.

- [ ] **Step 5: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(page): render summary, ticking, event-based fetch"
```

---

### Task 8: Deploy and verify end-to-end

**Files:**
- None (uses existing `npm run deploy`).

- [ ] **Step 1: Run the full test suite**

Run: `cd cdk && npm test`
Expected: PASS — all `tracker.test.mjs` and `index.test.mjs` tests.

- [ ] **Step 2: Deploy**

Run: `cd cdk && npm run deploy`
Expected: succeeds; prints `BaseUrl` and `VoteApiUrl`. The new `lockin.html` and regenerated `config.json` are synced to the bucket.

- [ ] **Step 3: Live smoke test**

Open `<BaseUrl>lockin.html` (the HTTPS object URL). Then:
- Tick all 5 prayers → note flips to "All 5 in — day locked ✓"; reload → ticks persist; Prayers streak shows `1`.
- Tap "Mark clean today" → turns green; Sober streak shows `1`.
- Tap "Log a session" → Workout "sessions this week" increments.
- Switch to Dawn theme → parchment palette, still no red.
- In an AWS console DynamoDB view (or via `aws dynamodb query`), confirm one item exists with `poll="lockin"`, `voter="<today MYT>"`, and the `prayers`/`workout`/`sober` attributes.
- Attempt a `POST` with `date` two days ago (via `curl`) → returns `400 {"error":"date must be today or yesterday (MYT)"}`.

- [ ] **Step 4: Confirm gokart still works**

Open `<BaseUrl>gokart-proposal.html`, cast a test vote → still records and renders (the voting path is unchanged).

- [ ] **Step 5: Commit any fixups and tag done**

```bash
git add -A
git commit -m "chore: Lock In tracker deployed and verified" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Three habits + success-shapes → Tasks 1–4 (`computeSummary` predicates), Task 6/7 (UI). ✓
- Two-layer mechanic (streak + permanent bank) → Task 2 (streaks), Task 3 (medals from historical runs), Task 4 test asserts medals survive a gap. ✓
- Medal tiers + Comeback + `×N` + pooled trophy case → Task 3, Task 4 (pooling), Task 7 (`renderShelf`). ✓
- Hero scoreboard + trophy case + daily cards layout → Task 6 markup, Task 7 render. ✓
- Fraunces/Inter, Night & Gold default + Dawn toggle, green/gold/neutral no-red → Task 6 tokens + toggle. ✓
- MYT rollover + backfill-yesterday grace + affirmative sober tick → Task 1 (`todayInMYT`), Task 5 (`validTrackerDate`, POST), Task 7 (sober toggle). ✓
- Event-based updates only → Task 7 (load / POST response / `visibilitychange`, no timers). ✓
- Empty & error states → Task 7 (`banner`, zeros render, locked tiers). ✓
- Public/no-auth, reuse stack, no new infra → no CDK changes; Task 8 deploy via existing script. ✓
- Test-first derivation with the tricky fixtures → Tasks 1–4 cover empty, ongoing, broken-keeps-medals, multiple runs (`×N`), tier boundaries, comeback, workout weeks; Task 5 covers grace/backfill + prayer normalization. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. Task 7 Step 4 uses an explicitly-temporary mock that is removed before commit (not a shipped placeholder). ✓

**Type consistency:** `computeSummary` return shape (Task 4) matches what `render`/`renderShelf` consume (Task 7): `summary.prayers/sober.{current,best,thisWeek,forging}`, `summary.workout.{current,thisWeekSessions,target,forging}`, `summary.medals.{bronze..diamond,comeback}`, `summary.totals.{medals,bestStreak,daysTracked}`. `TRACKER_POLL`/`PRAYERS` names shared via import in Task 5. Medal tier names identical across Tasks 3/4/7. ✓

## Notes for the implementer
- `computeSummary` is intentionally pure (no AWS SDK) so it runs under `node:test` with no credentials.
- Do not add a second GET after a POST — the POST response already carries fresh state.
- Keep the gokart `voter`/`track`/`dates` code path untouched; the tracker branch returns early before it.
