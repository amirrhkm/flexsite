# Architecture

Static plan pages with an event-based live-voting backend. One CDK stack (`Site`),
account `761018890563`, region `ap-southeast-1`.

This describes *this deployment*. For the generalized, reusable pattern behind
it — and how to apply it to a different use case — see [../PLAYBOOK.md](../PLAYBOOK.md).

```
                        ┌──────────────────────── AWS ────────────────────────┐
                        │                                                     │
 Browser ──── GET ────────▶ S3 bucket (public, static website)                │
   │                    │     ├─ gokart-proposal.html   ← synced from ../plan │
   │                    │     └─ config.json            ← { voteApiUrl }      │
   │                    │                                                     │
   ├── GET  ?poll=id ──────▶ Lambda Function URL ──▶ VoteFn (Node 22)         │
   └── POST {vote}   ──────▶        (no API GW)         │                     │
                        │                               ▼                     │
                        │                        DynamoDB VotesTable          │
                        │                        PK: poll · SK: voter         │
                        └─────────────────────────────────────────────────────┘
```

## Components

| Resource | Purpose | Notes |
|---|---|---|
| `SiteBucket` (S3) | Serves every top-level `*.html` from `../plan/` | Public bucket policy, ACLs blocked; `DESTROY` + auto-delete |
| `BucketDeployment` | Syncs pages + generates `config.json` on deploy | Prune on: deleted local files leave the bucket |
| `VoteFn` (Lambda) | Voting API, single handler in `lambda/index.mjs` | Function URL (auth NONE, CORS `*`) — no API Gateway |
| `VotesTable` (DynamoDB) | One item per `(poll, voter)` | Provisioned 5/5 RCU/WCU |

`config.json` is the only coupling between page and backend: it's written at deploy
time with the resolved Function URL, and pages fetch it at runtime. Pages never
hard-code endpoints.

## Voting API

- `GET  ?poll=<id>` → current state
- `POST {poll, voter, track, dates[]}` → upsert vote, returns the same state shape

State: `{ votes: [{voter, track, dates, createdAt, updatedAt}], tracks: {opt: n}, dates: {opt: n} }`

Item semantics:
- Upsert keyed on `(poll, voter)` — re-voting updates the pick, never duplicates.
- `createdAt` set via `if_not_exists` → grid position (first-voter order) is permanent.
- `poll` partition makes the table multi-tenant: future plan pages reuse the same
  API with a new poll id.

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

- Endpoint is public and unauthenticated — anyone with the link can vote or
  overwrite a vote by name. Fine for a private share link.
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
