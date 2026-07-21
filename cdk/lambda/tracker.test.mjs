import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayInMYT, addDays, dayNum, weekStart, weekNum,
  DAY_TIERS, WEEK_TIERS, PRAYERS, WORKOUT_TARGET, TRACKER_POLL,
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
