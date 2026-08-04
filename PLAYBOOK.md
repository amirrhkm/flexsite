# Playbook: static page + serverless interactivity

A reusable pattern for "open a URL, act, see the result" — originally for shared
things (proposals, polls, RSVPs, small trip planners), and since proven just as
well for **private single-user tools**: a habit tracker and a spend tracker, each
one page against the same backend. This doc is the generalized design;
[cdk/ARCHITECTURE.md](cdk/ARCHITECTURE.md) is this specific deployment of it.

That second use turned out to be the stronger one. A personal tool has exactly one
writer, so there is no concurrency to reason about, no accounts to manage, and no
reason to build an app — a URL on a phone home screen is the whole distribution
story.

## When to reach for this pattern

Fits when all of these are true:

- Audience is small — one person, or friends/family/team; not public internet scale
- "Live" means *fresh on load/action*, not sub-second push
- You want a URL, not an app install
- Budget is "must round to $0"

**A page can carry a lot more interaction than the pattern first appears to
allow.** The original framing here was "mostly static, with one or two actions on
top". Lock In has five prayer toggles, two habit toggles, an urge flow, two tabs
and history calendars; Moware had four write operations, a chart with two views
and a month stepper. Both were still one static file and one Lambda branch. The
real limit is not the number of actions — it's whether the data stays small,
single-writer, and refreshable on action.

Doesn't fit: public-facing products, >~1k concurrent users, true real-time
(chat, live cursors), anything needing auth/PII handling. Note that "no auth" is
load-bearing: an unguessable URL is the only thing protecting the data, which was
an easy call for a habit tracker and a considered one for a spend log. If the
content would genuinely hurt to leak, this is the wrong pattern.

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

Two things the third shape buys, both proven by Moware — a spend tracker retired in August
2026, whose page is gone but whose backend (`cdk/lambda/moware.mjs`, its tests, and the
`moware` branch in `index.mjs`) is kept precisely as the worked example:

- **Prefix-scoped reads.** Embedding the date in the sort key makes a month a
  `begins_with` query, already in chronological order. A full-partition query
  would work fine on day one and get slower every month forever.
- **Several record types in one partition.** Distinct prefixes (`t#` a
  transaction, `s#` a subscription, `meta#categories` a registry) keep unrelated
  entities together without a second table or a GSI. Fetch what you need per
  prefix; two small queries beat one large one.

### Store raw events; derive everything on read

The single most load-bearing decision in both trackers. They store only what the
user actually did — a day's ticks, one transaction, a subscription's start and
end. Every number on screen (streaks, medals, badge tiers, monthly totals,
category splits) is computed from those records on each read, by one pure
function per use case.

Not purity for its own sake. It buys three concrete things:

- **A mistake can never corrupt history.** Break a 40-day streak and the medals
  already earned still derive from the same untouched run of days. Nothing needs
  repairing because nothing was ever written down.
- **Rules can change retroactively, for free.** Lock In's urge feature was
  rebuilt from "waves surfed" into reps-toward-seawall-badges by renaming tiers
  and swapping artwork — no migration, no backfill script, because the badges had
  never existed as data. A stored-aggregate design would have needed a rewrite of
  every historical row.
- **The interesting logic is unit-testable without AWS.** `tracker.mjs` and
  `moware.mjs` import no SDK; the suite runs in milliseconds under `node --test`
  and covers exactly the part most likely to be wrong.

The cost is recomputing on every read. At this scale that is microseconds, and
when it stops being, the answer is a cached rollup item — not scattering derived
values through the write path.

**The same rule at a different scale: derive recurring things, never materialise
them.** Moware's monthly subscriptions could have been written as real rows each
month — which needs a write as a side effect of a read, and an exactly-correct
idempotency key or you get silent duplicates. Storing each subscription once with
`startMonth` and a nullable `endMonth`, then deriving membership per month, is a
one-line rule with no write path at all. As a bonus, `YYYY-MM` strings compare
lexicographically in chronological order, so the rule needs no date parsing.

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
- **In a self-directed tool, count the win — not the lapse.** What a page counts
  is what its user comes to believe about themselves, so the choice of metric is
  a design decision, not a data one. Lock In logs urges but deliberately never
  badges the urge *count*: a badge for urges logged is a badge for having urges.
  It badges the reps paid instead — same tap, same record, opposite meaning. Where
  a number could read as either strength or weakness, pick the framing on purpose,
  and keep the raw tally visible as context rather than as an achievement. (No
  punishing red, either. Green for done, gold for earned, a calm colour for the
  hard moments.)
- **Gate flourishes on `prefers-reduced-motion` — never gate the feedback
  itself.** Bursts, count-ups and centre-screen animations should respect the
  setting. But the confirmation that a tap *registered* must always fire, or
  reduced-motion users get a UI that appears broken. Lock In learned this from a
  "no animation on tap" report and now runs an always-on CSS pulse (card glow +
  number bump) that is deliberately ungated, with every decorative layer above it
  gated.
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

## Verifying a single-file page without a browser

One HTML file with an inline IIFE is fast to write and awkward to test: there is
no module boundary, no import to stub, and a single typo yields a blank page
rather than an error you'll see. What actually works:

**1. Extract the script and syntax-check it.**

```bash
python3 - <<'PY' > /tmp/check.js
import re
h = open('plan/<page>.html').read()
for m in re.finditer(r'<script>(.*?)</script>', h, re.S):
    print(m.group(1))
PY
node --check /tmp/check.js
```

**2. Confirm every wired id exists *before* the script.** This is the gotcha that
has broken a page in this repo: the IIFE runs at parse time, so an element
declared *after* `<script>` makes `document.getElementById` return null, the
constructor throws, and **the entire page dies** — not just the feature. Overlays
and sheets are the usual culprits, since they feel like they belong at the bottom.

```bash
python3 - <<'PY'
import re
h = open('plan/<page>.html').read()
si = h.index('<script>')
ids = set(re.findall(r'id="([^"]+)"', h[:si]))
wired = set(re.findall(r"el\('([^']+)'\)", h))
missing = sorted(w for w in wired if w not in ids)
print('MISSING:', missing if missing else 'none')
PY
```

**3. Sentinel-bracket the pure functions that live in the page**, so they can be
unit-tested from the Node suite. Lock In's celebration-decision function is
wrapped in `/*__CELEB_START__*/ … /*__CELEB_END__*/`; the test extracts that
block by regex and evaluates it with `new Function`. Keep such a block free of
DOM and page globals and it tests like any other module — which means page logic
worth trusting doesn't have to move out of the file to become testable.

**4. `tidy -q -e`** for malformed markup, and a grep for whatever you just
removed (fake data, retired helpers) so a rename doesn't leave a dangling caller.

**5. The real visual pass is the user, on their phone, after deploy.** None of
the above sees layout, contrast, or whether a tap target is reachable with a
thumb. Say which of the two you did; don't let "checks pass" imply "it looks
right".

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
  `*.html`, so there is nowhere for a bundle to live). Give every gradient a
  unique id from a counter: several copies of the same badge or slice render at
  once, and duplicate ids make all of them inherit the first one's fill.
- **Optimistic write with revert** (Lock In) — apply the tick locally, POST, and
  on failure re-render the last server-confirmed state with a plain-language
  banner. Good for a one-tap toggle where latency is felt. Moware does the
  opposite and waits for the response, because a spend total that flickers to a
  wrong number is worse than one that appears a beat later. Pick per action, not
  per app.
- **Side effects only on confirmed writes.** Anything celebratory or irreversible
  fires from diffing the previous server state against the response of a
  *successful* mutation — never on first load, a background refresh, or the revert
  path. Keeping that diff in one pure function makes the rule enforceable and
  testable instead of a convention people remember.
- Pure page logic extracted for testing via sentinel comments (see "Verifying a
  single-file page without a browser")

## What would make you outgrow this pattern

- Need for auth → add Cognito or a simple shared-secret header (breaks the
  "no server maintenance" property, so consider if it's really needed)
- Need for true push → swap Function URL polling-on-event for WebSocket API
  Gateway + DynamoDB Streams, or move the whole thing to Firebase
- Public/viral scale → CloudFront in front of S3, on-demand DynamoDB, rate
  limiting on the Lambda
