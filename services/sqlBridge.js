const { querySQL, withTransaction } = require('../config/db.sql');
const sessionModel = require('../models/sql/sessionModel');
const orderModel = require('../models/sql/orderModel');
const paymentModel = require('../models/sql/paymentModel');
const pointTransactionModel = require('../models/sql/pointTransactionModel');
const shopSettingsModel = require('../models/sql/shopSettingsModel');
const userModel = require('../models/sql/userModel');

async function resolveUserUuid(rawRef) {
  if (!rawRef) return { uuid: null, ref: null };
  const ref = String(rawRef._id || rawRef.id || rawRef).trim();
  if (!ref) return { uuid: null, ref: null };
  try {
    const u = await userModel.findById(ref);
    if (u && u.id) {
      return { uuid: u.id, ref };
    }
  } catch {
  }
  return { uuid: userModel.isUuid(ref) ? ref : null, ref };
}

async function syncSessionFromMongo(sessionDoc) {
  if (!sessionDoc) return null;
  const s = typeof sessionDoc.toObject === 'function' ? sessionDoc.toObject() : sessionDoc;
  const mongoId = String(s._id || s.mongoSessionId || '').trim();
  if (!mongoId) return null;

  const queueId = s.queueId ? String(s.queueId._id || s.queueId) : null;
  const tableId = s.tableId ? String(s.tableId._id || s.tableId) : 'unknown';

  const result = await querySQL(
    `INSERT INTO sessions (
       mongo_session_id, queue_id, table_id, customer_count, dining_style,
       buffet_package_code, buffet_package_name, buffet_price_per_person,
       has_refill_drink, refill_price_per_person,
       start_time, end_time, actual_end_time, checkout_requested_at, status,
       subtotal, service_charge, vat, discount, grand_total,
       is_paid, paid_at,
       member_id, member_phone, member_name, member_tier_name,
       benefit_type, applied_promotion_id, applied_promo_code, applied_promo_title,
       points_to_redeem, points_earned, loyalty_processed_at,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10,
       $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20,
       $21, $22,
       $23, $24, $25, $26,
       $27, $28, $29, $30,
       $31, $32, $33,
       COALESCE($34, NOW()), NOW()
     )
     ON CONFLICT (mongo_session_id) DO UPDATE SET
       queue_id = COALESCE(EXCLUDED.queue_id, sessions.queue_id),
       table_id = COALESCE(EXCLUDED.table_id, sessions.table_id),
       customer_count = EXCLUDED.customer_count,
       dining_style = EXCLUDED.dining_style,
       buffet_package_code = EXCLUDED.buffet_package_code,
       buffet_package_name = EXCLUDED.buffet_package_name,
       buffet_price_per_person = EXCLUDED.buffet_price_per_person,
       has_refill_drink = EXCLUDED.has_refill_drink,
       refill_price_per_person = EXCLUDED.refill_price_per_person,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       actual_end_time = EXCLUDED.actual_end_time,
       checkout_requested_at = EXCLUDED.checkout_requested_at,
       status = EXCLUDED.status,
       subtotal = EXCLUDED.subtotal,
       service_charge = EXCLUDED.service_charge,
       vat = EXCLUDED.vat,
       discount = EXCLUDED.discount,
       grand_total = EXCLUDED.grand_total,
       is_paid = EXCLUDED.is_paid,
       paid_at = EXCLUDED.paid_at,
       member_id = EXCLUDED.member_id,
       member_phone = EXCLUDED.member_phone,
       member_name = EXCLUDED.member_name,
       member_tier_name = EXCLUDED.member_tier_name,
       benefit_type = EXCLUDED.benefit_type,
       applied_promotion_id = EXCLUDED.applied_promotion_id,
       applied_promo_code = EXCLUDED.applied_promo_code,
       applied_promo_title = EXCLUDED.applied_promo_title,
       points_to_redeem = EXCLUDED.points_to_redeem,
       points_earned = EXCLUDED.points_earned,
       loyalty_processed_at = EXCLUDED.loyalty_processed_at,
       updated_at = NOW()
     RETURNING id, mongo_session_id, status, is_paid, grand_total`,
    [
      mongoId,
      queueId,
      tableId,
      Number(s.customerCount || 1),
      s.diningStyle || 'alacarte',
      s.buffetPackageCode || '',
      s.buffetPackageName || '',
      Number(s.buffetPricePerPerson || 0),
      Boolean(s.hasRefillDrink),
      Number(s.refillPricePerPerson || 0),
      s.startTime || new Date(),
      s.endTime || s.startTime || new Date(),
      s.actualEndTime || null,
      s.checkoutRequestedAt || null,
      s.status || 'active',
      Number(s.subtotal || 0),
      Number(s.serviceCharge || 0),
      Number(s.vat || 0),
      Number(s.discount || 0),
      Number(s.grandTotal || 0),
      Boolean(s.isPaid),
      s.paidAt || null,
      s.memberId ? String(s.memberId) : null,
      s.memberPhone || null,
      s.memberName || null,
      s.memberTierName || null,
      s.benefitType || '',
      s.appliedPromotionId ? String(s.appliedPromotionId) : null,
      s.appliedPromoCode || null,
      s.appliedPromoTitle || null,
      Number(s.pointsToRedeem || 0),
      Number(s.pointsEarned || 0),
      s.loyaltyProcessedAt || null,
      s.createdAt || s.startTime || new Date(),
    ]
  );

  return result.rows[0] || null;
}

async function syncOrderFromMongo(orderDoc) {
  if (!orderDoc) return null;
  const o = typeof orderDoc.toObject === 'function' ? orderDoc.toObject() : orderDoc;
  const mongoOrderId = String(o._id || o.mongoOrderId || '').trim();
  if (!mongoOrderId) return null;

  const mongoSessionId = String(o.sessionId && (o.sessionId._id || o.sessionId)).trim();
  const tableId = String((o.tableId && (o.tableId._id || o.tableId)) || 'unknown');
  const sqlSession = await ensureSqlSession(mongoSessionId, {
    tableId,
    startTime: o.createdAt || new Date(),
    endTime: o.createdAt || new Date(),
  });

  return withTransaction(async (client) => {
    const orderRes = await client.query(
      `INSERT INTO orders (
         mongo_order_id, session_id, table_id, total_price, status,
         accepted_at, cooking_at, ready_at, served_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), NOW())
       ON CONFLICT (mongo_order_id) DO UPDATE SET
         total_price = EXCLUDED.total_price,
         status = EXCLUDED.status,
         accepted_at = COALESCE(EXCLUDED.accepted_at, orders.accepted_at),
         cooking_at = COALESCE(EXCLUDED.cooking_at, orders.cooking_at),
         ready_at = COALESCE(EXCLUDED.ready_at, orders.ready_at),
         served_at = COALESCE(EXCLUDED.served_at, orders.served_at),
         updated_at = NOW()
       RETURNING id, mongo_order_id, session_id, status`,
      [
        mongoOrderId,
        sqlSession.id,
        tableId,
        Number(o.totalPrice || 0),
        o.status || 'pending',
        o.acceptedAt || null,
        o.cookingAt || null,
        o.readyAt || null,
        o.servedAt || null,
        o.createdAt || new Date(),
      ]
    );

    const sqlOrder = orderRes.rows[0];
    const items = Array.isArray(o.items) ? o.items : [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const it = items[idx];
      const mongoItemId = it._id ? String(it._id) : `${mongoOrderId}:${idx}`;
      const menuId = it.menuId ? String(it.menuId._id || it.menuId) : null;
      await client.query(
        `INSERT INTO order_items (
           mongo_item_id, order_id, menu_id, name, price, quantity, note, item_status, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), NOW())
         ON CONFLICT (mongo_item_id) DO UPDATE SET
           price = EXCLUDED.price,
           quantity = EXCLUDED.quantity,
           note = EXCLUDED.note,
           item_status = EXCLUDED.item_status,
           updated_at = NOW()`,
        [
          mongoItemId,
          sqlOrder.id,
          menuId,
          String(it.name || 'Item'),
          Number(it.price || 0),
          Number(it.quantity || 1),
          it.note || null,
          it.itemStatus || 'pending',
          o.createdAt || new Date(),
        ]
      );
    }

    return sqlOrder;
  });
}

async function syncPaymentFromMongo(paymentDoc) {
  if (!paymentDoc) return null;
  const p = typeof paymentDoc.toObject === 'function' ? paymentDoc.toObject() : paymentDoc;
  const mongoPaymentId = String(p._id || p.mongoPaymentId || '').trim();
  if (!mongoPaymentId) return null;

  const mongoSessionId = String(p.sessionId && (p.sessionId._id || p.sessionId)).trim();
  const sqlSession = await ensureSqlSession(mongoSessionId, {
    endTime: p.paidAt || p.createdAt || new Date(),
  });

  const receiver = await resolveUserUuid(p.receivedBy);
  const confirmer = await resolveUserUuid(p.confirmedBy);

  const res = await querySQL(
    `INSERT INTO payments (
       mongo_payment_id, session_id, mongo_session_id,
       amount, method, cash_received, change_due, status, paid_at,
       received_by, received_by_ref, confirmed_by, confirmed_by_ref, confirmed_at,
       note, slip_image_url, slip_uploaded_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, COALESCE($18, NOW()), NOW())
     ON CONFLICT (mongo_payment_id) DO UPDATE SET
       amount = EXCLUDED.amount,
       method = EXCLUDED.method,
       cash_received = COALESCE(EXCLUDED.cash_received, payments.cash_received),
       change_due = EXCLUDED.change_due,
       status = EXCLUDED.status,
       paid_at = COALESCE(EXCLUDED.paid_at, payments.paid_at),
       received_by = COALESCE(EXCLUDED.received_by, payments.received_by),
       received_by_ref = COALESCE(EXCLUDED.received_by_ref, payments.received_by_ref),
       confirmed_by = COALESCE(EXCLUDED.confirmed_by, payments.confirmed_by),
       confirmed_by_ref = COALESCE(EXCLUDED.confirmed_by_ref, payments.confirmed_by_ref),
       confirmed_at = COALESCE(EXCLUDED.confirmed_at, payments.confirmed_at),
       note = COALESCE(EXCLUDED.note, payments.note),
       slip_image_url = COALESCE(NULLIF(EXCLUDED.slip_image_url, ''), payments.slip_image_url),
       slip_uploaded_at = COALESCE(EXCLUDED.slip_uploaded_at, payments.slip_uploaded_at),
       updated_at = NOW()
     RETURNING id, mongo_payment_id, status, amount`,
    [
      mongoPaymentId,
      sqlSession.id,
      mongoSessionId,
      Number(p.amount || 0),
      p.method || 'cash',
      p.cashReceived !== undefined && p.cashReceived !== null ? Number(p.cashReceived) : null,
      Number(p.changeDue || 0),
      p.status || 'pending',
      p.paidAt || null,
      receiver.uuid,
      receiver.ref,
      confirmer.uuid,
      confirmer.ref,
      p.confirmedAt || null,
      p.note || '',
      p.slipImageUrl || p.slip_image_url || '',
      p.slipUploadedAt || p.slip_uploaded_at || null,
      p.createdAt || p.paidAt || new Date(),
    ]
  );

  return res.rows[0] || null;
}

async function ensureSqlSession(mongoSessionId, fallback = {}) {
  const existing = await sessionModel.findByMongoId(String(mongoSessionId));
  if (existing) return existing;

  const synced = await syncSessionFromMongo({
    _id: String(mongoSessionId),
    queueId: fallback.queueId ? String(fallback.queueId) : null,
    tableId: fallback.tableId ? String(fallback.tableId) : 'unknown',
    customerCount: Number(fallback.customerCount || 1),
    diningStyle: fallback.diningStyle || 'alacarte',
    startTime: fallback.startTime || new Date(),
    endTime: fallback.endTime || new Date(),
    status: fallback.status || 'active',
    buffetPackageCode: fallback.buffetPackageCode || '',
    buffetPackageName: fallback.buffetPackageName || '',
    buffetPricePerPerson: Number(fallback.buffetPricePerPerson || 0),
    hasRefillDrink: Boolean(fallback.hasRefillDrink),
    refillPricePerPerson: Number(fallback.refillPricePerPerson || 0),
  });
  return synced;
}

async function createSqlSession({
  mongoSessionId,
  queueId,
  tableId,
  customerCount,
  diningStyle,
  endTime,
  buffetData = {},
}) {
  return ensureSqlSession(mongoSessionId, {
    queueId,
    tableId,
    customerCount,
    diningStyle,
    endTime,
    ...buffetData,
  });
}

async function getSqlSessionByMongoId(mongoSessionId) {
  return await sessionModel.findByMongoId(String(mongoSessionId));
}

async function createSqlOrder({ mongoSessionId, mongoOrderId = null, tableId, items, totalPrice }) {
  if (mongoOrderId) {
    return syncOrderFromMongo({
      _id: mongoOrderId,
      sessionId: mongoSessionId,
      tableId,
      items,
      totalPrice,
      status: 'pending',
    });
  }
  const sqlSession = await ensureSqlSession(mongoSessionId, { tableId });
  return await orderModel.create({
    sessionId: sqlSession.id,
    mongoOrderId: null,
    tableId: String(tableId),
    items,
    totalPrice,
  });
}

async function createSqlPayment({
  mongoPaymentId = null,
  mongoSessionId,
  amount,
  subtotal = 0,
  serviceCharge = 0,
  vat = 0,
  grandTotal,
  method = 'cash',
  cashReceived,
  changeDue = 0,
  receivedBy,
  note = '',
}) {
  const now = new Date();
  const sqlSession = await ensureSqlSession(mongoSessionId, { endTime: now });

  let payment;
  if (mongoPaymentId) {
    payment = await syncPaymentFromMongo({
      _id: mongoPaymentId,
      sessionId: mongoSessionId,
      amount,
      method,
      cashReceived,
      changeDue,
      status: 'completed',
      paidAt: now,
      receivedBy,
      note,
    });
  } else {
    const receiver = await resolveUserUuid(receivedBy);
    payment = await paymentModel.create({
      sessionId: sqlSession.id,
      mongoSessionId: String(mongoSessionId),
      amount,
      method,
      cashReceived,
      changeDue,
      status: 'completed',
      paidAt: now,
      receivedBy: receiver.uuid || receiver.ref,
      note,
    });
  }

  await sessionModel.markPaidByMongoId(String(mongoSessionId), {
    status: 'completed',
    actualEndTime: now,
    subtotal: Number(subtotal || 0),
    serviceCharge: Number(serviceCharge || 0),
    vat: Number(vat || 0),
    grandTotal: Number(grandTotal ?? amount ?? 0),
    isPaid: true,
    paidAt: now,
  });

  return payment;
}

async function confirmSqlQrPayment({ paymentId, mongoSessionId, confirmedBy }) {
  const now = new Date();
  const payment = await paymentModel.updateStatus(paymentId, 'completed', {
    confirmedBy,
    confirmedAt: now,
  });

  const sqlSession = await sessionModel.findByMongoId(String(mongoSessionId));
  if (sqlSession) {
    await sessionModel.markPaidByMongoId(String(mongoSessionId), {
      status: 'completed',
      actualEndTime: now,
      subtotal: Number(sqlSession.subtotal || 0),
      serviceCharge: Number(sqlSession.service_charge || 0),
      vat: Number(sqlSession.vat || 0),
      grandTotal: Number(sqlSession.grand_total || 0),
      isPaid: true,
      paidAt: now,
    });
  }

  return payment;
}

async function recordSqlPointTransaction({
  memberId,
  mongoSessionId,
  type,
  points,
  pointsBefore,
  pointsAfter,
  description,
  createdBy,
}) {
  let sqlSessionId = null;
  if (mongoSessionId) {
    const sqlSession = await sessionModel.findByMongoId(String(mongoSessionId));
    sqlSessionId = sqlSession ? sqlSession.id : null;
  }
  return await pointTransactionModel.create({
    memberId,
    sessionId: sqlSessionId,
    type,
    points,
    pointsBefore,
    pointsAfter,
    description,
    createdBy,
  });
}

async function getSqlShopSettings() {
  return await shopSettingsModel.getSettings();
}

async function updateSqlShopSettings(settings) {
  return await shopSettingsModel.updateSettings(settings);
}

async function getSqlPaymentHistory(limit = 200, sessionRef = null) {
  return await paymentModel.getHistory(limit, sessionRef);
}

module.exports = {
  syncSessionFromMongo,
  syncOrderFromMongo,
  syncPaymentFromMongo,
  ensureSqlSession,
  createSqlSession,
  getSqlSessionByMongoId,
  createSqlOrder,
  createSqlPayment,
  confirmSqlQrPayment,
  recordSqlPointTransaction,
  getSqlShopSettings,
  updateSqlShopSettings,
  getSqlPaymentHistory,
};
