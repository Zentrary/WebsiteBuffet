const mongoose = require('mongoose');
const { querySQL } = require('../config/db.sql');
const sqlBridge = require('./sqlBridge');
const shopSettingsModel = require('../models/sql/shopSettingsModel');

function toStr(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && val._id !== undefined) return String(val._id);
  const s = String(val).trim();
  return s || null;
}

async function syncTableDocToSql(doc) {
  const mongoId = toStr(doc._id);
  const tableNumber = String(doc.tableNumber || '').trim();
  if (!mongoId || !tableNumber) return;

  const existing = await querySQL(
    `SELECT id FROM tables WHERE mongo_id = $1 OR table_number = $2 LIMIT 1`,
    [mongoId, tableNumber]
  );

  if (existing.rows[0]) {
    await querySQL(
      `UPDATE tables
       SET mongo_id = $1,
           table_number = $2,
           capacity = $3,
           min_capacity = $4,
           zone = $5,
           status = $6,
           current_session_id = $7,
           reserved_for_queue_id = $8,
           last_session_id = $9,
           updated_at = NOW()
       WHERE id = $10`,
      [
        mongoId,
        tableNumber,
        Number(doc.capacity || 2),
        Number(doc.minCapacity || 1),
        String(doc.zone || 'small'),
        String(doc.status || 'available'),
        toStr(doc.currentSessionId),
        toStr(doc.reservedForQueueId),
        toStr(doc.lastSessionId),
        existing.rows[0].id,
      ]
    );
  } else {
    await querySQL(
      `INSERT INTO tables (
         mongo_id, table_number, capacity, min_capacity, zone, status,
         current_session_id, reserved_for_queue_id, last_session_id, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), NOW())`,
      [
        mongoId,
        tableNumber,
        Number(doc.capacity || 2),
        Number(doc.minCapacity || 1),
        String(doc.zone || 'small'),
        String(doc.status || 'available'),
        toStr(doc.currentSessionId),
        toStr(doc.reservedForQueueId),
        toStr(doc.lastSessionId),
        doc.createdAt || new Date(),
      ]
    );
  }
}

async function syncQueueDocToSql(doc) {
  const mongoId = toStr(doc._id);
  if (!mongoId) return;

  await querySQL(
    `INSERT INTO queues (
       mongo_id, queue_number, business_date, sequence, customer_count,
       dining_style, buffet_package_code, has_refill_drink,
       customer_name, customer_phone, member_id, access_token_hash,
       status, preferred_zone, preferred_table_id, auto_assign,
       assigned_table_id, assignment_note, qr_code_data,
       called_at, seated_at, completed_at, no_show_at,
       table_id, session_id, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15, $16,
       $17, $18, $19,
       $20, $21, $22, $23,
       $24, $25, COALESCE($26, NOW()), NOW()
     )
     ON CONFLICT (mongo_id) DO UPDATE SET
       queue_number = EXCLUDED.queue_number,
       business_date = EXCLUDED.business_date,
       sequence = EXCLUDED.sequence,
       customer_count = EXCLUDED.customer_count,
       dining_style = EXCLUDED.dining_style,
       buffet_package_code = EXCLUDED.buffet_package_code,
       has_refill_drink = EXCLUDED.has_refill_drink,
       customer_name = EXCLUDED.customer_name,
       customer_phone = EXCLUDED.customer_phone,
       member_id = EXCLUDED.member_id,
       access_token_hash = COALESCE(EXCLUDED.access_token_hash, queues.access_token_hash),
       status = EXCLUDED.status,
       preferred_zone = EXCLUDED.preferred_zone,
       preferred_table_id = EXCLUDED.preferred_table_id,
       auto_assign = EXCLUDED.auto_assign,
       assigned_table_id = EXCLUDED.assigned_table_id,
       assignment_note = EXCLUDED.assignment_note,
       qr_code_data = COALESCE(EXCLUDED.qr_code_data, queues.qr_code_data),
       called_at = EXCLUDED.called_at,
       seated_at = EXCLUDED.seated_at,
       completed_at = EXCLUDED.completed_at,
       no_show_at = EXCLUDED.no_show_at,
       table_id = EXCLUDED.table_id,
       session_id = EXCLUDED.session_id,
       updated_at = NOW()`,
    [
      mongoId,
      String(doc.queueNumber || 'Q000'),
      doc.businessDate || null,
      doc.sequence !== undefined && doc.sequence !== null ? Number(doc.sequence) : null,
      Number(doc.customerCount || 1),
      String(doc.diningStyle || 'alacarte'),
      String(doc.buffetPackageCode || ''),
      Boolean(doc.hasRefillDrink),
      String(doc.customerName || ''),
      String(doc.customerPhone || ''),
      toStr(doc.memberId),
      doc.accessTokenHash || null,
      String(doc.status || 'waiting'),
      doc.preferredZone || null,
      toStr(doc.preferredTableId),
      doc.autoAssign !== false,
      toStr(doc.assignedTableId),
      String(doc.assignmentNote || ''),
      doc.qrCodeData || null,
      doc.calledAt || null,
      doc.seatedAt || null,
      doc.completedAt || null,
      doc.noShowAt || null,
      toStr(doc.tableId),
      toStr(doc.sessionId),
      doc.createdAt || new Date(),
    ]
  );
}

async function syncQueueCounterDocToSql(doc) {
  const counterId = toStr(doc._id);
  if (!counterId) return;
  await querySQL(
    `INSERT INTO queue_counters (counter_id, sequence, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (counter_id) DO UPDATE SET
       sequence = EXCLUDED.sequence,
       updated_at = NOW()`,
    [counterId, Number(doc.sequence || 0)]
  );
}

async function syncMenuDocToSql(doc) {
  const mongoId = toStr(doc._id);
  if (!mongoId) return;
  await querySQL(
    `INSERT INTO menus (
       mongo_id, name, description, price, category, buffet_tier, image_url,
       is_available, preparation_time, stock_quantity, low_stock_threshold,
       max_order_quantity, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, NOW()), NOW())
     ON CONFLICT (mongo_id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       price = EXCLUDED.price,
       category = EXCLUDED.category,
       buffet_tier = EXCLUDED.buffet_tier,
       image_url = EXCLUDED.image_url,
       is_available = EXCLUDED.is_available,
       preparation_time = EXCLUDED.preparation_time,
       stock_quantity = EXCLUDED.stock_quantity,
       low_stock_threshold = EXCLUDED.low_stock_threshold,
       max_order_quantity = EXCLUDED.max_order_quantity,
       updated_at = NOW()`,
    [
      mongoId,
      String(doc.name || '').slice(0, 200),
      String(doc.description || ''),
      Number(doc.price || 0),
      String(doc.category || '').slice(0, 100),
      String(doc.buffetTier || 'auto').slice(0, 40),
      String(doc.imageUrl || '/assets/images/default-food.jpg'),
      doc.isAvailable !== false,
      Number(doc.preparationTime ?? 10),
      doc.stockQuantity !== null && doc.stockQuantity !== undefined ? Number(doc.stockQuantity) : null,
      Number(doc.lowStockThreshold ?? 5),
      Number(doc.maxOrderQuantity ?? 99),
      doc.createdAt || new Date(),
    ]
  );
}

async function syncPromotionDocToSql(doc) {
  const mongoId = toStr(doc._id);
  const promoCode = String(doc.promoCode || '').trim().toUpperCase();
  if (!mongoId || !promoCode) return;

  const existing = await querySQL(
    `SELECT id FROM promotions WHERE mongo_id = $1 OR promo_code = $2 LIMIT 1`,
    [mongoId, promoCode]
  );

  if (existing.rows[0]) {
    await querySQL(
      `UPDATE promotions
       SET mongo_id = $1,
           promo_code = $2,
           title = $3,
           description = $4,
           discount_type = $5,
           discount_value = $6,
           points_cost = $7,
           min_spend = $8,
           max_discount = $9,
           is_active = $10,
           updated_at = NOW()
       WHERE id = $11`,
      [
        mongoId,
        promoCode,
        String(doc.title || '').slice(0, 200),
        String(doc.description || ''),
        String(doc.discountType || 'FIXED'),
        Number(doc.discountValue || 0),
        Number(doc.pointsCost || 0),
        Number(doc.minSpend || 0),
        doc.maxDiscount !== null && doc.maxDiscount !== undefined ? Number(doc.maxDiscount) : null,
        doc.isActive !== false,
        existing.rows[0].id,
      ]
    );
  } else {
    await querySQL(
      `INSERT INTO promotions (
         mongo_id, promo_code, title, description, discount_type, discount_value,
         points_cost, min_spend, max_discount, is_active, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()), NOW())`,
      [
        mongoId,
        promoCode,
        String(doc.title || '').slice(0, 200),
        String(doc.description || ''),
        String(doc.discountType || 'FIXED'),
        Number(doc.discountValue || 0),
        Number(doc.pointsCost || 0),
        Number(doc.minSpend || 0),
        doc.maxDiscount !== null && doc.maxDiscount !== undefined ? Number(doc.maxDiscount) : null,
        doc.isActive !== false,
        doc.createdAt || new Date(),
      ]
    );
  }
}

async function syncFeedbackDocToSql(doc) {
  const mongoId = toStr(doc._id);
  if (!mongoId) return;
  const mongoSessionId = toStr(doc.sessionId);
  let sqlSessionId = null;
  if (mongoSessionId) {
    const sRes = await querySQL(
      `SELECT id FROM sessions WHERE mongo_session_id = $1 LIMIT 1`,
      [mongoSessionId]
    );
    sqlSessionId = sRes.rows[0] ? sRes.rows[0].id : null;
  }

  await querySQL(
    `INSERT INTO feedbacks (
       mongo_id, session_id, mongo_session_id, table_id, rating, comment, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), NOW())
     ON CONFLICT (mongo_id) DO UPDATE SET
       rating = EXCLUDED.rating,
       comment = EXCLUDED.comment,
       updated_at = NOW()`,
    [
      mongoId,
      sqlSessionId,
      mongoSessionId,
      toStr(doc.tableId),
      Number(doc.rating || 5),
      String(doc.comment || ''),
      doc.createdAt || new Date(),
    ]
  );
}

async function syncAuditLogDocToSql(doc) {
  const mongoId = toStr(doc._id);
  if (!mongoId) return;
  await querySQL(
    `INSERT INTO audit_logs (
       mongo_id, action, actor_id, actor_username, actor_role,
       ip, target_type, target_id, summary, metadata, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()))
     ON CONFLICT (mongo_id) DO NOTHING`,
    [
      mongoId,
      String(doc.action || '').slice(0, 100),
      toStr(doc.actorId),
      String(doc.actorUsername || 'anonymous').slice(0, 100),
      String(doc.actorRole || '').slice(0, 40),
      String(doc.ip || '').slice(0, 100),
      String(doc.targetType || '').slice(0, 60),
      String(doc.targetId || '').slice(0, 100),
      String(doc.summary || ''),
      doc.metadata ? JSON.stringify(doc.metadata) : null,
      doc.createdAt || new Date(),
    ]
  );
}

async function syncShopSettingsDocToSql(doc) {
  if (!doc) return;
  await shopSettingsModel.updateSettings({
    restaurantName: doc.restaurantName,
    welcomeMessage: doc.welcomeMessage,
    phone: doc.phone,
    address: doc.address,
    openTime: doc.openTime,
    closeTime: doc.closeTime,
    lastQueueTime: doc.lastQueueTime,
    timezone: doc.timezone,
    isTestMode: Boolean(doc.isTestMode),
    diningDurationMinutes: doc.diningDurationMinutes,
    logoUrl: doc.logoUrl,
    heroImageUrl: doc.heroImageUrl,
    vatPercent: doc.vatPercent,
    serviceChargePercent: doc.serviceChargePercent,
    vatMode: doc.vatMode,
    serviceChargeMode: doc.serviceChargeMode,
    buffetSignaturePrice: doc.buffetSignaturePrice,
    buffetPremiumPrice: doc.buffetPremiumPrice,
    buffetDeluxePrice: doc.buffetDeluxePrice,
    refillDrinkPrice: doc.refillDrinkPrice,
    promptPayId: doc.promptPayId || '',
    paymentQrImageUrl: doc.paymentQrImageUrl || '',
  });
}

async function syncMongoDocByModel(modelName, rawDoc) {
  if (!process.env.DATABASE_URL || !rawDoc) return;
  const doc = typeof rawDoc.toObject === 'function' ? rawDoc.toObject() : rawDoc;
  try {
    switch (modelName) {
      case 'Table':
        await syncTableDocToSql(doc);
        break;
      case 'Queue':
        await syncQueueDocToSql(doc);
        break;
      case 'QueueCounter':
        await syncQueueCounterDocToSql(doc);
        break;
      case 'Menu':
        await syncMenuDocToSql(doc);
        break;
      case 'Promotion':
        await syncPromotionDocToSql(doc);
        break;
      case 'Feedback':
        await syncFeedbackDocToSql(doc);
        break;
      case 'AuditLog':
        await syncAuditLogDocToSql(doc);
        break;
      case 'ShopSettings':
        await syncShopSettingsDocToSql(doc);
        break;
      case 'Session':
        await sqlBridge.syncSessionFromMongo(doc);
        break;
      case 'Order':
        await sqlBridge.syncOrderFromMongo(doc);
        break;
      case 'Payment':
        await sqlBridge.syncPaymentFromMongo(doc);
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn(`[mongooseSqlPlugin:${modelName}] sync skipped:`, err.message);
  }
}

async function deleteMongoIdsFromSql(modelName, mongoIds = []) {
  if (!process.env.DATABASE_URL || !Array.isArray(mongoIds) || mongoIds.length === 0) return;
  const ids = mongoIds.map((x) => String(x)).filter(Boolean);
  if (ids.length === 0) return;

  const deleteTableMap = {
    Table: ['tables', 'mongo_id'],
    Queue: ['queues', 'mongo_id'],
    QueueCounter: ['queue_counters', 'counter_id'],
    Menu: ['menus', 'mongo_id'],
    Promotion: ['promotions', 'mongo_id'],
    Feedback: ['feedbacks', 'mongo_id'],
    AuditLog: ['audit_logs', 'mongo_id'],
    Session: ['sessions', 'mongo_session_id'],
    Order: ['orders', 'mongo_order_id'],
    Payment: ['payments', 'mongo_payment_id'],
  };

  const target = deleteTableMap[modelName];
  if (!target) return;
  const [tableName, colName] = target;
  try {
    await querySQL(`DELETE FROM ${tableName} WHERE ${colName} = ANY($1)`, [ids]);
  } catch (err) {
    console.warn(`[mongooseSqlPlugin:${modelName}] delete skipped:`, err.message);
  }
}

function createMongooseSqlMirrorPlugin(modelName) {
  return function mongooseSqlMirrorPlugin(schema) {
    schema.post('save', async function onPostSave(doc) {
      await syncMongoDocByModel(modelName, doc);
    });

    schema.post('insertMany', async function onPostInsertMany(docs) {
      if (!Array.isArray(docs)) return;
      for (const doc of docs) {
        await syncMongoDocByModel(modelName, doc);
      }
    });

    schema.post('findOneAndUpdate', async function onPostFindOneAndUpdate(doc) {
      if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
        if (doc) await syncMongoDocByModel(modelName, doc);
        return;
      }
      const colName = this.model.collection.collectionName;
      const col = mongoose.connection.db.collection(colName);
      if (doc && doc._id !== undefined) {
        const fresh = await col.findOne({ _id: doc._id });
        await syncMongoDocByModel(modelName, fresh || doc);
      } else {
        const fresh = await col.findOne(this.getFilter());
        if (fresh) await syncMongoDocByModel(modelName, fresh);
      }
    });

    schema.pre(['updateOne', 'updateMany'], { document: false, query: true }, async function preUpdate() {
      try {
        if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
          const col = mongoose.connection.db.collection(this.model.collection.collectionName);
          const matched = await col.find(this.getFilter(), { projection: { _id: 1 } }).toArray();
          this.__mirrorTargetIds = matched.map((d) => d._id);
        }
      } catch {
        this.__mirrorTargetIds = [];
      }
    });

    schema.post(['updateOne', 'updateMany'], { document: false, query: true }, async function postUpdate(res) {
      try {
        if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return;
        const col = mongoose.connection.db.collection(this.model.collection.collectionName);
        const ids = Array.isArray(this.__mirrorTargetIds) ? [...this.__mirrorTargetIds] : [];
        if (res && res.upsertedId) ids.push(res.upsertedId);
        if (ids.length === 0) return;
        const freshDocs = await col.find({ _id: { $in: ids } }).toArray();
        for (const d of freshDocs) {
          await syncMongoDocByModel(modelName, d);
        }
      } catch (err) {
        console.warn(`[mongooseSqlPlugin:${modelName}] postUpdate skipped:`, err.message);
      }
    });

    schema.post('findOneAndDelete', async function onPostFindOneAndDelete(doc) {
      if (doc && doc._id !== undefined) {
        await deleteMongoIdsFromSql(modelName, [String(doc._id)]);
      }
    });

    schema.pre(['deleteOne', 'deleteMany'], { document: false, query: true }, async function preDelete() {
      try {
        if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
          const col = mongoose.connection.db.collection(this.model.collection.collectionName);
          const matched = await col.find(this.getFilter(), { projection: { _id: 1 } }).toArray();
          this.__mirrorDeletedIds = matched.map((d) => String(d._id));
        }
      } catch {
        this.__mirrorDeletedIds = [];
      }
    });

    schema.post(['deleteOne', 'deleteMany'], { document: false, query: true }, async function postDelete() {
      if (Array.isArray(this.__mirrorDeletedIds) && this.__mirrorDeletedIds.length > 0) {
        await deleteMongoIdsFromSql(modelName, this.__mirrorDeletedIds);
      }
    });
  };
}

module.exports = {
  createMongooseSqlMirrorPlugin,
  syncMongoDocByModel,
  deleteMongoIdsFromSql,
};
