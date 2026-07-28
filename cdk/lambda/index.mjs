import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { TRACKER_POLL, PRAYERS, computeSummary, todayInMYT, addDays } from './tracker.mjs';
import { MOWARE_POLL, monthOf, computeMonth } from './moware.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

const resp = (statusCode, data) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Items written before multi-date support have a single `date` string.
const itemDates = (it) => (Array.isArray(it.dates) ? it.dates : it.date ? [it.date] : []);

const state = async (poll) => {
  const { Items = [] } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: '#p = :p',
    ExpressionAttributeNames: { '#p': 'poll' },
    ExpressionAttributeValues: { ':p': poll },
  }));
  const tracks = {};
  const dates = {};
  for (const it of Items) {
    tracks[it.track] = (tracks[it.track] || 0) + 1;
    for (const d of itemDates(it)) dates[d] = (dates[d] || 0) + 1;
  }
  return {
    votes: Items
      .map(({ voter, track, updatedAt, createdAt, ...rest }) => ({
        voter,
        track,
        dates: itemDates(rest),
        updatedAt,
        createdAt: createdAt || updatedAt,
      }))
      // Grid order: first voter first. createdAt never changes on re-votes.
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))),
    tracks,
    dates,
  };
};

export function validTrackerDate(date, nowMs) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = todayInMYT(nowMs);
  return date === today || date === addDays(today, -1);
}
export function normalizePrayers(input) {
  const out = {};
  for (const p of PRAYERS) out[p] = input && input[p] === true;
  return out;
}
export function normalizeUrges(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 1000);
}
export function normalizeUrgeReps(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100000);
}
export function normalizeSen(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100000000);           // RM 1,000,000 ceiling
}
export function validSpendDate(date, nowMs) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date >= '2020-01-01' && date <= todayInMYT(nowMs);
}
export function validMonth(month, nowMs) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return false;
  return month <= monthOf(todayInMYT(nowMs));
}
// Typing "food" when "Food" exists must not split the category in two.
export function resolveCategory(input, known) {
  const raw = clean(input, 40);
  if (!raw) return '';
  const hit = (known || []).find((k) => String(k).toLowerCase() === raw.toLowerCase());
  return hit || raw;
}
export function normalizeNote(v) {
  return clean(v, 80);
}
async function trackerDays(poll) {
  const { Items = [] } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: '#p = :p',
    ExpressionAttributeNames: { '#p': 'poll' },
    ExpressionAttributeValues: { ':p': poll },
  }));
  return Items.map((it) => ({
    date: it.voter,
    prayers: it.prayers || {},
    workout: it.workout === true,
    sober: it.sober === true,
    urges: normalizeUrges(it.urges),
    urgeReps: normalizeUrgeReps(it.urgeReps),
  })).sort((a, b) => a.date.localeCompare(b.date));
}
async function trackerState(poll) {
  const days = await trackerDays(poll);
  const today = todayInMYT(Date.now());
  return { days, today, summary: computeSummary(days, today) };
}

const q = async (poll, prefix) => {
  const { Items = [] } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: '#p = :p AND begins_with(#v, :sk)',
    ExpressionAttributeNames: { '#p': 'poll', '#v': 'voter' },
    ExpressionAttributeValues: { ':p': poll, ':sk': prefix },
  }));
  return Items;
};

async function mowareCategories() {
  const items = await q(MOWARE_POLL, 'meta#categories');
  const set = items[0] && items[0].cats;
  // A DynamoDB string set deserialises to a Set via the document client.
  return set ? [...set].sort((a, b) => a.localeCompare(b)) : [];
}

async function mowareState(month) {
  const [txnItems, subItems, categories] = await Promise.all([
    q(MOWARE_POLL, 't#' + month),          // month-prefixed keys: one month only
    q(MOWARE_POLL, 's#'),                  // subscriptions are not month-scoped
    mowareCategories(),
  ]);
  const transactions = txnItems.map((it) => ({
    id: it.voter.split('#')[2],
    date: it.voter.split('#')[1],
    amount: normalizeSen(it.amount),
    category: it.category || '',
    treat: it.treat === true,
    note: it.note || '',
  }));
  const subs = subItems.map((it) => ({
    id: it.voter.slice(2),
    name: it.name || '',
    amount: normalizeSen(it.amount),
    category: it.category || '',
    startMonth: it.startMonth,
    endMonth: it.endMonth == null ? null : it.endMonth,
  }));
  return {
    month,
    today: todayInMYT(Date.now()),
    categories,
    subs,
    summary: computeMonth(transactions, subs, month),
  };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  try {
    if (method === 'GET') {
      const poll = clean(event.queryStringParameters?.poll, 60);
      if (!poll) return resp(400, { error: 'poll query param is required' });
      if (poll === TRACKER_POLL) return resp(200, await trackerState(poll));
      if (poll === MOWARE_POLL) {
        const asked = clean(event.queryStringParameters?.month, 7);
        const month = asked || monthOf(todayInMYT(Date.now()));
        if (!validMonth(month, Date.now())) {
          return resp(400, { error: 'month must be YYYY-MM and not in the future' });
        }
        return resp(200, await mowareState(month));
      }
      return resp(200, await state(poll));
    }

    if (method === 'POST') {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : event.body || '{}';
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return resp(400, { error: 'invalid JSON body' });
      }
      const poll = clean(body.poll, 60);
      if (poll === MOWARE_POLL) {
        const now = new Date().toISOString();
        const nowMs = Date.now();
        const thisMonth = monthOf(todayInMYT(nowMs));
        const op = clean(body.op, 20);

        if (op === 'txn') {
          const amount = normalizeSen(body.amount);
          if (amount < 1) return resp(400, { error: 'amount must be at least 1 sen' });
          if (!validSpendDate(body.date, nowMs)) {
            return resp(400, { error: 'date must be on or before today (MYT) and not before 2020-01-01' });
          }
          const category = resolveCategory(body.category, await mowareCategories());
          if (!category) return resp(400, { error: 'category is required' });
          const id = Math.random().toString(36).slice(2, 10);
          await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { poll, voter: 't#' + body.date + '#' + id },
            UpdateExpression: 'SET amount = :a, category = :c, treat = :t, note = :n, createdAt = if_not_exists(createdAt, :u)',
            ExpressionAttributeValues: {
              ':a': amount, ':c': category, ':t': body.treat === true,
              ':n': normalizeNote(body.note), ':u': now,
            },
          }));
          // Registry is a string set, so ADD is atomic and idempotent.
          await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { poll, voter: 'meta#categories' },
            UpdateExpression: 'ADD cats :c',
            ExpressionAttributeValues: { ':c': new Set([category]) },
          }));
          return resp(200, await mowareState(monthOf(body.date)));
        }

        if (op === 'delTxn') {
          const id = clean(body.id, 40);
          if (!validSpendDate(body.date, nowMs) || !id) {
            return resp(400, { error: 'date and id are required' });
          }
          await ddb.send(new DeleteCommand({
            TableName: TABLE,
            Key: { poll, voter: 't#' + body.date + '#' + id },
          }));
          return resp(200, await mowareState(monthOf(body.date)));
        }

        if (op === 'sub') {
          const amount = normalizeSen(body.amount);
          const name = clean(body.name, 40);
          if (amount < 1 || !name) return resp(400, { error: 'name and amount are required' });
          const category = resolveCategory(body.category, await mowareCategories());
          if (!category) return resp(400, { error: 'category is required' });
          const startMonth = validMonth(body.startMonth, nowMs) ? body.startMonth : thisMonth;
          const id = Math.random().toString(36).slice(2, 10);
          await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { poll, voter: 's#' + id },
            UpdateExpression: 'SET #nm = :n, amount = :a, category = :c, startMonth = :s, endMonth = :e, createdAt = if_not_exists(createdAt, :u)',
            ExpressionAttributeNames: { '#nm': 'name' },
            ExpressionAttributeValues: {
              ':n': name, ':a': amount, ':c': category, ':s': startMonth, ':e': null, ':u': now,
            },
          }));
          await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { poll, voter: 'meta#categories' },
            UpdateExpression: 'ADD cats :c',
            ExpressionAttributeValues: { ':c': new Set([category]) },
          }));
          return resp(200, await mowareState(thisMonth));
        }

        if (op === 'cancelSub') {
          const id = clean(body.id, 40);
          if (!id) return resp(400, { error: 'id is required' });
          // endMonth is the CURRENT month, inclusive — it was already billed.
          await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { poll, voter: 's#' + id },
            UpdateExpression: 'SET endMonth = :e',
            ExpressionAttributeValues: { ':e': thisMonth },
          }));
          return resp(200, await mowareState(thisMonth));
        }

        return resp(400, { error: 'unknown op' });
      }
      if (poll === TRACKER_POLL) {
        if (!validTrackerDate(body.date, Date.now())) {
          return resp(400, { error: 'date must be today or yesterday (MYT)' });
        }
        const now = new Date().toISOString();
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { poll, voter: body.date },
          UpdateExpression:
            'SET prayers = :pr, workout = :w, sober = :s, urges = :ur, urgeReps = :urr, updatedAt = :u, createdAt = if_not_exists(createdAt, :u)',
          ExpressionAttributeValues: {
            ':pr': normalizePrayers(body.prayers),
            ':w': body.workout === true,
            ':s': body.sober === true,
            ':ur': normalizeUrges(body.urges),
            ':urr': normalizeUrgeReps(body.urgeReps),
            ':u': now,
          },
        }));
        return resp(200, await trackerState(poll));
      }
      const voter = clean(body.voter, 40);
      const track = clean(body.track, 60);
      const rawDates = Array.isArray(body.dates) ? body.dates : body.date ? [body.date] : [];
      const dates = [...new Set(rawDates.map((d) => clean(d, 60)).filter(Boolean))].slice(0, 20);
      if (!poll || !voter || !track || dates.length === 0) {
        return resp(400, { error: 'poll, voter, track and at least one date are required' });
      }
      // One item per (poll, voter): voting again updates the pick but keeps
      // createdAt (and therefore the grid position) from the first vote.
      const now = new Date().toISOString();
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { poll, voter },
        UpdateExpression: 'SET track = :t, dates = :d, updatedAt = :u, createdAt = if_not_exists(createdAt, :u)',
        ExpressionAttributeValues: { ':t': track, ':d': dates, ':u': now },
      }));
      return resp(200, await state(poll));
    }

    return resp(405, { error: 'method not allowed' });
  } catch {
    return resp(500, { error: 'something went wrong' });
  }
};
