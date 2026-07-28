import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOWARE_POLL, monthOf, subActive, computeMonth } from './moware.mjs';

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

const T = (date, amount, category, over) => Object.assign(
  { id: date + '-' + amount, date, amount, category, treat: false, note: '' }, over);

test('computeMonth totals logged, subscriptions and their sum', () => {
  const txns = [T('2026-07-02', 1500, 'Food'), T('2026-07-09', 4500, 'Petrol')];
  const subs = [{ id: 's1', name: 'Netflix', amount: 2900, category: 'Entertainment', startMonth: '2026-01', endMonth: null }];
  const m = computeMonth(txns, subs, '2026-07');
  assert.equal(m.month, '2026-07');
  assert.equal(m.loggedTotal, 6000);
  assert.equal(m.subsTotal, 2900);
  assert.equal(m.total, 8900);
});

test('computeMonth counts only treat transactions in treatTotal', () => {
  const txns = [
    T('2026-07-02', 1500, 'Food'),
    T('2026-07-03', 8800, 'Food', { treat: true }),
    T('2026-07-04', 23000, 'Gift', { treat: true }),
  ];
  const m = computeMonth(txns, [], '2026-07');
  assert.equal(m.treatTotal, 31800);
  assert.equal(m.loggedTotal, 33300);
});

test('computeMonth merges a category fed by both a transaction and a subscription', () => {
  const txns = [T('2026-07-02', 5000, 'Bills')];
  const subs = [{ id: 's1', name: 'Telco', amount: 8800, category: 'Bills', startMonth: '2026-01', endMonth: null }];
  const m = computeMonth(txns, subs, '2026-07');
  assert.equal(m.byCategory.length, 1);
  assert.deepEqual(m.byCategory[0], { category: 'Bills', amount: 13800, fromLogged: 5000, fromSubs: 8800 });
});

test('computeMonth sorts byCategory by amount descending', () => {
  const txns = [T('2026-07-02', 1000, 'Coffee'), T('2026-07-03', 9000, 'Food'), T('2026-07-04', 5000, 'Petrol')];
  const m = computeMonth(txns, [], '2026-07');
  assert.deepEqual(m.byCategory.map((c) => c.category), ['Food', 'Petrol', 'Coffee']);
});

test('computeMonth ignores transactions outside the requested month', () => {
  const txns = [T('2026-06-30', 9900, 'Groceries'), T('2026-07-01', 1000, 'Food'), T('2026-08-01', 500, 'Food')];
  const m = computeMonth(txns, [], '2026-07');
  assert.equal(m.loggedTotal, 1000);
  assert.equal(m.transactions.length, 1);
});

test('computeMonth includes only subscriptions active that month', () => {
  const subs = [
    { id: 's1', name: 'Netflix', amount: 2900, category: 'Entertainment', startMonth: '2026-01', endMonth: null },
    { id: 's2', name: 'Magazine', amount: 2500, category: 'Entertainment', startMonth: '2025-08', endMonth: '2026-05' },
    { id: 's3', name: 'Gym', amount: 12000, category: 'Health', startMonth: '2026-09', endMonth: null },
  ];
  const m = computeMonth([], subs, '2026-07');
  assert.deepEqual(m.subscriptions.map((s) => s.name), ['Netflix']);
  assert.equal(m.subsTotal, 2900);
});

test('computeMonth handles a month with no transactions but active subscriptions', () => {
  const subs = [{ id: 's1', name: 'Telco', amount: 8800, category: 'Bills', startMonth: '2026-01', endMonth: null }];
  const m = computeMonth([], subs, '2026-07');
  assert.equal(m.loggedTotal, 0);
  assert.equal(m.total, 8800);
  assert.equal(m.treatTotal, 0);
  assert.deepEqual(m.byCategory, [{ category: 'Bills', amount: 8800, fromLogged: 0, fromSubs: 8800 }]);
});

test('computeMonth on a wholly empty month returns zeroed, not undefined', () => {
  const m = computeMonth([], [], '2026-07');
  assert.deepEqual(
    { total: m.total, loggedTotal: m.loggedTotal, subsTotal: m.subsTotal, treatTotal: m.treatTotal },
    { total: 0, loggedTotal: 0, subsTotal: 0, treatTotal: 0 },
  );
  assert.deepEqual(m.byCategory, []);
  assert.deepEqual(m.transactions, []);
});

test('computeMonth returns transactions newest first, stable within a date', () => {
  const txns = [
    T('2026-07-01', 100, 'Food'),
    T('2026-07-20', 200, 'Food'),
    T('2026-07-10', 300, 'Food'),
  ];
  const m = computeMonth(txns, [], '2026-07');
  assert.deepEqual(m.transactions.map((t) => t.date), ['2026-07-20', '2026-07-10', '2026-07-01']);
});
