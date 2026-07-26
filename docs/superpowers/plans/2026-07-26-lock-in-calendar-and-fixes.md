# Lock In — workout target · history calendar · explainer restructure (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or subagent-driven-development. Steps use `- [ ]`.

**Goal:** Workout streak target 4→3; tap a habit ring to open a month history calendar; restructure the Achievements explainer into a 3-line block.

**Architecture:** One backend constant (+ tests) and front-end additions to `plan/lockin.html` (calendar modal reads the already-loaded `lastState.days`; explainer reformat). No new infra.

## Global Constraints
- No emoji (✕/‹/› glyphs are allowed control chars, consistent with existing ☀/☾). Spare copy, centered, Night & Gold + Dawn.
- Calendar is view-only, client-side over `lastState.days`; no fetch. Next disabled at current MYT month, prev disabled at earliest tracked month.
- All calendar element ids must sit **before** `<script>` (avoid the null-ref-at-load class of bug).

---

### Task 1: Workout weekly target 4 → 3 (TDD)

**Files:** `cdk/lambda/tracker.mjs`, `cdk/lambda/tracker.test.mjs`

- [ ] **Step 1: Update the failing test** — in `tracker.test.mjs`, the workout on-target test currently builds a 4-session week and asserts `thisWeekSessions===4`/`current===1`. Change it to a **3-session** week and assert `target===3`:

```js
test('workout: a week with >=3 sessions is on-target', () => {
  const days = ['2026-07-20', '2026-07-21', '2026-07-22']
    .map((d) => ({ date: d, prayers: {}, workout: true, sober: false }));
  const s = computeSummary(days, '2026-07-22');
  assert.equal(s.workout.target, 3);
  assert.equal(s.workout.thisWeekSessions, 3);
  assert.equal(s.workout.current, 1);
});
```

- [ ] **Step 2: Run → fails** (`target` is 4). `cd cdk && node --test lambda/tracker.test.mjs`
- [ ] **Step 3: Implement** — in `tracker.mjs` change `export const WORKOUT_TARGET = 4;` → `export const WORKOUT_TARGET = 3;`
- [ ] **Step 4: Run → passes** `cd cdk && npm test`
- [ ] **Step 5: Commit** `git commit -am "fix(workout): weekly on-target streak needs 3 sessions, not 4"`

---

### Task 2: Restructure the Achievements explainer (front-end)

**Files:** `plan/lockin.html`

- [ ] **Step 1: `.explain` becomes a centered vertical stack.** Replace the `.explain{...}` rule's `display:flex;align-items:center;justify-content:center;` with a column stack and add sub-line styles:

```css
  .explain{position:sticky;top:8px;z-index:5;background:var(--card);border:1px solid var(--edge);border-radius:12px;
    padding:12px 14px;font-size:13px;color:var(--mut);min-height:64px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;gap:3px;margin-bottom:18px}
  .explain .exn{font-family:'Fraunces',serif;color:var(--gold);font-weight:700;font-size:16px}
  .explain .exr{font-size:12px;color:var(--mut)}
  .explain .exc{font-size:11px;color:var(--dim);letter-spacing:.04em}
```

Remove the old `.explain b{...}` rule (no longer used).

- [ ] **Step 2: Concise requirement strings.** Replace `STREAK_WHY` values and the wave `why`:

```js
    var STREAK_WHY = {
      bronze: '7-day streak · 4 weeks (workout)',
      silver: '30-day streak · 12 weeks',
      gold: '90-day streak · 26 weeks',
      sapphire: '180-day streak · 39 weeks',
      diamond: '365 days · 52 weeks',
      comeback: 'restart a streak after a slip',
    };
```

In `renderAchievements`, change the wave `why` from `w[1] + ' urges ridden out'` → `w[1] + ' urges ridden'`.

- [ ] **Step 3: 3-line explainer on tap.** Replace the `el('explain').innerHTML = ...` line in the awardsGrid click handler with:

```js
      el('explain').innerHTML = '<span class="exn">' + c.dataset.nm + '</span>' +
        '<span class="exr">' + c.dataset.why + '</span>' +
        '<span class="exc">' + (earned ? 'Collected ×' + ct : 'Not yet collected') + '</span>';
```

- [ ] **Step 4:** `node --check` the script; open locally to confirm the 3-line block. Commit `git commit -am "feat(achievements): 3-line explainer (name / requirement / collected)"`

---

### Task 3: Habit history calendar (front-end)

**Files:** `plan/lockin.html`

- [ ] **Step 1: Calendar CSS.** Add before the `@media` block:

```css
  .taphint{font-size:9px;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;margin:-4px 0 8px}
  .ringwrap.taphist{cursor:pointer}
  #cal{position:fixed;inset:0;background:rgba(7,12,20,.92);backdrop-filter:blur(4px);display:none;
    align-items:flex-start;justify-content:center;padding:24px 14px;z-index:60;overflow:auto}
  #cal.on{display:flex}
  .calsheet{background:var(--card);border:1px solid var(--edge);border-radius:18px;padding:18px 16px 22px;width:360px;max-width:100%;text-align:center}
  .calhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
  .calhead .t{font-family:'Fraunces',serif;font-weight:700;font-size:17px}
  .calx{background:none;border:1px solid var(--edge);color:var(--mut);border-radius:9px;width:32px;height:32px;cursor:pointer;font-size:15px}
  .calsum{font-size:11px;color:var(--mut);margin-bottom:14px}
  .calnav{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .calnav button{background:none;border:1px solid var(--edge);color:var(--ink);border-radius:9px;width:34px;height:34px;cursor:pointer;font-size:16px}
  .calnav button:disabled{opacity:.3;cursor:default}
  .calmo{font-family:'Fraunces',serif;font-size:15px}
  .calwk{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:6px}
  .calwk span{font-size:9px;color:var(--dim)}
  .caldays{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
  .cd{aspect-ratio:1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--dim)}
  .cd.pad{visibility:hidden}
  .cd.miss{background:#0e1620;color:#4a5666}
  .cd.done{background:var(--gold);color:#0d141c;font-weight:700;box-shadow:0 0 10px var(--glow)}
  .cd.future{color:#2c3644}
  .cd.today{outline:2px solid var(--gold);outline-offset:1px}
```

- [ ] **Step 2: Ring markup — tappable + hint.** For each of the three cards, change `<div class="ringwrap">` to include `taphist` + `data-habit`, and add a hint line right after the `</div>` closing the ringwrap (before the `.togoal`). Prayers:

```html
      <div class="ringwrap taphist" data-habit="prayers" role="button" tabindex="0">
```
and after that ringwrap's closing `</div>`: `<div class="taphint">tap for history</div>`. Repeat with `data-habit="sober"` and `data-habit="workout"` on the other two cards.

- [ ] **Step 3: Calendar modal markup** — add right before `<nav class="tabs">`:

```html
  <div id="cal" aria-hidden="true">
    <div class="calsheet">
      <div class="calhead"><span class="t" id="calTitle">Prayers</span><button class="calx" id="calClose" type="button">✕</button></div>
      <div class="calsum" id="calSum"></div>
      <div class="calnav"><button id="calPrev" type="button">‹</button><span class="calmo" id="calMonth"></span><button id="calNext" type="button">›</button></div>
      <div class="calwk"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
      <div class="caldays" id="calDays"></div>
    </div>
  </div>
```

- [ ] **Step 4: Calendar JS** — add inside the IIFE (e.g. after `renderAchievements`):

```js
    function calCounted(rec, h) {
      if (!rec) return false;
      if (h === 'prayers') return PRAYERS.every(function (p) { return rec.prayers && rec.prayers[p] === true; });
      if (h === 'sober') return rec.sober === true;
      return rec.workout === true;
    }
    var calH = 'prayers', calY = 0, calM = 0;
    var CAL_NM = { prayers: 'Prayers', sober: 'Sober', workout: 'Workout' };
    function calDraw() {
      var days = (lastState && lastState.days) || [];
      var byDate = {}, j; for (j = 0; j < days.length; j++) byDate[days[j].date] = days[j];
      var earliest = days.length ? days[0].date : (today || '2026-01-01');
      var todayStr = today || earliest;
      el('calTitle').textContent = CAL_NM[calH];
      var first = new Date(Date.UTC(calY, calM, 1));
      el('calMonth').textContent = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      var dim = new Date(Date.UTC(calY, calM + 1, 0)).getUTCDate();
      var lead = (first.getUTCDay() + 6) % 7, cells = '', i, done = 0, tot = 0;
      for (i = 0; i < lead; i++) cells += '<div class="cd pad"></div>';
      for (i = 1; i <= dim; i++) {
        var iso = calY + '-' + String(calM + 1).padStart(2, '0') + '-' + String(i).padStart(2, '0');
        var cls = 'cd', future = iso > todayStr;
        if (future) cls += ' future';
        else { if (calCounted(byDate[iso], calH)) { cls += ' done'; done++; } else cls += ' miss'; tot++; }
        if (iso === todayStr) cls += ' today';
        cells += '<div class="' + cls + '">' + i + '</div>';
      }
      el('calDays').innerHTML = cells;
      el('calSum').textContent = done + ' of ' + tot + ' days this month';
      var dispKey = calY + '-' + String(calM + 1).padStart(2, '0');
      el('calNext').disabled = dispKey >= todayStr.slice(0, 7);
      el('calPrev').disabled = dispKey <= earliest.slice(0, 7);
    }
    function openCalendar(h) {
      if (!lastState) return;
      calH = h;
      var t = today || '2026-01-01';
      calY = +t.slice(0, 4); calM = +t.slice(5, 7) - 1;
      calDraw();
      el('cal').classList.add('on');
    }
```

- [ ] **Step 5: Wire the ring taps + modal controls** — add near the other listener wiring (after the tab listeners):

```js
    Array.prototype.forEach.call(document.querySelectorAll('.ringwrap.taphist'), function (rw) {
      rw.addEventListener('click', function () { openCalendar(rw.dataset.habit); });
    });
    el('calClose').addEventListener('click', function () { el('cal').classList.remove('on'); });
    el('cal').addEventListener('click', function (e) { if (e.target === el('cal')) el('cal').classList.remove('on'); });
    el('calPrev').addEventListener('click', function () { if (el('calPrev').disabled) return; calM--; if (calM < 0) { calM = 11; calY--; } calDraw(); });
    el('calNext').addEventListener('click', function () { if (el('calNext').disabled) return; calM++; if (calM > 11) { calM = 0; calY++; } calDraw(); });
```

- [ ] **Step 6:** `node --check`; confirm all `cal*` ids sit before `<script>`; local mock (stub `lastState` with a few `days`) → tap a ring opens the calendar, fills/dim correct, ‹ › nav + disabling work, ✕/tap-outside closes. Commit `git commit -am "feat(calendar): tap a habit ring to open its month history"`

---

### Task 4: Deploy + verify
- [ ] `cd cdk && npm test` (all pass); `npm run deploy` (user runs).
- [ ] Phone smoke: workout on-target at 3 sessions (dots show /3); tap each ring → calendar opens, page back a month, fills correct, close works; achievements explainer shows the 3-line block. No emoji.

## Self-Review
Covers spec §1 (Task 1), §2 (Task 3), §3 (Task 2). No placeholders. Calendar ids before script (Task 3 Step 6 checks). `lastState.days` is sorted ascending (server) so `days[0].date` is earliest. `today` is the module var set in `render()`.
