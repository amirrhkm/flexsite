import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validTrackerDate, normalizePrayers, normalizeUrges } from './index.mjs';

test('validTrackerDate accepts today and yesterday (MYT), rejects others', () => {
  const now = Date.parse('2026-07-21T05:00:00Z'); // 13:00 MYT on 2026-07-21
  assert.equal(validTrackerDate('2026-07-21', now), true);
  assert.equal(validTrackerDate('2026-07-20', now), true);
  assert.equal(validTrackerDate('2026-07-19', now), false);
  assert.equal(validTrackerDate('2026-07-22', now), false);
  assert.equal(validTrackerDate('garbage', now), false);
});

test('normalizePrayers coerces to exactly the five booleans', () => {
  assert.deepEqual(
    normalizePrayers({ subuh: true, zohor: 'yes', asar: true, isya: true, junk: true }),
    { subuh: true, zohor: false, asar: true, maghrib: false, isya: true },
  );
});

test('normalizeUrges coerces to a clamped non-negative integer', () => {
  assert.equal(normalizeUrges('5'), 5);
  assert.equal(normalizeUrges(2.9), 2);
  assert.equal(normalizeUrges(-3), 0);
  assert.equal(normalizeUrges(99999), 1000);
  assert.equal(normalizeUrges(undefined), 0);
  assert.equal(normalizeUrges('x'), 0);
});
