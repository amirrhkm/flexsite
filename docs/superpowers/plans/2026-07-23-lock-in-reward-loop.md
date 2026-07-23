# Lock In — Reward Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make logging feel rewarding and show progression in the moment — per-habit cards with a progress ring, a gold burst + count-up on log, and a center-screen medal mint on crossing a tier.

**Architecture:** Front-end only. The single static page `plan/lockin.html` is restructured so each habit is a self-contained card (ring + streak + "N to next medal" + its tap control), the trophy case becomes the page header, and a reward layer animates on confirmed progress. Every celebration is decided by a pure `celebrationsFor(prev, next)` that diffs the previous render state against the new one. No backend, CDK, or data-model changes.

**Tech Stack:** Vanilla HTML/CSS/JS (no build, single self-contained file), SVG ring, WAAPI (`element.animate`) + `requestAnimationFrame`, `node:test` for the pure function.

## Global Constraints

- **Front-end only.** Change only `plan/lockin.html` (+ one test file). No backend/CDK/data changes. Deploy via the existing `npm run deploy`.
- **Single self-contained file**, inline CSS/JS, no external requests except the existing Google Fonts + `./config.json`. (`BucketDeployment` only syncs `*.html`, so no sibling `.js`.)
- **Earned & predictable only** — no random/variable rewards. Rewards reflect real progress.
- **Event-based unchanged:** fetch on load, re-render from the POST response (no second GET on success), re-fetch on `visibilitychange`. Celebrations run ONLY on the POST-success path — never on first load, `refresh()`, or the revert-on-failure path.
- **Theme tokens** (`--gold`, `--done`, etc.) so it works in Night and Dawn. Colour rules unchanged: green = done, gold = reward, no punishing red.
- **Reduced motion:** `prefers-reduced-motion: reduce` skips bursts/mint/count-up (values set instantly) and disables the ring tween. Keyboard focus preserved.
- **No sound.**
- `state.today` remains the single source of "today" (MYT). `PRAYERS = ['subuh','zohor','asar','maghrib','isya']`. Day tiers 7/30/90/180/365; week tiers 4/12/26/39/52.
- Visual reference for the card/ring/mint feel: the approved prototype `.superpowers/brainstorm/44087-1784792506/content/reward-loop.html`.

---

### Task 1: Pure decision function `celebrationsFor` + test (TDD)

**Files:**
- Modify: `plan/lockin.html` (insert the function into the second `<script>` IIFE, near the other helpers)
- Create: `cdk/lambda/reward.test.mjs`

**Interfaces:**
- Produces: `celebrationsFor(prev, next) -> { countUp: string[], mints: string[], dailyComplete: boolean }`, self-contained (no outer deps), bracketed by `/*__CELEB_START__*/` … `/*__CELEB_END__*/` sentinels so the test can extract it. `prev`/`next` are render states shaped `{ today, days:[{date,prayers,workout,sober}], summary:{ prayers:{current}, sober:{current}, workout:{current}, medals:{bronze..diamond,comeback} } }`. Rules: `prev==null` → all empty/false; a habit whose `summary[h].current` increased → in `countUp`; a pooled medal tier whose count increased → in `mints`; `dailyComplete` true only when today's record goes from not (all 5 prayers && sober) to (all 5 prayers && sober).

- [ ] **Step 1: Write the failing test**

```js
// cdk/lambda/reward.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Extract the sentinel-bracketed pure function from the page and evaluate it.
const html = readFileSync(new URL('../../plan/lockin.html', import.meta.url), 'utf8');
const m = html.match(/\/\*__CELEB_START__\*\/([\s\S]*?)\/\*__CELEB_END__\*\//);
if (!m) throw new Error('celebrationsFor sentinels not found in plan/lockin.html');
const celebrationsFor = new Function(m[1] + '\nreturn celebrationsFor;')();

const allP = { subuh: true, zohor: true, asar: true, maghrib: true, isya: true };
function state(over) {
  return Object.assign({
    today: '2026-07-21',
    days: [{ date: '2026-07-21', prayers: {}, workout: false, sober: false }],
    summary: {
      prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
      medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    },
  }, over);
}

test('first load (prev null) celebrates nothing', () => {
  const r = celebrationsFor(null, state());
  assert.deepEqual(r, { countUp: [], mints: [], dailyComplete: false });
});

test('a streak increase is a count-up for that habit only', () => {
  const prev = state();
  const next = state({ summary: { prayers: { current: 11 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 } } });
  const r = celebrationsFor(prev, next);
  assert.deepEqual(r.countUp, ['prayers']);
  assert.deepEqual(r.mints, []);
});

test('a pooled medal increase mints that tier', () => {
  const prev = state();
  const next = state({ summary: { prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 1, gold: 0, sapphire: 0, diamond: 0, comeback: 1 } } });
  const r = celebrationsFor(prev, next);
  assert.deepEqual(r.mints.sort(), ['comeback', 'silver']);
});

test('no change and decreases celebrate nothing', () => {
  assert.deepEqual(celebrationsFor(state(), state()), { countUp: [], mints: [], dailyComplete: false });
  const lower = state({ summary: { prayers: { current: 9 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 0, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 } } });
  assert.deepEqual(celebrationsFor(state(), lower), { countUp: [], mints: [], dailyComplete: false });
});

test('dailyComplete fires once when today becomes all-5-prayers + sober', () => {
  const before = state({ days: [{ date: '2026-07-21', prayers: { ...allP, isya: false }, sober: true, workout: false }] });
  const after = state({ days: [{ date: '2026-07-21', prayers: allP, sober: true, workout: false }] });
  assert.equal(celebrationsFor(before, after).dailyComplete, true);
  // already complete -> does not fire again
  assert.equal(celebrationsFor(after, after).dailyComplete, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cdk && node --test lambda/reward.test.mjs`
Expected: FAIL — "celebrationsFor sentinels not found in plan/lockin.html".

- [ ] **Step 3: Insert the function into the page**

In `plan/lockin.html`, inside the second `<script>` IIFE, immediately after the `var lastState = null;` line (currently line 183), add:

```js
    /*__CELEB_START__*/
    function celebrationsFor(prev, next) {
      var PR = ['subuh', 'zohor', 'asar', 'maghrib', 'isya'];
      var TIERS = ['bronze', 'silver', 'gold', 'sapphire', 'diamond', 'comeback'];
      var out = { countUp: [], mints: [], dailyComplete: false };
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
      return out;
    }
    /*__CELEB_END__*/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cdk && node --test lambda/reward.test.mjs`
Expected: PASS (5 tests). Also run `cd cdk && npm test` — all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add plan/lockin.html cdk/lambda/reward.test.mjs
git commit -m "feat(reward): pure celebrationsFor decision fn + extraction test"
```

---

### Task 2: Restructure to per-habit ring cards (static, no animations yet)

**Files:**
- Modify: `plan/lockin.html`

**Interfaces:**
- Consumes: the `{days, today, summary}` shape (unchanged).
- Produces: new DOM — trophy case as header (no `#scores` scoreboard); three `.hcard`s each with a progress ring (`#ring{Prayers,Sober,Workout}` prog circle), centered streak number (`#num{...}`), and goal label (`#goal{...}`), plus the existing tap controls and week dots. New JS helpers `DAY_TIERS`, `WEEK_TIERS`, `ringProgress(current, tiers)`, `setRing(progEl, p, animate)`, `RC`. `render()` rewired to the new DOM. Static: no burst/count-up/mint yet.

- [ ] **Step 1: Replace the scoreboard CSS with ring/card CSS**

In the `<style>`, replace the scoreboard rules (currently lines 35–42, from `#scores{display:flex}` through `.score .t{...}`) with:

```css
  .cardcenter{text-align:center}
  .ringwrap{position:relative;width:130px;height:130px;margin:4px auto 10px}
  .ring{position:absolute;inset:0;transform:rotate(-90deg)}
  .ring .track{fill:none;stroke:var(--edge);stroke-width:8}
  .ring .prog{fill:none;stroke:var(--gold);stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)}
  .ringmid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .ringmid .num{font-family:'Fraunces',serif;font-weight:900;font-size:42px;line-height:1;color:var(--gold);text-shadow:0 0 24px var(--glow)}
  .ringmid .numlabel{font-size:8px;letter-spacing:.14em;color:var(--mut);margin-top:3px}
  .togoal{font-size:12px;color:var(--mut);margin-bottom:12px}
  .togoal b{color:var(--gold);font-family:'Fraunces',serif}
```

- [ ] **Step 2: Replace the mobile scoreboard rules**

In the `@media (max-width:620px)` block, replace the scoreboard lines (currently lines 79–83, the `Scoreboard:` comment plus `#scores{...}`, `.score{...}`, `.score:first-child{...}`, `.score .num{...}`) with:

```css
    /* Rings sit a touch larger and centered on phones. */
    .ringwrap{width:138px;height:138px}
```

- [ ] **Step 3: Replace the hero + grid markup**

Replace the whole block from `<div class="hero">` through the closing `</div>` of `.grid` (currently lines 111–146) with:

```html
  <div class="hero">
    <div class="case">
      <div class="case-head">
        <span class="l">THE TROPHY CASE — EVERY ACHIEVEMENT</span>
        <span id="caseSummary"></span>
      </div>
      <div id="shelf"></div>
    </div>
  </div>

  <div class="grid">
    <div class="hcard wide cardcenter">
      <div class="hname">Prayers</div>
      <div class="ringwrap">
        <svg class="ring" viewBox="0 0 130 130"><circle class="track" cx="65" cy="65" r="56"/><circle class="prog" id="ringPrayers" cx="65" cy="65" r="56"/></svg>
        <div class="ringmid"><div class="num" id="numPrayers">0</div><div class="numlabel">DAY STREAK</div></div>
      </div>
      <div class="togoal" id="goalPrayers"></div>
      <div class="pills" id="prayerPills"></div>
      <div class="note" id="prayerNote"></div>
      <div class="wklabel">THIS WEEK</div>
      <div class="dots" id="prayerWeek"></div>
    </div>

    <div class="hcard cardcenter">
      <div class="hname">Sober</div>
      <div class="ringwrap">
        <svg class="ring" viewBox="0 0 130 130"><circle class="track" cx="65" cy="65" r="56"/><circle class="prog" id="ringSober" cx="65" cy="65" r="56"/></svg>
        <div class="ringmid"><div class="num" id="numSober">0</div><div class="numlabel">DAY STREAK</div></div>
      </div>
      <div class="togoal" id="goalSober"></div>
      <button class="toggle" id="soberToggle" type="button">Mark clean today</button>
      <div class="wklabel">THIS WEEK</div>
      <div class="dots" id="soberWeek"></div>
    </div>

    <div class="hcard cardcenter">
      <div class="hname">Workout</div>
      <div class="ringwrap">
        <svg class="ring" viewBox="0 0 130 130"><circle class="track" cx="65" cy="65" r="56"/><circle class="prog" id="ringWorkout" cx="65" cy="65" r="56"/></svg>
        <div class="ringmid"><div class="num" id="numWorkout">0</div><div class="numlabel">WEEKS ON TARGET</div></div>
      </div>
      <div class="togoal" id="goalWorkout"></div>
      <button class="toggle" id="workoutToggle" type="button">Log a session</button>
      <div class="wklabel" id="workoutSessions">SESSIONS THIS WEEK</div>
      <div class="dots" id="workoutWeek"></div>
    </div>
  </div>
```

- [ ] **Step 4: Add ring helpers and rewire `render()`**

In the second IIFE, after the `TIER_CAP` declaration, add the tier tables and ring helpers:

```js
    var DAY_TIERS = [['bronze', 7], ['silver', 30], ['gold', 90], ['sapphire', 180], ['diamond', 365]];
    var WEEK_TIERS = [['bronze', 4], ['silver', 12], ['gold', 26], ['sapphire', 39], ['diamond', 52]];
    var RC = 2 * Math.PI * 56;
    var firstPaint = true;
    var reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
    function ringProgress(current, tiers) {
      var prev = 0, i;
      for (i = 0; i < tiers.length; i++) {
        if (current < tiers[i][1]) return { p: (current - prev) / (tiers[i][1] - prev), toGo: tiers[i][1] - current, tier: tiers[i][0] };
        prev = tiers[i][1];
      }
      return { p: 1, toGo: 0, tier: null };
    }
    function setRing(prog, p, animate) {
      prog.style.strokeDasharray = RC;
      prog.style.transition = animate ? '' : 'none';
      prog.style.strokeDashoffset = RC * (1 - Math.max(0, Math.min(1, p)));
    }
    function paintHabit(cap, current, tiers, unit) {
      el('num' + cap).textContent = current;
      var t = ringProgress(current, tiers);
      setRing(el('ring' + cap), t.p, !firstPaint && !reduceMotion);
      el('goal' + cap).innerHTML = t.tier ? ('<b>' + t.toGo + '</b> ' + unit + ' to ' + TIER_CAP[t.tier]) : 'Maxed — Diamond earned';
    }
```

Then replace the body of `render()` from the line `el('sPrayers').textContent = s.prayers.current;` through the `el('workoutSessions').textContent = ...` line (currently lines 215–230) with:

```js
      paintHabit('Prayers', s.prayers.current, DAY_TIERS, 'days');
      paintHabit('Sober', s.sober.current, DAY_TIERS, 'days');
      paintHabit('Workout', s.workout.current, WEEK_TIERS, 'weeks');

      el('caseSummary').textContent = s.totals.medals + ' earned · best streak ' + s.totals.bestStreak + ' · ' + s.totals.daysTracked + ' days tracked';
      renderShelf(s.medals);

      renderPrayers();
      el('soberToggle').className = 'toggle' + (todayRow.sober ? ' on' : '');
      el('soberToggle').textContent = todayRow.sober ? 'Clean today' : 'Mark clean today';
      el('workoutToggle').className = 'toggle' + (todayRow.workout ? ' on' : '');
      el('workoutToggle').textContent = todayRow.workout ? 'Trained today' : 'Log a session';
      el('workoutSessions').textContent = 'SESSIONS THIS WEEK · ' + s.workout.thisWeekSessions + '/' + s.workout.target;
```

Then, at the very end of `render()` (after the `workoutWeek` block), add:

```js
      firstPaint = false;
```

(Leave `dots()`, `renderShelf()`, `renderPrayers()`, `tierLabel()` intact. `tierLabel` becomes unused — remove its declaration to avoid dead code.)

- [ ] **Step 5: Verify structurally and locally**

Run: extract the second `<script>` to a temp file and `node --check` it — expect no syntax errors. Then confirm by reading: no remaining references to `sPrayers`/`sSober`/`sWorkout`/`#scores`/`.score`; every `#ring*`/`#num*`/`#goal*` id is written by `paintHabit`; `tierLabel` is removed. Open `plan/lockin.html` locally (it shows the empty state) and confirm the three ring cards render with `0` centered and the trophy header appears, and the theme toggle still works.

Run: `open plan/lockin.html`
Expected: three centered ring cards (rings near-empty at 0), trophy header on top, no scoreboard; Dawn toggle still flips.

- [ ] **Step 6: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(reward): restructure into per-habit ring cards; trophy case header"
```

---

### Task 3: Wire the reward loop (burst, haptic, count-up, mint, daily-complete)

**Files:**
- Modify: `plan/lockin.html`

**Interfaces:**
- Consumes: `celebrationsFor` (Task 1), `paintHabit`/`setRing`/`RC`/`reduceMotion` (Task 2), `medalSvg`/`METAL`/`TIER_CAP`.
- Produces: reward animations fired only on the POST-success path via `runCelebrations(prev, next)`, plus an immediate tap burst + haptic on each control.

- [ ] **Step 1: Add reward-layer CSS**

In `<style>`, before the `@media (max-width:620px)` block, add:

```css
  .log.pop{animation:rpop .28s ease}
  @keyframes rpop{40%{transform:scale(.96)}100%{transform:scale(1)}}
  .spark{position:fixed;border-radius:50%;background:var(--gold);pointer-events:none;z-index:50}
  .toast{position:fixed;left:50%;top:38%;z-index:60;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:12px}
  .toast .cap{font-family:'Fraunces',serif;font-weight:900;font-size:26px;color:var(--gold);text-shadow:0 0 30px rgba(232,198,90,.5);text-align:center}
```

- [ ] **Step 2: Add the animation helpers**

In the second IIFE, after `setRing(...)`/`paintHabit(...)`, add:

```js
    function centerOf(elm) { var r = elm.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    function fireBurst(cx, cy, n) {
      if (reduceMotion) return;
      for (var i = 0; i < n; i++) {
        var s = document.createElement('div'); s.className = 'spark';
        var sz = 6 + Math.random() * 7; s.style.width = sz + 'px'; s.style.height = sz + 'px';
        s.style.left = cx + 'px'; s.style.top = cy + 'px'; document.body.appendChild(s);
        var ang = Math.random() * Math.PI * 2, dist = 45 + Math.random() * 80;
        var a = s.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 },
          { transform: 'translate(calc(-50% + ' + Math.cos(ang) * dist + 'px),calc(-50% + ' + Math.sin(ang) * dist + 'px)) scale(.2)', opacity: 0 }],
          { duration: 650 + Math.random() * 350, easing: 'cubic-bezier(.15,.7,.3,1)' });
        a.onfinish = function () { this.effect.target.remove(); };
      }
    }
    function buzz(pattern) { if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} } }
    function countUp(elm, from, to) {
      if (reduceMotion || from === to) { elm.textContent = to; return; }
      var start = null, dur = 520;
      (function step(ts) { if (!start) start = ts; var k = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - k, 3);
        elm.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); })(performance.now());
    }
    function mint(tier) {
      buzz([30, 40, 60]);
      fireBurst(window.innerWidth / 2, window.innerHeight * 0.38, 28);
      if (reduceMotion) return;
      var t = document.createElement('div'); t.className = 'toast';
      t.innerHTML = medalSvg(tier, false).replace('width="52" height="52"', 'width="120" height="120"') +
        '<div class="cap">' + TIER_CAP[tier] + ' unlocked</div>';
      document.body.appendChild(t);
      var a = t.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.06)', offset: .45 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .8 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.9) translateY(-26px)' }],
        { duration: 1700, easing: 'ease' });
      a.onfinish = function () { t.remove(); };
    }
    function celebrateDaily() {
      buzz(20);
      fireBurst(window.innerWidth / 2, window.innerHeight * 0.4, 22);
      if (reduceMotion) return;
      var t = document.createElement('div'); t.className = 'toast';
      t.innerHTML = '<div class="cap">Locked in for today</div>';
      document.body.appendChild(t);
      var a = t.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.7)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .3 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .75 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1) translateY(-22px)' }],
        { duration: 1500, easing: 'ease' });
      a.onfinish = function () { t.remove(); };
    }
    function runCelebrations(prev, next) {
      var c = celebrationsFor(prev, next);
      c.countUp.forEach(function (h) {
        var cap = h.charAt(0).toUpperCase() + h.slice(1);
        countUp(el('num' + cap), prev.summary[h].current, next.summary[h].current);
      });
      c.mints.forEach(function (tier, i) { setTimeout(function () { mint(tier); }, i * 320); });
      if (c.dailyComplete) setTimeout(celebrateDaily, c.mints.length ? 400 : 0);
    }
```

Note: `medalSvg(tier,false)` returns a `52x52` SVG; the `.replace(...)` scales it to `120` for the mint. Verify `medalSvg` emits exactly `width="52" height="52"` (it does in the current file); if that literal ever changes, update this call.

- [ ] **Step 3: Fire the tap burst + haptic on each control, and run celebrations on save success**

In `renderPrayers()`, change the pill click handler to add a burst + buzz before saving:

```js
      Array.prototype.forEach.call(el('prayerPills').children, function (b) {
        b.addEventListener('click', function () {
          todayRow.prayers[b.dataset.p] = !todayRow.prayers[b.dataset.p];
          if (todayRow.prayers[b.dataset.p]) { var c = centerOf(b); fireBurst(c.x, c.y, 12); buzz(15); }
          renderPrayers();
          save();
        });
      });
```

In the `soberToggle` click handler, after flipping `todayRow.sober`, add before `save();`:

```js
      if (todayRow.sober) { var c = centerOf(el('soberToggle')); fireBurst(c.x, c.y, 12); buzz(15); }
```

In the `workoutToggle` click handler, after flipping `todayRow.workout`, add before `save();`:

```js
      if (todayRow.workout) { var c = centerOf(el('workoutToggle')); fireBurst(c.x, c.y, 12); buzz(15); }
```

In `save()`, change the success handler from `.then(render)` to capture the previous state, render, then celebrate:

```js
        .then(function (newState) {
          var prev = lastState;      // capture before render() overwrites lastState
          render(newState);
          runCelebrations(prev, newState);
        })
```

(The `refresh()` success path and the `.catch` revert (`render(lastState)`) stay as plain `render(...)` calls — they must NOT celebrate.)

- [ ] **Step 4: Verify structurally and locally**

Run: extract the second `<script>` and `node --check` it — zero syntax errors. Confirm by reading: tap handlers call `fireBurst`+`buzz` only when turning a control ON; `save()` success calls `runCelebrations(prev, newState)` with `prev` captured before `render`; `refresh()` and the revert path do NOT call `runCelebrations`; `reduceMotion` short-circuits `fireBurst`/`mint`/`celebrateDaily`/`countUp`.

Because the reward path needs the live API, verify the feel with a temporary local mock: copy the file to the scratchpad, replace the `fetch('./config.json')…` block with a hard-coded `apiUrl` stub whose `save()`/`refresh()` resolve a canned `{days,today,summary}` (e.g. reuse the prototype's MOCK, bumping a streak and a medal to trigger count-up + mint), open it, and confirm: tapping bursts at the control, the number counts up, the ring advances, a tier crossing mints center-screen, and completing all prayers+sober fires "Locked in for today". Delete the mock copy after.

Run: `open <scratchpad>/reward-check.html`
Expected: burst on tap, count-up + ring advance on progress, center mint on tier crossing, daily-complete flourish; with OS reduce-motion on, values update instantly with no particles.

- [ ] **Step 5: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(reward): tap burst + haptic, count-up, ring advance, medal mint, daily-complete"
```

---

### Task 4: Deploy and verify live

**Files:** none.

- [ ] **Step 1: Full test suite**

Run: `cd cdk && npm test`
Expected: PASS — including `reward.test.mjs` (5) and all prior tracker/index tests.

- [ ] **Step 2: Deploy**

Run: `cd cdk && npm run deploy`
Expected: succeeds; syncs the updated `lockin.html`.

- [ ] **Step 3: Live smoke test (phone)**

Open `<BaseUrl>lockin.html`:
- Tick prayers one by one → each turns green with a gold burst + buzz; on the 5th, the day completes → Prayers number counts up, ring advances, and "Locked in for today" fires (sober must also be logged for the daily-complete moment).
- Tap "Mark clean today" → burst; the Sober number counts up (day becomes clean) and the ring moves.
- If a tick crosses a tier threshold, a medal mints center-screen and lands in the trophy header.
- Reload → no celebration replays (first load is silent); numbers/rings reflect current state.
- Toggle Dawn → rewards still gold and legible; enable OS reduced-motion → instant, no particles.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "chore: reward loop deployed and verified" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Merge reward into per-habit ring cards; trophy case as header; scoreboard retired → Task 2. ✓
- Progress ring to next medal (day tiers / week tiers), center streak number, "N to tier" → Task 2 (`ringProgress`/`paintHabit`). ✓
- Tap burst + haptic (immediate) → Task 3 Step 3. ✓
- Count-up + ring advance on confirmed increase → Task 3 (`runCelebrations`/`countUp`; ring tween via `setRing` animate). ✓
- Milestone mint center-screen on medal increase → Task 3 (`mint`). ✓
- Daily-complete moment (all 5 prayers + sober) → Task 1 (`dailyComplete`) + Task 3 (`celebrateDaily`). ✓
- Earned-only / first-load silent / failure silent → Task 1 (`prev==null`) + Task 3 (celebrate only on POST success; `refresh`/revert don't). ✓
- Reduced motion, no sound, theme tokens → Task 2/3 (`reduceMotion` guards; `--gold`; no audio). ✓
- Pure, tested decision function → Task 1. ✓
- Front-end only, deploy via existing script → Tasks 2–4. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. Task 3 Step 4's mock copy is explicitly temporary and deleted before commit.

**Type consistency:** `celebrationsFor` reads `summary[h].current` and `summary.medals[tier]` (Task 1) — matches what the Lambda returns and what `paintHabit`/`renderShelf` consume. Ring/num/goal ids `#ring{Prayers,Sober,Workout}`, `#num…`, `#goal…` are created in Task 2 markup and targeted by `paintHabit` (`'ring'+cap`, `'num'+cap`, `'goal'+cap` with cap ∈ {Prayers,Sober,Workout}) and by `runCelebrations` (`'num'+cap`). `medalSvg(tier,false)` `52x52` literal is relied on by `mint`'s `.replace` — noted in Task 3.

## Notes for the implementer
- The page must stay a single self-contained file — do not split JS into a sibling `.js` (the deploy only syncs `*.html`).
- Celebrations run exclusively from `save()`'s success handler. If you find yourself adding a celebration call in `render()`, `refresh()`, or the revert path, stop — that would fire on load/refresh/failure.
- Keep `state.today` as the only source of "today".
