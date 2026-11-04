const Queue = require('../models/Queue');

const ACTIVE_DINING_SESSION_STATUSES = ['active', 'expired'];

function notifyQueueBoard(io) {
  if (!io) return;
  io.to('admin').to('waiter').emit('queue_board_updated');
}

async function completeSeatedQueues(filter = {}, { io, reason = '' } = {}) {
  const ids = await Queue.find({ ...filter, status: 'seated' }).distinct('_id');
  if (!ids.length) return 0;
  const result = await Queue.updateMany(
    { _id: { $in: ids }, status: 'seated' },
    { $set: { status: 'completed', completedAt: new Date() } }
  );
  const closed = result.modifiedCount || 0;
  if (closed > 0) {
    console.log(`[queueLifecycle] closed ${closed} seated queue(s)${reason ? ` (${reason})` : ''}`);
    notifyQueueBoard(io);
  }
  return closed;
}

function completeSeatedQueuesForSession(sessionId, options = {}) {
  if (!sessionId) return Promise.resolve(0);
  return completeSeatedQueues({ sessionId }, { reason: 'session finished', ...options });
}

function completeSeatedQueuesForTable(tableId, options = {}) {
  if (!tableId) return Promise.resolve(0);
  return completeSeatedQueues({ tableId }, { reason: 'table cleared', ...options });
}

async function completeQueueById(queueId, { io } = {}) {
  const updated = await Queue.findOneAndUpdate(
    { _id: queueId, status: 'seated' },
    { $set: { status: 'completed', completedAt: new Date() } },
    { new: true }
  );
  if (updated) notifyQueueBoard(io);
  return updated;
}

async function findStaleSeatedQueueIds(Session, now = new Date()) {
  const seated = await Queue.find({ status: 'seated' }).select('_id sessionId seatedAt').lean();
  if (!seated.length) return [];
  const sessionIds = [
    ...new Set(
      seated
        .map((queue) => queue.sessionId)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const liveSessions = sessionIds.length
    ? await Session.find({
        _id: { $in: sessionIds },
        isPaid: false,
        status: { $in: ACTIVE_DINING_SESSION_STATUSES },
      })
        .select('_id')
        .lean()
    : [];
  const liveSet = new Set(liveSessions.map((session) => String(session._id)));
  return seated
    .filter((queue) => !queue.sessionId || !liveSet.has(String(queue.sessionId)))
    .map((queue) => queue._id);
}

module.exports = {
  ACTIVE_DINING_SESSION_STATUSES,
  completeQueueById,
  completeSeatedQueues,
  completeSeatedQueuesForSession,
  completeSeatedQueuesForTable,
  findStaleSeatedQueueIds,
  notifyQueueBoard,
};
