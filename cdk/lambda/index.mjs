import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  try {
    if (method === 'GET') {
      const poll = clean(event.queryStringParameters?.poll, 60);
      if (!poll) return resp(400, { error: 'poll query param is required' });
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
