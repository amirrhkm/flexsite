import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOWARE_POLL, monthOf, subActive } from './moware.mjs';

test('MOWARE_POLL is the partition id', () => {
  assert.equal(MOWARE_POLL, 'moware');
});

test('monthOf takes the YYYY-MM prefix of an ISO date', () => {
  assert.equal(monthOf('2026-07-29'), '2026-07');
  assert.equal(monthOf('2026-01-01'), '2026-01');
});

test('subActive: open-ended subscription runs from its start month onward', () => {
  const s = { startMonth: '2026-03', endMonth: null };
  assert.equal(subActive(s, '2026-02'), false);
  assert.equal(subActive(s, '2026-03'), true);   // start month is inclusive
  assert.equal(subActive(s, '2026-07'), true);
  assert.equal(subActive(s, '2027-01'), true);
});

test('subActive: endMonth is inclusive — the cancelled month still counts', () => {
  const s = { startMonth: '2026-01', endMonth: '2026-05' };
  assert.equal(subActive(s, '2025-12'), false);
  assert.equal(subActive(s, '2026-01'), true);
  assert.equal(subActive(s, '2026-05'), true);   // the month it was cancelled in
  assert.equal(subActive(s, '2026-06'), false);
});

test('subActive: a single-month subscription is active in exactly that month', () => {
  const s = { startMonth: '2026-04', endMonth: '2026-04' };
  assert.equal(subActive(s, '2026-03'), false);
  assert.equal(subActive(s, '2026-04'), true);
  assert.equal(subActive(s, '2026-05'), false);
});
