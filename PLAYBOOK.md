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
  purpose; don't default to system-font-does-everything.
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
   extend `lambda/index.mjs` only if the shape genuinely differs.
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

## What would make you outgrow this pattern

- Need for auth → add Cognito or a simple shared-secret header (breaks the
  "no server maintenance" property, so consider if it's really needed)
- Need for true push → swap Function URL polling-on-event for WebSocket API
  Gateway + DynamoDB Streams, or move the whole thing to Firebase
- Public/viral scale → CloudFront in front of S3, on-demand DynamoDB, rate
  limiting on the Lambda
