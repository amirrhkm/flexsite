import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Extract the sentinel-bracketed pure function from the page and evaluate it.
const html = readFileSync(new URL('../../plan/lockin.html', import.meta.url), 'utf8');
const m = html.match(/\/\*__CELEB_START__\*\/([\s\S]*?)\/\*__CELEB_END__\*\//);
if (!m) throw new Error('celebrationsFor sentinels not found in plan/lockin.html');
const celebrationsFor = new Function(m[1] + '\nreturn celebrationsFor;')();

const allP = { subuh: true, zohor: true, asar: true, maghrib: true, isya: true };
function state(over) {
  return Object.assign({
    today: '2026-07-21',
    days: [{ date: '2026-07-21', prayers: {}, workout: false, sober: false }],
    summary: {
      prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
      medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    },
  }, over);
}

test('first load (prev null) celebrates nothing', () => {
  const r = celebrationsFor(null, state());
  assert.deepEqual(r, { countUp: [], mints: [], dailyComplete: false });
});

test('a streak increase is a count-up for that habit only', () => {
  const prev = state();
  const next = state({ summary: { prayers: { current: 11 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 } } });
  const r = celebrationsFor(prev, next);
  assert.deepEqual(r.countUp, ['prayers']);
  assert.deepEqual(r.mints, []);
});

test('a pooled medal increase mints that tier', () => {
  const prev = state();
  const next = state({ summary: { prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 1, gold: 0, sapphire: 0, diamond: 0, comeback: 1 } } });
  const r = celebrationsFor(prev, next);
  assert.deepEqual(r.mints.sort(), ['comeback', 'silver']);
});

test('no change and decreases celebrate nothing', () => {
  assert.deepEqual(celebrationsFor(state(), state()), { countUp: [], mints: [], dailyComplete: false });
  const lower = state({ summary: { prayers: { current: 9 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 0, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 } } });
  assert.deepEqual(celebrationsFor(state(), lower), { countUp: [], mints: [], dailyComplete: false });
});

test('dailyComplete fires once when today becomes all-5-prayers + sober', () => {
  const before = state({ days: [{ date: '2026-07-21', prayers: { ...allP, isya: false }, sober: true, workout: false }] });
  const after = state({ days: [{ date: '2026-07-21', prayers: allP, sober: true, workout: false }] });
  assert.equal(celebrationsFor(before, after).dailyComplete, true);
  // already complete -> does not fire again
  assert.equal(celebrationsFor(after, after).dailyComplete, false);
});
