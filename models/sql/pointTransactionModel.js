const { querySQL } = require('../../config/db.sql');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function splitUuidRef(rawRef) {
  if (!rawRef) return { uuid: null, ref: null };
  const text = String(rawRef).trim();
  if (!text) return { uuid: null, ref: null };
  return {
    uuid: UUID_REGEX.test(text) ? text : null,
    ref: text,
  };
}

const pointTransactionModel = {
  async create({ memberId, sessionId, type, points, pointsBefore, pointsAfter, description, createdBy }) {
    const creator = splitUuidRef(createdBy);
    const sessionRef = splitUuidRef(sessionId);
    const result = await querySQL(
      `INSERT INTO point_transactions (
         member_id, session_id, type, points, points_before, points_after, description, created_by, created_by_ref
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, member_id, session_id, type, points, points_before, points_after, description, created_at`,
      [
        memberId,
        sessionRef.uuid,
        type,
        points,
        pointsBefore,
        pointsAfter,
        description || null,
        creator.uuid,
        creator.ref,
      ]
    );
    return result.rows[0];
  },

  async findByMemberId(memberId, limit = 50) {
    const result = await querySQL(
      `SELECT id, type, points, points_before, points_after, description, created_at
       FROM point_transactions WHERE member_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [memberId, limit]
    );
    return result.rows;
  },
};

module.exports = pointTransactionModel;
