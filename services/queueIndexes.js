const Queue = require('../models/Queue');
const ShopSettings = require('../models/ShopSettings');
const { getBusinessDateKey } = require('../utils/businessDay');
const { LEGACY_INDEX_NAME, resetLegacyIndexCache } = require('./queueNumbering');

const BATCH_SIZE = 500;
let repairPromise = null;

function numericPart(queueNumber) {
  const value = Number(String(queueNumber || '').replace(/\D/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}

async function backfillBusinessDates(settings, { dryRun = false } = {}) {
  const filter = { $or: [{ businessDate: null }, { businessDate: { $exists: false } }] };

  const probe = await Queue.findOne(filter).select('_id').lean();
  if (!probe) return { scanned: 0, updated: 0 };
  const scanned = await Queue.countDocuments(filter);
  if (!scanned || dryRun) return { scanned, updated: 0 };

  let updated = 0;
  let lastId = null;
  for (;;) {
    const batchFilter = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
    const batch = await Queue.find(batchFilter)
      .select('_id queueNumber createdAt')
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean();
    if (!batch.length) break;
    const operations = batch.map((queue) => ({
      updateOne: {
        filter: { _id: queue._id },
        update: {
          $set: {
            businessDate: getBusinessDateKey(settings, new Date(queue.createdAt || Date.now())),
            sequence: numericPart(queue.queueNumber),
          },
        },
      },
    }));
    const result = await Queue.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount || operations.length;
    lastId = batch[batch.length - 1]._id;
    if (batch.length < BATCH_SIZE) break;
  }
  return { scanned, updated };
}

async function repairQueueIndexes({ logger = console, backfill = true } = {}) {
  const summary = { droppedLegacyIndex: false, backfilled: 0, indexesSynced: false };
  let indexes;
  try {
    indexes = await Queue.collection.indexes();
  } catch (error) {
    logger.warn('[queueIndexes] could not list indexes:', error.message);
    return summary;
  }

  const legacy = indexes.find(
    (index) =>
      index.name === LEGACY_INDEX_NAME && index.unique === true && !index.partialFilterExpression
  );

  if (backfill) {
    try {
      const settings = (await ShopSettings.findById('shop-settings').lean()) || {};
      const result = await backfillBusinessDates(settings);
      summary.backfilled = result.updated;
      if (result.updated) {
        logger.log(`[queueIndexes] backfilled businessDate on ${result.updated} queue(s)`);
      }
    } catch (error) {
      logger.warn('[queueIndexes] backfill skipped:', error.message);
    }
  }

  if (legacy) {
    try {
      await Queue.collection.dropIndex(LEGACY_INDEX_NAME);
      summary.droppedLegacyIndex = true;
      logger.log(
        '[queueIndexes] dropped legacy unique index queueNumber_1 (per-day numbers can restart)'
      );
    } catch (error) {
      if (error.codeName === 'IndexNotFound') {
        summary.droppedLegacyIndex = true;
      } else {
        logger.warn('[queueIndexes] could not drop legacy queueNumber index:', error.message);
      }
    }
  }

  const hasPerDayIndex = indexes.some(
    (index) =>
      index.unique === true &&
      index.key &&
      index.key.businessDate === 1 &&
      index.key.queueNumber === 1
  );
  if (summary.droppedLegacyIndex || !hasPerDayIndex) {
    try {
      await Queue.syncIndexes();
      summary.indexesSynced = true;
    } catch (error) {
      logger.warn('[queueIndexes] syncIndexes failed:', error.message);
    }
  } else {
    summary.indexesSynced = hasPerDayIndex;
  }

  resetLegacyIndexCache();
  return summary;
}

function repairQueueIndexesOnce(options = {}) {
  if (!repairPromise) {
    repairPromise = repairQueueIndexes(options).catch((error) => {
      console.warn('[queueIndexes] repair failed:', error.message);
      return null;
    });
  }
  return repairPromise;
}

module.exports = {
  backfillBusinessDates,
  repairQueueIndexes,
  repairQueueIndexesOnce,
};
