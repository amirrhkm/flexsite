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
      urges: { today: 0, total: 0, repsToday: 0, repsTotal: 0 },
    },
  }, over);
}

test('first load (prev null) celebrates nothing', () => {
  const r = celebrationsFor(null, state());
  assert.deepEqual(r, { countUp: [], mints: [], dailyComplete: false, repBadges: [], effortBadges: [] });
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
  assert.deepEqual(celebrationsFor(state(), state()), { countUp: [], mints: [], dailyComplete: false, repBadges: [], effortBadges: [] });
  const lower = state({ summary: { prayers: { current: 9 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 0, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 } } });
  assert.deepEqual(celebrationsFor(state(), lower), { countUp: [], mints: [], dailyComplete: false, repBadges: [], effortBadges: [] });
});

test('dailyComplete fires once when today becomes all-5-prayers + sober', () => {
  const before = state({ days: [{ date: '2026-07-21', prayers: { ...allP, isya: false }, sober: true, workout: false }] });
  const after = state({ days: [{ date: '2026-07-21', prayers: allP, sober: true, workout: false }] });
  assert.equal(celebrationsFor(before, after).dailyComplete, true);
  // already complete -> does not fire again
  assert.equal(celebrationsFor(after, after).dailyComplete, false);
});

test('celebrationsFor flags a rep badge when reps total crosses a threshold', () => {
  const withReps = (repsTotal) => state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total: 1, repsToday: 10, repsTotal },
  } });
  assert.deepEqual(celebrationsFor(withReps(95), withReps(105)).repBadges, ['Stone']);
  assert.deepEqual(celebrationsFor(withReps(499), withReps(512)).repBadges, ['Jetty']);
  // one entry per threshold crossed, even if a single set clears two
  assert.deepEqual(celebrationsFor(withReps(90), withReps(600)).repBadges, ['Stone', 'Jetty']);
  assert.deepEqual(celebrationsFor(withReps(120), withReps(130)).repBadges, []);
  assert.deepEqual(celebrationsFor(null, withReps(105)).repBadges, []);
});

test('celebrationsFor uses the passed rep tiers', () => {
  var s = function (repsTotal) { return state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total: 1, repsToday: 3, repsTotal: repsTotal },
  } }); };
  assert.deepEqual(celebrationsFor(s(2), s(3), [['Tiny', 3]]).repBadges, ['Tiny']);
});

test('celebrationsFor ignores the urge count — only reps earn badges', () => {
  var s = function (total, repsTotal) { return state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2 },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 1, total: total, repsToday: 0, repsTotal: repsTotal },
  } }); };
  // urge count leaps past every old wave threshold; reps do not move
  assert.deepEqual(celebrationsFor(s(9, 50), s(600, 50)).repBadges, []);
});

test('celebrationsFor flags an effort badge when extra crosses a threshold', () => {
  var s = function (extra) { return state({ summary: {
    prayers: { current: 10 }, sober: { current: 10 }, workout: { current: 2, extra: extra },
    medals: { bronze: 1, silver: 0, gold: 0, sapphire: 0, diamond: 0, comeback: 0 },
    urges: { today: 0, total: 0, repsToday: 0, repsTotal: 0 },
  } }); };
  assert.deepEqual(celebrationsFor(s(2), s(3)).effortBadges, ['Ember']);
  assert.deepEqual(celebrationsFor(s(3), s(4)).effortBadges, []);
  assert.deepEqual(celebrationsFor(s(2), s(3), null, [['X', 3]]).effortBadges, ['X']);
});
