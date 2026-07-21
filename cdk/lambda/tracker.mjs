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
