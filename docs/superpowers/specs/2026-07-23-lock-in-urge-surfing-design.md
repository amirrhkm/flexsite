# Lock In — urge counter + urge-surfing wave (design)

An urge button on the Sober card that can be tapped many times a day. Each tap
launches a guided "ride it out" wave (Marlatt's urge-surfing) and banks a **wave
ridden** — a win, with milestone badges for cumulative resilience. Extends the
tracker + reward loop ([2026-07-21](2026-07-21-lock-in-habit-tracker-design.md),
[2026-07-23 reward loop](2026-07-23-lock-in-reward-loop-design.md)). Backend + front-end.

## Why / principles (research-grounded)

- **Urge surfing** (Marlatt): a craving is a wave that rises, peaks, and subsides —
  most pass within 20–30 min if not acted on; you "surf" it with breath as the board.
  So the in-the-moment tool is a wave you ride out. ([positivepsychology](https://positivepsychology.com/urge-surfing/), [recovery.com](https://recovery.com/resources/urge-surfing-a-mindful-technique-to-navigate-through-cravings/))
- **Every tap is a WIN, never a failure tally.** Riding an urge builds self-efficacy;
  it's a "wave surfed," evidence of strength — celebrated, badged. A bare "urge counter"
  that reads as counting weakness backfires. ([bactrack](https://monitoring.bactrack.com/blogs/ontrack/best-sobriety-apps))
- **Independent of the streak.** Having urges is normal; *riding* them is staying clean.
  The urge count must never touch the sober day-tick or look like a slip.

## The chosen shape (validated by an approved prototype)

On the **Sober card**: a button **"🌊 Feeling an urge? Ride it out"** plus a ridden
count (today · all-time) and the current **wave badge** with progress to the next.

Tapping it:
1. **Banks the win immediately** — today's urge count +1 (the *choice to surf* is the
   win; ending early never revokes it).
2. **Launches the guided wave** — a full-screen calming overlay: a blue wave that
   **swells, crests, and recedes**, a **breathing ring** pacing in 4s / out 6s, and copy
   that walks through *building → cresting → passing*. Ends with "You rode it out — a wave
   surfed." An **"I'm okay now"** button ends it anytime (still counts); a **"Done"**
   button closes after it passes.
3. Duration is tunable (default ~60s; always end-able). Wave is **calming blue**
   (deliberately distinct from the gold reward language); the badge/counts stay gold.

## Data model (backend)

Add `urges` (non-negative integer, default 0) to the day item (`poll="lockin"`, SK=date).
- `POST` accepts `urges` and stores it via `SET` (the client holds today's running count
  and sends the whole day record, as it already does for prayers/workout/sober).
- Validation in the Lambda: coerce to a non-negative integer, clamp `0..1000` (abuse guard).
- No other schema change. Still one item per day.

## Derivation (`computeSummary`)

Add to the returned summary:

```
urges: { today: <today's count>, total: <sum of urges across all days> }
```

The wave **badge tier** is derived client-side from `urges.total` against a `WAVE_TIERS`
table (keeps the summary lean and mirrors how ring tiers are computed).

**Wave badge tiers** (all-time waves ridden; tunable constants):

| Badge | Waves ridden |
|---|---|
| Ripple | 10 |
| Swell | 50 |
| Breaker | 100 |
| Tide | 250 |
| Ocean | 500 |

One badge per threshold crossed; the Sober card shows the highest earned + "N to <next>".

## Front-end

- **Sober card additions:** the urge button, the "ridden today · all-time" line, and the
  current wave badge with progress. All below the existing ring/toggle; visually its own
  small block so it never competes with the clean-today tick.
- **Guided-wave overlay:** canvas wave (rise/crest/recede envelope), breathing ring, phase
  copy, "I'm okay now" / "Done" — as prototyped. Vanilla JS/CSS/canvas, inline (single
  self-contained file, per the S3 pattern).
- **Optimistic + save:** on tap, increment `todayRow.urges`, call the existing `save()`
  (POST now includes `urges`), and open the overlay. The POST response re-renders counts.
  On save failure the existing revert applies; the overlay still plays (riding out is not
  contingent on the network).
- **Reward integration:** crossing a wave-badge threshold fires the existing milestone
  **mint** *mechanic* (center-screen scale-in + burst + label) so a new badge lands like the
  medals — but with its **own wave-motif artwork and name** (Ripple/Swell/…), not the
  khatam metal medals. Reaching a badge is the only celebration here; individual rides get
  the wave itself (no confetti — the moment is meant to be calming, not loud).
- **Reduced motion:** the wave is core therapeutic *content*, so it still renders, but
  simplified/calm; incidental bursts are skipped and the breathing ring respects the
  gentle pace. Honor `prefers-reduced-motion` for any non-essential flourish.
- **Streak independence:** urges never read or write the sober clean-day state.

## Files

- `cdk/lambda/tracker.mjs` — add `WAVE_TIERS` (optional, or keep tiers client-side),
  extend `computeSummary` to return `urges: {today, total}`; extend `celebrationsFor` (or
  the client) to detect a wave-badge crossing for the mint. Pure, unit-tested.
- `cdk/lambda/index.mjs` — tracker `POST` validates/stores `urges` (coerce int, clamp).
- `plan/lockin.html` — Sober-card UI (button, counts, badge), the guided-wave overlay +
  its JS, wire tap → increment + save + overlay, and badge-crossing mint.
- Tests: `cdk/lambda/tracker.test.mjs` / `reward.test.mjs` extended.

**No new AWS infrastructure.** Deploy via existing `npm run deploy`.

## Testing

- **Unit:** `computeSummary` sums `urges` correctly (empty → 0/0; multi-day → total; today
  picks today's); wave-badge tier from total crosses at exactly 10/50/100/250/500;
  `normalizeUrges`/validation coerces non-integers and clamps negatives/oversize; a
  wave-badge crossing appears in the celebration decision (mint) while a non-crossing
  increment does not.
- **Manual:** deploy; tap the urge button → count +1, wave plays, ends gracefully, "I'm
  okay now" ends early and still counts; cross a badge threshold → mint fires; confirm the
  sober streak/tick is untouched by any of it; reduced-motion degrades calmly.

## Out of scope (YAGNI)

Any effect on the sober streak; notifications/reminders to "check in"; random/variable
rewards; journaling/notes on the urge; sharing. Wave badges live on the Sober card (not
mixed into the streak-medal trophy case) to keep the two metaphors distinct — surfacing
them in the trophy header is a possible later extension, not now.
