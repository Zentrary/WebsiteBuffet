const mongoose = require('mongoose');
const { querySQL } = require('../config/db.sql');

function isValidObjectId(val) {
  if (!val) return false;
  const s = String(val).trim();
  return /^[0-9a-fA-F]{24}$/.test(s) && mongoose.Types.ObjectId.isValid(s);
}

function getMongoDb() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return null;
  }
  return mongoose.connection.db;
}

async function mirrorUserToMongo(row) {
  const db = getMongoDb();
  if (!db || !row || !row.username) return null;

  try {
    const col = db.collection('users');
    let objId = isValidObjectId(row.mongo_id) ? new mongoose.Types.ObjectId(String(row.mongo_id)) : null;

    if (!objId) {
      const existingByUsername = await col.findOne({ username: row.username });
      objId = existingByUsername ? existingByUsername._id : new mongoose.Types.ObjectId();
    }

    const doc = {
      username: row.username,
      password: row.password_hash || row.passwordHash || '',
      prefix: row.prefix || '',
      firstName: row.first_name ?? row.firstName ?? '',
      lastName: row.last_name ?? row.lastName ?? '',
      fullName: row.full_name ?? row.fullName ?? '',
      nickname: row.nickname || '',
      age: row.age !== undefined ? row.age : null,
      phone: row.phone || '',
      role: row.role || 'waiter',
      isActive: row.is_active !== undefined ? Boolean(row.is_active) : Boolean(row.isActive ?? true),
      updatedAt: row.updated_at || row.updatedAt || new Date(),
    };

    if (!doc.password) {
      const sqlRow = await querySQL(`SELECT password_hash FROM users WHERE id = $1 LIMIT 1`, [row.id]);
      if (sqlRow.rows[0]) doc.password = sqlRow.rows[0].password_hash;
    }

    await col.updateOne(
      { _id: objId },
      {
        $set: doc,
        $setOnInsert: { createdAt: row.created_at || row.createdAt || new Date() },
      },
      { upsert: true }
    );

    const mongoIdStr = String(objId);
    if (row.id && String(row.mongo_id || row.mongoId || '') !== mongoIdStr) {
      await querySQL(`UPDATE users SET mongo_id = $1 WHERE id = $2`, [mongoIdStr, row.id]).catch(
        () => {}
      );
    }
    return mongoIdStr;
  } catch (err) {
    console.warn('[sqlToMongoMirror:user] skipped:', err.message);
    return null;
  }
}

async function deleteUserFromMongo(row) {
  const db = getMongoDb();
  if (!db || !row) return;
  try {
    const col = db.collection('users');
    const clauses = [];
    if (row.username) clauses.push({ username: row.username });
    const mid = row.mongo_id || row.mongoId;
    if (isValidObjectId(mid)) clauses.push({ _id: new mongoose.Types.ObjectId(String(mid)) });
    if (clauses.length > 0) {
      await col.deleteMany({ $or: clauses });
    }
  } catch (err) {
    console.warn('[sqlToMongoMirror:deleteUser] skipped:', err.message);
  }
}

async function mirrorTierToMongo(tier) {
  const db = getMongoDb();
  if (!db || !tier) return;
  try {
    const tierCode = String(tier.tier_name || tier.tierCode || '').trim().toUpperCase();
    if (!tierCode) return;
    const col = db.collection('membershiptiers');
    await col.updateOne(
      { tierCode },
      {
        $set: {
          tierCode,
          tierName: tier.display_name || tier.tierName || tierCode,
          minPoints: Number(tier.min_points ?? tier.minPoints ?? 0),
          discountPercent: Number(tier.discount_percent ?? tier.discountPercent ?? 0),
          pointsMultiplier: Number(tier.points_multiplier ?? tier.pointsMultiplier ?? 1),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: tier.created_at || new Date() },
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn('[sqlToMongoMirror:tier] skipped:', err.message);
  }
}

async function mirrorMemberToMongo(row) {
  const db = getMongoDb();
  if (!db || !row) return null;
  try {
    const col = db.collection('members');
    const rawMongoId = row.mongo_id || row.mongoId;
    let objId = isValidObjectId(rawMongoId)
      ? new mongoose.Types.ObjectId(String(rawMongoId))
      : null;

    const memberCode = row.member_id || row.memberCode;
    const phone = row.phone;

    if (!objId) {
      const existing = await col.findOne({
        $or: [...(phone ? [{ phone }] : []), ...(memberCode ? [{ memberCode }] : [])],
      });
      objId = existing ? existing._id : new mongoose.Types.ObjectId();
    }

    const validSources = new Set(['queue', 'web', 'staff', 'admin']);
    const rawVia = String(row.registered_via || row.registeredVia || 'admin');
    const registeredVia = validSources.has(rawVia) ? rawVia : 'staff';

    await col.updateOne(
      { _id: objId },
      {
        $set: {
          memberCode,
          prefix: row.prefix || '',
          fullName: row.full_name ?? row.fullName ?? 'ลูกค้าสมาชิก',
          nickname: row.nickname || '',
          age: row.age !== undefined ? row.age : null,
          phone,
          email: row.email || '',
          tierCode: String(row.tier_name || row.tierCode || 'MEMBER').toUpperCase(),
          currentPoints: Number(row.points_balance ?? row.currentPoints ?? 0),
          lifetimePoints: Number(row.lifetime_points ?? row.lifetimePoints ?? 0),
          totalSpent: Number(row.total_spent ?? row.totalSpent ?? 0),
          visitCount: Number(row.visit_count ?? row.visitCount ?? 0),
          isActive: row.is_active !== undefined ? Boolean(row.is_active) : Boolean(row.isActive ?? true),
          registeredVia,
          createdBy: row.created_by || row.createdBy || 'system',
          updatedAt: row.updated_at || row.updatedAt || new Date(),
        },
        $setOnInsert: {
          createdAt: row.created_at || row.createdAt || new Date(),
        },
      },
      { upsert: true }
    );

    const mongoIdStr = String(objId);
    const sqlId = row.id || row.memberId;
    if (sqlId && String(rawMongoId || '') !== mongoIdStr) {
      await querySQL(`UPDATE members SET mongo_id = $1 WHERE id = $2`, [mongoIdStr, sqlId]).catch(
        () => {}
      );
    }
    return mongoIdStr;
  } catch (err) {
    console.warn('[sqlToMongoMirror:member] skipped:', err.message);
    return null;
  }
}

async function deleteMemberFromMongo(row) {
  const db = getMongoDb();
  if (!db || !row) return;
  try {
    const membersCol = db.collection('members');
    const txCol = db.collection('pointtransactions');
    const rawMongoId = row.mongo_id || row.mongoId;
    const memberCode = row.member_id || row.memberCode;
    const phone = row.phone;

    const existing = await membersCol.findOne({
      $or: [
        ...(isValidObjectId(rawMongoId) ? [{ _id: new mongoose.Types.ObjectId(String(rawMongoId)) }] : []),
        ...(memberCode ? [{ memberCode }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    });

    if (existing) {
      await txCol.deleteMany({ memberId: existing._id });
      await membersCol.deleteOne({ _id: existing._id });
    }
  } catch (err) {
    console.warn('[sqlToMongoMirror:deleteMember] skipped:', err.message);
  }
}

async function mirrorPointTxToMongo(txRow, memberMongoIdHint = null) {
  const db = getMongoDb();
  if (!db || !txRow) return null;
  try {
    let memberMongoId = memberMongoIdHint;
    if (!isValidObjectId(memberMongoId) && txRow.member_id) {
      const mRes = await querySQL(
        `SELECT id, mongo_id, member_id, phone, prefix, full_name, nickname, age, email,
                tier_name, points_balance, lifetime_points, total_spent, visit_count,
                is_active, registered_via, created_by, created_at, updated_at
         FROM members WHERE id = $1 LIMIT 1`,
        [txRow.member_id]
      );
      if (mRes.rows[0]) {
        memberMongoId = isValidObjectId(mRes.rows[0].mongo_id)
          ? mRes.rows[0].mongo_id
          : await mirrorMemberToMongo(mRes.rows[0]);
      }
    }
    if (!isValidObjectId(memberMongoId)) return null;

    const col = db.collection('pointtransactions');
    const objId = isValidObjectId(txRow.mongo_id)
      ? new mongoose.Types.ObjectId(String(txRow.mongo_id))
      : new mongoose.Types.ObjectId();

    const promoObjId = isValidObjectId(txRow.promotion_id)
      ? new mongoose.Types.ObjectId(String(txRow.promotion_id))
      : null;

    const createdAt = txRow.created_at || new Date();
    await col.updateOne(
      { _id: objId },
      {
        $set: {
          memberId: new mongoose.Types.ObjectId(String(memberMongoId)),
          promotionId: promoObjId,
          sessionRef: txRow.session_ref || '',
          transactionType: String(txRow.type || 'ADJUST').toUpperCase(),
          pointsDelta: Number(txRow.points) || 0,
          discountAmount: Number(txRow.discount_amount) || 0,
          billAmount: Number(txRow.bill_amount) || 0,
          note: txRow.description || '',
          createdBy: txRow.created_by_ref || 'system',
          updatedAt: createdAt,
        },
        $setOnInsert: {
          createdAt,
        },
      },
      { upsert: true }
    );

    const mongoIdStr = String(objId);
    if (txRow.id && String(txRow.mongo_id || '') !== mongoIdStr) {
      await querySQL(`UPDATE point_transactions SET mongo_id = $1 WHERE id = $2`, [
        mongoIdStr,
        txRow.id,
      ]).catch(() => {});
    }
    return mongoIdStr;
  } catch (err) {
    console.warn('[sqlToMongoMirror:pointTx] skipped:', err.message);
    return null;
  }
}

module.exports = {
  isValidObjectId,
  mirrorUserToMongo,
  deleteUserFromMongo,
  mirrorTierToMongo,
  mirrorMemberToMongo,
  deleteMemberFromMongo,
  mirrorPointTxToMongo,
};
