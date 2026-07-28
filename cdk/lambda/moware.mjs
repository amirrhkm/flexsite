export const MOWARE_POLL = 'moware';

export function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

// YYYY-MM strings compare lexicographically in chronological order, so
// membership needs no date parsing. endMonth is INCLUSIVE: the month a
// subscription was cancelled in was already billed, so it still counts.
export function subActive(sub, month) {
  return sub.startMonth <= month && (sub.endMonth == null || month <= sub.endMonth);
}

// The whole engine: one pure function. Raw records are the only stored truth —
// subscription spend is derived per month, never materialised as rows.
export function computeMonth(transactions, subs, month) {
  const inMonth = transactions.filter((t) => monthOf(t.date) === month);
  const activeSubs = subs.filter((s) => subActive(s, month));

  let loggedTotal = 0;
  let treatTotal = 0;
  const map = new Map();
  const bump = (category, amount, key) => {
    const row = map.get(category) || { category, amount: 0, fromLogged: 0, fromSubs: 0 };
    row.amount += amount;
    row[key] += amount;
    map.set(category, row);
  };

  for (const t of inMonth) {
    loggedTotal += t.amount;
    if (t.treat === true) treatTotal += t.amount;
    bump(t.category, t.amount, 'fromLogged');
  }
  let subsTotal = 0;
  for (const s of activeSubs) {
    subsTotal += s.amount;
    bump(s.category, s.amount, 'fromSubs');
  }

  const byCategory = [...map.values()].sort((a, b) => b.amount - a.amount);
  const ordered = inMonth.slice().sort((a, b) => b.date.localeCompare(a.date));

  return {
    month,
    total: loggedTotal + subsTotal,
    loggedTotal,
    subsTotal,
    treatTotal,
    byCategory,
    transactions: ordered,
    subscriptions: activeSubs,
  };
}
