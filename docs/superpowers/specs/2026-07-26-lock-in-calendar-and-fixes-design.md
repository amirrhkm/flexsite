# Lock In — workout target, history calendar, explainer restructure (design)

Three changes bundled: (1) workout weekly streak target 4 → 3; (2) tap a habit's ring
to open a month **history calendar**; (3) restructure the Achievements explainer into a
clean multiline block. Front-end + one backend constant. Extends the existing app.

## 1. Workout weekly target 4 → 3 (backend)

- `WORKOUT_TARGET` in `cdk/lambda/tracker.mjs`: **4 → 3**. A week is "on-target" (counts
  toward the workout week-streak) at **≥ 3 sessions**.
- Update the tracker tests that use 4 (the on-target-week fixture and the `target`
  assertion) to 3.
- The page already reads `summary.workout.target` for the session dots and the
  "SESSIONS THIS WEEK · X/target" text, so it auto-adjusts.
- **Unchanged:** the workout `WEEK_TIERS` (4/12/26/39/52 *weeks*) and the achievements
  requirement text "(4 weeks for workout)" — those are week counts for medal tiers, not
  the per-week session target.

## 2. Habit history calendar (front-end)

- **Trigger:** tapping a habit's **ring** (the streak circle on the Prayers / Sober /
  Workout card) opens a month-history modal for that habit. Add a subtle "tap for
  history" hint under each ring (and make the ring keyboard/pointer-tappable).
- **Modal** (full-screen overlay, like the wave/tab overlays; ✕ or tap-outside closes):
  - Header: habit name + close.
  - "X of N days this month" summary line.
  - Month nav: `‹  Month YYYY  ›`. **Next disabled** at the current (MYT) month (no
    future). **Prev disabled** once at/earlier than the earliest tracked month.
  - Mon-first weekday header + a day grid.
- **Day cell:** **gold-filled** when it counted that day — prayers = all 5 that day,
  sober = clean that day, workout = a session logged that day; **dim** when missed;
  **future** days faded/blank; **today** outlined.
- **Data:** entirely from the already-loaded `state.days` (each day carries
  `prayers/workout/sober`). No fetch — month navigation is client-side over that array.
  "Counted" per habit: prayers → all 5 of `PRAYERS` true; sober → `sober === true`;
  workout → `workout === true`.
- View-only (no editing past days from the calendar).

## 3. Achievements explainer — multiline block (front-end)

Replace the run-on tap sentence with a **centered, structured block**:

```
Bronze
7-day streak · 4 weeks (workout)
Collected ×5
```

- Line 1: medal name (Fraunces, gold). Line 2: concise requirement. Line 3:
  `Collected ×N` when earned, `Not yet collected` when locked.
- Requirement strings (concise): Bronze `7-day streak · 4 weeks (workout)`, Silver
  `30-day streak · 12 weeks`, Gold `90-day streak · 26 weeks`, Sapphire
  `180-day streak · 39 weeks`, Diamond `365 days · 52 weeks`, Comeback
  `restart a streak after a slip`, waves `N urges ridden`.
- Default (nothing tapped): "Tap a medal to see what it earns." The `.explain` box
  becomes a centered vertical stack (taller min-height) instead of one line.

## Files

- `cdk/lambda/tracker.mjs` (+ `tracker.test.mjs`): `WORKOUT_TARGET` 3, tests updated.
- `plan/lockin.html`: calendar modal markup + CSS + JS (ring tap → `openCalendar(habit)`,
  month grid render, nav, close), the "tap for history" ring hint, and the restructured
  explainer (CSS stack + updated tap handler + requirement table).

No new AWS infrastructure. Deploy via existing `npm run deploy`.

## Testing

- **Backend unit:** a week with 3 sessions is on-target (was 4); `summary.workout.target`
  is 3; a 2-session week is not on-target.
- **Front-end:** `node --check` + structural checks (ring tap opens modal, month grid
  renders correct fills from a mock `days`, nav disabling at current/earliest month, close
  works, explainer stacks into 3 lines). Manual on deploy: open each habit's calendar,
  page back a month, confirm fills; tap medals to see the new explainer.

## Out of scope (YAGNI)

Editing history from the calendar; a calendar for urges/waves; per-day detail beyond
done/missed; streak-recompute changes from the target tweak beyond the constant.
