const mongoose = require('mongoose');
const { querySQL } = require('../config/db.sql');
const shopSettingsModel = require('../models/sql/shopSettingsModel');
const userModel = require('../models/sql/userModel');
const { DEFAULT_TIERS } = require('./loyaltyService');
const {
  mirrorUserToMongo,
  mirrorTierToMongo,
  mirrorMemberToMongo,
  mirrorPointTxToMongo,
} = require('./sqlToMongoMirror');

const MIGRATION_MARKER = 'full_mirror_v1';

async function collectionExists(db, name) {
  const list = await db.listCollections({ name }).toArray();
  return list.length > 0;
}

async function readCollectionDocs(db, name) {
  if (!(await collectionExists(db, name))) return [];
  return db.collection(name).find({}).toArray();
}

async function countCollectionDocs(db, name) {
  if (!(await collectionExists(db, name))) return 0;
  return db.collection(name).countDocuments({});
}

function buildMultiInsertPlaceholders(rowCount, colCount) {
  const groups = [];
  for (let r = 0; r < rowCount; r += 1) {
    const cols = [];
    for (let c = 1; c <= colCount; c += 1) {
      cols.push(`$${r * colCount + c}`);
    }
    groups.push(`(${cols.join(', ')})`);
  }
  return groups.join(', ');
}

function dedupeByKey(list, keyFn) {
  const map = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const key = keyFn(list[i], i);
    if (key) map.set(String(key), list[i]);
  }
  return [...map.values()];
}

function toStr(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && val._id !== undefined) return String(val._id);
  const s = String(val).trim();
  return s || null;
}

async function getMirrorParitySummary() {
  if (!process.env.DATABASE_URL || mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return null;
  }
  const db = mongoose.connection.db;

  const [
    sqlRes,
    mUsers,
    mTiers,
    mMembers,
    mPointTxs,
    mSettings,
    mSessions,
    mOrders,
    mPayments,
    mTables,
    mQueues,
    mQueueCounters,
    mMenus,
    mPromotions,
    mFeedbacks,
    mAuditLogs,
  ] = await Promise.all([
    querySQL(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM membership_tiers) AS membership_tiers,
        (SELECT COUNT(*)::int FROM members) AS members,
        (SELECT COUNT(*)::int FROM point_transactions) AS point_transactions,
        (SELECT COUNT(*)::int FROM shop_settings) AS shop_settings,
        (SELECT COUNT(*)::int FROM sessions) AS sessions,
        (SELECT COUNT(*)::int FROM orders) AS orders,
        (SELECT COUNT(*)::int FROM order_items) AS order_items,
        (SELECT COUNT(*)::int FROM payments) AS payments,
        (SELECT COUNT(*)::int FROM tables) AS tables,
        (SELECT COUNT(*)::int FROM queues) AS queues,
        (SELECT COUNT(*)::int FROM queue_counters) AS queue_counters,
        (SELECT COUNT(*)::int FROM menus) AS menus,
        (SELECT COUNT(*)::int FROM promotions) AS promotions,
        (SELECT COUNT(*)::int FROM feedbacks) AS feedbacks,
        (SELECT COUNT(*)::int FROM audit_logs) AS audit_logs
    `),
    countCollectionDocs(db, 'users'),
    countCollectionDocs(db, 'membershiptiers'),
    countCollectionDocs(db, 'members'),
    countCollectionDocs(db, 'pointtransactions'),
    countCollectionDocs(db, 'shopsettings'),
    countCollectionDocs(db, 'sessions'),
    countCollectionDocs(db, 'orders'),
    countCollectionDocs(db, 'payments'),
    countCollectionDocs(db, 'tables'),
    countCollectionDocs(db, 'queues'),
    countCollectionDocs(db, 'queuecounters'),
    countCollectionDocs(db, 'menus'),
    countCollectionDocs(db, 'promotions'),
    countCollectionDocs(db, 'feedbacks'),
    countCollectionDocs(db, 'auditlogs'),
  ]);

  const s = sqlRes.rows[0] || {};
  const mongodb = {
    users: mUsers,
    membershiptiers: mTiers,
    members: mMembers,
    pointtransactions: mPointTxs,
    shopsettings: mSettings,
    sessions: mSessions,
    orders: mOrders,
    payments: mPayments,
    tables: mTables,
    queues: mQueues,
    queuecounters: mQueueCounters,
    menus: mMenus,
    promotions: mPromotions,
    feedbacks: mFeedbacks,
    auditlogs: mAuditLogs,
  };
  const postgresql = {
    users: Number(s.users || 0),
    membership_tiers: Number(s.membership_tiers || 0),
    members: Number(s.members || 0),
    point_transactions: Number(s.point_transactions || 0),
    shop_settings: Number(s.shop_settings || 0),
    sessions: Number(s.sessions || 0),
    orders: Number(s.orders || 0),
    order_items: Number(s.order_items || 0),
    payments: Number(s.payments || 0),
    tables: Number(s.tables || 0),
    queues: Number(s.queues || 0),
    queue_counters: Number(s.queue_counters || 0),
    menus: Number(s.menus || 0),
    promotions: Number(s.promotions || 0),
    feedbacks: Number(s.feedbacks || 0),
    audit_logs: Number(s.audit_logs || 0),
  };

  const pairs = [
    ['users', mongodb.users, postgresql.users],
    ['membership_tiers', mongodb.membershiptiers, postgresql.membership_tiers],
    ['members', mongodb.members, postgresql.members],
    ['point_transactions', mongodb.pointtransactions, postgresql.point_transactions],
    ['shop_settings', mongodb.shopsettings, postgresql.shop_settings],
    ['sessions', mongodb.sessions, postgresql.sessions],
    ['orders', mongodb.orders, postgresql.orders],
    ['payments', mongodb.payments, postgresql.payments],
    ['tables', mongodb.tables, postgresql.tables],
    ['queues', mongodb.queues, postgresql.queues],
    ['queue_counters', mongodb.queuecounters, postgresql.queue_counters],
    ['menus', mongodb.menus, postgresql.menus],
    ['promotions', mongodb.promotions, postgresql.promotions],
    ['feedbacks', mongodb.feedbacks, postgresql.feedbacks],
    ['audit_logs', mongodb.auditlogs, postgresql.audit_logs],
  ];

  const mismatches = pairs
    .filter(([, mCount, sCount]) => mCount !== sCount)
    .map(([key, mongo, sql]) => ({ key, mongo, sql }));

  return {
    allMatched: mismatches.length === 0,
    mismatches,
    mongodb,
    postgresql,
  };
}

async function migrateMongoToSql({ force = false } = {}) {
  if (!process.env.DATABASE_URL) {
    return { skipped: true, reason: 'no_database_url' };
  }
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return { skipped: true, reason: 'mongodb_not_connected' };
  }

  if (!force && global.__buffetMongoToSqlMigrated) {
    return { skipped: true, reason: 'already_migrated_in_memory' };
  }

  const markerCheck = await querySQL(
    `SELECT setting_value FROM shop_settings WHERE setting_key = 'shop-settings' LIMIT 1`
  );
  if (
    !force &&
    markerCheck.rows[0] &&
    markerCheck.rows[0].setting_value === MIGRATION_MARKER
  ) {
    global.__buffetMongoToSqlMigrated = true;
    return { skipped: true, reason: 'already_migrated_marker' };
  }

  if (global.__buffetMongoToSqlRunning && !force) {
    return global.__buffetMongoToSqlRunning;
  }

  const migrationPromise = (async () => {
    const db = mongoose.connection.db;
    const stats = {
      restoredToMongo: {
        users: 0,
        membershipTiers: 0,
        members: 0,
        pointTransactions: 0,
      },
      syncedToSql: {
        users: 0,
        membershipTiers: 0,
        members: 0,
        pointTransactions: 0,
        shopSettings: 0,
        sessions: 0,
        orders: 0,
        orderItems: 0,
        payments: 0,
        tables: 0,
        queues: 0,
        queueCounters: 0,
        menus: 0,
        promotions: 0,
        feedbacks: 0,
        auditLogs: 0,
      },
    };

    const mongoTiers = await readCollectionDocs(db, 'membershiptiers');
    const tiersToEnsure =
      mongoTiers.length > 0
        ? mongoTiers.map((t) => ({
            tierCode: String(t.tierCode || 'MEMBER').trim().toUpperCase(),
            tierName: String(t.tierName || t.tierCode || 'Member').trim(),
            discountPercent: Number(t.discountPercent) || 0,
            pointsMultiplier: Number(t.pointsMultiplier) || 1,
            minPoints: Number(t.minPoints) || 0,
          }))
        : DEFAULT_TIERS;

    const tierIdByCode = new Map();
    for (const t of tiersToEnsure) {
      const res = await querySQL(
        `INSERT INTO membership_tiers (tier_name, display_name, discount_percent, points_multiplier, min_points)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tier_name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           discount_percent = EXCLUDED.discount_percent,
           points_multiplier = EXCLUDED.points_multiplier,
           min_points = EXCLUDED.min_points,
           updated_at = NOW()
         RETURNING id, tier_name`,
        [t.tierCode, t.tierName, t.discountPercent, t.pointsMultiplier, t.minPoints]
      );
      if (res.rows[0]) {
        tierIdByCode.set(String(res.rows[0].tier_name).toUpperCase(), res.rows[0].id);
        stats.syncedToSql.membershipTiers += 1;
      }
    }

    const allSqlTiers = await querySQL(
      `SELECT id, tier_name, display_name, discount_percent, points_multiplier, min_points, created_at
       FROM membership_tiers ORDER BY min_points ASC`
    );
    for (const r of allSqlTiers.rows) {
      tierIdByCode.set(String(r.tier_name).toUpperCase(), r.id);
      await mirrorTierToMongo(r);
      stats.restoredToMongo.membershipTiers += 1;
    }

    const mongoUsers = await readCollectionDocs(db, 'users');
    for (const u of mongoUsers) {
      const username = String(u.username || '').trim();
      const passwordHash = String(u.password || '').trim();
      if (!username || !passwordHash) continue;
      const mongoId = String(u._id);
      const firstName = String(u.firstName || '').trim();
      const lastName = String(u.lastName || '').trim();
      const fullName =
        String(u.fullName || '').trim() || [firstName, lastName].filter(Boolean).join(' ').trim();

      await querySQL(
        `INSERT INTO users (
           mongo_id, username, password_hash, prefix, first_name, last_name,
           full_name, nickname, age, phone, role, is_active, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (username) DO UPDATE SET
           mongo_id = COALESCE(users.mongo_id, EXCLUDED.mongo_id),
           updated_at = NOW()`,
        [
          mongoId,
          username,
          passwordHash,
          String(u.prefix || '').slice(0, 30),
          firstName.slice(0, 80),
          lastName.slice(0, 80),
          fullName.slice(0, 150),
          String(u.nickname || '').slice(0, 60),
          u.age !== null && u.age !== undefined ? Number(u.age) : null,
          String(u.phone || '').slice(0, 20),
          String(u.role || 'waiter'),
          u.isActive !== false,
          u.createdAt || new Date(),
          u.updatedAt || new Date(),
        ]
      );
      stats.syncedToSql.users += 1;
    }

    const sqlUsersRes = await querySQL(
      `SELECT id, mongo_id, username, password_hash, prefix, first_name, last_name,
              full_name, nickname, age, phone, role, is_active, created_at, updated_at
       FROM users ORDER BY created_at ASC`
    );
    const userUuidByRef = new Map();
    for (const r of sqlUsersRes.rows) {
      const mirroredMongoId = await mirrorUserToMongo(r);
      const effectiveMongoId = r.mongo_id || mirroredMongoId;
      userUuidByRef.set(String(r.id), r.id);
      if (effectiveMongoId) userUuidByRef.set(String(effectiveMongoId), r.id);
      if (r.username) userUuidByRef.set(String(r.username), r.id);
      stats.restoredToMongo.users += 1;
    }

    const mongoMembers = await readCollectionDocs(db, 'members');
    for (const m of mongoMembers) {
      const mongoId = String(m._id);
      const memberCode = String(m.memberCode || `MB${mongoId.slice(-6).toUpperCase()}`).trim();
      const phone = String(m.phone || '').trim();
      if (!phone) continue;

      const tierCode = String(m.tierCode || 'MEMBER').trim().toUpperCase();
      const tierId = tierIdByCode.get(tierCode) || tierIdByCode.get('MEMBER') || null;
      const existing = await querySQL(
        `SELECT id FROM members WHERE mongo_id = $1 OR phone = $2 OR member_id = $3 LIMIT 1`,
        [mongoId, phone, memberCode]
      );
      if (!existing.rows[0]) {
        await querySQL(
          `INSERT INTO members (
             mongo_id, member_id, phone, prefix, full_name, nickname, age, email,
             tier_id, tier_name, points_balance, lifetime_points, total_spent,
             visit_count, is_active, registered_via, created_by, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            mongoId,
            memberCode,
            phone,
            String(m.prefix || '').slice(0, 30),
            String(m.fullName || 'ลูกค้าสมาชิก').slice(0, 150),
            String(m.nickname || '').slice(0, 60),
            m.age !== null && m.age !== undefined ? Number(m.age) : null,
            String(m.email || '').slice(0, 150),
            tierId,
            tierCode,
            Number(m.currentPoints) || 0,
            Number(m.lifetimePoints) || 0,
            Number(m.totalSpent) || 0,
            Number(m.visitCount) || 0,
            m.isActive !== false,
            String(m.registeredVia || 'admin').slice(0, 30),
            String(m.createdBy || 'system').slice(0, 100),
            m.createdAt || new Date(),
            m.updatedAt || new Date(),
          ]
        );
        stats.syncedToSql.members += 1;
      }
    }

    const sqlMembersRes = await querySQL(
      `SELECT id, mongo_id, member_id, phone, prefix, full_name, nickname, age, email,
              tier_id, tier_name, points_balance, lifetime_points, total_spent,
              visit_count, is_active, registered_via, created_by, created_at, updated_at
       FROM members ORDER BY created_at ASC`
    );
    const memberUuidByMongoId = new Map();
    const memberMongoIdByUuid = new Map();
    for (const r of sqlMembersRes.rows) {
      const mirroredMongoId = await mirrorMemberToMongo(r);
      const effectiveMongoId = r.mongo_id || mirroredMongoId;
      if (effectiveMongoId) {
        memberUuidByMongoId.set(String(effectiveMongoId), r.id);
        memberMongoIdByUuid.set(String(r.id), String(effectiveMongoId));
      }
      stats.restoredToMongo.members += 1;
    }

    const mongoSettingsDocs = await readCollectionDocs(db, 'shopsettings');
    const mongoSettings =
      mongoSettingsDocs.find((d) => String(d._id) === 'shop-settings') || mongoSettingsDocs[0];
    if (mongoSettings) {
      await shopSettingsModel.updateSettings({
        restaurantName: mongoSettings.restaurantName,
        welcomeMessage: mongoSettings.welcomeMessage,
        phone: mongoSettings.phone,
        address: mongoSettings.address,
        openTime: mongoSettings.openTime,
        closeTime: mongoSettings.closeTime,
        lastQueueTime: mongoSettings.lastQueueTime,
        timezone: mongoSettings.timezone,
        isTestMode: Boolean(mongoSettings.isTestMode),
        diningDurationMinutes: mongoSettings.diningDurationMinutes,
        logoUrl: mongoSettings.logoUrl,
        heroImageUrl: mongoSettings.heroImageUrl,
        vatPercent: mongoSettings.vatPercent,
        serviceChargePercent: mongoSettings.serviceChargePercent,
        vatMode: mongoSettings.vatMode,
        serviceChargeMode: mongoSettings.serviceChargeMode,
        buffetSignaturePrice: mongoSettings.buffetSignaturePrice,
        buffetPremiumPrice: mongoSettings.buffetPremiumPrice,
        buffetDeluxePrice: mongoSettings.buffetDeluxePrice,
        refillDrinkPrice: mongoSettings.refillDrinkPrice,
        promptPayId: mongoSettings.promptPayId || '',
        paymentQrImageUrl: mongoSettings.paymentQrImageUrl || '',
      });
      stats.syncedToSql.shopSettings = 1;
    }

    const rawMongoSessions = await readCollectionDocs(db, 'sessions');
    const mongoSessions = dedupeByKey(rawMongoSessions, (s) => s && s._id && String(s._id));
    const SESSION_BATCH = 40;
    for (let i = 0; i < mongoSessions.length; i += SESSION_BATCH) {
      const batch = mongoSessions.slice(i, i + SESSION_BATCH);
      const values = [];
      for (const s of batch) {
        const mongoId = String(s._id);
        const mappedMemberId =
          s.memberId && memberUuidByMongoId.has(String(s.memberId))
            ? String(memberUuidByMongoId.get(String(s.memberId)))
            : s.memberId
              ? String(s.memberId)
              : null;
        values.push(
          mongoId,
          s.queueId ? String(s.queueId) : null,
          s.tableId ? String(s.tableId) : 'unknown',
          Number(s.customerCount || 1),
          String(s.diningStyle || 'alacarte').slice(0, 20),
          String(s.buffetPackageCode || '').slice(0, 100),
          String(s.buffetPackageName || '').slice(0, 150),
          Number(s.buffetPricePerPerson || 0),
          Boolean(s.hasRefillDrink),
          Number(s.refillPricePerPerson || 0),
          s.startTime || s.createdAt || new Date(),
          s.endTime || s.startTime || s.createdAt || new Date(),
          s.actualEndTime || null,
          s.checkoutRequestedAt || null,
          String(s.status || 'active').slice(0, 20),
          Number(s.subtotal || 0),
          Number(s.serviceCharge || 0),
          Number(s.vat || 0),
          Number(s.discount || 0),
          Number(s.grandTotal || 0),
          Boolean(s.isPaid),
          s.paidAt || null,
          mappedMemberId,
          s.memberPhone ? String(s.memberPhone).slice(0, 20) : null,
          s.memberName ? String(s.memberName).slice(0, 150) : null,
          s.memberTierName ? String(s.memberTierName).slice(0, 50) : null,
          String(s.benefitType || '').slice(0, 20),
          s.appliedPromotionId ? String(s.appliedPromotionId) : null,
          s.appliedPromoCode ? String(s.appliedPromoCode).slice(0, 50) : null,
          s.appliedPromoTitle ? String(s.appliedPromoTitle).slice(0, 150) : null,
          Number(s.pointsToRedeem || 0),
          Number(s.pointsEarned || 0),
          s.loyaltyProcessedAt || null,
          s.createdAt || s.startTime || new Date()
        );
      }

      const placeholders = buildMultiInsertPlaceholders(batch.length, 34);
      await querySQL(
        `INSERT INTO sessions (
           mongo_session_id, queue_id, table_id, customer_count, dining_style,
           buffet_package_code, buffet_package_name, buffet_price_per_person,
           has_refill_drink, refill_price_per_person,
           start_time, end_time, actual_end_time, checkout_requested_at, status,
           subtotal, service_charge, vat, discount, grand_total,
           is_paid, paid_at,
           member_id, member_phone, member_name, member_tier_name,
           benefit_type, applied_promotion_id, applied_promo_code, applied_promo_title,
           points_to_redeem, points_earned, loyalty_processed_at, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (mongo_session_id) DO UPDATE SET
           status = EXCLUDED.status,
           actual_end_time = COALESCE(EXCLUDED.actual_end_time, sessions.actual_end_time),
           checkout_requested_at = EXCLUDED.checkout_requested_at,
           subtotal = EXCLUDED.subtotal,
           service_charge = EXCLUDED.service_charge,
           vat = EXCLUDED.vat,
           discount = EXCLUDED.discount,
           grand_total = EXCLUDED.grand_total,
           is_paid = EXCLUDED.is_paid,
           paid_at = COALESCE(EXCLUDED.paid_at, sessions.paid_at),
           member_id = COALESCE(EXCLUDED.member_id, sessions.member_id),
           member_phone = COALESCE(EXCLUDED.member_phone, sessions.member_phone),
           member_name = COALESCE(EXCLUDED.member_name, sessions.member_name),
           member_tier_name = COALESCE(EXCLUDED.member_tier_name, sessions.member_tier_name),
           benefit_type = EXCLUDED.benefit_type,
           applied_promotion_id = EXCLUDED.applied_promotion_id,
           applied_promo_code = EXCLUDED.applied_promo_code,
           applied_promo_title = EXCLUDED.applied_promo_title,
           points_to_redeem = EXCLUDED.points_to_redeem,
           points_earned = EXCLUDED.points_earned,
           loyalty_processed_at = COALESCE(EXCLUDED.loyalty_processed_at, sessions.loyalty_processed_at),
           updated_at = NOW()`,
        values
      );
      stats.syncedToSql.sessions += batch.length;
    }

    if (mongoSessions.length > 0) {
      await querySQL(`DELETE FROM sessions WHERE NOT (mongo_session_id = ANY($1))`, [
        mongoSessions.map((s) => String(s._id)),
      ]);
    }

    const sessionRowsRes = await querySQL(
      `SELECT id, mongo_session_id FROM sessions WHERE mongo_session_id IS NOT NULL`
    );
    const sessionUuidByMongoId = new Map(
      sessionRowsRes.rows.map((r) => [String(r.mongo_session_id), r.id])
    );

    const ensureStubSession = async (mongoSid, fallbackDate, fallbackTable) => {
      if (sessionUuidByMongoId.has(mongoSid)) return sessionUuidByMongoId.get(mongoSid);
      const stubRes = await querySQL(
        `INSERT INTO sessions (mongo_session_id, table_id, start_time, end_time, status)
         VALUES ($1, $2, $3, $3, 'completed')
         ON CONFLICT (mongo_session_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [mongoSid, fallbackTable || 'unknown', fallbackDate || new Date()]
      );
      const id = stubRes.rows[0].id;
      sessionUuidByMongoId.set(mongoSid, id);
      return id;
    };

    const mongoOrders = await readCollectionDocs(db, 'orders');
    for (const o of mongoOrders) {
      const mSid = String(o.sessionId || '');
      if (mSid && !sessionUuidByMongoId.has(mSid)) {
        await ensureStubSession(mSid, o.createdAt, o.tableId ? String(o.tableId) : 'unknown');
      }
    }

    const validOrders = dedupeByKey(
      mongoOrders.filter((o) => o._id && o.sessionId && sessionUuidByMongoId.has(String(o.sessionId))),
      (o) => String(o._id)
    );
    const ORDER_BATCH = 50;
    for (let i = 0; i < validOrders.length; i += ORDER_BATCH) {
      const batch = validOrders.slice(i, i + ORDER_BATCH);
      const values = [];
      for (const o of batch) {
        values.push(
          String(o._id),
          sessionUuidByMongoId.get(String(o.sessionId)),
          o.tableId ? String(o.tableId) : 'unknown',
          Number(o.totalPrice || 0),
          String(o.status || 'pending').slice(0, 20),
          o.acceptedAt || null,
          o.cookingAt || null,
          o.readyAt || null,
          o.servedAt || null,
          o.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(batch.length, 10);
      await querySQL(
        `INSERT INTO orders (
           mongo_order_id, session_id, table_id, total_price, status,
           accepted_at, cooking_at, ready_at, served_at, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (mongo_order_id) DO UPDATE SET
           total_price = EXCLUDED.total_price,
           status = EXCLUDED.status,
           accepted_at = COALESCE(EXCLUDED.accepted_at, orders.accepted_at),
           cooking_at = COALESCE(EXCLUDED.cooking_at, orders.cooking_at),
           ready_at = COALESCE(EXCLUDED.ready_at, orders.ready_at),
           served_at = COALESCE(EXCLUDED.served_at, orders.served_at),
           updated_at = NOW()`,
        values
      );
      stats.syncedToSql.orders += batch.length;
    }

    if (validOrders.length > 0) {
      await querySQL(`DELETE FROM orders WHERE NOT (mongo_order_id = ANY($1))`, [
        validOrders.map((o) => String(o._id)),
      ]);
    }

    const orderRowsRes = await querySQL(
      `SELECT id, mongo_order_id FROM orders WHERE mongo_order_id IS NOT NULL`
    );
    const orderUuidByMongoId = new Map(
      orderRowsRes.rows.map((r) => [String(r.mongo_order_id), r.id])
    );

    const allItems = [];
    for (const o of validOrders) {
      const sqlOrderId = orderUuidByMongoId.get(String(o._id));
      if (!sqlOrderId || !Array.isArray(o.items)) continue;
      for (let idx = 0; idx < o.items.length; idx += 1) {
        const it = o.items[idx];
        allItems.push({
          mongoItemId: it._id ? String(it._id) : `${String(o._id)}:${idx}`,
          orderId: sqlOrderId,
          menuId: it.menuId ? String(it.menuId) : null,
          name: String(it.name || 'Item').slice(0, 200),
          price: Number(it.price || 0),
          quantity: Math.max(1, Number(it.quantity || 1)),
          note: it.note ? String(it.note) : null,
          itemStatus: String(it.itemStatus || 'pending').slice(0, 20),
          createdAt: o.createdAt || new Date(),
        });
      }
    }

    const dedupedItems = dedupeByKey(allItems, (it) => it.mongoItemId);
    const ITEM_BATCH = 80;
    for (let i = 0; i < dedupedItems.length; i += ITEM_BATCH) {
      const batch = dedupedItems.slice(i, i + ITEM_BATCH);
      const values = [];
      for (const it of batch) {
        values.push(
          it.mongoItemId,
          it.orderId,
          it.menuId,
          it.name,
          it.price,
          it.quantity,
          it.note,
          it.itemStatus,
          it.createdAt
        );
      }
      const placeholders = buildMultiInsertPlaceholders(batch.length, 9);
      await querySQL(
        `INSERT INTO order_items (
           mongo_item_id, order_id, menu_id, name, price, quantity, note, item_status, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (mongo_item_id) DO UPDATE SET
           price = EXCLUDED.price,
           quantity = EXCLUDED.quantity,
           note = EXCLUDED.note,
           item_status = EXCLUDED.item_status,
           updated_at = NOW()`,
        values
      );
      stats.syncedToSql.orderItems += batch.length;
    }

    if (dedupedItems.length > 0) {
      await querySQL(`DELETE FROM order_items WHERE NOT (mongo_item_id = ANY($1))`, [
        dedupedItems.map((it) => it.mongoItemId),
      ]);
    }

    const mongoPayments = await readCollectionDocs(db, 'payments');
    for (const p of mongoPayments) {
      const mSid = String(p.sessionId || '');
      if (mSid && !sessionUuidByMongoId.has(mSid)) {
        await ensureStubSession(mSid, p.paidAt || p.createdAt, 'unknown');
      }
    }

    const validPayments = dedupeByKey(
      mongoPayments.filter(
        (p) => p._id && p.sessionId && sessionUuidByMongoId.has(String(p.sessionId))
      ),
      (p) => String(p._id)
    );
    const PAYMENT_BATCH = 50;
    for (let i = 0; i < validPayments.length; i += PAYMENT_BATCH) {
      const batch = validPayments.slice(i, i + PAYMENT_BATCH);
      const values = [];
      for (const p of batch) {
        const recRef = p.receivedBy ? String(p.receivedBy) : null;
        const confRef = p.confirmedBy ? String(p.confirmedBy) : null;
        const recUuid =
          recRef && userUuidByRef.has(recRef)
            ? userUuidByRef.get(recRef)
            : recRef && userModel.isUuid(recRef)
              ? recRef
              : null;
        const confUuid =
          confRef && userUuidByRef.has(confRef)
            ? userUuidByRef.get(confRef)
            : confRef && userModel.isUuid(confRef)
              ? confRef
              : null;

        values.push(
          String(p._id),
          sessionUuidByMongoId.get(String(p.sessionId)),
          String(p.sessionId),
          Number(p.amount || 0),
          String(p.method || 'cash').slice(0, 20),
          p.cashReceived !== undefined && p.cashReceived !== null ? Number(p.cashReceived) : null,
          Number(p.changeDue || 0),
          String(p.status || 'pending').slice(0, 30),
          p.paidAt || null,
          recUuid,
          recRef,
          confUuid,
          confRef,
          p.confirmedAt || null,
          String(p.note || ''),
          String(p.slipImageUrl || ''),
          p.slipUploadedAt || null,
          p.createdAt || p.paidAt || new Date()
        );
      }

      const placeholders = buildMultiInsertPlaceholders(batch.length, 18);
      await querySQL(
        `INSERT INTO payments (
           mongo_payment_id, session_id, mongo_session_id,
           amount, method, cash_received, change_due, status, paid_at,
           received_by, received_by_ref, confirmed_by, confirmed_by_ref, confirmed_at,
           note, slip_image_url, slip_uploaded_at, created_at
         )
         VALUES ${placeholders}
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
           updated_at = NOW()`,
        values
      );
      stats.syncedToSql.payments += batch.length;
    }

    if (validPayments.length > 0) {
      await querySQL(`DELETE FROM payments WHERE NOT (mongo_payment_id = ANY($1))`, [
        validPayments.map((p) => String(p._id)),
      ]);
    }

    const mongoPointTxs = await readCollectionDocs(db, 'pointtransactions');
    const validPointTxs = dedupeByKey(
      mongoPointTxs.filter(
        (pt) => pt._id && pt.memberId && memberUuidByMongoId.has(String(pt.memberId))
      ),
      (pt) => String(pt._id)
    );
    const PT_BATCH = 50;
    for (let i = 0; i < validPointTxs.length; i += PT_BATCH) {
      const batch = validPointTxs.slice(i, i + PT_BATCH);
      const values = [];
      for (const pt of batch) {
        const sessionRef = String(pt.sessionRef || '').trim();
        const sqlSessionId = sessionRef ? sessionUuidByMongoId.get(sessionRef) || null : null;
        values.push(
          String(pt._id),
          memberUuidByMongoId.get(String(pt.memberId)),
          sqlSessionId,
          sessionRef,
          pt.promotionId ? String(pt.promotionId) : null,
          String(pt.transactionType || pt.type || 'ADJUST').toUpperCase(),
          Number(pt.pointsDelta ?? pt.points ?? 0),
          Number(pt.discountAmount || 0),
          Number(pt.billAmount || 0),
          String(pt.note || pt.description || ''),
          String(pt.createdBy || 'system'),
          pt.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(batch.length, 12);
      await querySQL(
        `INSERT INTO point_transactions (
           mongo_id, member_id, session_id, session_ref, promotion_id,
           type, points, discount_amount, bill_amount, description, created_by_ref, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (mongo_id) DO NOTHING`,
        values
      );
      stats.syncedToSql.pointTransactions += batch.length;
    }

    const sqlPointTxsRes = await querySQL(
      `SELECT id, mongo_id, member_id, session_ref, promotion_id, type, points,
              discount_amount, bill_amount, description, created_by_ref, created_at
       FROM point_transactions ORDER BY created_at ASC`
    );
    for (const tx of sqlPointTxsRes.rows) {
      const memberMongoId = memberMongoIdByUuid.get(String(tx.member_id)) || null;
      await mirrorPointTxToMongo(tx, memberMongoId);
      stats.restoredToMongo.pointTransactions += 1;
    }

    const mongoTables = dedupeByKey(
      (await readCollectionDocs(db, 'tables')).filter((t) => t._id && t.tableNumber),
      (t) => String(t.tableNumber).trim()
    );
    if (mongoTables.length > 0) {
      const values = [];
      for (const t of mongoTables) {
        values.push(
          String(t._id),
          String(t.tableNumber).trim().slice(0, 50),
          Number(t.capacity || 2),
          Number(t.minCapacity || 1),
          String(t.zone || 'small').slice(0, 30),
          String(t.status || 'available').slice(0, 30),
          toStr(t.currentSessionId),
          toStr(t.reservedForQueueId),
          toStr(t.lastSessionId),
          t.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(mongoTables.length, 10);
      await querySQL(
        `INSERT INTO tables (
           mongo_id, table_number, capacity, min_capacity, zone, status,
           current_session_id, reserved_for_queue_id, last_session_id, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (table_number) DO UPDATE SET
           mongo_id = EXCLUDED.mongo_id,
           capacity = EXCLUDED.capacity,
           min_capacity = EXCLUDED.min_capacity,
           zone = EXCLUDED.zone,
           status = EXCLUDED.status,
           current_session_id = EXCLUDED.current_session_id,
           reserved_for_queue_id = EXCLUDED.reserved_for_queue_id,
           last_session_id = EXCLUDED.last_session_id,
           updated_at = NOW()`,
        values
      );
      await querySQL(`DELETE FROM tables WHERE NOT (mongo_id = ANY($1))`, [
        mongoTables.map((t) => String(t._id)),
      ]);
      stats.syncedToSql.tables = mongoTables.length;
    } else {
      await querySQL(`DELETE FROM tables`);
    }

    const mongoQueues = dedupeByKey(
      (await readCollectionDocs(db, 'queues')).filter((q) => q._id),
      (q) => String(q._id)
    );
    const QUEUE_BATCH = 40;
    for (let i = 0; i < mongoQueues.length; i += QUEUE_BATCH) {
      const batch = mongoQueues.slice(i, i + QUEUE_BATCH);
      const values = [];
      for (const q of batch) {
        values.push(
          String(q._id),
          String(q.queueNumber || 'Q000').slice(0, 30),
          q.businessDate ? String(q.businessDate).slice(0, 20) : null,
          q.sequence !== undefined && q.sequence !== null ? Number(q.sequence) : null,
          Number(q.customerCount || 1),
          String(q.diningStyle || 'alacarte').slice(0, 20),
          String(q.buffetPackageCode || '').slice(0, 100),
          Boolean(q.hasRefillDrink),
          String(q.customerName || '').slice(0, 150),
          String(q.customerPhone || '').slice(0, 30),
          toStr(q.memberId),
          q.accessTokenHash ? String(q.accessTokenHash) : null,
          String(q.status || 'waiting').slice(0, 30),
          q.preferredZone ? String(q.preferredZone).slice(0, 30) : null,
          toStr(q.preferredTableId),
          q.autoAssign !== false,
          toStr(q.assignedTableId),
          String(q.assignmentNote || ''),
          q.qrCodeData ? String(q.qrCodeData) : null,
          q.calledAt || null,
          q.seatedAt || null,
          q.completedAt || null,
          q.noShowAt || null,
          toStr(q.tableId),
          toStr(q.sessionId),
          q.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(batch.length, 26);
      await querySQL(
        `INSERT INTO queues (
           mongo_id, queue_number, business_date, sequence, customer_count,
           dining_style, buffet_package_code, has_refill_drink,
           customer_name, customer_phone, member_id, access_token_hash,
           status, preferred_zone, preferred_table_id, auto_assign,
           assigned_table_id, assignment_note, qr_code_data,
           called_at, seated_at, completed_at, no_show_at,
           table_id, session_id, created_at
         )
         VALUES ${placeholders}
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
        values
      );
      stats.syncedToSql.queues += batch.length;
    }
    if (mongoQueues.length > 0) {
      await querySQL(`DELETE FROM queues WHERE NOT (mongo_id = ANY($1))`, [
        mongoQueues.map((q) => String(q._id)),
      ]);
    } else {
      await querySQL(`DELETE FROM queues`);
    }

    const mongoQueueCounters = dedupeByKey(
      (await readCollectionDocs(db, 'queuecounters')).filter((c) => c._id !== undefined),
      (c) => String(c._id)
    );
    if (mongoQueueCounters.length > 0) {
      const values = [];
      for (const c of mongoQueueCounters) {
        values.push(String(c._id).slice(0, 150), Number(c.sequence || 0));
      }
      const placeholders = buildMultiInsertPlaceholders(mongoQueueCounters.length, 2);
      await querySQL(
        `INSERT INTO queue_counters (counter_id, sequence)
         VALUES ${placeholders}
         ON CONFLICT (counter_id) DO UPDATE SET
           sequence = EXCLUDED.sequence,
           updated_at = NOW()`,
        values
      );
      await querySQL(`DELETE FROM queue_counters WHERE NOT (counter_id = ANY($1))`, [
        mongoQueueCounters.map((c) => String(c._id)),
      ]);
      stats.syncedToSql.queueCounters = mongoQueueCounters.length;
    } else {
      await querySQL(`DELETE FROM queue_counters`);
    }

    const mongoMenus = dedupeByKey(
      (await readCollectionDocs(db, 'menus')).filter((m) => m._id),
      (m) => String(m._id)
    );
    const MENU_BATCH = 50;
    for (let i = 0; i < mongoMenus.length; i += MENU_BATCH) {
      const batch = mongoMenus.slice(i, i + MENU_BATCH);
      const values = [];
      for (const m of batch) {
        values.push(
          String(m._id),
          String(m.name || '').slice(0, 200),
          String(m.description || ''),
          Number(m.price || 0),
          String(m.category || '').slice(0, 100),
          String(m.buffetTier || 'auto').slice(0, 40),
          String(m.imageUrl || '/assets/images/default-food.jpg'),
          m.isAvailable !== false,
          Number(m.preparationTime ?? 10),
          m.stockQuantity !== null && m.stockQuantity !== undefined ? Number(m.stockQuantity) : null,
          Number(m.lowStockThreshold ?? 5),
          Number(m.maxOrderQuantity ?? 99),
          m.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(batch.length, 13);
      await querySQL(
        `INSERT INTO menus (
           mongo_id, name, description, price, category, buffet_tier, image_url,
           is_available, preparation_time, stock_quantity, low_stock_threshold,
           max_order_quantity, created_at
         )
         VALUES ${placeholders}
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
        values
      );
      stats.syncedToSql.menus += batch.length;
    }
    if (mongoMenus.length > 0) {
      await querySQL(`DELETE FROM menus WHERE NOT (mongo_id = ANY($1))`, [
        mongoMenus.map((m) => String(m._id)),
      ]);
    } else {
      await querySQL(`DELETE FROM menus`);
    }

    const mongoPromos = dedupeByKey(
      (await readCollectionDocs(db, 'promotions')).filter((p) => p._id && p.promoCode),
      (p) => String(p.promoCode).trim().toUpperCase()
    );
    if (mongoPromos.length > 0) {
      const values = [];
      for (const p of mongoPromos) {
        values.push(
          String(p._id),
          String(p.promoCode).trim().toUpperCase().slice(0, 50),
          String(p.title || '').slice(0, 200),
          String(p.description || ''),
          String(p.discountType || 'FIXED').slice(0, 20),
          Number(p.discountValue || 0),
          Number(p.pointsCost || 0),
          Number(p.minSpend || 0),
          p.maxDiscount !== null && p.maxDiscount !== undefined ? Number(p.maxDiscount) : null,
          p.isActive !== false,
          p.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(mongoPromos.length, 11);
      await querySQL(
        `INSERT INTO promotions (
           mongo_id, promo_code, title, description, discount_type, discount_value,
           points_cost, min_spend, max_discount, is_active, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (promo_code) DO UPDATE SET
           mongo_id = EXCLUDED.mongo_id,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           discount_type = EXCLUDED.discount_type,
           discount_value = EXCLUDED.discount_value,
           points_cost = EXCLUDED.points_cost,
           min_spend = EXCLUDED.min_spend,
           max_discount = EXCLUDED.max_discount,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
        values
      );
      await querySQL(`DELETE FROM promotions WHERE NOT (mongo_id = ANY($1))`, [
        mongoPromos.map((p) => String(p._id)),
      ]);
      stats.syncedToSql.promotions = mongoPromos.length;
    } else {
      await querySQL(`DELETE FROM promotions`);
    }

    const mongoFeedbacks = dedupeByKey(
      (await readCollectionDocs(db, 'feedbacks')).filter((f) => f._id),
      (f) => String(f._id)
    );
    if (mongoFeedbacks.length > 0) {
      const values = [];
      for (const f of mongoFeedbacks) {
        const mSid = toStr(f.sessionId);
        const sqlSid = mSid && sessionUuidByMongoId.has(mSid) ? sessionUuidByMongoId.get(mSid) : null;
        values.push(
          String(f._id),
          sqlSid,
          mSid,
          toStr(f.tableId),
          Number(f.rating || 5),
          String(f.comment || ''),
          f.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(mongoFeedbacks.length, 7);
      await querySQL(
        `INSERT INTO feedbacks (
           mongo_id, session_id, mongo_session_id, table_id, rating, comment, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (mongo_id) DO UPDATE SET
           rating = EXCLUDED.rating,
           comment = EXCLUDED.comment,
           updated_at = NOW()`,
        values
      );
      await querySQL(`DELETE FROM feedbacks WHERE NOT (mongo_id = ANY($1))`, [
        mongoFeedbacks.map((f) => String(f._id)),
      ]);
      stats.syncedToSql.feedbacks = mongoFeedbacks.length;
    } else {
      await querySQL(`DELETE FROM feedbacks`);
    }

    const mongoAuditLogs = dedupeByKey(
      (await readCollectionDocs(db, 'auditlogs')).filter((a) => a._id),
      (a) => String(a._id)
    );
    const AUDIT_BATCH = 60;
    for (let i = 0; i < mongoAuditLogs.length; i += AUDIT_BATCH) {
      const batch = mongoAuditLogs.slice(i, i + AUDIT_BATCH);
      const values = [];
      for (const a of batch) {
        values.push(
          String(a._id),
          String(a.action || 'unknown').slice(0, 100),
          toStr(a.actorId),
          String(a.actorUsername || 'anonymous').slice(0, 100),
          String(a.actorRole || '').slice(0, 40),
          String(a.ip || '').slice(0, 100),
          String(a.targetType || '').slice(0, 60),
          String(a.targetId || '').slice(0, 100),
          String(a.summary || ''),
          a.metadata ? JSON.stringify(a.metadata) : null,
          a.createdAt || new Date()
        );
      }
      const placeholders = buildMultiInsertPlaceholders(batch.length, 11);
      await querySQL(
        `INSERT INTO audit_logs (
           mongo_id, action, actor_id, actor_username, actor_role,
           ip, target_type, target_id, summary, metadata, created_at
         )
         VALUES ${placeholders}
         ON CONFLICT (mongo_id) DO NOTHING`,
        values
      );
      stats.syncedToSql.auditLogs += batch.length;
    }
    if (mongoAuditLogs.length > 0) {
      await querySQL(`DELETE FROM audit_logs WHERE NOT (mongo_id = ANY($1))`, [
        mongoAuditLogs.map((a) => String(a._id)),
      ]);
    } else {
      await querySQL(`DELETE FROM audit_logs`);
    }

    const User = require('../models/User');
    const MembershipTier = require('../models/MembershipTier');
    const Member = require('../models/Member');
    const PointTransaction = require('../models/PointTransaction');
    await Promise.allSettled([
      User.createIndexes(),
      MembershipTier.createIndexes(),
      Member.createIndexes(),
      PointTransaction.createIndexes(),
    ]);

    const parity = await getMirrorParitySummary();

    await querySQL(
      `UPDATE shop_settings
       SET setting_value = $1, updated_at = NOW()
       WHERE setting_key = 'shop-settings'`,
      [MIGRATION_MARKER]
    );
    global.__buffetMongoToSqlMigrated = true;

    return {
      skipped: false,
      marker: MIGRATION_MARKER,
      ...stats,
      parity,
    };
  })();

  global.__buffetMongoToSqlRunning = migrationPromise;
  try {
    return await migrationPromise;
  } finally {
    global.__buffetMongoToSqlRunning = null;
  }
}

module.exports = {
  MIGRATION_MARKER,
  migrateMongoToSql,
  getMirrorParitySummary,
};
