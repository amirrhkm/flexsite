# Lock In — personal habit tracker (design)

A private, single-user daily tracker for **prayers**, **workout**, and **sober**, built on
the repo's existing "static S3 page + Lambda Function URL + DynamoDB" pattern
(see [../../../PLAYBOOK.md](../../../PLAYBOOK.md) and [../../../cdk/ARCHITECTURE.md](../../../cdk/ARCHITECTURE.md)).
The emphasis is on **progress visualisation** — streaks, a filling weekly view, and a
permanent trophy case of medals — grounded in behavioural-psychology research on habit
formation and staying sober.

## Purpose & scope

One person (the owner) opens a shared HTTPS link every day, ticks what they did, and sees
their progress. Not public, not multi-user, no auth (see Privacy). The point is the
visualisation that keeps them on track, not feature breadth.

**Three habits, three success-shapes:**

| Habit | What "counts" | Streak unit |
|---|---|---|
| **Prayers** (Subuh, Zohor, Asar, Maghrib, Isya') | All 5 ticked in a day = a clean day | consecutive clean days |
| **Sober** | Day ticked "clean" | consecutive clean days |
| **Workout** | Week (Mon–Sun) with ≥ 4 sessions = an on-target week | consecutive on-target weeks |

Prayers and sober are all-or-nothing daily streaks (a miss resets). Workout is a weekly
frequency target (rest days are fine; the week, not the day, is judged).

## Research basis (informs the mechanic and colour)

- **Loss aversion** — a long streak becomes something you won't break. Primary driver of
  the day-counter. ([daysnoalcohol](https://daysnoalcohol.com/blog/understanding-streaks), [66streaks](https://66streaks.com/blog/dont-break-the-chain-method/))
- **Endowed-progress effect** — always show banked progress; never feel like zero. Drives
  the permanent trophy case. ([66streaks](https://66streaks.com/blog/dont-break-the-chain-method/))
- **Immediate visual feedback** — a tick that changes colour instantly ≈ +30% adherence.
  ([cohorty](https://blog.cohorty.app/progress-bars-and-visual-rewards-psychology/))
- **Green = progress, gold/amber = reward, no punishing red** — shame backfires in recovery.
  ([hakunamatata](https://www.hakunamatatatech.com/our-resources/blog/color-psychology-in-ui-design), [almax](https://almaxagency.com/design-trends/the-psychology-of-light-vs-dark-modes-in-ux-design/))
- **Dark = calm/focus, light = daytime readability → offer both.**
  ([gapsy](https://gapsystudio.com/blog/dark-mode-ux/))
- **Reward resilience, not just perfection** — hence the Comeback medal (recovery framing:
  getting back up matters more than never falling). ([Samba Recovery](https://sambarecovery.com/rehab-blog/visualization-techniques-to-support-sobriety/))

## The visualisation (signature element)

Two layers, each doing a different psychological job:

1. **Live streak** — a running day-counter per habit. Resets on a break. This is the
   loss-aversion layer; the reset is meant to sting.
2. **The bank** — a permanent trophy case of medals. **A slip never removes a banked
   medal.** This is the endowed-progress layer, so you're never back to nothing.

**Layout (top → bottom):**

- **Hero scoreboard** — the three headline streaks, big, in gold (Fraunces).
- **Trophy case** — *pooled* across all habits: earned tiers gleam with an `×N` count,
  locked tiers (e.g. Sapphire, Diamond) sit dim as the next thing to chase. Summary line:
  total earned · best streak · days tracked.
- **Daily check-in cards** — Prayers (5 tappable pills, full width), Sober (one "clean
  today" toggle), Workout (one "trained today" toggle + this-week sessions). Each card also
  shows this week's day-dots and its current forging tier.

**Medal tiers** (thresholds are tunable constants):

| Tier | Prayers / Sober | Workout |
|---|---|---|
| Bronze | 7 days | 4 weeks on target |
| Silver | 30 days | 12 weeks |
| Gold | 90 days | 26 weeks |
| Sapphire | 180 days | 39 weeks |
| Diamond | 365 days | 52 weeks |
| **Comeback** | rebuild a broken streak back to 7 days (any post-reset Bronze; first streak excluded) | same |

A single run banks **one medal per threshold it crosses** (a 95-day run → Bronze + Silver +
Gold). `×N` counts accumulate across runs. Medal motif: an 8-point Islamic star (khatam),
same shape across habits, different metal per tier.

## Visual design

- **Type:** Fraunces (hero numbers, tier names, headings — gravitas) + Inter (UI text).
  Google Fonts.
- **Theme:** **Night & Gold** (deep ink-navy) as default + a **Dawn** (warm parchment) light
  toggle, choice saved to `localStorage`.
- **Colour rules:** green = done/progress, gold = reward/achievement, quiet neutral =
  not-yet. No punishing red.
- Single static HTML file, inline CSS/JS, no build step. Fetches `./config.json` at runtime
  for the API URL (never hard-coded).

## Architecture

Reuses the one existing CDK stack — **no new infrastructure**.

```
Browser ── GET ?poll=lockin ─▶ S3: lockin.html + config.json
   │                             │
   ├── GET/POST ───────────────▶ VoteFn (Lambda Function URL, no API GW)
   │                             │
   └─────────────────────────▶ DynamoDB VotesTable  (PK poll="lockin", SK date)
```

- `plan/lockin.html` — the page, synced to S3 by the existing `BucketDeployment`.
- `cdk/lambda/index.mjs` — extended to handle the tracker contract **alongside** gokart
  voting, routed by poll id / payload shape. The gokart path is left untouched.
- `VotesTable` — partition `poll = "lockin"` keeps tracker data isolated from any poll.

### Data model — daily ticks are the only source of truth

One item per day:

```
PK poll  = "lockin"
SK date  = "2026-07-21"          (ISO, Malaysia local date)
prayers  = { subuh, zohor, asar, maghrib, isya }   // all boolean
workout  = boolean
sober    = boolean
createdAt / updatedAt
```

Nothing derived is stored. Streaks, best, medals, and the trophy case are **recomputed from
the day history on every read**. This is deliberate: because medals derive from history
(where completed runs always remain), a later slip can never corrupt the bank. Trivial cost
at this scale (`Query` by `poll`, recompute — same recompute-per-request approach as gokart).

### API (extends `lambda/index.mjs`)

- `GET  ?poll=lockin` → `{ days: [...], summary }`
- `POST { poll:"lockin", date, prayers, workout, sober }` → upsert that day, return the same
  `{ days, summary }` shape (the POST response **is** the fresh state — no second GET).

`summary` (computed server-side in a pure function):

```
{
  prayers: { current, best, thisWeek:[7 bools], forgingTier, nextThreshold },
  sober:   { current, best, thisWeek:[7 bools], forgingTier, nextThreshold },
  workout: { current, best, thisWeekSessions, target:4, forgingTier, nextThreshold },
  medals:  { bronze, silver, gold, sapphire, diamond, comeback },   // pooled counts
  totals:  { medals, bestStreak, daysTracked }
}
```

### Rules

- **Day boundary:** midnight **Malaysia time (UTC+8)**, computed server-side (Lambda runs in
  UTC and offsets).
- **Grace / backfill:** a `POST` is accepted only for **today or yesterday (MYT)**; any other
  date is rejected (400). This means forgetting to open the app for a single day doesn't
  falsely break a streak — you can still log yesterday the next morning — but you can't edit
  older history.
- **Sober logging:** affirmative daily "clean today" tick (assumed *not* logged until ticked).
- **Streak evaluation:** a day is "in progress" until MYT midnight; the streak only counts
  completed clean days. A day that rolls over incomplete breaks the streak.

### Updates — event-based only

On page load (GET after resolving `config.json`), after a POST (use the response), and on
`visibilitychange` (re-GET). No timers, no WebSockets. Per the PLAYBOOK.

### Error & empty states

- **POST failure** → revert the optimistic tick and show "Couldn't save that — tap to retry".
  No silent data loss.
- **`config.json` / GET failure** → explicit "Can't reach the tracker" state, not a blank page.
- **New user / no days** → hero shows honest zeros; trophy case shows every tier **dim and
  locked** (the shape of what's coming); a nudge to log today. Never an empty div.

## Privacy (accepted trade-off)

Public and unauthenticated, exactly like the gokart page — anyone with the link can read or
write. Accepted by the owner for a personal tool shared via an obscure link. Share the HTTPS
object URL (`https://<bucket>.s3.<region>.amazonaws.com/lockin.html`), not the HTTP website
endpoint. If this ever needs protecting, the PLAYBOOK's shared-secret-header step is the
sanctioned upgrade.

## Cost

Unchanged from the existing deployment — same always-free tiers (Lambda 1M req/mo, DynamoDB
25 provisioned RCU/WCU, first 100 GB/mo egress). One more small HTML file and one more
partition round to RM0.

## Testing

The derivation logic is pure and is the heart of the app, so it is built **test-first**
(`node:test`) against day-history fixtures:

- empty history → all zeros, all tiers locked
- an ongoing streak → correct current/best/forgingTier/nextThreshold
- a broken streak → counter resets to 0, **medals persist**
- multiple runs → correct `×N` medal counts (e.g. two separate 7-day runs → Bronze ×2)
- exact tier boundaries → day 7/30/90/180/365 award precisely (off-by-one guard)
- a 95-day run → Bronze + Silver + Gold (one each)
- Comeback → not awarded on the first streak; awarded when a post-reset streak reaches 7
- workout week boundaries → Mon–Sun grouping, ≥4 = on-target, consecutive-week counting
- grace/backfill → POST accepted for today/yesterday (MYT), rejected otherwise
- upsert idempotency → re-ticking the same day updates, never duplicates

Contract-level checks for GET/POST shapes, then a manual deploy pass: tick a few days and
confirm the visuals move as expected.

## Deliverables

1. `plan/lockin.html` — the page (Night & Gold + Dawn toggle, Fraunces/Inter, hero + trophy
   case + daily cards, event-based fetch).
2. Extended `cdk/lambda/index.mjs` — tracker GET/POST + pure derivation module, gokart path
   untouched.
3. Unit tests for the derivation module.
4. Deploy via existing `npm run deploy`; share the HTTPS object URL.

## Explicitly out of scope (YAGNI)

Auth/accounts, multi-user, notifications/reminders, editing history older than yesterday,
data export, charts beyond the streak/medal visualisation, any second poll/use-case.
