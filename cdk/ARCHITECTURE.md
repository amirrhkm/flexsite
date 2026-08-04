# Architecture

Static pages with one shared event-based backend — a poll and a habit tracker, kept apart by
a `poll` id. One CDK stack (`Site`), account `761018890563`, region `ap-southeast-1`.

A third page, *Moware* (a spend tracker), was retired in August 2026: its HTML and its data
are gone, but its backend branch and derivation module are deliberately retained. It appears
below as **retired** wherever it is still part of the code.

This describes *this deployment*. For the generalized, reusable pattern behind
it — and how to apply it to a different use case — see [../PLAYBOOK.md](../PLAYBOOK.md).

```mermaid
flowchart LR
  browser["Browser"]

  subgraph aws["AWS · 761018890563 · ap-southeast-1 · stack: Site"]
    direction TB

    subgraph bucket["SiteBucket — S3, public, static"]
      html["gokart-proposal.html<br/>lockin.html<br/><i>synced from ../plan</i>"]
      cfg["config.json<br/><i>generated at deploy</i>"]
    end

    fn["VoteFn · Node 22<br/>lambda/index.mjs<br/>Function URL, auth NONE, CORS *"]
    ddb[("VotesTable<br/>PK poll · SK varies<br/>provisioned 5/5")]
  end

  browser -->|"GET *.html"| html
  browser -->|"GET config.json"| cfg
  browser -->|"GET ?poll=id"| fn
  browser -->|"POST"| fn
  fn -->|"Query / Update / Delete"| ddb

  classDef store fill:#e8f1fb,stroke:#3d6fa5,color:#12314d
  classDef comp fill:#eef7f2,stroke:#3f8f6b,color:#123a2a
  class html,cfg,ddb store
  class fn comp
```

One handler serves every use case, branching on the `poll` id — and each branch owns a pure,
unit-tested derivation module:

```mermaid
flowchart LR
  req["request<br/>poll = ?"]

  req -->|"lockin"| tr["tracker branch"]
  req -->|"any other id"| gk["poll / RSVP branch"]
  req -->|"moware"| mw["moware branch<br/><i>retired page, live code</i>"]

  tr --> trm["tracker.mjs<br/>streaks · medals · badges"]
  gk --> gkm["inline in index.mjs<br/>tally by track and date"]
  mw --> mwm["moware.mjs<br/>subActive · computeMonth"]

  classDef pure fill:#eef7f2,stroke:#3f8f6b,color:#123a2a
  classDef dim fill:#f2f3f5,stroke:#9aa3ad,color:#4a5259
  class trm,gkm pure
  class mw,mwm dim
```

The single table is multi-tenant by partition, and each tenant chooses its own sort-key
shape — which is the decision that actually differs per use case:

```mermaid
flowchart TB
  subgraph tbl["VotesTable — PK: poll"]
    direction TB
    p1["poll = any poll id<br/>SK: voter<br/><i>one item per person</i>"]
    p2["poll = lockin<br/>SK: YYYY-MM-DD<br/><i>one item per day</i>"]
    p3["poll = moware — retired, no items<br/>SK: t#date#id · s#id · meta#categories<br/><i>many items, prefix-scoped by month</i>"]
  end

  classDef part fill:#e8f1fb,stroke:#3d6fa5,color:#12314d
  classDef gone fill:#f2f3f5,stroke:#9aa3ad,color:#4a5259
  class p1,p2 part
  class p3 gone
```

The third shape is kept in this diagram on purpose: it is the only worked example of a tenant
whose data grows without bound, and the reason `begins_with` prefix-scoping exists here.

## Components

| Resource | Purpose | Notes |
|---|---|---|
| `SiteBucket` (S3) | Serves every top-level `*.html` from `../plan/` | Public bucket policy, ACLs blocked; `DESTROY` + auto-delete |
| `BucketDeployment` | Syncs pages + generates `config.json` on deploy | Prune on: deleted local files leave the bucket |
| `VoteFn` (Lambda) | One handler in `lambda/index.mjs`, branching on `poll` id | Function URL (auth NONE, CORS `*`) — no API Gateway |
| `VotesTable` (DynamoDB) | Keyed `(poll, voter)`; the sort key's meaning is per-tenant (see above) | Provisioned 5/5 RCU/WCU |

`config.json` is the only coupling between page and backend: it's written at deploy
time with the resolved Function URL, and pages fetch it at runtime. Pages never
hard-code endpoints.

## API

Every branch answers `GET` with current state and `POST` with the *same shape* recomputed —
so a write never needs a follow-up read.

| `poll` | `GET` | `POST` |
|---|---|---|
| any poll id | `{ votes[], tracks{}, dates{} }` | `{poll, voter, track, dates[]}` → upsert |
| `lockin` | `{ days[], today, summary }` | one day's ticks (today or yesterday MYT only) |
| `moware` *(retired)* | `{ month, today, categories, subs, summary }` | `op`: `txn` / `delTxn` / `sub` / `cancelSub` |

The `moware` branch still answers — with an empty month, since its items were deleted. No page
calls it.

Shared item semantics:

- **Upserts, not appends**, wherever there's one item per actor or per day — re-voting or
  re-ticking updates in place and never duplicates.
- `createdAt` via `if_not_exists` → the poll's grid position (first-voter order) is permanent.
- The `poll` partition makes the table multi-tenant: a new page reuses the same API with a
  new id, and unrelated use cases can never collide.
- **Aggregates are never stored.** Streaks, medals, monthly totals and category splits are all
  derived from raw items on read, by the pure module for that branch.
- **Reserved words bite here.** `treat` is a DynamoDB reserved keyword and must be aliased via
  `ExpressionAttributeNames`, as `name` already is — a bare one throws `ValidationException`
  at runtime and is invisible to the test suite. `index.test.mjs` carries a guard and the
  probe command for checking a new attribute name.

## Event-based updates (no polling)

The page fetches state only on discrete events:

1. **Page load** — `GET` after resolving `config.json`
2. **After voting** — the `POST` response carries fresh state (no second request)
3. **Tab refocus** — `visibilitychange` listener re-fetches

No timers, no WebSockets. Staleness between events is accepted by design; a
friends-scale poll doesn't justify push infrastructure.

## Cost

Everything sits in always-free tiers: Lambda (1M req/mo), DynamoDB (25 provisioned
RCU/WCU), data transfer (first 100 GB/mo). S3 storage/requests for a few HTML files
round to RM0. Function URL instead of API Gateway avoids the only per-request charge
that would outlive the 12-month free tier.

## Trade-offs (accepted)

- Endpoint is public and unauthenticated — anyone with the link can read or write any tenant:
  overwrite a vote by name, or tick a habit. Accepted for a private share link. It was weighed
  most carefully for the retired spend log, where the data was more sensitive (see that spec's
  "Accepted risk"); if a future use case carries data that would hurt to leak, this is the wrong
  pattern. The mitigation, if ever needed, is a shared-secret header — not Cognito.
- S3 website endpoint is HTTP-only; share the HTTPS object URL
  (`https://<bucket>.s3.<region>.amazonaws.com/<page>.html`) instead.
- `Scan`-free but `Query`-per-request reads: state is recomputed on every call.
  Trivial at this scale.

## Deploy

```bash
npm run deploy    # sync pages + backend; prints BaseUrl and VoteApiUrl
npm run destroy   # removes everything, including bucket contents
```

Lambda or page changes both ship through the same deploy.
