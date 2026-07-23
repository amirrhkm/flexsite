# Lock In — Urge Counter + Urge-Surfing Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an urge button to the Sober card that can be tapped many times a day; each tap banks a "wave ridden" and launches a guided urge-surfing wave, with milestone wave badges.

**Architecture:** A new per-day `urges` integer flows through the existing Lambda/DynamoDB path (no new infra). `computeSummary` returns `urges:{today,total}`. The page adds a Sober-card urge block + a full-screen guided-wave overlay (canvas wave + breath cue); crossing a wave-badge threshold fires the existing mint mechanic with wave artwork. Everything stays independent of the sober streak.

**Tech Stack:** Node 22 ESM Lambda, `@aws-sdk/lib-dynamodb`, `node:test`; vanilla HTML/CSS/JS + `<canvas>`, single self-contained page.

## Global Constraints

- **Backend + front-end**, but **no new AWS infrastructure**; reuse the stack, table, and `npm run deploy`.
- `plan/lockin.html` stays a **single self-contained file** (inline CSS/JS/canvas; only external refs: existing Google Fonts + `./config.json`).
- **No emoji anywhere. Copy is spare** — phase words (`Building` / `Cresting` / `Passing`), breath cue (`Breathe in` / `Breathe out`), at most one short line ("It rises and passes. Ride it."). Button label: **"Ride out an urge"**.
- **Every tap is a win, banked on tap** (choosing to surf); ending the wave early never revokes it. **No random/variable rewards.**
- **Independent of the sober streak** — the urge flow never reads or writes the clean-day tick.
- **Wave = calming blue** (deliberately distinct from the gold reward language); counts/badge accents stay gold-family. Wave badges use **their own wave-motif artwork**, not the khatam metal medals.
- **Wave badge tiers** (all-time waves ridden, tunable): Ripple 10 · Swell 50 · Breaker 100 · Tide 250 · Ocean 500.
- **Reduced motion:** the wave is core therapeutic content and still renders (calm); skip incidental bursts; respect `prefers-reduced-motion` for flourish. **No sound.**
- Event model unchanged: celebrations (incl. wave-badge mint) fire only on POST success; `state.today` is the sole "today". Urge value validated/clamped server-side (`0..1000`).

---

### Task 1: Backend — thread `urges` through summary + storage (TDD)

**Files:**
- Modify: `cdk/lambda/tracker.mjs` (`computeSummary`)
- Modify: `cdk/lambda/index.mjs` (`normalizeUrges`, `trackerDays`, POST)
- Modify: `cdk/lambda/tracker.test.mjs`, `cdk/lambda/index.test.mjs`

**Interfaces:**
- Produces: `computeSummary(days, today)` return gains `urges: { today, total }` (today = today's day's urge count; total = sum across days; non-numeric/negative treated as 0). New export `normalizeUrges(v) -> int` (floor, clamp `0..1000`, non-finite/negative → 0). `trackerDays` maps `urges` onto each day; tracker `POST` stores `urges`.

- [ ] **Step 1: Write the failing tests**

```js
// append to cdk/lambda/tracker.test.mjs
test('computeSummary sums urges (today + all-time), missing = 0', () => {
  const days = [
    { date: '2026-07-19', prayers: {}, workout: false, sober: false, urges: 3 },
    { date: '2026-07-20', prayers: {}, workout: false, sober: false, urges: 2 },
    { date: '2026-07-21', prayers: {}, workout: false, sober: false, urges: 4 },
  ];
  const s = computeSummary(days, '2026-07-21');
  assert.deepEqual(s.urges, { today: 4, total: 9 });
  assert.deepEqual(computeSummary([{ date: '2026-07-21', prayers: {}, workout: false, sober: false }], '2026-07-21').urges, { today: 0, total: 0 });
});
```

```js
// cdk/lambda/index.test.mjs — add to the existing import and a new test
import { validTrackerDate, normalizePrayers, normalizeUrges } from './index.mjs';

test('normalizeUrges coerces to a clamped non-negative integer', () => {
  assert.equal(normalizeUrges('5'), 5);
  assert.equal(normalizeUrges(2.9), 2);
  assert.equal(normalizeUrges(-3), 0);
  assert.equal(normalizeUrges(99999), 1000);
  assert.equal(normalizeUrges(undefined), 0);
  assert.equal(normalizeUrges('x'), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cdk && node --test lambda/tracker.test.mjs lambda/index.test.mjs`
Expected: FAIL — `s.urges` undefined; `normalizeUrges is not a function`.

- [ ] **Step 3: Implement**

In `cdk/lambda/tracker.mjs`, in `computeSummary`, replace the accumulator + loop header:

```js
  const activeDates = new Set();
  let urgesTotal = 0;
  let urgesToday = 0;

  for (const d of days) {
    activeDates.add(d.date);
    const u = Number(d.urges) > 0 ? Math.floor(Number(d.urges)) : 0;
    urgesTotal += u;
    if (d.date === today) urgesToday = u;
    if (PRAYERS.every((p) => d.prayers && d.prayers[p] === true)) prayerOrd.add(dayNum(d.date));
    if (d.sober === true) soberOrd.add(dayNum(d.date));
    if (d.workout === true) {
      const ws = weekStart(d.date);
      weekCounts.set(ws, (weekCounts.get(ws) || 0) + 1);
    }
  }
```

and add `urges` to the returned object (after the `totals` block):

```js
    totals: {
      medals: totalMedals,
      bestStreak: Math.max(prayers.best, sober.best),
      daysTracked: activeDates.size,
    },
    urges: { today: urgesToday, total: urgesTotal },
  };
```

In `cdk/lambda/index.mjs`, add the export after `normalizePrayers`:

```js
export function normalizeUrges(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 1000);
}
```

In `trackerDays`, add `urges` to the mapped day:

```js
  return Items.map((it) => ({
    date: it.voter,
    prayers: it.prayers || {},
    workout: it.workout === true,
    sober: it.sober === true,
    urges: normalizeUrges(it.urges),
  })).sort((a, b) => a.date.localeCompare(b.date));
```

In the tracker `POST` `UpdateCommand`, add `urges` to the expression and values:

```js
          UpdateExpression:
            'SET prayers = :pr, workout = :w, sober = :s, urges = :ur, updatedAt = :u, createdAt = if_not_exists(createdAt, :u)',
          ExpressionAttributeValues: {
            ':pr': normalizePrayers(body.prayers),
            ':w': body.workout === true,
            ':s': body.sober === true,
            ':ur': normalizeUrges(body.urges),
            ':u': now,
          },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cdk && npm test`
Expected: PASS — new urges/normalizeUrges tests plus all prior tests.

- [ ] **Step 5: Commit**

```bash
git add cdk/lambda/tracker.mjs cdk/lambda/index.mjs cdk/lambda/tracker.test.mjs cdk/lambda/index.test.mjs
git commit -m "feat(urge): thread per-day urges through summary + storage"
```

---

### Task 2: Wave-badge detection in `celebrationsFor` (TDD)

**Files:**
- Modify: `plan/lockin.html` (the sentinel-bracketed `celebrationsFor`)
- Modify: `cdk/lambda/reward.test.mjs`

**Interfaces:**
- Produces: `celebrationsFor` return gains `waveBadges: string[]` — wave-tier names (`Ripple`…`Ocean`) whose threshold `next.summary.urges.total` crossed vs `prev`. Empty on first load, no-cross, or decrease. Backward-compatible when `summary.urges` is absent (treated as 0).

- [ ] **Step 1: Write the failing test**

```js
// append to cdk/lambda/reward.test.mjs
// NOTE: extend the existing `state()` helper's summary to include urges so these run:
//   summary: { ..., medals: {...}, urges: { today: 0, total: 0 } }
test('celebrationsFor flags a wave badge when total crosses a threshold', () => {
  const withUrges = (total) => state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total },
  } });
  assert.deepEqual(celebrationsFor(withUrges(9), withUrges(10)).waveBadges, ['Ripple']);
  assert.deepEqual(celebrationsFor(withUrges(49), withUrges(51)).waveBadges, ['Swell']);
  assert.deepEqual(celebrationsFor(withUrges(11), withUrges(12)).waveBadges, []);
  assert.deepEqual(celebrationsFor(null, withUrges(10)).waveBadges, []);
});
```

Also update the shared `state()` helper's `summary` to include `urges: { today: 0, total: 0 }` so existing tests still construct valid states.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cdk && node --test lambda/reward.test.mjs`
Expected: FAIL — `waveBadges` is `undefined`.

- [ ] **Step 3: Implement**

In `plan/lockin.html`, edit `celebrationsFor` (inside the sentinels). Change the `out` initializer to include `waveBadges`, and add the crossing check before `return out;`:

```js
      var out = { countUp: [], mints: [], dailyComplete: false, waveBadges: [] };
      if (!prev) return out;
```

```js
      if (complete(next) && !complete(prev)) out.dailyComplete = true;
      var WAVE = [['Ripple', 10], ['Swell', 50], ['Breaker', 100], ['Tide', 250], ['Ocean', 500]];
      var pt = (prev.summary.urges && prev.summary.urges.total) || 0;
      var nt = (next.summary.urges && next.summary.urges.total) || 0;
      WAVE.forEach(function (w) { if (pt < w[1] && nt >= w[1]) out.waveBadges.push(w[0]); });
      return out;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cdk && npm test`
Expected: PASS — new wave-badge test plus all prior reward/tracker/index tests.

- [ ] **Step 5: Commit**

```bash
git add plan/lockin.html cdk/lambda/reward.test.mjs
git commit -m "feat(urge): detect wave-badge crossings in celebrationsFor"
```

---

### Task 3: Page — Sober-card urge UI + guided-wave overlay

**Files:**
- Modify: `plan/lockin.html`

**Interfaces:**
- Consumes: `summary.urges` (Task 1), `celebrationsFor().waveBadges` (Task 2), `reduceMotion`, `save`, `render`, `runCelebrations`.
- Produces: Sober-card urge block (button `#urgeBtn`, counts `#urToday`/`#urAll`, `#waveBadge`); a `#ov` guided-wave overlay; `todayRow.urges` threaded through `render`/`save`; page-scope `WAVE_TIERS`, `waveBadgeSvg`, `mintWave`, `paintUrges`, and the overlay engine; wave-badge mint wired into `runCelebrations`.

- [ ] **Step 1: Add sea tokens + urge/overlay CSS**

Append `--sea`/`--seabg`/`--sea-ink`/`--sea-ink2` to each theme `:root`:

- Night (`data-theme="night"`), before `color-scheme:dark}`: `--sea:#3f7fca;--seabg:rgba(47,128,184,.14);--sea-ink:#cfe6f7;--sea-ink2:#7fb8e6;`
- Dawn (`data-theme="dawn"`), before `color-scheme:light}`: `--sea:#2f6fb0;--seabg:rgba(47,111,176,.10);--sea-ink:#235d92;--sea-ink2:#2f6fb0;`

Add to `<style>` (after the `numbump` keyframe block, before the media query):

```css
  .urge{margin-top:14px;padding-top:14px;border-top:1px solid var(--edge)}
  .urgebtn{width:100%;border:1px solid var(--sea);background:var(--seabg);color:var(--sea-ink);
    border-radius:12px;padding:13px;font:600 14px/1 'Inter';cursor:pointer;transition:transform .08s,background .15s}
  .urgebtn:active{transform:scale(.97)}
  .urgestat{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:10px;font-size:11px;color:var(--mut)}
  .urgecount b{font-family:'Fraunces',serif;color:var(--sea-ink2)}
  .wavebadge svg{display:block}
  #ov{position:fixed;inset:0;background:#07101a;display:none;flex-direction:column;align-items:center;z-index:70;overflow:hidden}
  #ov.on{display:flex}
  #ov canvas{position:absolute;inset:0;width:100%;height:100%}
  .ovtop{position:relative;z-index:2;padding:calc(40px + env(safe-area-inset-top)) 22px 0;text-align:center;max-width:420px}
  .ovtop .phase{font-family:'Fraunces',serif;font-size:24px;font-weight:700;margin-bottom:8px;color:#eaf2fb}
  .ovtop .guide{font-size:14px;color:#bcd4ea;line-height:1.5}
  .breath{position:relative;z-index:2;margin:auto;width:170px;height:170px;display:flex;align-items:center;justify-content:center}
  .breath .bring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(120,190,240,.5);
    background:radial-gradient(circle,rgba(87,166,216,.25),transparent 70%);transition:transform .2s linear}
  .breath .word{font-size:15px;letter-spacing:.1em;color:#dbeeff;z-index:3}
  .ovbtns{position:relative;z-index:2;padding:0 22px calc(38px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px;width:100%;max-width:360px}
  .ovbtns button{border:none;border-radius:12px;padding:15px;font:600 15px/1 'Inter';cursor:pointer}
  #okBtn{background:rgba(255,255,255,.10);color:#dbeeff;border:1px solid rgba(120,190,240,.3)}
  #doneBtn{background:var(--gold);color:#0d141c;display:none}
```

- [ ] **Step 2: Add the Sober-card urge block + the overlay markup**

In the Sober card, after `<div class="dots" id="soberWeek"></div>`, add (still inside that `.hcard`):

```html
      <div class="urge">
        <button class="urgebtn" id="urgeBtn" type="button">Ride out an urge</button>
        <div class="urgestat"><span class="wavebadge" id="waveBadge"></span><span class="urgecount"><b id="urToday">0</b> today · <b id="urAll">0</b> all-time</span></div>
      </div>
```

Immediately before the closing `</body>`, add the overlay:

```html
  <div id="ov" aria-hidden="true">
    <canvas id="ovCanvas"></canvas>
    <div class="ovtop"><div class="phase" id="ovPhase">Building</div><div class="guide" id="ovGuide">It rises and passes. Ride it.</div></div>
    <div class="breath"><div class="bring" id="ovRing"></div><div class="word" id="ovWord">Breathe in</div></div>
    <div class="ovbtns"><button id="okBtn" type="button">I'm okay now</button><button id="doneBtn" type="button">Done</button></div>
  </div>
```

- [ ] **Step 3: Add wave-badge artwork, mint, and the urge painters**

In the IIFE, after the `METAL` declaration, add the wave tier table, badge SVG, and mint:

```js
    var WAVE_TIERS = [['Ripple', 10], ['Swell', 50], ['Breaker', 100], ['Tide', 250], ['Ocean', 500]];
    function waveBadgeSvg(size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 102 102">' +
        '<defs><radialGradient id="wv" cx="40%" cy="30%" r="72%"><stop offset="0%" stop-color="#bfe6ff"/>' +
        '<stop offset="55%" stop-color="#3f7fca"/><stop offset="100%" stop-color="#1c3f76"/></radialGradient></defs>' +
        '<circle cx="51" cy="51" r="42" fill="url(#wv)"/>' +
        '<path d="M20 58 q8 -12 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#eaf6ff" stroke-width="4" stroke-linecap="round" opacity=".9"/>' +
        '<path d="M20 48 q8 -12 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#eaf6ff" stroke-width="3" stroke-linecap="round" opacity=".5"/></svg>';
    }
    function currentWaveBadge(total) {
      var earned = null, next = null, prevThr = 0, i;
      for (i = 0; i < WAVE_TIERS.length; i++) {
        if (total >= WAVE_TIERS[i][1]) { earned = WAVE_TIERS[i][0]; prevThr = WAVE_TIERS[i][1]; }
        else { next = WAVE_TIERS[i]; break; }
      }
      return { earned: earned, next: next, toGo: next ? next[1] - total : 0 };
    }
    function mintWave(name) {
      buzz([20, 40, 40]);
      fireBurst(window.innerWidth / 2, window.innerHeight * 0.4, 22);
      if (reduceMotion) return;
      var t = document.createElement('div'); t.className = 'toast';
      t.innerHTML = waveBadgeSvg(120) + '<div class="cap">' + name + '</div>';
      document.body.appendChild(t);
      var a = t.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.06)', offset: .45 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .8 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.9) translateY(-26px)' }],
        { duration: 1700, easing: 'ease' });
      a.onfinish = function () { t.remove(); };
    }
    function paintUrges(s) {
      var total = (s.urges && s.urges.total) || 0, today = (s.urges && s.urges.today) || 0;
      el('urToday').textContent = today;
      el('urAll').textContent = total;
      var b = currentWaveBadge(total);
      el('waveBadge').innerHTML = b.earned ? waveBadgeSvg(30) : '';
    }
```

- [ ] **Step 4: Add the guided-wave overlay engine**

After `paintUrges`, add the overlay engine (adapted from the approved prototype `.superpowers/brainstorm/27063-1784810625/content/urge-wave.html`):

```js
    var OV_DUR = 60000, BR_IN = 4000, BR_OUT = 6000;
    var ovCv, ovCtx, ovW, ovH, ovRaf = null, ovT0 = 0;
    function ovSize() { ovW = ovCv.width = innerWidth * devicePixelRatio; ovH = ovCv.height = innerHeight * devicePixelRatio; }
    function ovFrame(now) {
      var p = Math.min(1, (now - ovT0) / OV_DUR), env = Math.sin(p * Math.PI);
      var amp = (12 + env * 78) * devicePixelRatio, base = ovH * (0.80 - env * 0.28);
      ovCtx.clearRect(0, 0, ovW, ovH);
      var grad = ovCtx.createLinearGradient(0, base - amp, 0, ovH);
      grad.addColorStop(0, 'rgba(87,166,216,.55)'); grad.addColorStop(1, 'rgba(20,60,110,.85)');
      for (var layer = 0; layer < 2; layer++) {
        ovCtx.beginPath(); ovCtx.moveTo(0, ovH);
        var ph = now * (0.0016 + layer * 0.0007) + layer * 2, la = amp * (layer ? 0.6 : 1);
        for (var x = 0; x <= ovW; x += 8 * devicePixelRatio) ovCtx.lineTo(x, base - Math.sin(x / (120 * devicePixelRatio) + ph) * la);
        ovCtx.lineTo(ovW, ovH); ovCtx.closePath();
        ovCtx.fillStyle = layer ? 'rgba(47,128,184,.35)' : grad; ovCtx.fill();
      }
      var cyc = (now - ovT0) % (BR_IN + BR_OUT), inhale = cyc < BR_IN;
      var k = inhale ? cyc / BR_IN : 1 - (cyc - BR_IN) / BR_OUT;
      el('ovRing').style.transform = 'scale(' + (0.6 + 0.4 * k) + ')';
      el('ovWord').textContent = inhale ? 'Breathe in' : 'Breathe out';
      el('ovPhase').textContent = p < 0.4 ? 'Building' : p < 0.72 ? 'Cresting' : 'Passing';
      if (p >= 1) { ovFinish(); return; }
      ovRaf = requestAnimationFrame(ovFrame);
    }
    function ovFinish() {
      if (ovRaf) cancelAnimationFrame(ovRaf); ovRaf = null;
      el('ovPhase').textContent = 'It passed'; el('ovGuide').textContent = 'You rode it out.';
      el('ovWord').textContent = ''; el('ovRing').style.transform = 'scale(.6)';
      el('okBtn').style.display = 'none'; el('doneBtn').style.display = 'block';
      if (ovCtx) ovCtx.clearRect(0, 0, ovW, ovH);
    }
    function ovOpen() {
      if (!ovCv) { ovCv = el('ovCanvas'); ovCtx = ovCv.getContext('2d'); }
      el('ov').classList.add('on'); el('ov').setAttribute('aria-hidden', 'false');
      el('ovPhase').textContent = 'Building'; el('ovGuide').textContent = 'It rises and passes. Ride it.';
      el('okBtn').style.display = 'block'; el('doneBtn').style.display = 'none';
      ovSize(); ovT0 = performance.now(); ovRaf = requestAnimationFrame(ovFrame);
    }
    function ovClose() { if (ovRaf) cancelAnimationFrame(ovRaf); ovRaf = null; el('ov').classList.remove('on'); el('ov').setAttribute('aria-hidden', 'true'); }
    addEventListener('resize', function () { if (el('ov').classList.contains('on')) ovSize(); });
```

- [ ] **Step 5: Thread urges through render/save and wire the button + wave-badge mint**

In `render()`, extend `todayRow` to carry urges, and paint the urge block. Replace the `todayRow = todayItem ? ...` assignment with:

```js
      todayRow = todayItem ? { prayers: Object.assign({}, todayItem.prayers), workout: todayItem.workout, sober: todayItem.sober, urges: todayItem.urges || 0 }
                           : { prayers: {}, workout: false, sober: false, urges: 0 };
```

Add `paintUrges(s);` in `render()` right after the `paintHabit('Workout', …)` line.

In `save()`, add `urges` to the POST body:

```js
        body: JSON.stringify({ poll: POLL, date: today, prayers: todayRow.prayers, workout: todayRow.workout, sober: todayRow.sober, urges: todayRow.urges }),
```

In `runCelebrations`, after the `c.mints.forEach(...)` line, add wave-badge mints:

```js
      c.waveBadges.forEach(function (name, i) { setTimeout(function () { mintWave(name); }, (c.mints.length + i) * 320); });
```

After the workout toggle listener, wire the urge button (bank on tap → save → open the wave):

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

- [ ] **Step 6: Verify structurally and locally**

Run: extract the second `<script>` and `node --check` it — zero syntax errors. Read to confirm: `save()` body includes `urges`; `render()` sets `todayRow.urges` and calls `paintUrges`; the urge button increments + `save()` + `ovOpen()`; `runCelebrations` mints wave badges; the overlay closes via both buttons; nothing here reads/writes the sober tick. Then a temporary local mock (scratchpad copy stubbing `apiUrl` + a canned state whose `urges.total` bumps 9→10): confirm tapping opens the wave (swell→crest→pass), "I'm okay now" ends early, the counts increment, and crossing 10 mints a Ripple badge. Delete the mock after.

Run: `open plan/lockin.html`
Expected: Sober card shows "Ride out an urge" + counts; tapping opens the blue wave overlay with breath cue; ends gracefully; no emoji; copy is spare.

- [ ] **Step 7: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(urge): sober-card urge button, ridden counts + wave badge, guided-wave overlay"
```

---

### Task 4: Deploy and verify live

- [ ] **Step 1: Full suite** — Run: `cd cdk && npm test` → all pass (urges, normalizeUrges, wave-badge, prior).
- [ ] **Step 2: Deploy** — Run: `cd cdk && npm run deploy`.
- [ ] **Step 3: Live smoke (phone + desktop):**
  - Tap "Ride out an urge" → the wave overlay opens (swell → crest → pass), breath cue paces in/out; "ridden today"/"all-time" both incremented immediately.
  - "I'm okay now" ends early and still counts; "Done" closes after it passes.
  - Tap enough times to cross 10 all-time → a Ripple wave badge mints center-screen and shows on the Sober card.
  - Confirm the **sober streak/tick is unaffected** by any urge tap; reload → counts persist, no celebration replays.
  - Toggle Dawn → wave/overlay still legible; enable OS reduce-motion → wave still rides (calm), no incidental bursts.
- [ ] **Step 4: Commit fixups** — `git add -A && git commit -m "chore: urge-surfing deployed and verified" --allow-empty`

---

## Self-Review

**Spec coverage:**
- Urge button, many taps/day, banked on tap → Task 3 Step 5. ✓
- Guided wave (swell/crest/pass) + breath cue, end-able → Task 3 Steps 2/4/5. ✓
- Ridden counts (today · all-time) → Task 1 (summary.urges) + Task 3 (paintUrges). ✓
- Wave badges (Ripple…Ocean) with own artwork + mint → Task 2 (detection) + Task 3 (waveBadgeSvg/mintWave/currentWaveBadge). ✓
- Backend per-day urges, validated/clamped → Task 1 (computeSummary/normalizeUrges/POST). ✓
- No emoji / spare copy / "Ride out an urge" → Task 3 markup + overlay copy. ✓
- Independent of sober streak → urge flow never touches sober tick (Task 3). ✓
- Calming blue wave, gold-family counts/badge accents → Task 3 sea tokens + waveBadgeSvg. ✓
- Reduced motion (wave stays, bursts skipped), no sound → `reduceMotion` guards in mintWave/fireBurst; wave is content. ✓
- Celebrate only on POST success → wave-badge mint runs in `runCelebrations` (save-success only). ✓

**Placeholder scan:** none; Task 3 Step 6 mock is explicitly temporary/deleted.

**Type consistency:** `summary.urges` shape `{today,total}` produced in Task 1, consumed by `paintUrges` and `celebrationsFor` (Task 2). `celebrationsFor` return gains `waveBadges` (Task 2), consumed by `runCelebrations` (Task 3). `todayRow.urges` written in `render`, incremented in the button handler, sent in `save`. Wave tier names identical in `celebrationsFor`'s internal `WAVE` and the page `WAVE_TIERS` (both `Ripple/Swell/Breaker/Tide/Ocean` at 10/50/100/250/500) — keep them in sync (duplicated by design: `celebrationsFor` is self-contained for extraction testing).

## Notes for the implementer
- The page stays one self-contained file — no sibling JS.
- The urge flow must never read or write `todayRow.sober`/the sober streak.
- Wave-badge mint fires only via `runCelebrations` (POST-success). Don't celebrate on the optimistic tap (the tap already banks the count + opens the wave).
- `celebrationsFor`'s internal `WAVE` and page `WAVE_TIERS` must hold identical thresholds/names.
