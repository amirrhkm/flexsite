import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validTrackerDate, normalizePrayers, normalizeUrges, normalizeUrgeReps,
         normalizeSen, validSpendDate, validMonth, resolveCategory, normalizeNote } from './index.mjs';

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

test('normalizeUrgeReps coerces to a clamped non-negative integer', () => {
  assert.equal(normalizeUrgeReps('15'), 15);
  assert.equal(normalizeUrgeReps(12.7), 12);
  assert.equal(normalizeUrgeReps(-4), 0);
  assert.equal(normalizeUrgeReps(999999), 100000);
  assert.equal(normalizeUrgeReps(undefined), 0);
  assert.equal(normalizeUrgeReps('x'), 0);
  assert.equal(normalizeUrgeReps(0), 0);
});

test('normalizeSen coerces to a clamped non-negative integer', () => {
  assert.equal(normalizeSen('1290'), 1290);
  assert.equal(normalizeSen(1290.7), 1290);
  assert.equal(normalizeSen(-5), 0);
  assert.equal(normalizeSen(0), 0);
  assert.equal(normalizeSen(999999999999), 100000000);
  assert.equal(normalizeSen(undefined), 0);
  assert.equal(normalizeSen('x'), 0);
});

test('validSpendDate accepts today and the past, rejects the future and pre-2020', () => {
  const now = Date.parse('2026-07-29T05:00:00Z'); // 13:00 MYT on 2026-07-29
  assert.equal(validSpendDate('2026-07-29', now), true);   // today
  assert.equal(validSpendDate('2026-07-01', now), true);
  assert.equal(validSpendDate('2020-01-01', now), true);   // floor is inclusive
  assert.equal(validSpendDate('2019-12-31', now), false);  // typo floor
  assert.equal(validSpendDate('2026-07-30', now), false);  // future
  assert.equal(validSpendDate('garbage', now), false);
  assert.equal(validSpendDate(undefined, now), false);
});

test('validMonth accepts this month and earlier, rejects the future and junk', () => {
  const now = Date.parse('2026-07-29T05:00:00Z');
  assert.equal(validMonth('2026-07', now), true);
  assert.equal(validMonth('2026-06', now), true);
  assert.equal(validMonth('2026-08', now), false);
  assert.equal(validMonth('2026-7', now), false);
  assert.equal(validMonth('garbage', now), false);
});

test('resolveCategory reuses an existing spelling regardless of case', () => {
  const known = ['Food', 'Petrol', 'Sports'];
  assert.equal(resolveCategory('food', known), 'Food');
  assert.equal(resolveCategory('  PETROL ', known), 'Petrol');
  assert.equal(resolveCategory('Food', known), 'Food');
  assert.equal(resolveCategory('Bowling', known), 'Bowling');   // genuinely new
  assert.equal(resolveCategory('  Bowling  ', known), 'Bowling');
  assert.equal(resolveCategory('food', []), 'food');
  assert.equal(resolveCategory('food', undefined), 'food');
});

test('resolveCategory caps length at 40 and returns empty for junk', () => {
  assert.equal(resolveCategory('x'.repeat(60), []).length, 40);
  assert.equal(resolveCategory('   ', []), '');
  assert.equal(resolveCategory(undefined, []), '');
});

test('normalizeNote trims, caps at 80, and empties when absent', () => {
  assert.equal(normalizeNote('  pickleball court '), 'pickleball court');
  assert.equal(normalizeNote('n'.repeat(200)).length, 80);
  assert.equal(normalizeNote(undefined), '');
  assert.equal(normalizeNote(42), '');
});

// A DynamoDB reserved word used bare in an UpdateExpression throws
// ValidationException at runtime — invisible to unit tests, and it took a live
// probe to find (`treat` broke every Moware transaction write). Any attribute
// name here must be aliased via ExpressionAttributeNames.
//
// To check a new attribute name, probe it against the real table:
//   aws dynamodb update-item --table-name <T> --key '<k>' \
//     --update-expression 'SET <word> = :v' \
//     --expression-attribute-values '{":v":{"S":"x"}}'
// A "reserved keyword" ValidationException means it needs an alias.
const VERIFIED_RESERVED = ['treat', 'name'];

test('no UpdateExpression uses a known DynamoDB reserved word bare', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const exprs = [...src.matchAll(/UpdateExpression:\s*\n?\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(exprs.length >= 4, 'expected to find the UpdateExpressions, found ' + exprs.length);
  const offenders = [];
  for (const e of exprs) {
    for (const w of VERIFIED_RESERVED) {
      if (new RegExp('(^|[^#\\w])' + w + '\\s*=', 'i').test(e)) offenders.push(w + ' in: ' + e);
    }
  }
  assert.deepEqual(offenders, []);
});
