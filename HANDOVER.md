# Context handover — Personal plans site

Everything a new contributor (or a fresh session) needs to pick this up. For the concept +
architecture see [README.md](README.md), [PLAYBOOK.md](PLAYBOOK.md), and
[cdk/ARCHITECTURE.md](cdk/ARCHITECTURE.md).

## What this is

A reusable "static page + serverless interactivity" pattern: each use case is one static
HTML file in `plan/`, served from public S3, backed by one shared Lambda **Function URL** +
one DynamoDB table. Friends-scale, mostly-static, fresh-on-action, hosted on the AWS
**always-free tier** (~RM0). One CDK stack `Site` · account `761018890563` · `ap-southeast-1`.

Two use cases live today:
- **`plan/gokart-proposal.html`** — the original date/track poll.
- **`plan/lockin.html`** — *Lock In*, a private single-user habit tracker (the bulk of the work).

Live (share the HTTPS object URL, not the HTTP website endpoint):
`https://site-sitebucket397a1860-lvgwefwlhc5r.s3.ap-southeast-1.amazonaws.com/lockin.html`

## Repo map

```
plan/lockin.html            the whole Lock In app (one self-contained file: inline CSS/JS)
plan/gokart-proposal.html   the poll
cdk/lib/site-stack.ts       the CDK stack (S3 + DynamoDB + Lambda Fn URL + BucketDeployment)
cdk/lambda/index.mjs        Lambda handler — routes gokart vs tracker by poll id
cdk/lambda/tracker.mjs      PURE derivation logic (streaks/medals/summary); unit-tested
cdk/lambda/lockin-config.json  single source of truth for rule numbers (see below)
cdk/lambda/*.test.mjs        node:test suites (tracker, index, reward)
docs/superpowers/specs/      design specs, one per feature
docs/superpowers/plans/      implementation plans, one per feature
```

## Backend model

- Table `VotesTable`: PK `poll`, SK `voter`. For Lock In: `poll="lockin"`, `voter`=ISO date
  (MYT), attrs `prayers{subuh..isya}`, `workout`, `sober`, `urges`, `createdAt/updatedAt`.
  One item per day. **Raw ticks are the only stored truth** — all streaks/medals/counts are
  **derived on read** by `computeSummary`, so a slip can never corrupt history.
- `GET ?poll=lockin` → `{ days, today, summary }`. `POST {poll:"lockin",date,prayers,workout,sober,urges}`
  upserts one day (only **today or yesterday MYT**, else 400) and returns the same shape.
- Day boundary is **midnight Malaysia time (UTC+8)**, computed server-side (`todayInMYT`).
- `summary` shape the page consumes:
  ```
  prayers/sober: { current, best, thisWeek[7], forging }
  workout:       { current, best, thisWeekSessions, target, forging, extra }
  medals:        { bronze, silver, gold, sapphire, diamond, comeback }   // pooled counts
  urges:         { today, total }
  totals:        { medals, bestStreak, daysTracked }
  ```

## Single source of truth for rule numbers

`cdk/lambda/lockin-config.json` holds the tunable numbers and feeds three places:
```json
{ "workoutTarget": 3,
  "dayTiers":  [["bronze",7],["silver",30],["gold",90],["sapphire",180],["diamond",365]],
  "weekTiers": [["bronze",4],["silver",12],["gold",26],["sapphire",39],["diamond",52]],
  "waveTiers": [["Ripple",10],["Swell",50],["Breaker",100],["Tide",250],["Ocean",500]],
  "effortTiers": [["Ember",3],["Flame",10],["Blaze",25],["Furnace",60],["Inferno",150]] }
```
- The **Lambda** imports it (`WORKOUT_TARGET`, `DAY_TIERS`, `WEEK_TIERS`).
- The **CDK deploy** merges it into the served `config.json`.
- The **page** reads `dayTiers`/`weekTiers`/`waveTiers`/`effortTiers` from `config.json` at
  load (keeping its own arrays as fallback defaults). Change a number here → redeploy →
  backend + page both update.

## Lock In feature inventory (all in `plan/lockin.html`)

- **Two tabs** (bottom bar): **Track** (habit cards) and **Achievements**.
- **Ring cards** per habit: progress ring toward the next medal + streak number + tap
  controls (5 prayer pills / sober toggle / workout toggle) + this-week dots.
  Prayers/sober are all-or-nothing day streaks; workout is on-target **weeks** (≥3 sessions/wk).
- **Reward loop:** gold burst + haptic on tap, count-up + ring advance on confirmed
  progress, center-screen **medal mint** on crossing a tier, "Locked in for today" on
  completing all prayers+sober. An always-on **CSS tap pulse** (card glow + number bump)
  guarantees visible feedback regardless of reduce-motion.
- **Urge surfing:** "Ride out an urge" on the Sober card → a guided **wave overlay** (swell/
  crest/recede + breath cue), banks a "wave ridden" on tap; **wave badges** (Ripple…Ocean)
  at urge-total milestones.
- **Extra-effort flame badges** (Ember…Inferno): workout days beyond the weekly 3 accumulate
  into a lifetime `workout.extra` total that unlocks flame badges.
- **Achievements tab:** one centered grid of every badge (streak tiers + Comeback + wave +
  flame) with ×counts; locked ones show the real art **blurred/dim**; tap → a single
  explainer line (name / requirement / collected).
- **History calendar:** tap a habit's ring → month grid, page back through months, filled =
  it counted that day. Client-side over `state.days`.
- **Themes:** Night & Gold (default) + Dawn light toggle (persisted). Type: Fraunces + Inter.
- **`celebrationsFor(prev, next, waveTiers, effortTiers)`** — pure, decides what to
  celebrate by diffing render states; sentinel-bracketed (`/*__CELEB_START__*/…`) and
  extraction-tested in `reward.test.mjs`.

## How we work

- Flow per feature (Superpowers skills): **brainstorming** → **writing-plans** →
  **executing-plans** (or subagent-driven) → **finishing-a-development-branch**. Specs land
  in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
- Git: work on a feature branch, merge `--ff-only` into `main`, delete the branch.
- Tests: `cd cdk && npm test` (node:test; the derivation logic is the tested core — currently
  ~27 tests). Deploy: `cd cdk && npm run deploy` (**the user runs the deploy** — it touches
  their AWS account). `npm run destroy` tears down.

## Conventions & hard-won gotchas

- **Single self-contained HTML file.** `BucketDeployment` only syncs `*.html`, so no sibling
  `.js`/`.css` — everything inline in `plan/lockin.html`.
- **DOM order matters:** any element the page's IIFE wires at load must appear **before** the
  `<script>`. Putting the wave overlay *after* the script once made `el('okBtn')` null →
  threw → broke the whole page. Overlays/modals/tab bar all sit before `<script>`.
- **Reduce-motion:** `fireBurst`/`mint`/`countUp`/overlay flourish are gated on
  `prefers-reduced-motion`; the CSS tap pulse is intentionally **not** gated so feedback
  always shows. (Added after a "no animation on tap" report.)
- **Celebrations fire only on POST success** — never on first load, `refresh()`, or the
  revert path. `celebrationsFor(null, …)` returns empty.
- **`state.today` (server, MYT) is the only source of "today"** — never the browser clock.
- **No emoji, spare copy** (user preference). Colours: green = done, gold = reward, calming
  blue for the urge wave, warm flame for effort badges; **no punishing red**.
- **Medal SVG gradient ids must be unique** (`svgSeq`) — many render at once in the grid.
- **No browser in the dev environment** (Chrome extension declined). Verify with
  `node --check` on the extracted script + `tidy` + structural greps + occasional jsdom logic
  checks; **the real visual pass is the user on their phone after deploy.**

## Open items / possible next steps

- Deferred **Minor** review findings (DRY in a couple of tracker primitives, a magic-number
  or two, coverage gaps) — noted in the per-feature plans under `docs/superpowers/`; none block.
- Calendar/achievements are view-only; no history editing.
- If a use case ever needs auth, real-time push, or public scale, that's the signal to swap
  the pattern (Cognito / WebSocket API GW / CloudFront + on-demand DynamoDB), not extend it.
