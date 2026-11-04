const DINING_SESSION_STATUSES = ['active', 'expired'];

const CLOSED_QUEUE_STATUSES = ['completed', 'cancelled', 'no_show'];

function canRequestCheckout(session) {
  return Boolean(
    session &&
    DINING_SESSION_STATUSES.includes(session.status) &&
    !session.isPaid &&
    !session.checkoutRequestedAt
  );
}

function canTransitionQueue(from, to) {
  if (from === 'waiting' && ['called', 'cancelled', 'no_show'].includes(to)) return true;
  if (from === 'called' && ['seated', 'cancelled', 'no_show'].includes(to)) return true;
  return false;
}

function canCompleteQueue(from) {
  return from === 'seated';
}

function isSeatedQueueActive(queue) {
  if (!queue || queue.status !== 'seated') return true;
  const session = queue.sessionId;
  if (!session || typeof session !== 'object' || !session.status) return false;
  if (session.isPaid) return false;
  return DINING_SESSION_STATUSES.includes(session.status);
}

function isSeatedQueueOverdue(queue, now = new Date()) {
  const session = queue && queue.sessionId;
  if (!session || typeof session !== 'object' || !session.endTime) return false;
  return new Date(session.endTime).getTime() < now.getTime();
}

function canResumeDining(session, now = new Date()) {
  return Boolean(
    session &&
    session.status === 'active' &&
    !session.isPaid &&
    session.checkoutRequestedAt &&
    new Date(session.endTime).getTime() > now.getTime()
  );
}

function canCompletePayment(session) {
  return Boolean(
    session &&
    DINING_SESSION_STATUSES.includes(session.status) &&
    !session.isPaid &&
    session.checkoutRequestedAt
  );
}

function canTransitionTable(from, to, { isPaid = false } = {}) {
  if (from === 'available' && to === 'reserved') return true;
  if (from === 'reserved' && to === 'occupied') return true;
  if (from === 'reserved' && to === 'available') return true;
  if (from === 'occupied' && to === 'cleaning') return isPaid;
  if (from === 'cleaning' && to === 'available') return isPaid;
  return false;
}

module.exports = {
  CLOSED_QUEUE_STATUSES,
  canCompletePayment,
  canCompleteQueue,
  canRequestCheckout,
  canResumeDining,
  canTransitionQueue,
  canTransitionTable,
  isSeatedQueueActive,
  isSeatedQueueOverdue,
};
