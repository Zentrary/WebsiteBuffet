const { querySQL } = require('../../config/db.sql');

const memberModel = {
  async create({
    memberId, phone, fullName, tierId, tierName, pointsBalance = 0, totalSpent = 0, isActive = true,
  }) {
    const result = await querySQL(
      `INSERT INTO members (member_id, phone, full_name, tier_id, tier_name, points_balance, total_spent, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, member_id, phone, full_name, tier_id, tier_name, points_balance, total_spent, is_active, created_at`,
      [memberId, phone, fullName, tierId, tierName, pointsBalance, totalSpent, isActive]
    );
    return result.rows[0];
  },

  async findByMemberId(memberId) {
    const result = await querySQL(
      `SELECT id, member_id, phone, full_name, tier_id, tier_name, points_balance, total_spent, is_active, created_at
       FROM members WHERE member_id = $1`,
      [memberId]
    );
    return result.rows[0] || null;
  },

  async findByPhone(phone) {
    const result = await querySQL(
      `SELECT id, member_id, phone, full_name, tier_id, tier_name, points_balance, total_spent, is_active, created_at
       FROM members WHERE phone = $1`,
      [phone]
    );
    return result.rows[0] || null;
  },

  async findById(id) {
    const result = await querySQL(
      `SELECT id, member_id, phone, full_name, tier_id, tier_name, points_balance, total_spent, is_active, created_at
       FROM members WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async updatePoints(id, pointsBalance, totalSpent) {
    const result = await querySQL(
      `UPDATE members SET points_balance = $1, total_spent = $2, updated_at = NOW() WHERE id = $3
       RETURNING id, points_balance, total_spent`,
      [pointsBalance, totalSpent, id]
    );
    return result.rows[0];
  },

  async listActive() {
    const result = await querySQL(
      `SELECT id, member_id, phone, full_name, tier_name, points_balance, total_spent, is_active
       FROM members WHERE is_active = true ORDER BY member_id`
    );
    return result.rows;
  },
};

module.exports = memberModel;
