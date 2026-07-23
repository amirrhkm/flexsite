import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TRACKER_POLL, PRAYERS, computeSummary, todayInMYT, addDays } from './tracker.mjs';

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
  })).sort((a, b) => a.date.localeCompare(b.date));
}
async function trackerState(poll) {
  const days = await trackerDays(poll);
  const today = todayInMYT(Date.now());
  return { days, today, summary: computeSummary(days, today) };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  try {
    if (method === 'GET') {
      const poll = clean(event.queryStringParameters?.poll, 60);
      if (!poll) return resp(400, { error: 'poll query param is required' });
      if (poll === TRACKER_POLL) return resp(200, await trackerState(poll));
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
      if (poll === TRACKER_POLL) {
        if (!validTrackerDate(body.date, Date.now())) {
          return resp(400, { error: 'date must be today or yesterday (MYT)' });
        }
        const now = new Date().toISOString();
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { poll, voter: body.date },
          UpdateExpression:
            'SET prayers = :pr, workout = :w, sober = :s, urges = :ur, updatedAt = :u, createdAt = if_not_exists(createdAt, :u)',
          ExpressionAttributeValues: {
            ':pr': normalizePrayers(body.prayers),
            ':w': body.workout === true,
            ':s': body.sober === true,
            ':ur': normalizeUrges(body.urges),
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
