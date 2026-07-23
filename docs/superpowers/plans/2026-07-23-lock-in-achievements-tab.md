# Lock In — Achievements Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the trophy case from the main view and put all medals in their own bottom-tab "Achievements" view — one centered grid of every medal type with ×counts, blurred-when-locked, and a single tap-to-explain line.

**Architecture:** Front-end only, `plan/lockin.html`. Wrap existing content in a `#trackView`, add a `#awardsView`, and a fixed bottom tab bar to switch. The achievements grid derives entirely from the existing `summary.medals` (streak tiers + comeback) and `summary.urges.total` (wave badges) — no backend/data change. Medal SVGs get unique gradient ids so many can render at once.

**Tech Stack:** Vanilla HTML/CSS/JS, single self-contained page.

## Global Constraints

- **Front-end only** (`plan/lockin.html`); no backend/CDK/data change; deploy via existing `npm run deploy`.
- **No emoji; spare copy.** Everything **centered** (mobile-first). Night & Gold; works in Dawn.
- **Locked medals = the real art, blurred + dimmed** (not an empty slot), with "—" for count.
- **Counts:** streak tiers + comeback show pooled `×N` from `summary.medals`; wave badges are earned/locked from `summary.urges.total` vs `WAVE_TIERS` (10/50/100/250/500).
- **One explainer line**, sticky + centered: default "Tap a medal to see what it earns."; updates on tap. No per-medal text.
- **Two tabs only** (Track / Achievements); default Track on load. Topbar + banner stay global above both views.
- New CSS classes must **not clash** with existing ones: use `.agrid`/`.amed`/`.vhead`/`.vlead`/`.explain`/`.tabs`/`.view` (the habit cards keep `.grid`/`.med`-free; old `.med`/`#shelf`/`.case`/`.hero` are removed).
- Medal SVG gradient ids must be **unique per instance** (`medalSvg` + `waveBadgeSvg`).

---

### Task 1: All page changes — remove trophy case, add tabs + Achievements view

**Files:** Modify `plan/lockin.html`

**Interfaces:**
- Consumes `summary.medals.{bronze..diamond,comeback}` and `summary.urges.total` (+ `totals`).
- Produces `#trackView`/`#awardsView`, `.tabs` bar with `#tabTrack`/`#tabAwards`, `#awardsGrid`, `#explain`, `#awardsTotals`; JS `renderAchievements(summary)`, `showTab(which)`; `medalSvg`/`waveBadgeSvg` with unique ids; removes `renderShelf`/`#shelf`/`#caseSummary`/`.hero`/`.case`.

- [ ] **Step 1: Remove trophy-case CSS; add tab/view/achievements CSS**

In `<style>`: **delete** these now-unused rules — `.hero` (line ~33), `.case`, `.case-head`, `.case .l`, `#caseSummary`, `#shelf`, `.med`, `.med .cap`, `.med .cnt`, `.med.locked`, and the mobile-block `#shelf`/`#shelf::-webkit-scrollbar`/`.med` rules. Also drop `#caseSummary` from the `h1,.num,.hname,#caseSummary{...}` font rule → `h1,.num,.hname,.vhead{...}`.

Then add (near the end of `<style>`, before `@media`):

```css
  .view{display:none}
  .view.on{display:block}
  .vhead{font-family:'Fraunces',serif;font-weight:700;font-size:22px;text-align:center;margin:2px 0 4px}
  .vlead{color:var(--mut);font-size:13px;text-align:center;margin:0 0 14px}
  #awardsTotals{display:block;text-align:center;color:var(--gold);font-family:'Fraunces',serif;font-size:13px;margin:0 0 16px}
  .explain{position:sticky;top:8px;z-index:5;background:var(--card);border:1px solid var(--edge);border-radius:12px;
    padding:12px 14px;font-size:13px;color:var(--mut);min-height:44px;display:flex;align-items:center;justify-content:center;
    text-align:center;margin-bottom:18px}
  .explain b{font-family:'Fraunces',serif;color:var(--gold);font-weight:700}
  .agrid{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}
  .amed{width:96px;background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:14px 8px 12px;
    display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer;transition:border-color .15s,transform .08s}
  .amed:active{transform:scale(.97)}
  .amed.sel{border-color:var(--gold)}
  .amed.locked{opacity:.55}
  .amed.locked svg{filter:blur(3px) grayscale(.55)}
  .amed .nm{font-size:11px;color:var(--ink)}
  .amed.locked .nm{color:var(--mut)}
  .amed .ct{font-family:'Fraunces',serif;font-size:12px;color:var(--gold)}
  .amed.locked .ct{color:var(--dim)}
  .tabs{position:fixed;left:0;right:0;bottom:0;display:flex;background:rgba(13,20,28,.92);backdrop-filter:blur(8px);
    border-top:1px solid var(--edge);padding-bottom:env(safe-area-inset-bottom);z-index:30}
  :root[data-theme="dawn"] .tabs{background:rgba(244,236,221,.92)}
  .tabs button{flex:1;background:none;border:none;color:var(--mut);font:600 12px/1 'Inter';padding:12px 0 14px;cursor:pointer;
    display:flex;flex-direction:column;align-items:center;gap:5px;position:relative}
  .tabs button.on{color:var(--gold)}
  .tabs button.on::before{content:"";position:absolute;top:0;left:24%;right:24%;height:2px;background:var(--gold);border-radius:2px}
  .tabs .ic{width:20px;height:20px}
```

And give `body` room for the fixed bar — change its `padding-bottom`:

```css
    padding-bottom:calc(78px + env(safe-area-inset-bottom))}
```

- [ ] **Step 2: Markup — remove the hero/case, wrap views, add tab bar**

Delete the whole `.hero` block:

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
```

Wrap the habit-cards `.grid` in a Track view, and add the Awards view right after it. Replace `<div class="grid">` (the opening) with:

```html
  <div class="view on" id="trackView">
  <div class="grid">
```

and replace the matching closing `</div>` of that `.grid` (the one immediately before `<div id="ov"`) with:

```html
  </div>
  </div>

  <div class="view" id="awardsView">
    <div class="vhead">Achievements</div>
    <div class="vlead">Everything you've earned — and what's still out there.</div>
    <div id="awardsTotals"></div>
    <div class="explain" id="explain">Tap a medal to see what it earns.</div>
    <div class="agrid" id="awardsGrid"></div>
  </div>
```

Add the tab bar just before the `<div id="ov"` overlay:

```html
  <nav class="tabs">
    <button id="tabTrack" class="on" type="button"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 13a8 8 0 1 1 16 0"/><path d="M12 13l3-3"/></svg>Track</button>
    <button id="tabAwards" type="button"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="9" r="5"/><path d="M9 13l-2 8 5-3 5 3-2-8"/></svg>Achievements</button>
  </nav>
```

- [ ] **Step 3: Unique SVG gradient ids**

In `medalSvg`, replace the id line so every instance is unique:

```js
      var id = 'g_' + tier + '_' + (svgSeq++);
```

In `waveBadgeSvg`, replace the hardcoded `wv` id (both the `id="..."` and the `url(#...)`) with a unique one:

```js
    function waveBadgeSvg(size) {
      var id = 'wv_' + (svgSeq++);
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 102 102">' +
        '<defs><radialGradient id="' + id + '" cx="40%" cy="30%" r="72%"><stop offset="0%" stop-color="#bfe6ff"/>' +
        '<stop offset="55%" stop-color="#3f7fca"/><stop offset="100%" stop-color="#1c3f76"/></radialGradient></defs>' +
        '<circle cx="51" cy="51" r="42" fill="url(#' + id + ')"/>' +
        '<path d="M20 58 q8 -12 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#eaf6ff" stroke-width="4" stroke-linecap="round" opacity=".9"/>' +
        '<path d="M20 48 q8 -12 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#eaf6ff" stroke-width="3" stroke-linecap="round" opacity=".5"/></svg>';
    }
```

Declare the counter next to `METAL`:

```js
    var svgSeq = 0;
```

- [ ] **Step 4: `renderAchievements` (replaces `renderShelf`) + meanings + tap-to-explain**

Replace the whole `renderShelf` function with:

```js
    var STREAK_WHY = {
      bronze: 'a 7-day streak (4 weeks for workout)',
      silver: 'a 30-day streak (12 weeks)',
      gold: 'a 90-day streak (26 weeks)',
      sapphire: 'a 180-day streak (39 weeks)',
      diamond: 'a full year — 365 days (52 weeks)',
      comeback: 'rebuilding a streak to 7 days after a slip',
    };
    function acell(nm, art, ct, why) {
      var locked = ct === 0;
      return '<div class="amed ' + (locked ? 'locked' : '') + '" data-nm="' + nm + '" data-ct="' + ct + '" data-why="' + why + '">' +
        art + '<span class="nm">' + nm + '</span><span class="ct">' + (locked ? '—' : '×' + ct) + '</span></div>';
    }
    function renderAchievements(s) {
      el('awardsTotals').textContent = s.totals.medals + ' earned · best streak ' + s.totals.bestStreak + ' · ' + s.totals.daysTracked + ' days tracked';
      var cells = '';
      ['bronze', 'silver', 'gold', 'sapphire', 'diamond', 'comeback'].forEach(function (t) {
        cells += acell(TIER_CAP[t], medalSvg(t), s.medals[t] || 0, STREAK_WHY[t]);
      });
      var total = (s.urges && s.urges.total) || 0;
      WAVE_TIERS.forEach(function (w) {
        cells += acell(w[0], waveBadgeSvg(46), total >= w[1] ? 1 : 0, w[1] + ' urges ridden out');
      });
      el('awardsGrid').innerHTML = cells;
    }
```

(`TIER_CAP` already maps `comeback → 'Comeback'`; `medalSvg('comeback')` uses the existing amber khatam art; `WAVE_TIERS` is already defined at page scope.)

In `render()`, replace the two trophy lines:

```js
      el('caseSummary').textContent = s.totals.medals + ' earned · best streak ' + s.totals.bestStreak + ' · ' + s.totals.daysTracked + ' days tracked';
      renderShelf(s.medals);
```

with:

```js
      renderAchievements(s);
```

- [ ] **Step 5: Tab switching + explainer delegation (wire once at init)**

Near the other listener wiring (after the `urgeBtn`/`okBtn`/`doneBtn` block, before the `visibilitychange` line), add:

```js
    var selMedal = null;
    el('awardsGrid').addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('.amed') : null;
      if (!c) return;
      if (selMedal) selMedal.classList.remove('sel');
      selMedal = c; c.classList.add('sel');
      var ct = +c.dataset.ct, earned = ct > 0;
      el('explain').innerHTML = '<b>' + c.dataset.nm + (earned ? ' ×' + ct : '') + '</b> — ' +
        (earned ? 'earned for ' : 'not yet · earn it for ') + c.dataset.why + '.';
    });
    function showTab(which) {
      el('trackView').classList.toggle('on', which === 'track');
      el('awardsView').classList.toggle('on', which === 'awards');
      el('tabTrack').classList.toggle('on', which === 'track');
      el('tabAwards').classList.toggle('on', which === 'awards');
      scrollTo(0, 0);
    }
    el('tabTrack').addEventListener('click', function () { showTab('track'); });
    el('tabAwards').addEventListener('click', function () { showTab('awards'); });
```

- [ ] **Step 6: Verify structurally + locally**

Run: extract the second `<script>` and `node --check` — zero syntax errors. Read to confirm: no remaining `renderShelf`/`caseSummary`/`#shelf`/`.hero`/`.case` references; `render()` calls `renderAchievements(s)`; `medalSvg`/`waveBadgeSvg` use `svgSeq` unique ids; tab bar switches views; grid delegation updates `#explain`. Then a temporary local mock (scratchpad copy stubbing `apiUrl` + a canned summary with some tiers earned, some 0, `urges.total` mid-range): open it, switch to Achievements, confirm one centered grid of all medals, locked ones blurred with "—", tapping updates the single explainer line, and Track↔Achievements switch works. Delete the mock after.

Run: `open plan/lockin.html`
Expected: bottom tab bar; Track shows habit cards (no trophy case); Achievements shows the centered medal grid + explainer; tapping a medal explains it; no emoji.

- [ ] **Step 7: Commit**

```bash
git add plan/lockin.html
git commit -m "feat(achievements): move medals to a bottom-tab Achievements view; remove trophy case"
```

---

### Task 2: Deploy and verify live

- [ ] **Step 1: Tests** — Run: `cd cdk && npm test` → all pass (unchanged; sanity that nothing broke).
- [ ] **Step 2: Deploy** — Run: `cd cdk && npm run deploy`.
- [ ] **Step 3: Live smoke (phone):**
  - Main (Track) view no longer shows the trophy case; habit cards + urge block intact and working.
  - Bottom tab bar switches Track ↔ Achievements; both keep the topbar.
  - Achievements: one centered grid of all medals with ×counts; locked ones blurred/dim with "—"; tapping any medal updates the single explainer line (earned vs "not yet"); totals line correct.
  - Reload stays functional; Dawn theme legible; no emoji anywhere new.
- [ ] **Step 4:** `git add -A && git commit -m "chore: achievements tab deployed and verified" --allow-empty`

---

## Self-Review

**Spec coverage:** trophy case removed from main view (Task 1 Step 1/2); bottom tab bar + two views (Step 1/2/5); Achievements grid with all medal types + `×N` (Step 4); locked = blurred real art + "—" (Step 1 CSS + Step 4); single tap-to-explain line (Step 5); centered/mobile-first (Step 1 CSS); derives from existing summary, no backend (Step 4); unique SVG ids (Step 3); totals preserved (Step 4). ✓

**Placeholder scan:** none; Step 6 mock is explicitly temporary/deleted.

**Type consistency:** `renderAchievements(s)` reads `s.medals[tier]`, `s.medals.comeback`, `s.urges.total`, `s.totals.*` — all present in the summary. `WAVE_TIERS` (`[name, threshold]`) and `TIER_CAP` reused as-is. New classes (`.agrid/.amed/.vhead/.vlead/.explain/.tabs/.view`) don't collide with existing (`.grid/.med/.hero/.case` — the latter two removed). `svgSeq` declared once, used by both SVG builders.

## Notes for the implementer
- Single self-contained file — no sibling assets.
- The Track view must keep the full habit UI + urge flow working; you're only relocating the medal display.
- Default tab is Track; the Achievements grid re-renders from `summary` on every `render()`, so counts stay live after a tick.
