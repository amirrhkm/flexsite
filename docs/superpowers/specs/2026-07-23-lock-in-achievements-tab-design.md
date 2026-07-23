# Lock In — Achievements tab (design)

Move medals out of the main view into their own tab: remove the trophy case from
the tracker view, add a bottom tab bar (Track ↔ Achievements), and build a centered
Achievements view showing **every** medal type — streak tiers, Comeback, and wave
badges — each once with an `×count`, locked ones shown blurred/dim as goals, with a
single tap-to-explain line. Front-end only; extends
[the tracker](2026-07-21-lock-in-habit-tracker-design.md), [reward loop](2026-07-23-lock-in-reward-loop-design.md),
and [urge surfing](2026-07-23-lock-in-urge-surfing-design.md).

## Problem

The trophy case sits on the main tracker view and only shows the streak medals; wave
badges live separately on the Sober card. The user wants one place for all achievements,
uncluttered, phone-first.

## Chosen shape (validated by an approved prototype)

- **Remove the trophy case** (`.case`: label, `#caseSummary`, `#shelf`) from the main
  view. Since the `.hero` now contains only that case, remove the whole `.hero` block.
- **Bottom tab bar** (fixed, thumb-friendly), two tabs: **Track** and **Achievements**,
  each a small line-SVG icon + label; active tab in gold. Content area swaps between the
  two views; the topbar (Lock In / date / theme toggle) and banner stay global above.
- **Achievements view** (centered throughout, mobile-first):
  - Heading "Achievements" + a one-line lead, and a compact centered totals line
    ("N earned · best streak N · N days tracked" — the info the old case summary held).
  - A **sticky, centered explainer line** — default "Tap a medal to see what it earns.";
    tapping any medal replaces it with that medal's meaning (one line).
  - **One centered grid** of all medals (no section headings): streak tiers
    Bronze/Silver/Gold/Sapphire/Diamond, then Comeback, then wave badges
    Ripple/Swell/Breaker/Tide/Ocean. Each cell: medal art + name + `×count`.
    **Locked** medals show the real art **blurred + dimmed** with "—" (a glimpse of the
    goal), and tapping still reveals the requirement.

## Data (all from the existing summary — no backend change)

- **Streak tiers:** pooled counts from `summary.medals[tier]` (already computed across
  prayers/sober/workout). Locked when count is 0.
- **Comeback:** `summary.medals.comeback`.
- **Wave badges:** derived from `summary.urges.total` vs `WAVE_TIERS`
  (10/50/100/250/500) — earned (count 1) when total ≥ threshold, else locked.
- Each medal has a fixed one-line meaning (the tap explainer), e.g.
  `Gold — a 90-day streak (26 weeks for workout)`, `Comeback — rebuilding a streak to 7
  days after a slip`, `Ocean — 500 urges ridden out`.

## Behavior / mechanics

- `showTab('track'|'awards')` toggles the two views + the tab-bar active state and scrolls
  to top. Default on load: **Track**. The Achievements grid is (re)rendered from the
  latest `summary` on each `render()`, so counts stay live.
- The existing `renderShelf`/`#shelf`/`#caseSummary` are removed; the achievements grid
  render (`renderAchievements(summary)`) replaces them.
- **Reuse artwork:** `medalSvg` (khatam metals) for streak tiers + a comeback variant;
  `waveBadgeSvg` for waves. **Fix:** give each medal SVG a **unique gradient id** so the
  grid's many instances (esp. the 5 wave badges) don't collide on a shared `id`.
- No change to the reward loop, ring cards, or urge flow beyond removing the case and
  relocating medal display.

## Visual / tone

- Night & Gold; works in Dawn. Everything **centered** (headings, explainer, grid,
  section-free). Medals wrap and center as a group (flex-wrap + `justify-content:center`).
- Bottom tab bar: translucent blurred background, gold active tab, safe-area padding;
  body gets bottom padding so content clears the bar.
- No emoji; spare copy. Locked = blur + reduced opacity (not an empty slot).

## Files

- `plan/lockin.html` only: remove `.hero`/trophy markup + `renderShelf`; add the tab bar
  markup + the two view wrappers + the Achievements view; add `WAVE tiers`/meanings table,
  `renderAchievements`, tab switching, unique-id medal SVGs. No backend/CDK/data change.

## Testing

- Front-end: `node --check` on the inline script; structural checks (tab switching,
  grid renders all medal types, locked vs earned from a mock summary, tap updates the
  explainer, unique SVG ids). Manual: deploy, switch tabs on a phone, tap medals.
- No unit-test target changes (derivation is a thin mapping over the existing, already
  tested `summary`).

## Out of scope (YAGNI)

More than two tabs; per-habit medal breakdown; sharing; animating the tab transition;
any change to how medals are earned or to the backend.
