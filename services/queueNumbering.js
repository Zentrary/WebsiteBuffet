const Queue = require('../models/Queue');
const QueueCounter = require('../models/QueueCounter');

const LEGACY_INDEX_NAME = 'queueNumber_1';
const LEGACY_CACHE_TTL_MS = 30_000;

let legacyCache = { value: null, at: 0 };

function queueCounterId(businessDate) {
  return `queue-number:${businessDate}`;
}

function formatQueueNumber(sequence) {
  return `Q${String(sequence).padStart(3, '0')}`;
}

function numericPart(queueNumber) {
  const value = Number(String(queueNumber || '').replace(/\D/g, ''));
  return Number.isSafeInteger(value) ? value : 0;
}

async function highestSequenceFor(businessDate) {
  const [latest] = await Queue.find({ businessDate })
    .select('sequence queueNumber')
    .sort({ sequence: -1 })
    .limit(1)
    .lean();
  if (!latest) return 0;
  return Math.max(
    Number.isSafeInteger(latest.sequence) ? latest.sequence : 0,
    numericPart(latest.queueNumber)
  );
}

async function highestGlobalSequence() {
  try {
    const [row] = await Queue.aggregate([
      { $match: { queueNumber: /^Q\d+$/ } },
      {
        $project: {
          value: {
            $convert: {
              input: {
                $substrBytes: [
                  '$queueNumber',
                  1,
                  { $subtract: [{ $strLenBytes: '$queueNumber' }, 1] },
                ],
              },
              to: 'long',
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      { $sort: { value: -1 } },
      { $limit: 1 },
    ]);
    const value = Number(row && row.value);
    return Number.isFinite(value) ? value : 0;
  } catch (error) {
    const rows = await Queue.find({ queueNumber: /^Q\d+$/ })
      .select('queueNumber')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    return list.reduce((max, item) => Math.max(max, numericPart(item.queueNumber)), 0);
  }
}

async function hasLegacyUniqueQueueNumberIndex({ force = false } = {}) {
  const now = Date.now();
  if (!force && legacyCache.value !== null && now - legacyCache.at < LEGACY_CACHE_TTL_MS) {
    return legacyCache.value;
  }
  try {
    const indexes = await Queue.collection.indexes();
    const legacy = indexes.find(
      (index) =>
        index.name === LEGACY_INDEX_NAME && index.unique === true && !index.partialFilterExpression
    );
    legacyCache = { value: Boolean(legacy), at: now };
    return legacyCache.value;
  } catch (error) {
    console.warn('[queueNumbering] index inspection failed:', error.message);
    legacyCache = { value: true, at: now };
    return true;
  }
}

function resetLegacyIndexCache() {
  legacyCache = { value: null, at: 0 };
}

async function bumpCounter(counterId, amount = 1) {
  try {
    return await QueueCounter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { sequence: amount } },
      { new: true, upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    return QueueCounter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { sequence: amount } },
      { new: true }
    );
  }
}

async function allocateQueueNumber(businessDate) {
  if (!businessDate) throw new Error('A business date is required to allocate a queue number.');
  const counterId = queueCounterId(businessDate);
  const bumped = await bumpCounter(counterId, 1);
  if (!bumped || !Number.isSafeInteger(bumped.sequence)) {
    throw new Error('Queue sequence counter is not available.');
  }

  let sequence = bumped.sequence;
  const dayHighest = await highestSequenceFor(businessDate);
  if (dayHighest >= sequence) sequence = dayHighest + 1;

  if (await hasLegacyUniqueQueueNumberIndex()) {
    const globalHighest = await highestGlobalSequence();
    if (globalHighest >= sequence) sequence = globalHighest + 1;
  }

  if (sequence !== bumped.sequence) {
    const persisted = await QueueCounter.findOneAndUpdate(
      { _id: counterId },
      { $set: { sequence } },
      { new: true, upsert: true }
    );
    if (persisted && Number.isSafeInteger(persisted.sequence) && persisted.sequence > sequence) {
      sequence = persisted.sequence;
    }
  }

  return { queueNumber: formatQueueNumber(sequence), sequence, businessDate };
}

async function skipSequence(businessDate, sequence) {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return;
  await QueueCounter.findOneAndUpdate(
    { _id: queueCounterId(businessDate) },
    { $max: { sequence } },
    { upsert: true }
  );
}

module.exports = {
  LEGACY_INDEX_NAME,
  allocateQueueNumber,
  formatQueueNumber,
  hasLegacyUniqueQueueNumberIndex,
  highestGlobalSequence,
  highestSequenceFor,
  numericPart,
  queueCounterId,
  resetLegacyIndexCache,
  skipSequence,
};
