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

export function medalsFromRuns(runs, tiers) {
  const m = {}; for (const [name] of tiers) m[name] = 0;
  for (const len of runs) for (const [name, thr] of tiers) if (len >= thr) m[name]++;
  return m;
}

export function comebackCount(runs, bronzeThreshold) {
  return runs.slice(1).filter((len) => len >= bronzeThreshold).length;
}

export function forging(current, tiers) {
  for (const [name, thr] of tiers) if (current < thr) return { tier: name, threshold: thr };
  return null;
}

export function computeSummary(days, today) {
  const prayerOrd = new Set();
  const soberOrd = new Set();
  const weekCounts = new Map(); // weekStart date -> workout-day count
  const activeDates = new Set();

  for (const d of days) {
    activeDates.add(d.date);
    if (PRAYERS.every((p) => d.prayers && d.prayers[p] === true)) prayerOrd.add(dayNum(d.date));
    if (d.sober === true) soberOrd.add(dayNum(d.date));
    if (d.workout === true) {
      const ws = weekStart(d.date);
      weekCounts.set(ws, (weekCounts.get(ws) || 0) + 1);
    }
  }

  const weekOrd = new Set();
  for (const [ws, c] of weekCounts) if (c >= WORKOUT_TARGET) weekOrd.add(weekNum(ws));

  const todayOrd = dayNum(today);
  const wsToday = weekStart(today);

  const dayHabit = (ordSet) => {
    const runs = runLengths(ordSet);
    return {
      current: streakCurrent(ordSet, todayOrd),
      best: bestRun(ordSet),
      thisWeek: Array.from({ length: 7 }, (_, i) => ordSet.has(dayNum(addDays(wsToday, i)))),
      forging: forging(streakCurrent(ordSet, todayOrd), DAY_TIERS),
      _medals: medalsFromRuns(runs, DAY_TIERS),
      _comeback: comebackCount(runs, 7),
    };
  };

  const prayers = dayHabit(prayerOrd);
  const sober = dayHabit(soberOrd);

  const wRuns = runLengths(weekOrd);
  const wCurrent = streakCurrent(weekOrd, weekNum(today));
  const workout = {
    current: wCurrent,
    best: bestRun(weekOrd),
    thisWeekSessions: weekCounts.get(wsToday) || 0,
    target: WORKOUT_TARGET,
    forging: forging(wCurrent, WEEK_TIERS),
    _medals: medalsFromRuns(wRuns, WEEK_TIERS),
    _comeback: comebackCount(wRuns, 4),
  };

  const names = ['bronze', 'silver', 'gold', 'sapphire', 'diamond'];
  const medals = {};
  for (const n of names) medals[n] = prayers._medals[n] + sober._medals[n] + workout._medals[n];
  medals.comeback = prayers._comeback + sober._comeback + workout._comeback;
  const totalMedals = names.reduce((s, n) => s + medals[n], 0) + medals.comeback;

  const strip = ({ _medals, _comeback, ...rest }) => rest;
  return {
    prayers: strip(prayers),
    sober: strip(sober),
    workout: strip(workout),
    medals,
    totals: {
      medals: totalMedals,
      bestStreak: Math.max(prayers.best, sober.best),
      daysTracked: activeDates.size,
    },
  };
}
