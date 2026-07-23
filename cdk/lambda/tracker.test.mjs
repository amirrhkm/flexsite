import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayInMYT, addDays, dayNum, weekStart, weekNum,
  DAY_TIERS, WEEK_TIERS, PRAYERS, WORKOUT_TARGET, TRACKER_POLL,
  streakCurrent, bestRun, runLengths,
  medalsFromRuns, comebackCount, forging,
  computeSummary,
} from './tracker.mjs';

test('constants', () => {
  assert.equal(TRACKER_POLL, 'lockin');
  assert.equal(WORKOUT_TARGET, 4);
  assert.deepEqual(PRAYERS, ['subuh', 'zohor', 'asar', 'maghrib', 'isya']);
  assert.deepEqual(DAY_TIERS.map((t) => t[1]), [7, 30, 90, 180, 365]);
  assert.deepEqual(WEEK_TIERS.map((t) => t[1]), [4, 12, 26, 39, 52]);
});

test('todayInMYT shifts UTC+8 across the date line', () => {
  // 2026-07-20 20:00 UTC == 2026-07-21 04:00 MYT
  assert.equal(todayInMYT(Date.parse('2026-07-20T20:00:00Z')), '2026-07-21');
  // 2026-07-20 15:00 UTC == 2026-07-20 23:00 MYT
  assert.equal(todayInMYT(Date.parse('2026-07-20T15:00:00Z')), '2026-07-20');
});

test('addDays and dayNum', () => {
  assert.equal(addDays('2026-07-21', -1), '2026-07-20');
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(dayNum('2026-07-21') - dayNum('2026-07-20'), 1);
});

test('weekStart returns Monday; weekNum increments weekly', () => {
  // 2026-07-21 is a Tuesday -> Monday is 2026-07-20
  assert.equal(weekStart('2026-07-21'), '2026-07-20');
  assert.equal(weekStart('2026-07-20'), '2026-07-20');
  assert.equal(weekStart('2026-07-26'), '2026-07-20'); // Sunday still same week
  assert.equal(weekNum('2026-07-27') - weekNum('2026-07-21'), 1);
});

test('streakCurrent counts back from today', () => {
  const s = new Set([10, 11, 12]); // 3 in a row ending at 12
  assert.equal(streakCurrent(s, 12), 3);      // today qualifies
  assert.equal(streakCurrent(s, 13), 3);      // today not logged yet, ends yesterday -> still alive
  assert.equal(streakCurrent(s, 14), 0);      // full gap -> broken
  assert.equal(streakCurrent(new Set(), 12), 0);
});

test('bestRun finds the longest run', () => {
  assert.equal(bestRun(new Set([1, 2, 3, 10, 11])), 3);
  assert.equal(bestRun(new Set([5])), 1);
  assert.equal(bestRun(new Set()), 0);
});

test('runLengths returns each run in chronological order', () => {
  assert.deepEqual(runLengths(new Set([1, 2, 3, 10, 11, 20])), [3, 2, 1]);
  assert.deepEqual(runLengths(new Set()), []);
});

test('medalsFromRuns banks one medal per crossed threshold', () => {
  // a 95-day run crosses Bronze+Silver+Gold
  assert.deepEqual(medalsFromRuns([95], DAY_TIERS),
    { bronze: 1, silver: 1, gold: 1, sapphire: 0, diamond: 0 });
  // two separate 7-day runs -> Bronze x2
  assert.deepEqual(medalsFromRuns([7, 7], DAY_TIERS),
    { bronze: 2, silver: 0, gold: 0, sapphire: 0, diamond: 0 });
  // a 6-day run crosses nothing
  assert.deepEqual(medalsFromRuns([6], DAY_TIERS),
    { bronze: 0, silver: 0, gold: 0, sapphire: 0, diamond: 0 });
});

test('comebackCount excludes the first run', () => {
  assert.equal(comebackCount([30], 7), 0);        // only ever one streak
  assert.equal(comebackCount([30, 8], 7), 1);     // rebuilt to Bronze once
  assert.equal(comebackCount([30, 8, 5, 9], 7), 2); // 8 and 9 count; 5 does not
});

test('forging returns the next unreached tier, or null when maxed', () => {
  assert.deepEqual(forging(42, DAY_TIERS), { tier: 'gold', threshold: 90 });
  assert.deepEqual(forging(0, DAY_TIERS), { tier: 'bronze', threshold: 7 });
  assert.equal(forging(365, DAY_TIERS), null);
});

const allPrayers = { subuh: true, zohor: true, asar: true, maghrib: true, isya: true };
function cleanDay(date, over = {}) {
  return { date, prayers: allPrayers, workout: true, sober: true, ...over };
}

test('empty history -> all zeros, forging Bronze', () => {
  const s = computeSummary([], '2026-07-21');
  assert.equal(s.prayers.current, 0);
  assert.equal(s.totals.medals, 0);
  assert.equal(s.totals.daysTracked, 0);
  assert.deepEqual(s.prayers.forging, { tier: 'bronze', threshold: 7 });
  assert.deepEqual(s.prayers.thisWeek, [false, false, false, false, false, false, false]);
});

test('a clean 8-day run ending today: streak alive, Bronze banked, medals survive a later gap', () => {
  const days = [];
  for (let i = 7; i >= 0; i--) days.push(cleanDay(addDays('2026-07-21', -i)));
  const s = computeSummary(days, '2026-07-21');
  assert.equal(s.prayers.current, 8);
  assert.equal(s.prayers.best, 8);
  assert.equal(s.medals.bronze >= 2, true); // prayers+sober each earned Bronze
  // now evaluate two days later with no new logs -> current resets, Bronze count unchanged
  const s2 = computeSummary(days, '2026-07-23');
  assert.equal(s2.prayers.current, 0);
  assert.equal(s2.medals.bronze, s.medals.bronze);
});

test('an incomplete prayer day does not count; sober can still count', () => {
  const days = [cleanDay('2026-07-21', { prayers: { ...allPrayers, isya: false } })];
  const s = computeSummary(days, '2026-07-21');
  assert.equal(s.prayers.current, 0);
  assert.equal(s.sober.current, 1);
  assert.equal(s.totals.daysTracked, 1);
});

test('workout: a week with >=4 sessions is on-target', () => {
  // Mon..Thu of the week containing 2026-07-21 (week starts 2026-07-20)
  const days = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23']
    .map((d) => ({ date: d, prayers: {}, workout: true, sober: false }));
  const s = computeSummary(days, '2026-07-23');
  assert.equal(s.workout.thisWeekSessions, 4);
  assert.equal(s.workout.current, 1); // one on-target week
});

test('computeSummary sums urges (today + all-time), missing = 0', () => {
  const days = [
    { date: '2026-07-19', prayers: {}, workout: false, sober: false, urges: 3 },
    { date: '2026-07-20', prayers: {}, workout: false, sober: false, urges: 2 },
    { date: '2026-07-21', prayers: {}, workout: false, sober: false, urges: 4 },
  ];
  const s = computeSummary(days, '2026-07-21');
  assert.deepEqual(s.urges, { today: 4, total: 9 });
  assert.deepEqual(
    computeSummary([{ date: '2026-07-21', prayers: {}, workout: false, sober: false }], '2026-07-21').urges,
    { today: 0, total: 0 },
  );
});
