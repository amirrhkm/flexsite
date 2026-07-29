# Personal plans site

Shared IaC that publishes plan pages from `~/jarvis/personal/plan/` to a public S3 bucket,
with an event-based live-voting backend. See [ARCHITECTURE.md](ARCHITECTURE.md).

## How it works

- Every top-level `*.html` in `../plan/` is uploaded to the bucket root on deploy.
- Deleting a local `.html` removes it from the bucket on the next deploy (prune is on).
- Share links: `<BaseUrl><filename>.html` — `BaseUrl` is printed as a stack output.

## Usage

```bash
npm run deploy    # deploy/update the bucket and sync pages
npm run destroy   # tear everything down
```

Add a new plan page → drop `whatever.html` into `../plan/` → `npm run deploy` → share the link.

Stack: `Site` · account 761018890563 · ap-southeast-1
