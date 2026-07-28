# Playbook: static page + serverless interactivity

A reusable pattern for "share a link, people interact, you see live results" —
proposals, polls, RSVPs, small trip planners. This doc is the generalized
design; [cdk/ARCHITECTURE.md](cdk/ARCHITECTURE.md) is this specific deployment of it.

## When to reach for this pattern

Fits when all of these are true:

- Audience is small (friends/family/team, not public internet scale)
- Content is mostly static (a page), with one or two interactive actions on top
- "Live" means *fresh on load/action*, not sub-second push
- You want a shareable HTTPS link, not an app install
- Budget is "must round to $0"

Doesn't fit: public-facing products, >~1k concurrent users, true real-time
(chat, live cursors), anything needing auth/PII handling.

## Architecture recipe

```
Browser ──GET──▶ S3 static site (public bucket)
   │                ├─ <page>.html         (content)
   │                └─ config.json         (endpoint discovery)
   │
   ├─GET/POST──▶ Lambda Function URL ──▶ DynamoDB (single table)
```

Four resource types, always:

| Layer | AWS service | Why this, not the alternative |
|---|---|---|
| Hosting | S3 static website + public bucket policy | CloudFront/Amplify add cost and complexity for near-zero traffic; S3 alone is enough |
| Content sync | `BucketDeployment` (CDK) | Deploy = source of truth; no manual `aws s3 cp` |
| API | Lambda **Function URL**, not API Gateway | API Gateway's free tier is 12-months-then-billed; Function URLs are free indefinitely at this scale |
| Data | DynamoDB, single table, provisioned 5/5 | Stays inside the *always-free* 25 RCU/WCU (not a 12-month tier); single table keyed by `(entityId, actorId)` covers most poll/RSVP shapes |

One CDK stack, one bucket, one table — reused across use cases by namespacing:
bucket holds every page as a top-level file; table partition key is a poll/event
id, so unrelated use cases never collide.

### Sort-key design: one item vs. many, and unbounded growth

The partition key is settled (a poll id). The sort key is where each use case
actually differs, and getting it wrong is the one mistake that doesn't show up
until there's real data:

| Shape | Sort key | Read |
|---|---|---|
| One item per actor (poll, RSVP) | `voter` | query the whole partition |
| One item per day (habit tracker) | ISO date | query the whole partition — 365/year is nothing |
| **Many items per period, growing forever** (a spend log) | `t#<ISO date>#<id>` | `begins_with("t#<YYYY-MM>")` — one month, never the whole history |

Two things the third shape buys, both proven in `plan/moware.html`:

- **Prefix-scoped reads.** Embedding the date in the sort key makes a month a
  `begins_with` query, already in chronological order. A full-partition query
  would work fine on day one and get slower every month forever.
- **Several record types in one partition.** Distinct prefixes (`t#` a
  transaction, `s#` a subscription, `meta#categories` a registry) keep unrelated
  entities together without a second table or a GSI. Fetch what you need per
  prefix; two small queries beat one large one.

**Derive recurring things; never materialise them.** Moware's monthly
subscriptions could have been written as real rows each month — which needs a
write as a side effect of a read, and an exactly-correct idempotency key or you
get silent duplicates. Storing each subscription once with `startMonth` and a
nullable `endMonth`, then deriving membership per month, is a one-line rule with
no write path at all. As a bonus, `YYYY-MM` strings compare lexicographically in
chronological order, so the rule needs no date parsing.

**Money is integer minor units.** Store sen, not ringgit. Format at the edge.
This is not a micro-optimisation — floats will eventually make a total disagree
with the sum of its parts, and a spend tracker whose arithmetic is visibly wrong
is worthless.

## Cost discipline

- Prefer **indefinite** free tiers over **12-month** ones (Function URL over API
  Gateway; DynamoDB provisioned floor over on-demand-at-scale).
- Everything must survive "what if this gets forgotten for a year" — hence
  `RemovalPolicy.DESTROY` + auto-delete during dev, and a `destroy` script that
  actually removes cost-bearing resources, not just app state.
- Data transfer is usually the hidden cost — a few KB of HTML/JSON per visit is
  irrelevant; don't add images/video without checking they still fit under the
  100GB/mo free egress.
- If a requirement needs true realtime or public scale, that's a signal to
  swap the whole pattern (e.g. Firebase, or paid API Gateway + WebSockets),
  not to bolt it onto this one.

## Event-based, not polling

State refreshes only on:

1. Initial load
2. Right after the user's own action (the mutation response *is* the fresh
   state — never issue a second GET after a POST)
3. Tab/window regaining focus (`visibilitychange`)

No `setInterval`. No WebSockets. Staleness between events is an accepted,
explicit trade-off — for <50 users checking a shared link, the cost of
correctness (websockets, API Gateway, connection management) outweighs the
value of sub-second freshness.

## UI/UX: avoiding AI-slop defaults

The generic AI look clusters around three tells: warm-cream + serif + terracotta,
near-black + one neon accent used everywhere, or broadsheet hairlines with
numbered-marker sections that don't represent a real sequence. Avoid by
default; only use one deliberately if the brief calls for it.

Design checklist for any new page in this pattern:

- **Ground it in the subject.** A gokart poll looks like a starting grid and a
  timing tower, not a generic card layout. Borrow structure, vocabulary, and
  motifs from the real-world thing being planned.
- **One signature element.** Pick the one thing this page is memorable for
  (here: the staggered F1 grid) and spend the design risk there. Keep
  everything else disciplined.
- **Structure encodes meaning.** Numbered steps, dividers, tags — only use
  them where the content actually has that structure (a real 3-step ballot),
  never as decoration.
- **Type as personality, sparingly.** Pick a display face + body face on
  purpose; don't default to system-font-does-everything. Money and any other
  aligned figures get `font-variant-numeric: tabular-nums` — it costs nothing
  and no extra font.
- **If there's a chart, validate the colours — don't pick them.** Measure
  separation rather than trusting your eye; intuition badly overestimates how
  many categorical hues survive. Moware's donut ended at **four** hues plus a
  neutral "Other", the largest set that passed, found by sweeping every 4-hue
  subset. Two rules that fall out of it: colour must follow the **entity**, not
  its rank, or a filter repaints the survivors; and if slices are ordered by
  size while hues are fixed per entity, *any* two hues can end up adjacent, so
  the whole set has to separate pairwise — not just in the order you happened to
  test. A legend beside the chart is not decoration; it is often what makes a
  low-contrast fill legible at all.
- **State honestly.** Empty state ≠ hidden — show the shape of what's coming
  (empty grid slots, not a blank div). Unknown data ≠ omitted — show "TBC" or
  "not provided", not silence.
- **Copy from the user's side of the screen.** "Lock it in" not "Submit";
  errors say what happened, not "oops".
- Match dark/light to what's asked for explicitly; don't default to one
  without a reason tied to the content.

## Recipe: adding a new use case

1. Pick a `poll` id (string) — e.g. `"trip-langkawi-2026"`.
2. Design the page per the checklist above; write it as a single static HTML
   file (inline CSS/JS, no build step) in `../plan/`.
3. Reuse the existing voting contract if it fits (`voter`, plus whatever
   choice fields you need — `track`/`dates` become e.g. `activity`/`budget`);
   extend `lambda/index.mjs` only if the shape genuinely differs. Give the new
   branch its own **pure derivation module** (`lambda/<name>.mjs`) so the logic
   is unit-testable without AWS — that module is where the tests live, and it is
   what makes the whole thing safe to change later.
   If the page has more than one kind of write, discriminate on an `op` field in
   the POST body (`txn` / `delTxn` / `sub` / `cancelSub`) rather than inventing
   several endpoints — the Function URL stays single.
4. Fetch `./config.json` at runtime for the API URL — never hard-code it.
5. Fetch on load, after your own POST response, and on `visibilitychange`.
   Nothing else.
6. `npm run deploy` — same stack, same table, new file, new poll id.

## Extension points already proven

- Multi-select fields (checkbox-style chips instead of radio)
- Vote-order-preserving upsert (`createdAt` via `if_not_exists`, so re-voting
  updates the choice but not the position/order)
- Progressive disclosure (collapsed detail panels behind `<details>`, so the
  default view stays scannable)
- Month-prefixed sort keys + `begins_with` for data that grows without bound
- Several record types in one partition, separated by sort-key prefix
- A **dynamic vocabulary** — a DynamoDB string set extended with atomic `ADD`,
  no read-modify-write. Resolve user input against it **case-insensitively**, or
  "food" and "Food" become two categories and every total splits in two.
- Derived recurring items (`startMonth` / nullable `endMonth`) instead of rows
  written per period
- Server-owned "today" (`todayInMYT`) so a page never trusts the browser clock,
  and a shared rule config merged into `config.json` at deploy so one number
  changes backend and page together
- A hand-rolled inline SVG chart (no libraries — `BucketDeployment` only syncs
  `*.html`, so there is nowhere for a bundle to live)

## What would make you outgrow this pattern

- Need for auth → add Cognito or a simple shared-secret header (breaks the
  "no server maintenance" property, so consider if it's really needed)
- Need for true push → swap Function URL polling-on-event for WebSocket API
  Gateway + DynamoDB Streams, or move the whole thing to Firebase
- Public/viral scale → CloudFront in front of S3, on-demand DynamoDB, rate
  limiting on the Lambda
