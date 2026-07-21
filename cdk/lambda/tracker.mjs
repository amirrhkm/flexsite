export const TRACKER_POLL = 'lockin';
export const PRAYERS = ['subuh', 'zohor', 'asar', 'maghrib', 'isya'];
export const WORKOUT_TARGET = 4;
export const DAY_TIERS = [['bronze', 7], ['silver', 30], ['gold', 90], ['sapphire', 180], ['diamond', 365]];
export const WEEK_TIERS = [['bronze', 4], ['silver', 12], ['gold', 26], ['sapphire', 39], ['diamond', 52]];

export function todayInMYT(nowMs) {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function dayNum(dateStr) {
  return Math.round(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
}
export function addDays(dateStr, n) {
  return new Date((dayNum(dateStr) + n) * 86400000).toISOString().slice(0, 10);
}
export function weekStart(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  return addDays(dateStr, -(dow === 0 ? 6 : dow - 1));
}
export function weekNum(dateStr) {
  return Math.floor(dayNum(weekStart(dateStr)) / 7);
}

export function streakCurrent(ordSet, endOrd) {
  let end;
  if (ordSet.has(endOrd)) end = endOrd;
  else if (ordSet.has(endOrd - 1)) end = endOrd - 1;
  else return 0;
  let n = 0;
  for (let d = end; ordSet.has(d); d--) n++;
  return n;
}

export function bestRun(ordSet) {
  const a = [...ordSet].sort((x, y) => x - y);
  let best = 0, run = 0, prev = null;
  for (const o of a) { run = prev !== null && o === prev + 1 ? run + 1 : 1; if (run > best) best = run; prev = o; }
  return best;
}

export function runLengths(ordSet) {
  const a = [...ordSet].sort((x, y) => x - y);
  const runs = []; let run = 0, prev = null;
  for (const o of a) {
    if (prev !== null && o === prev + 1) run++;
    else { if (run) runs.push(run); run = 1; }
    prev = o;
  }
  if (run) runs.push(run);
  return runs;
}
