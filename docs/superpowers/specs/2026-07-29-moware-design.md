# Moware — personal spend tracker (design)

*Moware* — "money aware". A private single-user spend log on the existing static-page +
serverless pattern: log every purchase, see where the month went, know the total. Third use
case on the stack after `gokart-proposal` and `lockin`. See [PLAYBOOK.md](../../../PLAYBOOK.md)
for the pattern and [cdk/ARCHITECTURE.md](../../../cdk/ARCHITECTURE.md) for this deployment.

## Purpose and boundaries

The goal is **awareness**, not budgeting. You log what you spend; the page tells you the
month's total and its shape. Deliberately absent:

- **No income, no balance.** Outflow only.
- **No budget ceilings, no targets, no warnings.** Nothing in the UI judges a number.
- **No auth**, same as the two existing pages — see "Accepted risk" below.

Validated during design by an approved clickable prototype covering the full Overview and
Subscriptions flows (scratchpad only — not kept in the repo).

## Poll id and files

`poll = "moware"`. Page `plan/moware.html`. Derivation `cdk/lambda/moware.mjs` — pure and
unit-tested, a sibling to `tracker.mjs`; the two share nothing but the table.

**No new AWS infrastructure and no CDK change.** `BucketDeployment` already syncs every
`plan/*.html`, and the page needs nothing from `config.json` beyond `voteApiUrl`. Moware has
no tunable rule numbers, so it adds nothing to `lockin-config.json`.

## Keys

Same table, same partition-per-use-case convention. Three sort-key prefixes under
`poll="moware"`:

```
t#2026-07-29#<id>     a transaction
s#<id>                a subscription period
meta#categories       the category registry
```

Because `t#` keys embed the ISO date, `begins_with("t#2026-07")` returns exactly one month in
chronological order — the month view never scans full history. A month load is two queries:
`begins_with("t#<month>")` for transactions, `begins_with("s#")` for subscriptions (which are
not month-scoped and always come whole).

**Amounts are integer sen** everywhere — storage, API, and derivation. Ringgit exists only in
page formatting. RM 12.90 is `1290`; no floating-point drift.

| Item | Attributes |
|---|---|
| Transaction | `amount` (sen), `category`, `treat` (bool), `note` (string, may be empty), `date` (`YYYY-MM-DD`), `createdAt` |
| Subscription | `name`, `amount` (sen), `category`, `startMonth` (`YYYY-MM`), `endMonth` (`YYYY-MM` or null), `createdAt` |

`note` is the free-text remark — "pickleball court", "mak's birthday". It exists because a
category like Sports covers badminton, pickleball and bowling, and the category alone loses
which one it was.

## Categories

Dynamic: typing a category that doesn't exist creates it. Stored as a DynamoDB **string set**
on `meta#categories`, extended with `ADD` — atomic, no read-modify-write race.

- **Case-insensitive resolve.** Typing "food" when "Food" exists uses the existing spelling.
  Without this the pie silently splits one category into two, which is the failure mode most
  likely to make the whole tool untrustworthy.
- **The registry never shrinks.** Deleting every Groceries transaction leaves Groceries in the
  suggestion list. Mostly desirable — it's your vocabulary — but a typo'd "Foood" also
  persists. Removal is out of scope for v1; it is a suggestion list only.

Resolution needs the current registry, so a `txn` POST reads `meta#categories` before writing.
Single user, no concurrency, two operations — acceptable.

## Subscriptions

A subscription record is a **subscription period**, not a subscription. One rule governs
membership in a month:

```js
active(sub, month) = sub.startMonth <= month && (sub.endMonth == null || month <= sub.endMonth)
```

`YYYY-MM` strings compare lexicographically in chronological order, so this needs no date
parsing. Pure, and unit-testable in isolation.

- **Registering** sets `startMonth`, defaulting to the current month but **editable** — set it
  earlier for a subscription you have been paying for a while, and those months then include it.
- **Cancelling** sets `endMonth` to the current month, **inclusive**: cancel Netflix on 29 July
  and July still counts, because July was already billed. The button says so.
- **Price change** is cancel-then-register: end the old record at its last real price, start a
  new one. Same for resubscribing after a gap. No price-history structure — records are cheap
  and the derivation stays one line.
- Ended records are kept and shown, collapsed, with their period.

Subscriptions carry **real categories** (Netflix → Entertainment, telco → Bills), not one
"Subscriptions" bucket, so the category view tells the truth about where money goes. Seeing
them as a bloc is the job of the Subscriptions chart view below.

**Nothing is ever auto-written.** A month's subscription spend is derived, never materialised
as transaction rows. This keeps the codebase's core principle — raw records are the only stored
truth, everything else derived on read — and makes duplicate rows structurally impossible. The
rejected alternative (materialising rows on first view of a new month) was truer to
"automatic" but needs a write as a side effect of a read and an exactly-correct idempotency key.

A third option — summing all current subscriptions with no dates — was rejected outright: it
silently rewrites every past month's total whenever you cancel something, corrupting the
history the tool exists to show you.

## Derivation — `computeMonth(transactions, subs, month)`

One pure function is the whole engine:

```
{ month, total, loggedTotal, subsTotal, treatTotal,
  byCategory: [{ category, amount, fromLogged, fromSubs }],   // desc by amount
  transactions: [...],                                        // newest first
  subscriptions: [...] }                                      // active this month
```

`byCategory` carries the logged/subscription **split per category**, so both chart views
re-slice the same payload client-side with no extra round trip. One server shape, two views.

Percentages are computed on the page, not the server — they are a function of the view. They
are rounded to whole numbers for display and so will not always sum to exactly 100; the amounts
beside them are exact, and that is the honest trade rather than fudging a slice.

## API — one `moware` branch in `index.mjs`

`GET ?poll=moware&month=YYYY-MM` → `{ month, today, categories, subs, summary }`

`subs` is **every** subscription record including ended ones — the Subscriptions tab needs them
to show the collapsed history. `summary.subscriptions` is the subset active in the viewed month,
which is what the chart and totals use. The two are deliberately different.

`month` defaults to the current MYT month, must match `^\d{4}-\d{2}$`, and is **rejected if in
the future**. `today` is server-computed MYT — the page never uses the browser clock, same as
Lock In.

`POST` discriminates on `op`, and every op returns the fresh month state (the mutation
response *is* the new state — no follow-up GET):

| op | payload | rules |
|---|---|---|
| `txn` | `amount`, `category`, `treat`, `note`, `date` | date ≤ today MYT and ≥ `2020-01-01`; category resolved case-insensitively then `ADD`ed; **the server generates the `id`** |
| `delTxn` | `date`, `id` | server rebuilds the key from date + id |
| `sub` | `name`, `amount`, `category`, `startMonth` | startMonth defaults to current month |
| `cancelSub` | `id` | sets `endMonth` = current MYT month |

Validation: `amount` integer sen, 1 to 100,000,000 (RM 1,000,000); `category` and `name`
trimmed, required, ≤ 40 chars; `note` trimmed, optional, ≤ 80 chars.

## Page — `plan/moware.html`

Single self-contained file, inline CSS/JS, no build step. Phone-first (max-width 460px).

**Theme:** dawn (light) is the **default**, with a night toggle — the inverse of Lock In.
Same bones as Lock In (Fraunces display + Inter body, same card and tab grammar) but a **cool
teal accent** instead of gold: gold means *reward* in Lock In, and here the headline number is
money leaving. Dawn is a cool grey rather than Lock In's warm cream, which went muddy against
teal.

**Tabs:** `Overview` · centre action · `Subscriptions`. The centre action is a raised teal
circle with an SVG plus — not a tab, so it takes no active-tab state, and it opens the log
sheet from **either** view because logging is the app's primary action. A 4px ring in the page
background makes it read as punching through the bar. Per-theme shadow tokens.

### Overview

Month header with a `‹ ›` stepper, **forward disabled at the current month** — an open-ended
subscription is technically active next December, but showing future months would present money
you have not spent as spend.

Then the headline total, `incl. RM 318.00 treats` beneath it when non-zero, the view control,
the donut, and the legend.

**Two chart views:**

- **Categories** — top 4 categories plus `Other (n)`, sorted by amount. Centre shows the
  category count.
- **Subscriptions** — the two-slice split, Regular spending vs Subscriptions. Centre states the
  headline directly: `41% subscriptions`.

The legend sits full-width **beneath** the donut as rows — swatch, category, `RM 230.00 · 34%`.
Beside the ring was tried and rejected: the column was too narrow for the figures.

### Receipt tape — the signature element

The playbook asks for one memorable element carrying the design risk. It is the transaction
list, styled as a receipt: perforated top edge, dotted leader lines from category to amount,
`font-variant-numeric: tabular-nums` so columns align without loading a monospace font, a
`treat` tag, the remark as a muted second line, per-row delete, and a `Logged total` footer set
like a receipt subtotal.

The donut is deliberately plain. The tape is where attention actually goes — you read the list
far more often than you study the chart. The obvious choice would have been an elaborate donut,
which is exactly why it isn't: every budget app has that, and it reads as templated.

### Log sheet

Opened by the centre action from either tab. A bottom sheet, sitting before `<script>` with the
other overlays:

- **Amount** — `RM` prefix, large figure, `inputmode="decimal"`.
- **Category** — free text, backed by tappable suggestion chips from the registry, plus a live
  line stating what will happen: `New category — "Sports" will be created.` or
  `Will use your existing "Food".` when the case differs. This makes the case-insensitive
  resolve visible instead of surprising.
- **Remarks** — optional, ≤ 80 chars.
- **Who was it for** — `For me` / `A treat`.
- **Date** — defaults to today (server MYT), editable for backdating.

Amount and category are both required; the sheet refuses to submit without them.

**After logging a backdated entry the view jumps to that entry's month**, so you can see it
landed. Logging into the current month leaves the view where it is.

### Subscriptions tab

Monthly commitment total (`RM 187/mo across 6`), then active subscriptions — name, amount,
category, "since Jan 2026", Cancel. Ended ones collapse behind `<details>` showing their period.
Add takes name, amount, category, start month.

### Empty and unknown states

A month with nothing logged shows the ring's shape with `Nothing in July 2026 yet.` and
`No entries logged this month.` — not blank space. Subscription baseline still shows.

## Chart palette — the part that must not be "improved" by eye

Four hues carry the Categories view. They were chosen by running the dataviz skill's validator,
not by taste, and the specific set matters:

| | Dark | Light |
|---|---|---|
| slot 1 | `#3987e5` blue | `#2a78d6` |
| slot 2 | `#c98500` yellow | `#eda100` |
| slot 3 | `#d55181` magenta | `#e87ba4` |
| slot 4 | `#008300` green | `#008300` |
| Other | neutral grey | neutral grey |

This set passes every check in **both** modes on the all-pairs list: worst normal-vision ΔE
19.3 dark / 19.6 light (≥15 floor), and it clears colourblind separation. It was found by
sweeping all 70 four-hue subsets of the reference palette — only two pass, and this is one.

Three findings that constrain future edits:

- **Five or more categorical hues cannot work here.** The obvious 5-hue set puts magenta
  against aqua at ΔE 1.6 under deuteranopia — indistinguishable. Every 4+ subset tried outside
  the two winners failed.
- **All-pairs is the correct pairlist, not adjacent.** Colour is assigned per slice while arcs
  sort by amount, so which two colours end up touching reshuffles every month. An
  adjacent-order validation would be meaningless.
- **Light mode WARNs on contrast** for yellow and magenta (2.11 and 2.62 against the light
  surface). The validator's relief rule is satisfied because the legend labels every slice by
  name and amount — so if the legend is ever removed, the palette becomes non-compliant.

**Hue assignment differs by view, deliberately:**

- **Categories view — by rank.** Within any single chart every slice is a distinct hue, but a
  category's colour moves as its rank moves. Pinning hues to categories with only four hues
  would eventually put two same-coloured slices in one ring, which is worse to read than a
  colour that shifts between months. The adjacent legend makes the shift harmless.
- **Subscriptions view — pinned to the entity.** Regular is always blue, Subscriptions always
  yellow. With two entities there is no collision risk, so stability is free.

Top 4 + Other, because a pie past ~6 segments is unreadable. The full breakdown lives in the
list, so nothing is hidden.

No red anywhere. Spending is not failure.

## Accepted risk — no auth

Like the two existing pages, Moware is served from a public bucket and its Function URL is
unauthenticated: anyone with the URL can read or write. That trade was accepted for a habit
tracker; a spend log with amounts and remarks is more sensitive, so it is worth stating
explicitly rather than inheriting silently. The URL is long and unguessable, and nothing here
carries a name, card number, or account. If that stops being acceptable, the cheap mitigation
is a shared-secret header on the Lambda — not Cognito. This design does **not** include it.

## Testing

**Unit (`moware.test.mjs`)** — the derivation is the tested core:

- `active()` boundaries: month before `startMonth`; exactly `startMonth`; between; exactly
  `endMonth` (**inclusive**); after `endMonth`; `endMonth: null` open-ended.
- `computeMonth`: `loggedTotal` / `subsTotal` / `total`; `treatTotal` counts only `treat: true`
  transactions; a month with no transactions but active subscriptions still totals correctly.
- `byCategory`: merges a category fed by both a transaction and a subscription into one row
  with the correct `fromLogged` / `fromSubs` split; sorted by amount descending.
- `transactions` newest-first, stable for two entries on the same date.
- Transactions outside the requested month never leak in.

**Unit (`index.test.mjs`)** — validators: amount coercion and clamping; category/name trim and
40-char cap; note 80-char cap and empty-when-absent; date rejects future (vs a fixed MYT
`nowMs`), rejects pre-2020, accepts today and old-but-valid; month format and future-month
rejection; case-insensitive category resolution against a registry.

**Front-end** — `node --check` on the extracted script, `tidy`, and the wired-id check (every
`el('…')` id present before `<script>`). No browser in this environment.

**Manual, after deploy, on the phone** — log a spend with a remark and a treat flag; confirm the
total, the `incl. … treats` line, both chart views, and the tape entry; delete it and watch the
total fall; log a backdated entry and confirm the view jumps to that month; step back a month;
add a subscription with an earlier start month and confirm past months pick it up; cancel one
and confirm the current month still counts while next month does not.

## Out of scope (YAGNI)

Editing a transaction (delete and re-log instead); editing a subscription's price in place;
removing a category from the registry; income, balances, budget ceilings or alerts; multi-currency;
receipt photos; non-monthly recurrences (weekly, annual); export or CSV; cross-month trend charts;
future-month projection; search or filter over remarks; any auth.
