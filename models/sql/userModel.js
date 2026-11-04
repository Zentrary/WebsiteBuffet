const { querySQL } = require('../../config/db.sql');
const { mirrorUserToMongo, deleteUserFromMongo } = require('../../services/sqlToMongoMirror');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_REGEX.test(String(value || '').trim());
}

function formatUserRow(row, { includePassword = false } = {}) {
  if (!row) return null;
  const formatted = {
    _id: row.id,
    id: row.id,
    mongoId: row.mongo_id || null,
    username: row.username,
    prefix: row.prefix || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    fullName: row.full_name || '',
    nickname: row.nickname || '',
    age: row.age !== null && row.age !== undefined ? Number(row.age) : null,
    phone: row.phone || '',
    role: row.role || 'waiter',
    isActive: Boolean(row.is_active),
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includePassword) {
    formatted.passwordHash = row.password_hash;
  }
  return formatted;
}

const SELECT_COLUMNS = `
  id, mongo_id, username, password_hash, prefix, first_name, last_name,
  full_name, nickname, age, phone, role, is_active, last_login_at, created_at, updated_at
`;

const userModel = {
  isUuid,
  formatUserRow,

  async create({
    mongoId = null,
    username,
    passwordHash,
    prefix = '',
    firstName = '',
    lastName = '',
    fullName = '',
    nickname = '',
    age = null,
    phone = '',
    role = 'waiter',
    isActive = true,
  }) {
    const result = await querySQL(
      `INSERT INTO users (
         mongo_id, username, password_hash, prefix, first_name, last_name,
         full_name, nickname, age, phone, role, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${SELECT_COLUMNS}`,
      [
        mongoId,
        username,
        passwordHash,
        prefix || '',
        firstName || '',
        lastName || '',
        fullName || '',
        nickname || '',
        age ?? null,
        phone || '',
        role || 'waiter',
        Boolean(isActive),
      ]
    );
    if (result.rows[0]) {
      const mirroredId = await mirrorUserToMongo(result.rows[0]);
      if (mirroredId && !result.rows[0].mongo_id) {
        result.rows[0].mongo_id = mirroredId;
      }
    }
    return formatUserRow(result.rows[0]);
  },

  async findByUsername(username, { includePassword = false } = {}) {
    const result = await querySQL(
      `SELECT ${SELECT_COLUMNS} FROM users WHERE username = $1 LIMIT 1`,
      [String(username || '').trim()]
    );
    return formatUserRow(result.rows[0], { includePassword });
  },

  async findById(idOrMongoId, { includePassword = false } = {}) {
    const key = String(idOrMongoId || '').trim();
    if (!key) return null;

    const result = isUuid(key)
      ? await querySQL(
          `SELECT ${SELECT_COLUMNS} FROM users WHERE id = $1 OR mongo_id = $2 LIMIT 1`,
          [key, key]
        )
      : await querySQL(
          `SELECT ${SELECT_COLUMNS} FROM users WHERE mongo_id = $1 LIMIT 1`,
          [key]
        );
    return formatUserRow(result.rows[0], { includePassword });
  },

  async updateLastLogin(idOrMongoId) {
    const key = String(idOrMongoId || '').trim();
    if (!key) return null;
    const result = isUuid(key)
      ? await querySQL(
          `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id`,
          [key]
        )
      : await querySQL(
          `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE mongo_id = $1 RETURNING id`,
          [key]
        );
    return result.rows[0] || null;
  },

  async updateById(idOrMongoId, fields = {}) {
    const existing = await this.findById(idOrMongoId, { includePassword: true });
    if (!existing) return null;

    const nextUsername = fields.username !== undefined ? fields.username : existing.username;
    const nextPasswordHash =
      fields.passwordHash !== undefined ? fields.passwordHash : existing.passwordHash;
    const nextPrefix = fields.prefix !== undefined ? fields.prefix : existing.prefix;
    const nextFirstName = fields.firstName !== undefined ? fields.firstName : existing.firstName;
    const nextLastName = fields.lastName !== undefined ? fields.lastName : existing.lastName;
    const nextFullName = fields.fullName !== undefined ? fields.fullName : existing.fullName;
    const nextNickname = fields.nickname !== undefined ? fields.nickname : existing.nickname;
    const nextAge = fields.age !== undefined ? fields.age : existing.age;
    const nextPhone = fields.phone !== undefined ? fields.phone : existing.phone;
    const nextRole = fields.role !== undefined ? fields.role : existing.role;
    const nextIsActive = fields.isActive !== undefined ? Boolean(fields.isActive) : existing.isActive;

    const result = await querySQL(
      `UPDATE users
       SET username = $1,
           password_hash = $2,
           prefix = $3,
           first_name = $4,
           last_name = $5,
           full_name = $6,
           nickname = $7,
           age = $8,
           phone = $9,
           role = $10,
           is_active = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING ${SELECT_COLUMNS}`,
      [
        nextUsername,
        nextPasswordHash,
        nextPrefix || '',
        nextFirstName || '',
        nextLastName || '',
        nextFullName || '',
        nextNickname || '',
        nextAge ?? null,
        nextPhone || '',
        nextRole,
        nextIsActive,
        existing.id,
      ]
    );
    if (result.rows[0]) {
      await mirrorUserToMongo(result.rows[0]);
    }
    return formatUserRow(result.rows[0]);
  },

  async deleteById(idOrMongoId) {
    const existing = await this.findById(idOrMongoId);
    if (!existing) return null;
    await querySQL(`DELETE FROM users WHERE id = $1`, [existing.id]);
    await deleteUserFromMongo(existing);
    return existing;
  },

  async listAll() {
    const result = await querySQL(
      `SELECT ${SELECT_COLUMNS} FROM users ORDER BY created_at DESC`
    );
    return result.rows.map((row) => formatUserRow(row));
  },

  async listActive() {
    const result = await querySQL(
      `SELECT ${SELECT_COLUMNS} FROM users WHERE is_active = true ORDER BY username`
    );
    return result.rows.map((row) => formatUserRow(row));
  },
};

module.exports = userModel;
