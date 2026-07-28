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
