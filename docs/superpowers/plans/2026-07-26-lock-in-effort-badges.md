# Lock In — extra-effort flame badges (plan)

> REQUIRED SUB-SKILL: superpowers:executing-plans. `- [ ]` steps.

**Goal:** New flame badges for cumulative workout days beyond the weekly target. Mirrors the wave-badge system.

## Global Constraints
- Numbers in `lockin-config.json` (`effortTiers`). Counted live (incl. current week). Earn once each. No infra change.

---

### Task 1: config + backend `workout.extra` (TDD)
**Files:** `cdk/lambda/lockin-config.json`, `cdk/lambda/tracker.mjs`, `cdk/lambda/tracker.test.mjs`

- [ ] **Step 1:** add to `lockin-config.json` (after `waveTiers`, mind the comma):
  `"effortTiers": [["Ember", 3], ["Flame", 10], ["Blaze", 25], ["Furnace", 60], ["Inferno", 150]]`
- [ ] **Step 2:** failing test — append to `tracker.test.mjs`:

```js
test('computeSummary sums workout extra days beyond the target', () => {
  // week of 2026-07-20 (Mon): 5 workout days -> 2 extra (target 3)
  const days = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']
    .map((d) => ({ date: d, prayers: {}, workout: true, sober: false }));
  const s = computeSummary(days, '2026-07-24');
  assert.equal(s.workout.extra, 2);
  // a 2-session week adds 0
  const few = ['2026-07-20', '2026-07-21'].map((d) => ({ date: d, prayers: {}, workout: true, sober: false }));
  assert.equal(computeSummary(few, '2026-07-21').workout.extra, 0);
});
```

- [ ] **Step 3:** run → fails (`workout.extra` undefined).
- [ ] **Step 4:** implement in `tracker.mjs` — before `const workout = {`, add:

```js
  let workoutExtra = 0;
  for (const [, c] of weekCounts) if (c > WORKOUT_TARGET) workoutExtra += c - WORKOUT_TARGET;
```
  and add `extra: workoutExtra,` inside the `workout` object (e.g. after `target: WORKOUT_TARGET,`).

- [ ] **Step 5:** `cd cdk && npm test` → all pass. Commit `feat(effort): backend workout.extra + effortTiers config`

---

### Task 2: page — flame badges + mint (front-end)
**Files:** `plan/lockin.html`, `cdk/lambda/reward.test.mjs`

- [ ] **Step 1: EFFORT_TIERS + config override.** After the `var WAVE_TIERS = ...` line add:
  `var EFFORT_TIERS = [['Ember', 3], ['Flame', 10], ['Blaze', 25], ['Furnace', 60], ['Inferno', 150]];`
  In the config fetch handler, after `if (cfg.waveTiers) WAVE_TIERS = cfg.waveTiers;` add:
  `if (cfg.effortTiers) EFFORT_TIERS = cfg.effortTiers;`

- [ ] **Step 2: flameSvg.** After `waveBadgeSvg` function, add:

```js
    function flameSvg(size) {
      var id = 'fl_' + (svgSeq++);
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 102 102">' +
        '<defs><radialGradient id="' + id + '" cx="42%" cy="34%" r="72%"><stop offset="0%" stop-color="#ffd98a"/>' +
        '<stop offset="48%" stop-color="#e8721f"/><stop offset="100%" stop-color="#7a2410"/></radialGradient></defs>' +
        '<circle cx="51" cy="51" r="42" fill="url(#' + id + ')"/>' +
        '<path d="M51 22 C64 40 71 49 62 63 A16 16 0 1 1 40 63 C33 51 45 43 45 30 C49 34 49 39 52 41 C55 36 52 28 51 22 Z" fill="#ffe6a8"/>' +
        '<path d="M51 44 C58 51 60 56 55 63 A9 9 0 1 1 45 61 C45 54 49 50 51 44 Z" fill="#e8721f"/></svg>';
    }
```

- [ ] **Step 3: mintEffort.** After `mintWave`, add a copy that uses `flameSvg`:

```js
    function mintEffort(name) {
      buzz([20, 40, 40]);
      fireBurst(window.innerWidth / 2, window.innerHeight * 0.4, 22);
      if (reduceMotion) return;
      var t = document.createElement('div'); t.className = 'toast';
      t.innerHTML = flameSvg(120) + '<div class="cap">' + name + '</div>';
      document.body.appendChild(t);
      var a = t.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.06)', offset: .45 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .8 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.9) translateY(-26px)' }],
        { duration: 1700, easing: 'ease' });
      a.onfinish = function () { t.remove(); };
    }
```

- [ ] **Step 4: achievements cells.** In `renderAchievements`, after the `WAVE_TIERS.forEach(...)` block, add:

```js
      var extra = (s.workout && s.workout.extra) || 0;
      EFFORT_TIERS.forEach(function (w) {
        cells += acell(w[0], flameSvg(46), extra >= w[1] ? 1 : 0, w[1] + ' extra workout days');
      });
```

- [ ] **Step 5: celebrationsFor + runCelebrations.**
  - Signature: `function celebrationsFor(prev, next, waveTiers, effortTiers) {`
  - Initial out: `var out = { countUp: [], mints: [], dailyComplete: false, waveBadges: [], effortBadges: [] };`
  - After the wave `WAVE.forEach(...)` block (before `return out;`), add:

```js
      var EFFORT = effortTiers || [['Ember', 3], ['Flame', 10], ['Blaze', 25], ['Furnace', 60], ['Inferno', 150]];
      var pe = (prev.summary.workout && prev.summary.workout.extra) || 0;
      var ne = (next.summary.workout && next.summary.workout.extra) || 0;
      EFFORT.forEach(function (w) { if (pe < w[1] && ne >= w[1]) out.effortBadges.push(w[0]); });
```

  - `runCelebrations`: change the call to `var c = celebrationsFor(prev, next, WAVE_TIERS, EFFORT_TIERS);` and after the `c.waveBadges.forEach(...)` line add:

```js
      c.effortBadges.forEach(function (name, i) { setTimeout(function () { mintEffort(name); }, (c.mints.length + c.waveBadges.length + i) * 320); });
```

- [ ] **Step 6: reward tests.** In `reward.test.mjs`: update the three `{ countUp: [], mints: [], dailyComplete: false, waveBadges: [] }` literals to also include `effortBadges: []`. Append an effort test:

```js
test('celebrationsFor flags an effort badge when extra crosses a threshold', () => {
  var s = function (extra) { return state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2, extra: extra },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 0, total: 0 },
  } }); };
  assert.deepEqual(celebrationsFor(s(2), s(3)).effortBadges, ['Ember']);
  assert.deepEqual(celebrationsFor(s(3), s(4)).effortBadges, []);
  assert.deepEqual(celebrationsFor(s(2), s(3), null, [['X', 3]]).effortBadges, ['X']);
});
```

- [ ] **Step 7:** `node --check` page; `cd cdk && npm test` → all pass. Commit `feat(effort): flame badges in achievements + mint`

---

### Task 3: deploy + verify
- [ ] `npm test`; `npm run deploy` (user). Phone: 4th weekly workout bumps toward Ember; crossing 3 mints a flame; badge appears in Achievements; config `effortTiers` served.

## Self-Review
Mirrors waves: config tiers, summary field, celebrationsFor detection (param + fallback), achievements cell, mint. Values live in config. Tests: extra sum + effort crossing + deepEqual updates.
