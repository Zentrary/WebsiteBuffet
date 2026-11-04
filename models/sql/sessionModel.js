const { querySQL } = require('../../config/db.sql');

const sessionModel = {
  async create({
    queueId, tableId, customerCount = 1, diningStyle = 'alacarte', endTime,
    buffetPackageCode = '', buffetPackageName = '', buffetPricePerPerson = 0,
    hasRefillDrink = false, refillPricePerPerson = 0,
  }) {
    const result = await querySQL(
      `INSERT INTO sessions (queue_id, table_id, customer_count, dining_style, end_time,
                buffet_package_code, buffet_package_name, buffet_price_per_person,
                has_refill_drink, refill_price_per_person)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, queue_id, table_id, customer_count, dining_style, end_time, status, start_time`,
      [queueId, tableId, customerCount, diningStyle, endTime, buffetPackageCode, buffetPackageName, buffetPricePerPerson, hasRefillDrink, refillPricePerPerson]
    );
    return result.rows[0];
  },

  async findById(id) {
    const result = await querySQL(
      `SELECT id, mongo_session_id, queue_id, table_id, customer_count, dining_style, buffet_package_code,
              buffet_package_name, buffet_price_per_person, has_refill_drink,
              refill_price_per_person, start_time, end_time, actual_end_time,
              checkout_requested_at, status, subtotal, service_charge, vat, discount,
              grand_total, is_paid, paid_at, member_id, member_phone, member_name,
              member_tier_name, benefit_type, applied_promotion_id, applied_promo_code,
              applied_promo_title, points_to_redeem, points_earned, loyalty_processed_at
       FROM sessions WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async findByMongoId(mongoSessionId) {
    const result = await querySQL(
      `SELECT id, mongo_session_id, queue_id, table_id, customer_count, dining_style,
              start_time, end_time, status, subtotal, service_charge, vat, discount,
              grand_total, is_paid, paid_at
       FROM sessions WHERE mongo_session_id = $1`,
      [mongoSessionId]
    );
    return result.rows[0] || null;
  },

  async findActiveAndUnpaid(limit = 200) {
    const result = await querySQL(
      `SELECT id, queue_id, table_id, customer_count, dining_style, start_time, end_time,
              checkout_requested_at, status, subtotal, service_charge, vat, discount, grand_total,
              is_paid, member_id, member_name
       FROM sessions
       WHERE status IN ('active', 'expired') AND is_paid = false
       ORDER BY start_time DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  },

  async updateCheckoutRequested(id, requestedAt) {
    const result = await querySQL(
      `UPDATE sessions
       SET checkout_requested_at = $1, updated_at = NOW()
       WHERE id = $2 AND is_paid = false AND status IN ('active', 'expired') AND checkout_requested_at IS NULL
       RETURNING id, checkout_requested_at`,
      [requestedAt, id]
    );
    return result.rows[0] || null;
  },

  async cancelCheckoutRequested(id) {
    const result = await querySQL(
      `UPDATE sessions
       SET checkout_requested_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'active' AND is_paid = false AND end_time > NOW()
       RETURNING id`,
      [id]
    );
    return result.rows[0] || null;
  },

  async markPaid(id, updateData) {
    const {
      status = 'completed', actualEndTime, subtotal, serviceCharge, vat, grandTotal, isPaid = true, paidAt,
    } = updateData;
    const result = await querySQL(
      `UPDATE sessions
       SET status = $1, actual_end_time = COALESCE($2, actual_end_time), subtotal = $3,
           service_charge = $4, vat = $5, grand_total = $6, is_paid = $7, paid_at = $8,
           updated_at = NOW()
       WHERE id = $9 AND is_paid = false AND checkout_requested_at IS NOT NULL
       RETURNING id, status, is_paid, paid_at, grand_total`,
      [status, actualEndTime, subtotal, serviceCharge, vat, grandTotal, isPaid, paidAt, id]
    );
    return result.rows[0] || null;
  },

  async markPaidByMongoId(mongoSessionId, updateData) {
    const {
      status = 'completed', actualEndTime, subtotal, serviceCharge, vat, grandTotal, isPaid = true, paidAt,
    } = updateData;
    const result = await querySQL(
      `UPDATE sessions
       SET status = $1, actual_end_time = COALESCE($2, actual_end_time), subtotal = $3,
           service_charge = $4, vat = $5, grand_total = $6, is_paid = $7, paid_at = $8,
           updated_at = NOW()
       WHERE mongo_session_id = $9 AND is_paid = false
       RETURNING id, mongo_session_id, status, is_paid, paid_at, grand_total`,
      [status, actualEndTime, subtotal, serviceCharge, vat, grandTotal, isPaid, paidAt, mongoSessionId]
    );
    return result.rows[0] || null;
  },

  async updateLoyalty(id, { pointsEarned, loyaltyProcessedAt, memberTierName }) {
    const result = await querySQL(
      `UPDATE sessions
       SET points_earned = $1, loyalty_processed_at = $2, member_tier_name = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, points_earned, member_tier_name`,
      [pointsEarned || 0, loyaltyProcessedAt || new Date(), memberTierName || '', id]
    );
    return result.rows[0];
  },

  async updateMongoSessionId(id, mongoSessionId) {
    const result = await querySQL(
      `UPDATE sessions SET mongo_session_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id, mongo_session_id`,
      [mongoSessionId, id]
    );
    return result.rows[0];
  },

  async markExpired(now) {
    const result = await querySQL(
      `UPDATE sessions
       SET status = 'expired', actual_end_time = $1, updated_at = NOW()
       WHERE status = 'active' AND end_time <= $1
       RETURNING id`,
      [now]
    );
    return result.rows;
  },
};

module.exports = sessionModel;
