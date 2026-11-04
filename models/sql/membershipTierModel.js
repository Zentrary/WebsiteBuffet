const { querySQL } = require('../../config/db.sql');

const membershipTierModel = {
  async create({ tierName, displayName, discountPercent = 0, pointsMultiplier = 1, minPoints = 0, benefits = [] }) {
    const result = await querySQL(
      `INSERT INTO membership_tiers (tier_name, display_name, discount_percent, points_multiplier, min_points, benefits)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tier_name, display_name, discount_percent, points_multiplier, min_points, benefits`,
      [tierName, displayName, discountPercent, pointsMultiplier, minPoints, benefits]
    );
    return result.rows[0];
  },

  async findAll() {
    const result = await querySQL(
      `SELECT id, tier_name, display_name, discount_percent, points_multiplier, min_points, benefits
       FROM membership_tiers ORDER BY min_points`
    );
    return result.rows;
  },

  async findByName(tierName) {
    const result = await querySQL(
      `SELECT id, tier_name, display_name, discount_percent, points_multiplier, min_points, benefits
       FROM membership_tiers WHERE tier_name = $1`,
      [tierName]
    );
    return result.rows[0] || null;
  },
};

module.exports = membershipTierModel;
