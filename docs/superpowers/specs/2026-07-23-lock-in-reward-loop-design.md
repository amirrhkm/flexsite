# Lock In — reward loop / engagement (design)

Make logging a prayer, session, or clean day *feel* rewarding and show progression
in the moment, instead of a flat single-tap color change. Enhances the existing
tracker (see [2026-07-21-lock-in-habit-tracker-design.md](2026-07-21-lock-in-habit-tracker-design.md));
front-end only.

## Problem

Today: tap → color flips → nothing. No in-the-moment reward and no visible sense of
moving toward anything. The streak numbers live in a top scoreboard while the tap
controls are in cards below, so any progress you make isn't felt where you act.

## Principle (non-negotiable)

Everything is **earned and predictable** — the reward is your real progress made
vivid, never a gamble. No random/variable "slot-machine" rewards: the research is
explicit that unpredictable rewards recreate the addiction pattern a sobriety tool
exists to counter ([ethics of engagement loops](https://uxmag.com/articles/gamification-or-manipulation-understanding-the-ethics-of-engagement-loops)).
Tone: celebratory but tasteful, within the Night & Gold identity.

## The chosen shape (validated by an interactive prototype the user approved)

**Merge the reward into each habit card.** Each of the three habits becomes a
self-contained card: a circular **progress ring** with the streak number inside,
an "**N to <tier>**" label, the tap control (prayer pills / sober toggle / workout
toggle), and the week dots. The reward animates exactly where you tap — which also
means it stays on-screen on a phone. The **trophy case** (pooled medals + totals)
moves up to be the page header (the "everything I've earned" boom).

The separate three-number hero scoreboard is removed; its information now lives in
each card's ring.

## Layout (page structure after this change)

```
Topbar:  Lock In / date            [theme toggle]
Header:  THE TROPHY CASE — pooled medals + "N earned · best streak · days tracked"
Card 1 (wide):  Prayers  — ring+streak · "N to Gold" · 5 pills · week dots
Card 2:         Sober    — ring+streak · "N to Gold" · clean-today toggle · week dots
Card 3:         Workout  — ring+weeks  · "N to <tier>" · session toggle · "sessions X/4" · session dots
```

- **Ring** = progress from the previous tier threshold to the next (forging) tier.
  - Prayers / Sober: day-based tiers (7/30/90/180/365). Center number = current day streak.
  - Workout: week-based tiers (4/12/26/39/52). Center number = weeks on target; the
    card also shows "sessions this week X/4".
  - Maxed (past Diamond): full ring, label "Maxed".
- Mobile: cards stay single-column (already responsive); the ring is comfortably
  sized and centered.

## The reward loop (all front-end, driven by diffing render state)

The backend is unchanged — it already returns `{days, today, summary}` with
`current`, `forging {tier,threshold}`, pooled `medals`, and `thisWeek`. Every
celebration is decided by comparing the **previous** rendered state to the **new**
one after a POST.

1. **Tap feedback (immediate, optimistic).** On tapping a pill/toggle: the control
   pops (scale), a **gold burst** fires from the tap point, and a haptic buzz
   (`navigator.vibrate(15)`) on supporting devices. Fires on the click, independent
   of the round-trip, so it's instant.
2. **Count-up + ring advance (on confirmed progress).** After the POST response
   re-renders, if a habit's `current` **increased**, animate a count-up on that
   card's number and tween its ring forward. Only on increase; decreases (undo)
   just repaint.
3. **Milestone mint (on tier crossing).** If pooled medal counts increased vs the
   previous state, play the mint: the medal scales in center-screen with a gold
   burst and "<Tier> unlocked", then settles into the trophy case. Center-screen so
   it's visible regardless of scroll.
4. **Daily-complete moment.** When today's record becomes fully complete for the
   first time in this view — **all 5 prayers AND sober** logged for today — fire a
   warm "Locked in for today" flourish (gold ring sweep + burst, no new medal).
   Workout is weekly, so it isn't part of the daily-complete gate.
5. **First load never celebrates.** With no previous state, render plainly — don't
   fire mints for already-earned medals or count-ups for existing streaks.
6. **Failure never celebrates.** On POST failure the state reverts (existing
   behavior); no reward plays.

### Decision logic (pure, testable)

A single pure function decides what to celebrate:

```
celebrationsFor(prev, next) -> {
  countUp: string[],      // habit keys whose current increased ('prayers'|'sober'|'workout')
  mints:   string[],      // tier names whose pooled medal count increased ('bronze'..'comeback')
  dailyComplete: boolean, // today went from not-all-done to (all 5 prayers && sober)
}
```

- `prev == null` (first load) → everything empty/false.
- Only counts **increases** (medal counts and `current` never celebrate on decrease).
- `dailyComplete` reads `next`'s today record (all 5 prayers true && sober true) and
  is true only if `prev`'s today record was not already complete.

This function is the tricky part and is unit-tested; the animation code is thin glue
around it.

## Visual / motion

- Gold burst (WAAPI particles), gold progress ring (SVG `stroke-dashoffset` tween),
  count-up (requestAnimationFrame), center mint (~1.7s) — all as prototyped and
  approved. Vanilla JS/CSS, no libraries, all inline (single self-contained file, per
  the S3 pattern).
- Uses theme tokens so it works in **Dawn** too (`--gold` etc.).
- **Reduced motion:** `prefers-reduced-motion: reduce` skips bursts/mint animation and
  count-up (values set instantly); the ring updates without a tween. Keyboard focus
  preserved.
- **No sound** (Package B excludes it).

## Files

- `plan/lockin.html` — the only shipped change: restructure to per-habit cards with
  rings, add the reward-loop JS (tap burst, count-up, ring, mint, daily-complete),
  keep the trophy case as the header. Inline `celebrationsFor` bracketed by sentinel
  comments so it can be extracted for testing.
- `cdk/lambda/reward.test.mjs` — unit tests for `celebrationsFor`, extracted from the
  HTML file and evaluated (no build step; runs under the existing `npm test`).

**No backend, CDK, or data-model changes.** Deploy via the existing `npm run deploy`.

## Testing

- **Unit** (`celebrationsFor`): first load → nothing; a streak +1 → countUp for that
  habit; a pooled medal 0→1 → mint that tier; both at once → both; no change →
  nothing; a decrease → nothing; today completing (prayers 4/5→5/5 with sober true)
  → dailyComplete true, and not again on a subsequent already-complete render.
- **Manual:** deploy, tick on a phone — confirm the burst fires at the tap, the ring
  and number move on completing a day, the medal mints center-screen on crossing a
  tier, and reduced-motion degrades gracefully.

## Out of scope (YAGNI)

Sound, "streak at risk" urgency, push notifications, leaderboards/social, and any
random or variable reward. No changes to streak/medal math or the backend.
