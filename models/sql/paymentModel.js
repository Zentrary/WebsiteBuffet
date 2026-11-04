const { querySQL } = require('../../config/db.sql');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function splitUserRef(rawRef) {
  if (!rawRef) return { uuid: null, ref: null };
  const text = String(rawRef).trim();
  if (!text) return { uuid: null, ref: null };
  return {
    uuid: UUID_REGEX.test(text) ? text : null,
    ref: text,
  };
}

const paymentModel = {
  async create({
    sessionId,
    mongoSessionId = null,
    amount,
    method = 'cash',
    cashReceived = null,
    changeDue = 0,
    status = 'pending',
    paidAt = null,
    receivedBy = null,
    note = '',
  }) {
    const receiver = splitUserRef(receivedBy);
    const result = await querySQL(
      `INSERT INTO payments (
         session_id, mongo_session_id, amount, method, cash_received, change_due,
         status, paid_at, received_by, received_by_ref, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, session_id, mongo_session_id, amount, method, cash_received, change_due,
                 status, paid_at, received_by, received_by_ref, created_at`,
      [
        sessionId,
        mongoSessionId,
        amount,
        method,
        cashReceived ?? null,
        changeDue ?? 0,
        status,
        paidAt,
        receiver.uuid,
        receiver.ref,
        note || '',
      ]
    );
    return result.rows[0];
  },

  async findById(id) {
    const result = await querySQL(
      `SELECT id, session_id, mongo_session_id, amount, method, cash_received, change_due, status, paid_at,
              received_by, received_by_ref, confirmed_by, confirmed_by_ref, confirmed_at, note, created_at
       FROM payments WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async findBySessionId(sessionId, status = null) {
    let query = `SELECT id, session_id, mongo_session_id, amount, method, cash_received, change_due, status, paid_at,
                        received_by, received_by_ref, confirmed_by, confirmed_by_ref, confirmed_at, note, created_at
                 FROM payments WHERE session_id = $1`;
    const params = [sessionId];
    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC`;
    const result = await querySQL(query, params);
    return result.rows;
  },

  async updateStatus(id, status, updateData = {}) {
    const { amount, confirmedBy, confirmedAt } = updateData;
    const confirmer = splitUserRef(confirmedBy);
    const result = await querySQL(
      `UPDATE payments
       SET status = $1,
           amount = COALESCE($2, amount),
           confirmed_by = COALESCE($3, confirmed_by),
           confirmed_by_ref = COALESCE($4, confirmed_by_ref),
           confirmed_at = COALESCE($5, confirmed_at),
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, status, amount, confirmed_at`,
      [status, amount ?? null, confirmer.uuid, confirmer.ref, confirmedAt ?? null, id]
    );
    return result.rows[0] || null;
  },

  async markPendingAsFailed(sessionId, excludeId = null) {
    let query = `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE session_id = $1 AND status IN ('pending', 'awaiting_confirmation')`;
    const params = [sessionId];
    if (excludeId) {
      query += ` AND id <> $2`;
      params.push(excludeId);
    }
    await querySQL(query, params);
  },

  async getHistory(limit = 200, sessionRef = null) {
    const params = [];
    let whereSql = '';
    if (sessionRef) {
      params.push(String(sessionRef));
      whereSql = `WHERE (p.mongo_session_id = $1 OR p.session_id::text = $1)`;
    }
    params.push(limit);
    const result = await querySQL(
      `SELECT p.id, p.mongo_payment_id, p.session_id, p.mongo_session_id,
              p.amount, p.method, p.cash_received, p.change_due,
              p.status, p.paid_at, p.received_by, p.received_by_ref, p.note, p.created_at,
              u.username AS received_by_username,
              u.full_name AS received_by_full_name
       FROM payments p
       LEFT JOIN users u ON p.received_by = u.id
       ${whereSql}
       ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return result.rows.map((r) => ({
      _id: r.mongo_payment_id || r.id,
      id: r.id,
      sessionId: r.mongo_session_id || r.session_id,
      amount: Number(r.amount) || 0,
      method: r.method,
      cashReceived: r.cash_received !== null ? Number(r.cash_received) : null,
      changeDue: Number(r.change_due) || 0,
      status: r.status,
      paidAt: r.paid_at,
      note: r.note || '',
      createdAt: r.created_at,
      receivedBy: r.received_by_username
        ? { username: r.received_by_username, fullName: r.received_by_full_name || '' }
        : null,
    }));
  },
};

module.exports = paymentModel;
