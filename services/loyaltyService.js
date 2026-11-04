const mongoose = require('mongoose');
const { querySQL, withTransaction } = require('../config/db.sql');
const Promotion = require('../models/Promotion');
const QueueCounter = require('../models/QueueCounter');
const {
  mirrorTierToMongo,
  mirrorMemberToMongo,
  deleteMemberFromMongo,
  mirrorPointTxToMongo,
} = require('./sqlToMongoMirror');

const roundMoney = (val) => Math.round(((Number(val) || 0) + Number.EPSILON) * 100) / 100;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(val) {
  return UUID_REGEX.test(String(val || '').trim());
}

const DEFAULT_TIERS = [
  {
    tierCode: 'MEMBER',
    tierName: 'สมาชิกทั่วไป',
    minPoints: 0,
    discountPercent: 0,
    pointsMultiplier: 1.0,
  },
  {
    tierCode: 'SILVER',
    tierName: 'Silver',
    minPoints: 50,
    discountPercent: 5,
    pointsMultiplier: 1.2,
  },
  {
    tierCode: 'GOLD',
    tierName: 'Gold',
    minPoints: 150,
    discountPercent: 10,
    pointsMultiplier: 1.5,
  },
  { tierCode: 'VIP', tierName: 'VIP', minPoints: 400, discountPercent: 15, pointsMultiplier: 2.0 },
];

const DEFAULT_PROMOTIONS = [
  {
    promoCode: 'WELCOME30',
    title: 'ต้อนรับสมาชิกใหม่ ลด 30 บาท',
    description: 'คูปองต้อนรับสมาชิก ใช้ลดทันทีเมื่อทานครบ 299 บาท ไม่ต้องใช้แต้ม',
    discountType: 'FIXED',
    discountValue: 30,
    pointsCost: 0,
    minSpend: 299,
    maxDiscount: null,
    isActive: true,
  },
  {
    promoCode: 'SAVE50',
    title: 'แลก 30 แต้ม ลดทันที 50 บาท',
    description: 'ใช้แต้มสะสม 30 แต้ม แลกส่วนลดท้ายบิล 50 บาท เมื่อทานครบ 399 บาท',
    discountType: 'FIXED',
    discountValue: 50,
    pointsCost: 30,
    minSpend: 399,
    maxDiscount: null,
    isActive: true,
  },
  {
    promoCode: 'SAVE10PCT',
    title: 'แลก 50 แต้ม ลด 10% (สูงสุด 150 บ.)',
    description: 'ใช้แต้มสะสม 50 แต้ม ลดค่าอาหาร 10% สูงสุด 150 บาท เมื่อครบ 500 บาท',
    discountType: 'PERCENT',
    discountValue: 10,
    pointsCost: 50,
    minSpend: 500,
    maxDiscount: 150,
    isActive: true,
  },
  {
    promoCode: 'VIP150',
    title: 'แลก 100 แต้ม ลดจัดเต็ม 150 บาท',
    description: 'ใช้แต้มสะสม 100 แต้ม ลดทันที 150 บาท เมื่อทานครบ 899 บาท',
    discountType: 'FIXED',
    discountValue: 150,
    pointsCost: 100,
    minSpend: 899,
    maxDiscount: null,
    isActive: true,
  },
];

let initPromise = null;

function createAppError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!/^\d{9,15}$/.test(digits)) {
    throw createAppError('INVALID_MEMBER_PHONE', 'กรุณากรอกเบอร์โทรศัพท์เป็นตัวเลข 9–15 หลัก');
  }
  return digits;
}

function tryNormalizePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/[^\d]/g, '');
  return /^\d{9,15}$/.test(digits) ? digits : null;
}

function sanitizeOptionalText(value, maxLen = 60) {
  return String(value || '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeAge(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 120) {
    throw createAppError('INVALID_MEMBER_AGE', 'กรุณาระบุอายุระหว่าง 1–120 ปี');
  }
  return parsed;
}

function isValidObjectId(id) {
  return (
    Boolean(id) &&
    mongoose.Types.ObjectId.isValid(String(id)) &&
    String(new mongoose.Types.ObjectId(String(id))) === String(id)
  );
}

function maskPublicName(rawName) {
  const clean = String(rawName || '').trim();
  if (!clean) return '';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const lastInitial = Array.from(parts[1])[0] || '';
    return `${first} ${lastInitial}***`;
  }
  const chars = Array.from(clean);
  if (chars.length <= 2) return `${chars[0] || '*'}***`;
  return `${chars.slice(0, 2).join('')}***`;
}

function maskPublicPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}-***-${digits.slice(-4)}`;
}

async function syncSqlMemberAndRecentTxsToMongo(memberUuid) {
  if (!memberUuid) return;
  try {
    const mRes = await querySQL(
      `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE id = $1 LIMIT 1`,
      [memberUuid]
    );
    if (!mRes.rows[0]) return;
    const memberMongoId = await mirrorMemberToMongo(mRes.rows[0]);
    const txRes = await querySQL(
      `SELECT id, mongo_id, member_id, session_ref, promotion_id, type, points,
              discount_amount, bill_amount, description, created_by_ref, created_at
       FROM point_transactions
       WHERE member_id = $1 AND mongo_id IS NULL
       ORDER BY created_at ASC`,
      [memberUuid]
    );
    for (const tx of txRes.rows) {
      await mirrorPointTxToMongo(tx, memberMongoId);
    }
  } catch (err) {
    console.warn('[loyaltyService:mirror] skipped:', err.message);
  }
}

async function ensureLoyaltyInitialized() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      for (const tier of DEFAULT_TIERS) {
        await querySQL(
          `INSERT INTO membership_tiers (tier_name, display_name, discount_percent, points_multiplier, min_points)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tier_name) DO NOTHING`,
          [
            tier.tierCode,
            tier.tierName,
            tier.discountPercent,
            tier.pointsMultiplier,
            tier.minPoints,
          ]
        );
        await mirrorTierToMongo(tier);
      }

      if (mongoose.connection.readyState === 1) {
        const promoSeedMarker = await QueueCounter.findById('loyalty-promos-seeded').lean();
        if (!promoSeedMarker) {
          const existingPromoCount = await Promotion.countDocuments();
          if (existingPromoCount === 0) {
            for (const promo of DEFAULT_PROMOTIONS) {
              await Promotion.findOneAndUpdate(
                { promoCode: promo.promoCode },
                { $setOnInsert: promo },
                { upsert: true, new: true }
              );
            }
          }
          await QueueCounter.findByIdAndUpdate(
            'loyalty-promos-seeded',
            { $setOnInsert: { sequence: 1 } },
            { upsert: true }
          );
        }
      }
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

async function getTierMap() {
  await ensureLoyaltyInitialized();
  const res = await querySQL(
    `SELECT id, tier_name, display_name, discount_percent, points_multiplier, min_points
     FROM membership_tiers
     ORDER BY min_points ASC`
  );
  const tiers = res.rows.map((r) => ({
    _id: r.id,
    id: r.id,
    tierCode: r.tier_name,
    tierName: r.display_name,
    minPoints: Number(r.min_points) || 0,
    discountPercent: roundMoney(r.discount_percent),
    pointsMultiplier: Number(r.points_multiplier) || 1,
  }));
  const list = tiers.length > 0 ? tiers : DEFAULT_TIERS;
  const byCode = new Map(list.map((t) => [String(t.tierCode).toUpperCase(), t]));
  return { list, byCode };
}

async function resolveTierForPoints(lifetimePoints, preloadedList = null) {
  const pts = Math.max(0, Math.floor(Number(lifetimePoints) || 0));
  const list = preloadedList || (await getTierMap()).list;
  let matched = list[0];
  for (const tier of list) {
    if (pts >= (Number(tier.minPoints) || 0)) {
      matched = tier;
    }
  }
  return matched;
}

async function generateNextMemberCode(client = null) {
  const run = client ? (sql, params) => client.query(sql, params) : querySQL;
  const res = await run(
    `SELECT member_id
     FROM members
     WHERE member_id ~ '^MB[0-9]+$'
     ORDER BY CAST(SUBSTRING(member_id FROM 3) AS INTEGER) DESC
     LIMIT 1`
  );
  let nextSeq = 1;
  if (res.rows[0] && res.rows[0].member_id) {
    const parsed = Number.parseInt(String(res.rows[0].member_id).slice(2), 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      nextSeq = parsed + 1;
    }
  }
  return `MB${String(nextSeq).padStart(4, '0')}`;
}

function calculateEarnedPoints(netPaidAmount, pointsMultiplier = 1) {
  const paid = Math.max(0, Number(netPaidAmount) || 0);
  const multiplier = Math.max(1, Number(pointsMultiplier) || 1);
  return Math.floor((paid / 100) * multiplier);
}

function computePromoDiscountAmount(promo, subtotal) {
  const safeSubtotal = Math.max(0, roundMoney(subtotal));
  if (safeSubtotal <= 0) return 0;
  let discount = 0;
  if (promo.discountType === 'PERCENT') {
    discount = roundMoney((safeSubtotal * promo.discountValue) / 100);
    if (promo.maxDiscount !== null && promo.maxDiscount !== undefined && promo.maxDiscount > 0) {
      discount = Math.min(discount, promo.maxDiscount);
    }
  } else {
    discount = roundMoney(promo.discountValue);
  }
  return Math.min(discount, safeSubtotal);
}

const MEMBER_SELECT_COLS = `
  id, mongo_id, member_id, phone, prefix, full_name, nickname, age, email,
  tier_id, tier_name, points_balance, lifetime_points, total_spent, visit_count,
  is_active, registered_via, created_by, created_at, updated_at
`;

async function findMemberRowByIdOrMongoId(rawId, client = null) {
  const key = String(rawId || '').trim();
  if (!key) return null;
  const run = client ? (sql, params) => client.query(sql, params) : querySQL;
  if (isUuid(key)) {
    const res = await run(
      `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE id = $1 OR mongo_id = $2 LIMIT 1`,
      [key, key]
    );
    return res.rows[0] || null;
  }
  const res = await run(
    `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE mongo_id = $1 OR UPPER(member_id) = UPPER($1) LIMIT 1`,
    [key]
  );
  return res.rows[0] || null;
}

function formatMember(row, tierByCode, txStats = null) {
  if (!row) return null;
  const tierCodeKey = String(row.tier_name || 'MEMBER').toUpperCase();
  const tier =
    tierByCode.get(tierCodeKey) || tierByCode.get('MEMBER') || DEFAULT_TIERS[0];
  return {
    memberId: String(row.id),
    id: String(row.id),
    _id: String(row.id),
    mongoId: row.mongo_id || null,
    memberCode: row.member_id,
    prefix: row.prefix || '',
    fullName: row.full_name,
    nickname: row.nickname || '',
    age: row.age !== null && row.age !== undefined ? Number(row.age) : null,
    phone: row.phone,
    email: row.email || '',
    currentPoints: Number(row.points_balance) || 0,
    lifetimePoints: Number(row.lifetime_points) || 0,
    totalSpent: roundMoney(row.total_spent),
    visitCount: Number(row.visit_count) || 0,
    isActive: Boolean(row.is_active),
    registeredVia: row.registered_via || 'admin',
    createdAt: row.created_at,
    tierCode: tier.tierCode,
    tierName: tier.tierName,
    discountPercent: roundMoney(tier.discountPercent),
    pointsMultiplier: Number(tier.pointsMultiplier) || 1,
    totalTransactions: txStats ? Number(txStats.totalTransactions) || 0 : 0,
    totalDiscountSaved: txStats ? roundMoney(txStats.totalDiscountSaved) : 0,
  };
}

function formatPromotion(doc, usageStats = null) {
  if (!doc) return null;
  return {
    promotionId: String(doc._id),
    promoCode: doc.promoCode,
    title: doc.title,
    description: doc.description || '',
    discountType: doc.discountType,
    discountValue: roundMoney(doc.discountValue),
    pointsCost: Number(doc.pointsCost) || 0,
    minSpend: roundMoney(doc.minSpend),
    maxDiscount:
      doc.maxDiscount !== null && doc.maxDiscount !== undefined
        ? roundMoney(doc.maxDiscount)
        : null,
    isActive: Boolean(doc.isActive),
    createdAt: doc.createdAt,
    usageCount: usageStats ? Number(usageStats.usageCount) || 0 : 0,
    totalDiscountGiven: usageStats ? roundMoney(usageStats.totalDiscountGiven) : 0,
  };
}

async function listTiers() {
  const [{ list }, activeMemberCounts] = await Promise.all([
    getTierMap(),
    querySQL(
      `SELECT UPPER(COALESCE(tier_name, 'MEMBER')) AS tier_code, COUNT(*)::int AS count
       FROM members
       WHERE is_active = true
       GROUP BY UPPER(COALESCE(tier_name, 'MEMBER'))`
    ),
  ]);
  const countMap = new Map(
    activeMemberCounts.rows.map((row) => [String(row.tier_code || '').toUpperCase(), Number(row.count) || 0])
  );
  return list.map((tier) => ({
    tierId: tier._id ? String(tier._id) : tier.tierCode,
    tierCode: tier.tierCode,
    tierName: tier.tierName,
    minPoints: Number(tier.minPoints) || 0,
    discountPercent: roundMoney(tier.discountPercent),
    pointsMultiplier: Number(tier.pointsMultiplier) || 1,
    memberCount: Number(countMap.get(String(tier.tierCode).toUpperCase())) || 0,
  }));
}

async function getLoyaltyOverview() {
  await ensureLoyaltyInitialized();
  const [tiers, memberSummaryRes, promos, txAggRes] = await Promise.all([
    listTiers(),
    querySQL(
      `SELECT
         COUNT(*)::int AS total_members,
         COUNT(*) FILTER (WHERE is_active = true)::int AS active_members,
         COALESCE(SUM(points_balance), 0)::bigint AS total_current_points,
         COALESCE(SUM(lifetime_points), 0)::bigint AS total_lifetime_points,
         COALESCE(SUM(total_spent), 0) AS total_member_spend
       FROM members`
    ),
    mongoose.connection.readyState === 1
      ? Promotion.find().select('isActive').lean()
      : Promise.resolve([]),
    querySQL(
      `SELECT
         COUNT(*)::int AS total_transactions,
         COUNT(*) FILTER (WHERE type = 'REDEEM')::int AS total_redemptions,
         COALESCE(SUM(points) FILTER (WHERE points > 0), 0)::bigint AS total_points_issued,
         COALESCE(SUM(discount_amount), 0) AS total_discount_saved
       FROM point_transactions`
    ),
  ]);

  const m = memberSummaryRes.rows[0] || {};
  const tx = txAggRes.rows[0] || {};
  return {
    summary: {
      totalMembers: Number(m.total_members) || 0,
      activeMembers: Number(m.active_members) || 0,
      totalCurrentPoints: Number(m.total_current_points) || 0,
      totalLifetimePoints: Number(m.total_lifetime_points) || 0,
      totalMemberSpend: roundMoney(m.total_member_spend),
      totalPromotions: promos.length,
      activePromotions: promos.filter((p) => p.isActive).length,
      totalTransactions: Number(tx.total_transactions) || 0,
      totalRedemptions: Number(tx.total_redemptions) || 0,
      totalPointsIssued: Number(tx.total_points_issued) || 0,
      totalDiscountSaved: roundMoney(tx.total_discount_saved),
    },
    tiers,
  };
}

async function listMembers({ search = '', q = '', tierCode = '', activeOnly = false } = {}) {
  const { byCode } = await getTierMap();
  const conditions = [];
  const params = [];

  const trimmedSearch = String(search || q || '').trim();
  if (trimmedSearch) {
    const digitsOnly = trimmedSearch.replace(/[^\d]/g, '');
    params.push(`%${trimmedSearch}%`);
    const textIdx = params.length;
    if (digitsOnly) {
      params.push(`%${digitsOnly}%`);
      const phoneIdx = params.length;
      conditions.push(
        `(full_name ILIKE $${textIdx} OR nickname ILIKE $${textIdx} OR member_id ILIKE $${textIdx} OR phone ILIKE $${phoneIdx})`
      );
    } else {
      conditions.push(
        `(full_name ILIKE $${textIdx} OR nickname ILIKE $${textIdx} OR member_id ILIKE $${textIdx})`
      );
    }
  }

  const trimmedTier = String(tierCode || '')
    .trim()
    .toUpperCase();
  if (trimmedTier) {
    params.push(trimmedTier);
    conditions.push(`UPPER(tier_name) = $${params.length}`);
  }
  if (activeOnly) {
    conditions.push(`is_active = true`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const docsRes = await querySQL(
    `SELECT ${MEMBER_SELECT_COLS}
     FROM members
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 300`,
    params
  );
  const rows = docsRes.rows;
  if (rows.length === 0) return [];

  const memberIds = rows.map((r) => r.id);
  const txAggRes = await querySQL(
    `SELECT
       member_id,
       COUNT(*)::int AS "totalTransactions",
       COALESCE(SUM(discount_amount), 0) AS "totalDiscountSaved"
     FROM point_transactions
     WHERE member_id = ANY($1::uuid[])
     GROUP BY member_id`,
    [memberIds]
  );
  const statsByMember = new Map(txAggRes.rows.map((r) => [String(r.member_id), r]));
  return rows.map((row) => formatMember(row, byCode, statsByMember.get(String(row.id))));
}

async function getMemberById(memberId) {
  const row = await findMemberRowByIdOrMongoId(memberId);
  if (!row) return null;
  const { byCode } = await getTierMap();
  const txAggRes = await querySQL(
    `SELECT
       COUNT(*)::int AS "totalTransactions",
       COALESCE(SUM(discount_amount), 0) AS "totalDiscountSaved"
     FROM point_transactions
     WHERE member_id = $1`,
    [row.id]
  );
  return formatMember(row, byCode, txAggRes.rows[0] || null);
}

async function buildMemberLookupPayload(member, subtotal = 0, candidates = []) {
  const safeSubtotal = Math.max(0, roundMoney(subtotal));
  const promotions = await listPromotions({ activeOnly: true });

  const tierDiscountAmount =
    member.discountPercent > 0
      ? Math.min(roundMoney((safeSubtotal * member.discountPercent) / 100), safeSubtotal)
      : 0;

  const availablePromotions = promotions.map((promo) => {
    const meetsSpend = safeSubtotal >= promo.minSpend;
    const hasEnoughPoints = member.currentPoints >= promo.pointsCost;
    const estimatedDiscount = computePromoDiscountAmount(promo, safeSubtotal);
    let ineligibleReason = null;
    if (!meetsSpend) {
      ineligibleReason = `ยอดขั้นต่ำ ฿${promo.minSpend.toFixed(2)}`;
    } else if (!hasEnoughPoints) {
      ineligibleReason = `ต้องใช้ ${promo.pointsCost} แต้ม (มี ${member.currentPoints} แต้ม)`;
    }
    return {
      ...promo,
      eligible: meetsSpend && hasEnoughPoints,
      ineligibleReason,
      estimatedDiscount,
    };
  });

  return {
    found: true,
    member,
    candidates,
    tierBenefit: {
      available: member.discountPercent > 0,
      tierCode: member.tierCode,
      tierName: member.tierName,
      discountPercent: member.discountPercent,
      pointsCost: 0,
      estimatedDiscount: tierDiscountAmount,
    },
    availablePromotions,
    estimatedEarnedPoints: calculateEarnedPoints(safeSubtotal, member.pointsMultiplier),
  };
}

async function lookupMember({ query = '', phone = '', memberId = '', subtotal = 0 } = {}) {
  const { byCode } = await getTierMap();

  if (memberId) {
    const byId = await getMemberById(memberId);
    if (!byId) return { found: false, member: null, candidates: [] };
    if (!byId.isActive) {
      throw createAppError('MEMBER_INACTIVE', 'บัญชีสมาชิกนี้ถูกระงับการใช้งานชั่วคราว');
    }
    return buildMemberLookupPayload(byId, subtotal, []);
  }

  const rawTerm = String(query || phone || '').trim();
  if (!rawTerm) {
    throw createAppError('EMPTY_MEMBER_LOOKUP', 'กรุณากรอกชื่อหรือเบอร์โทรศัพท์สมาชิก');
  }

  const digits = rawTerm.replace(/[^\d]/g, '');
  const looksNumericOnly = /^[\d\s\-+()]+$/.test(rawTerm);

  if (/^\d{9,15}$/.test(digits)) {
    const exactRes = await querySQL(
      `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE phone = $1 LIMIT 1`,
      [digits]
    );
    if (exactRes.rows[0]) {
      const formatted = formatMember(exactRes.rows[0], byCode);
      if (!formatted.isActive) {
        throw createAppError('MEMBER_INACTIVE', 'บัญชีสมาชิกนี้ถูกระงับการใช้งานชั่วคราว');
      }
      return buildMemberLookupPayload(formatted, subtotal, []);
    }
    if (looksNumericOnly) {
      return { found: false, phone: digits, member: null, candidates: [] };
    }
  } else if (looksNumericOnly && digits.length < 3) {
    throw createAppError(
      'INVALID_MEMBER_PHONE',
      'กรุณากรอกเบอร์โทรศัพท์หรือชื่อสมาชิกอย่างน้อย 2 ตัวอักษร'
    );
  }

  const params = [`%${rawTerm}%`];
  let matchSql = `(full_name ILIKE $1 OR nickname ILIKE $1 OR member_id ILIKE $1)`;
  if (digits.length >= 3) {
    params.push(`%${digits}%`);
    matchSql = `(full_name ILIKE $1 OR nickname ILIKE $1 OR member_id ILIKE $1 OR phone ILIKE $2)`;
  }

  const matchesRes = await querySQL(
    `SELECT ${MEMBER_SELECT_COLS}
     FROM members
     WHERE is_active = true AND ${matchSql}
     ORDER BY lifetime_points DESC, created_at DESC
     LIMIT 8`,
    params
  );

  if (matchesRes.rows.length === 0) {
    return { found: false, query: rawTerm, member: null, candidates: [] };
  }

  const formattedList = matchesRes.rows.map((row) => formatMember(row, byCode));
  if (formattedList.length === 1) {
    return buildMemberLookupPayload(formattedList[0], subtotal, []);
  }

  const exactMatch =
    formattedList.find(
      (m) =>
        m.memberCode.toLowerCase() === rawTerm.toLowerCase() ||
        m.fullName.toLowerCase() === rawTerm.toLowerCase()
    ) || formattedList[0];

  return buildMemberLookupPayload(exactMatch, subtotal, formattedList);
}

async function lookupMemberByPhone(rawPhone, subtotal = 0) {
  const phone = normalizePhone(rawPhone);
  return lookupMember({ phone, subtotal });
}

async function createMember({
  prefix = '',
  fullName,
  nickname = '',
  age = null,
  phone,
  email = null,
  initialPoints = 0,
  registeredVia = 'admin',
  createdBy = 'admin',
} = {}) {
  const cleanName = String(fullName || '').trim();
  if (!cleanName) {
    throw createAppError('INVALID_MEMBER_NAME', 'กรุณากรอกชื่อ-นามสกุลของสมาชิก');
  }

  const normalizedPhone = normalizePhone(phone);
  const cleanPrefix = sanitizeOptionalText(prefix, 30);
  const cleanNickname = sanitizeOptionalText(nickname, 60);
  const cleanAge = sanitizeAge(age);
  await ensureLoyaltyInitialized();

  const existingRes = await querySQL(
    `SELECT member_id FROM members WHERE phone = $1 LIMIT 1`,
    [normalizedPhone]
  );
  if (existingRes.rows[0]) {
    throw createAppError(
      'DUPLICATE_MEMBER_PHONE',
      `เบอร์โทรศัพท์ ${normalizedPhone} เป็นสมาชิกอยู่แล้ว (${existingRes.rows[0].member_id})`,
      409
    );
  }

  const startPoints = Math.max(0, Math.floor(Number(initialPoints) || 0));
  const tier = await resolveTierForPoints(startPoints);
  const cleanEmail = email ? String(email).trim() : '';

  const createdRow = await withTransaction(async (client) => {
    let created = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const memberCode = await generateNextMemberCode(client);
      try {
        const ins = await client.query(
          `INSERT INTO members (
             member_id, prefix, full_name, nickname, age, phone, email,
             tier_id, tier_name, points_balance, lifetime_points, total_spent,
             visit_count, is_active, registered_via, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, true, $12, $13)
           RETURNING ${MEMBER_SELECT_COLS}`,
          [
            memberCode,
            cleanPrefix,
            cleanName,
            cleanNickname,
            cleanAge,
            normalizedPhone,
            cleanEmail,
            tier && isUuid(tier.id) ? tier.id : null,
            tier.tierCode,
            startPoints,
            startPoints,
            registeredVia,
            createdBy || 'admin',
          ]
        );
        created = ins.rows[0];
        break;
      } catch (err) {
        if (err && err.code === '23505') {
          const dupPhone = await client.query(
            `SELECT member_id FROM members WHERE phone = $1 LIMIT 1`,
            [normalizedPhone]
          );
          if (dupPhone.rows[0]) {
            throw createAppError(
              'DUPLICATE_MEMBER_PHONE',
              `เบอร์โทรศัพท์ ${normalizedPhone} เป็นสมาชิกอยู่แล้ว (${dupPhone.rows[0].member_id})`,
              409
            );
          }
          continue;
        }
        throw err;
      }
    }

    if (!created) {
      throw createAppError('MEMBER_CREATE_FAILED', 'ไม่สามารถสร้างรหัสสมาชิกได้ กรุณาลองใหม่', 500);
    }

    if (startPoints > 0) {
      await client.query(
        `INSERT INTO point_transactions (
           member_id, type, points, points_before, points_after,
           discount_amount, bill_amount, description, created_by_ref
         )
         VALUES ($1, 'ADJUST', $2, 0, $3, 0, 0, 'แต้มเริ่มต้นตอนสมัครสมาชิกใหม่', $4)`,
        [created.id, startPoints, startPoints, createdBy || 'admin']
      );
    }

    return created;
  });

  await syncSqlMemberAndRecentTxsToMongo(createdRow.id);
  return getMemberById(createdRow.id);
}

async function upsertMemberFromCustomer({
  prefix = '',
  fullName = '',
  nickname = '',
  age = null,
  phone = '',
  email = '',
  source = 'queue',
} = {}) {
  const normalizedPhone = tryNormalizePhone(phone);
  if (!normalizedPhone) return null;

  const { byCode } = await getTierMap();
  const cleanPrefix = sanitizeOptionalText(prefix, 30);
  const cleanName = String(fullName || '').trim();
  const cleanNickname = sanitizeOptionalText(nickname, 60);
  const cleanAge = sanitizeAge(age);
  const cleanEmail = String(email || '').trim();

  const existingRes = await querySQL(
    `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE phone = $1 LIMIT 1`,
    [normalizedPhone]
  );

  if (existingRes.rows[0]) {
    let existing = existingRes.rows[0];
    const isPlaceholderName =
      !existing.full_name ||
      existing.full_name === 'ลูกค้าสมาชิก' ||
      existing.full_name === 'ลูกค้าทั่วไป' ||
      existing.full_name === 'Member';

    if (isPlaceholderName) {
      const nextFullName = cleanName || existing.full_name;
      const nextPrefix = !existing.prefix && cleanPrefix ? cleanPrefix : existing.prefix;
      const nextNickname = !existing.nickname && cleanNickname ? cleanNickname : existing.nickname;
      const nextAge =
        (existing.age === null || existing.age === undefined) && cleanAge !== null
          ? cleanAge
          : existing.age;
      const nextEmail = !existing.email && cleanEmail ? cleanEmail : existing.email;

      const upd = await querySQL(
        `UPDATE members
         SET full_name = $1, prefix = $2, nickname = $3, age = $4, email = $5, updated_at = NOW()
         WHERE id = $6
         RETURNING ${MEMBER_SELECT_COLS}`,
        [nextFullName, nextPrefix, nextNickname, nextAge, nextEmail, existing.id]
      );
      existing = upd.rows[0];
      await syncSqlMemberAndRecentTxsToMongo(existing.id);
    }

    return {
      member: formatMember(existing, byCode),
      isNewMember: false,
    };
  }

  const displayName = cleanName || 'ลูกค้าสมาชิก';
  const tier = await resolveTierForPoints(0);

  try {
    const createdRow = await withTransaction(async (client) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const memberCode = await generateNextMemberCode(client);
        try {
          const ins = await client.query(
            `INSERT INTO members (
               member_id, prefix, full_name, nickname, age, phone, email,
               tier_id, tier_name, points_balance, lifetime_points, total_spent,
               visit_count, is_active, registered_via, created_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, 0, 0, true, $10, $11)
             RETURNING ${MEMBER_SELECT_COLS}`,
            [
              memberCode,
              cleanPrefix,
              displayName,
              cleanNickname,
              cleanAge,
              normalizedPhone,
              cleanEmail,
              tier && isUuid(tier.id) ? tier.id : null,
              tier.tierCode,
              source === 'web' ? 'web' : 'queue',
              source === 'web' ? 'customer-web' : 'customer-queue',
            ]
          );
          return ins.rows[0];
        } catch (err) {
          if (err && err.code === '23505') {
            const raced = await client.query(
              `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE phone = $1 LIMIT 1`,
              [normalizedPhone]
            );
            if (raced.rows[0]) {
              return { __raced: raced.rows[0] };
            }
            continue;
          }
          throw err;
        }
      }
      throw createAppError('MEMBER_CREATE_FAILED', 'ไม่สามารถสมัครสมาชิกได้ กรุณาลองใหม่', 500);
    });

    if (createdRow && createdRow.__raced) {
      return {
        member: formatMember(createdRow.__raced, byCode),
        isNewMember: false,
      };
    }

    await syncSqlMemberAndRecentTxsToMongo(createdRow.id);
    return {
      member: formatMember(createdRow, byCode),
      isNewMember: true,
    };
  } catch (error) {
    if (error && error.code === '23505') {
      const raced = await querySQL(
        `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE phone = $1 LIMIT 1`,
        [normalizedPhone]
      );
      if (raced.rows[0]) {
        return {
          member: formatMember(raced.rows[0], byCode),
          isNewMember: false,
        };
      }
    }
    throw error;
  }
}

async function getPublicMemberCard(rawPhone) {
  const phone = normalizePhone(rawPhone);
  const { list, byCode } = await getTierMap();
  const res = await querySQL(
    `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE phone = $1 LIMIT 1`,
    [phone]
  );
  const doc = res.rows[0];
  if (!doc || !doc.is_active) {
    return { found: false, member: null, nextTier: null, promotions: [] };
  }

  const member = formatMember(doc, byCode);
  const nextTierDoc = list.find((t) => (Number(t.minPoints) || 0) > member.lifetimePoints) || null;
  const nextTier = nextTierDoc
    ? {
        tierCode: nextTierDoc.tierCode,
        tierName: nextTierDoc.tierName,
        minPoints: Number(nextTierDoc.minPoints) || 0,
        pointsNeeded: Math.max(0, (Number(nextTierDoc.minPoints) || 0) - member.lifetimePoints),
        discountPercent: roundMoney(nextTierDoc.discountPercent),
        pointsMultiplier: Number(nextTierDoc.pointsMultiplier) || 1,
      }
    : null;

  const promotions = await listPromotions({ activeOnly: true });
  return {
    found: true,
    member: {
      memberCode: member.memberCode,
      prefix: member.prefix,
      fullName: maskPublicName(member.fullName),
      nickname: member.nickname,
      phone: maskPublicPhone(member.phone),
      tierCode: member.tierCode,
      tierName: member.tierName,
      discountPercent: member.discountPercent,
      pointsMultiplier: member.pointsMultiplier,
      currentPoints: member.currentPoints,
      lifetimePoints: member.lifetimePoints,
      visitCount: member.visitCount,
    },
    tiers: list.map((t) => ({
      tierCode: t.tierCode,
      tierName: t.tierName,
      minPoints: Number(t.minPoints) || 0,
      discountPercent: roundMoney(t.discountPercent),
      pointsMultiplier: Number(t.pointsMultiplier) || 1,
    })),
    nextTier,
    promotions,
  };
}

async function updateMember(memberId, payload = {}) {
  const existing = await findMemberRowByIdOrMongoId(memberId);
  if (!existing) {
    throw createAppError('MEMBER_NOT_FOUND', 'ไม่พบข้อมูลสมาชิกในระบบ', 404);
  }

  const nextPrefix =
    payload.prefix !== undefined ? sanitizeOptionalText(payload.prefix, 30) : existing.prefix || '';

  let nextFullName = existing.full_name;
  if (payload.fullName !== undefined) {
    const cleanName = String(payload.fullName || '').trim();
    if (!cleanName) throw createAppError('INVALID_MEMBER_NAME', 'กรุณากรอกชื่อ-นามสกุลของสมาชิก');
    nextFullName = cleanName;
  }

  const nextNickname =
    payload.nickname !== undefined
      ? sanitizeOptionalText(payload.nickname, 60)
      : existing.nickname || '';

  const nextAge = payload.age !== undefined ? sanitizeAge(payload.age) : (existing.age ?? null);

  let nextPhone = existing.phone;
  if (payload.phone !== undefined) {
    const cleanPhone = normalizePhone(payload.phone);
    if (cleanPhone !== existing.phone) {
      const dupRes = await querySQL(
        `SELECT member_id FROM members WHERE phone = $1 AND id <> $2 LIMIT 1`,
        [cleanPhone, existing.id]
      );
      if (dupRes.rows[0]) {
        throw createAppError(
          'DUPLICATE_MEMBER_PHONE',
          `เบอร์โทรศัพท์ ${cleanPhone} ถูกใช้งานแล้ว (${dupRes.rows[0].member_id})`,
          409
        );
      }
      nextPhone = cleanPhone;
    }
  }

  const nextEmail =
    payload.email !== undefined
      ? payload.email
        ? String(payload.email).trim()
        : ''
      : existing.email || '';

  const nextIsActive =
    payload.isActive !== undefined
      ? Boolean(payload.isActive === true || payload.isActive === 'true')
      : Boolean(existing.is_active);

  let nextTierCode = existing.tier_name || 'MEMBER';
  let nextTierId = existing.tier_id;
  if (payload.tierCode) {
    const { byCode } = await getTierMap();
    const targetCode = String(payload.tierCode).trim().toUpperCase();
    if (byCode.has(targetCode)) {
      const matched = byCode.get(targetCode);
      nextTierCode = matched.tierCode;
      nextTierId = matched.id && isUuid(matched.id) ? matched.id : null;
    }
  }

  await querySQL(
    `UPDATE members
     SET prefix = $1,
         full_name = $2,
         nickname = $3,
         age = $4,
         phone = $5,
         email = $6,
         is_active = $7,
         tier_id = $8,
         tier_name = $9,
         updated_at = NOW()
     WHERE id = $10`,
    [
      nextPrefix,
      nextFullName,
      nextNickname,
      nextAge,
      nextPhone,
      nextEmail,
      nextIsActive,
      nextTierId,
      nextTierCode,
      existing.id,
    ]
  );

  await syncSqlMemberAndRecentTxsToMongo(existing.id);
  return getMemberById(existing.id);
}

async function deleteMember(memberId) {
  const existing = await getMemberById(memberId);
  if (!existing) {
    throw createAppError('MEMBER_NOT_FOUND', 'ไม่พบข้อมูลสมาชิกในระบบ', 404);
  }
  await querySQL(`DELETE FROM members WHERE id = $1`, [existing.memberId]);
  await deleteMemberFromMongo(existing);
  return existing;
}

async function adjustMemberPoints(memberId, { pointsDelta, points, note = '', description = '', createdBy = 'admin' } = {}) {
  const rawDelta = pointsDelta !== undefined ? pointsDelta : points;
  const delta = Math.trunc(Number(rawDelta) || 0);
  if (delta === 0) {
    throw createAppError(
      'INVALID_POINTS_DELTA',
      'กรุณาระบุจำนวนแต้มที่ต้องการเพิ่มหรือลด (ไม่เป็น 0)'
    );
  }

  const { list } = await getTierMap();

  const updatedId = await withTransaction(async (client) => {
    const found = await findMemberRowByIdOrMongoId(memberId, client);
    if (!found) {
      throw createAppError('MEMBER_NOT_FOUND', 'ไม่พบข้อมูลสมาชิกในระบบ', 404);
    }

    const lockedRes = await client.query(
      `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE id = $1 FOR UPDATE`,
      [found.id]
    );
    const existing = lockedRes.rows[0];
    const currentPoints = Number(existing.points_balance) || 0;
    const nextCurrent = currentPoints + delta;
    if (nextCurrent < 0) {
      throw createAppError(
        'INSUFFICIENT_MEMBER_POINTS',
        `แต้มสะสมไม่เพียงพอ (คงเหลือ ${currentPoints} แต้ม)`
      );
    }

    const currentLifetime = Number(existing.lifetime_points) || 0;
    const nextLifetime = delta > 0 ? currentLifetime + delta : currentLifetime;
    const resolvedTier = await resolveTierForPoints(nextLifetime, list);

    await client.query(
      `UPDATE members
       SET points_balance = $1,
           lifetime_points = $2,
           tier_id = $3,
           tier_name = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [
        nextCurrent,
        nextLifetime,
        resolvedTier && isUuid(resolvedTier.id) ? resolvedTier.id : null,
        resolvedTier.tierCode,
        existing.id,
      ]
    );

    const txNote =
      String(note || description || '').trim() ||
      (delta > 0 ? 'เพิ่มแต้มพิเศษโดยผู้ดูแล' : 'ปรับลดแต้มโดยผู้ดูแล');

    await client.query(
      `INSERT INTO point_transactions (
         member_id, type, points, points_before, points_after,
         discount_amount, bill_amount, description, created_by_ref
       )
       VALUES ($1, 'ADJUST', $2, $3, $4, 0, 0, $5, $6)`,
      [existing.id, delta, currentPoints, nextCurrent, txNote, createdBy || 'admin']
    );

    return existing.id;
  });

  await syncSqlMemberAndRecentTxsToMongo(updatedId);
  return getMemberById(updatedId);
}

async function listTransactions({ memberId = null, limit = 50 } = {}) {
  await ensureLoyaltyInitialized();
  const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
  const conditions = [];
  const params = [];

  if (memberId !== null && memberId !== undefined && memberId !== '') {
    const found = await findMemberRowByIdOrMongoId(memberId);
    if (!found) return [];
    params.push(found.id);
    conditions.push(`pt.member_id = $${params.length}`);
  }

  params.push(safeLimit);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await querySQL(
    `SELECT
       pt.id,
       pt.member_id,
       pt.promotion_id,
       pt.session_ref,
       pt.type,
       pt.points,
       pt.discount_amount,
       pt.bill_amount,
       pt.description,
       pt.created_by_ref,
       pt.created_at,
       m.member_id AS member_code,
       m.full_name AS member_name,
       m.phone AS member_phone
     FROM point_transactions pt
     LEFT JOIN members m ON m.id = pt.member_id
     ${whereClause}
     ORDER BY pt.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const promoIds = [
    ...new Set(
      res.rows
        .map((r) => r.promotion_id)
        .filter((pid) => pid && isValidObjectId(pid))
    ),
  ];
  const promoMap = new Map();
  if (promoIds.length > 0 && mongoose.connection.readyState === 1) {
    const promos = await Promotion.find({ _id: { $in: promoIds } })
      .select('promoCode title')
      .lean();
    for (const p of promos) {
      promoMap.set(String(p._id), p);
    }
  }

  return res.rows.map((row) => {
    const promo = row.promotion_id ? promoMap.get(String(row.promotion_id)) : null;
    return {
      transactionId: String(row.id),
      memberId: row.member_id ? String(row.member_id) : '',
      memberCode: row.member_code || '',
      memberName: row.member_name || '',
      memberPhone: row.member_phone || '',
      promotionId: promo ? String(promo._id) : row.promotion_id || null,
      promoCode: promo ? promo.promoCode : '',
      promoTitle: promo ? promo.title : '',
      sessionRef: row.session_ref || '',
      transactionType: row.type,
      pointsDelta: Number(row.points) || 0,
      discountAmount: roundMoney(row.discount_amount),
      billAmount: roundMoney(row.bill_amount),
      note: row.description || '',
      createdBy: row.created_by_ref || '',
      createdAt: row.created_at,
    };
  });
}

async function listPromotions({ activeOnly = false } = {}) {
  await ensureLoyaltyInitialized();
  const filter = activeOnly ? { isActive: true } : {};
  const docs = await Promotion.find(filter).sort({ pointsCost: 1, createdAt: 1 }).lean();
  if (docs.length === 0) return [];

  const promoIds = docs.map((d) => String(d._id));
  const usageAggRes = await querySQL(
    `SELECT
       promotion_id,
       COUNT(*)::int AS "usageCount",
       COALESCE(SUM(discount_amount), 0) AS "totalDiscountGiven"
     FROM point_transactions
     WHERE promotion_id = ANY($1)
     GROUP BY promotion_id`,
    [promoIds]
  );
  const usageMap = new Map(usageAggRes.rows.map((row) => [String(row.promotion_id), row]));
  return docs.map((doc) => formatPromotion(doc, usageMap.get(String(doc._id))));
}

async function getPromotionById(promotionId) {
  if (!isValidObjectId(promotionId)) return null;
  await ensureLoyaltyInitialized();
  const doc = await Promotion.findById(promotionId).lean();
  if (!doc) return null;
  const usageAggRes = await querySQL(
    `SELECT
       COUNT(*)::int AS "usageCount",
       COALESCE(SUM(discount_amount), 0) AS "totalDiscountGiven"
     FROM point_transactions
     WHERE promotion_id = $1`,
    [String(doc._id)]
  );
  return formatPromotion(doc, usageAggRes.rows[0] || null);
}

function validatePromotionPayload(payload = {}) {
  const promoCode = String(payload.promoCode || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(promoCode)) {
    throw createAppError(
      'INVALID_PROMO_CODE',
      'รหัสคูปองต้องเป็นภาษาอังกฤษหรือตัวเลข 3–30 ตัวอักษร'
    );
  }

  const title = String(payload.title || '').trim();
  if (!title || title.length > 160) {
    throw createAppError('INVALID_PROMO_TITLE', 'ชื่อโปรโมชัน/คูปองต้องมีความยาว 1–160 ตัวอักษร');
  }
  const description = payload.description ? String(payload.description).trim() : '';
  if (description.length > 400) {
    throw createAppError('INVALID_PROMO_DESCRIPTION', 'รายละเอียดโปรโมชันต้องไม่เกิน 400 ตัวอักษร');
  }

  const discountType = String(payload.discountType || 'FIXED')
    .trim()
    .toUpperCase();
  if (!['PERCENT', 'FIXED'].includes(discountType)) {
    throw createAppError('INVALID_DISCOUNT_TYPE', 'ประเภทส่วนลดต้องเป็น PERCENT หรือ FIXED');
  }

  const rawDiscountValue = Number(payload.discountValue);
  if (
    !Number.isFinite(rawDiscountValue) ||
    rawDiscountValue <= 0 ||
    (discountType === 'PERCENT' && rawDiscountValue > 100)
  ) {
    throw createAppError('INVALID_DISCOUNT_VALUE', 'มูลค่าส่วนลดไม่ถูกต้อง');
  }
  const discountValue = roundMoney(rawDiscountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw createAppError('INVALID_DISCOUNT_VALUE', 'มูลค่าส่วนลดไม่ถูกต้อง');
  }

  const rawPointsCost = Number(payload.pointsCost ?? 0);
  if (!Number.isSafeInteger(rawPointsCost) || rawPointsCost < 0) {
    throw createAppError('INVALID_POINTS_COST', 'แต้มที่ใช้แลกต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  }
  const pointsCost = rawPointsCost;

  const rawMinSpend = Number(payload.minSpend ?? 0);
  if (!Number.isFinite(rawMinSpend) || rawMinSpend < 0) {
    throw createAppError('INVALID_MIN_SPEND', 'ยอดอาหารขั้นต่ำต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  }
  const minSpend = roundMoney(rawMinSpend);
  if (!Number.isFinite(minSpend)) {
    throw createAppError('INVALID_MIN_SPEND', 'ยอดอาหารขั้นต่ำต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  }

  let maxDiscount = null;
  if (
    payload.maxDiscount !== '' &&
    payload.maxDiscount !== null &&
    payload.maxDiscount !== undefined
  ) {
    const rawMaxDiscount = Number(payload.maxDiscount);
    if (!Number.isFinite(rawMaxDiscount) || rawMaxDiscount < 0) {
      throw createAppError('INVALID_MAX_DISCOUNT', 'เพดานส่วนลดสูงสุดไม่ถูกต้อง');
    }
    if (rawMaxDiscount > 0) {
      maxDiscount = roundMoney(rawMaxDiscount);
      if (!Number.isFinite(maxDiscount)) {
        throw createAppError('INVALID_MAX_DISCOUNT', 'เพดานส่วนลดสูงสุดไม่ถูกต้อง');
      }
    }
  }

  const isActive = payload.isActive === undefined ? true : payload.isActive;
  if (![true, false, 'true', 'false'].includes(isActive)) {
    throw createAppError('INVALID_PROMO_STATUS', 'สถานะโปรโมชันไม่ถูกต้อง');
  }

  return {
    promoCode,
    title,
    description,
    discountType,
    discountValue,
    pointsCost,
    minSpend,
    maxDiscount,
    isActive: isActive === true || isActive === 'true',
  };
}

async function createPromotion(payload = {}) {
  await ensureLoyaltyInitialized();
  const clean = validatePromotionPayload(payload);
  const dup = await Promotion.findOne({ promoCode: clean.promoCode }).lean();
  if (dup) {
    throw createAppError(
      'DUPLICATE_PROMO_CODE',
      `รหัสโปรโมชัน ${clean.promoCode} มีอยู่ในระบบแล้ว`,
      409
    );
  }
  let created;
  try {
    created = await Promotion.create(clean);
  } catch (error) {
    if (error && error.code === 11000) {
      throw createAppError(
        'DUPLICATE_PROMO_CODE',
        `รหัสโปรโมชัน ${clean.promoCode} มีอยู่ในระบบแล้ว`,
        409
      );
    }
    throw error;
  }
  return getPromotionById(created._id);
}

async function updatePromotion(promotionId, payload = {}) {
  if (!isValidObjectId(promotionId)) {
    throw createAppError('PROMOTION_NOT_FOUND', 'ไม่พบโปรโมชันนี้ในระบบ', 404);
  }
  const existing = await Promotion.findById(promotionId);
  if (!existing) {
    throw createAppError('PROMOTION_NOT_FOUND', 'ไม่พบโปรโมชันนี้ในระบบ', 404);
  }

  const merged = {
    promoCode: payload.promoCode !== undefined ? payload.promoCode : existing.promoCode,
    title: payload.title !== undefined ? payload.title : existing.title,
    description: payload.description !== undefined ? payload.description : existing.description,
    discountType: payload.discountType !== undefined ? payload.discountType : existing.discountType,
    discountValue:
      payload.discountValue !== undefined ? payload.discountValue : existing.discountValue,
    pointsCost: payload.pointsCost !== undefined ? payload.pointsCost : existing.pointsCost,
    minSpend: payload.minSpend !== undefined ? payload.minSpend : existing.minSpend,
    maxDiscount: payload.maxDiscount !== undefined ? payload.maxDiscount : existing.maxDiscount,
    isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
  };
  const clean = validatePromotionPayload(merged);

  const dup = await Promotion.findOne({
    promoCode: clean.promoCode,
    _id: { $ne: existing._id },
  }).lean();
  if (dup) {
    throw createAppError(
      'DUPLICATE_PROMO_CODE',
      `รหัสโปรโมชัน ${clean.promoCode} ถูกใช้งานแล้ว`,
      409
    );
  }

  Object.assign(existing, clean);
  try {
    await existing.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw createAppError(
        'DUPLICATE_PROMO_CODE',
        `รหัสโปรโมชัน ${clean.promoCode} ถูกใช้งานแล้ว`,
        409
      );
    }
    throw error;
  }
  return getPromotionById(existing._id);
}

async function deletePromotion(promotionId) {
  if (!isValidObjectId(promotionId)) {
    throw createAppError('PROMOTION_NOT_FOUND', 'ไม่พบโปรโมชันนี้ในระบบ', 404);
  }
  const existing = await getPromotionById(promotionId);
  if (!existing) {
    throw createAppError('PROMOTION_NOT_FOUND', 'ไม่พบโปรโมชันนี้ในระบบ', 404);
  }
  await Promotion.findByIdAndDelete(existing.promotionId);
  return existing;
}

async function evaluateBenefitForBill({
  memberId,
  benefitType = 'NONE',
  promotionId = null,
  subtotal = 0,
}) {
  const member = await getMemberById(memberId);
  if (!member) {
    throw createAppError('MEMBER_NOT_FOUND', 'ไม่พบข้อมูลสมาชิกในระบบ', 404);
  }
  if (!member.isActive) {
    throw createAppError('MEMBER_INACTIVE', 'บัญชีสมาชิกนี้ถูกระงับการใช้งานชั่วคราว');
  }

  const safeSubtotal = Math.max(0, roundMoney(subtotal));
  const mode = String(benefitType || 'NONE').toUpperCase();

  if (mode === 'NONE') {
    return {
      member,
      benefitType: 'NONE',
      discountAmount: 0,
      pointsToRedeem: 0,
      appliedPromotionId: null,
      appliedPromoCode: '',
      appliedPromoTitle: 'สะสมแต้มสมาชิก (ไม่ใช้คูปอง)',
    };
  }

  if (mode === 'TIER') {
    if (member.discountPercent <= 0) {
      throw createAppError('TIER_NO_DISCOUNT', 'ระดับบัตรสมาชิกปัจจุบันยังไม่มีส่วนลดประจำบัตร');
    }
    const discountAmount = Math.min(
      roundMoney((safeSubtotal * member.discountPercent) / 100),
      safeSubtotal
    );
    return {
      member,
      benefitType: 'TIER',
      discountAmount,
      pointsToRedeem: 0,
      appliedPromotionId: null,
      appliedPromoCode: `TIER_${member.tierCode}`,
      appliedPromoTitle: `สิทธิ์บัตร ${member.tierName} ลด ${member.discountPercent}%`,
    };
  }

  if (mode === 'PROMO') {
    const promo = await getPromotionById(promotionId);
    if (!promo || !promo.isActive) {
      throw createAppError('PROMOTION_UNAVAILABLE', 'คูปองหรือโปรโมชันนี้ไม่เปิดใช้งาน');
    }
    if (safeSubtotal < promo.minSpend) {
      throw createAppError(
        'PROMOTION_MIN_SPEND_NOT_MET',
        `คูปอง ${promo.promoCode} ต้องมียอดอาหารขั้นต่ำ ฿${promo.minSpend.toFixed(2)}`
      );
    }
    if (member.currentPoints < promo.pointsCost) {
      throw createAppError(
        'INSUFFICIENT_MEMBER_POINTS',
        `แต้มสะสมไม่พอสำหรับคูปอง ${promo.promoCode} (ต้องใช้ ${promo.pointsCost} แต้ม แต่มี ${member.currentPoints} แต้ม)`
      );
    }
    const discountAmount = computePromoDiscountAmount(promo, safeSubtotal);
    return {
      member,
      benefitType: 'PROMO',
      discountAmount,
      pointsToRedeem: promo.pointsCost,
      appliedPromotionId: promo.promotionId,
      appliedPromoCode: promo.promoCode,
      appliedPromoTitle: promo.title,
    };
  }

  throw createAppError('INVALID_BENEFIT_TYPE', 'รูปแบบการใช้สิทธิ์ไม่ถูกต้อง');
}

async function settleSessionLoyalty(session, { username = 'staff' } = {}) {
  if (!session || !session.memberId) {
    return null;
  }

  const sessionRef = String(session._id || session.id || '');
  if (!sessionRef) return null;

  const { list, byCode } = await getTierMap();

  const txResult = await withTransaction(async (client) => {
    const found = await findMemberRowByIdOrMongoId(session.memberId, client);
    if (!found) return null;

    const lockedRes = await client.query(
      `SELECT ${MEMBER_SELECT_COLS} FROM members WHERE id = $1 FOR UPDATE`,
      [found.id]
    );
    const memberRow = lockedRes.rows[0];
    if (!memberRow) return null;

    const existingTx = await client.query(
      `SELECT id FROM point_transactions
       WHERE session_ref = $1 AND type IN ('EARN', 'REDEEM')
       LIMIT 1`,
      [sessionRef]
    );

    if (existingTx.rows[0]) {
      return {
        alreadySettled: true,
        memberRow,
        pointsRedeemed: Number(session.pointsToRedeem) || 0,
        pointsEarned: Number(session.pointsEarned) || 0,
      };
    }

    const sqlSessionRes = await client.query(
      `SELECT id FROM sessions WHERE mongo_session_id = $1 LIMIT 1`,
      [sessionRef]
    );
    const sqlSessionId = sqlSessionRes.rows[0] ? sqlSessionRes.rows[0].id : null;

    const currentMember = formatMember(memberRow, byCode);
    const paidAmount = Math.max(0, roundMoney(session.grandTotal));
    const discountAmount = Math.max(0, roundMoney(session.discount));
    const requestedRedeem = Math.max(0, Math.floor(Number(session.pointsToRedeem) || 0));
    const actualRedeem = Math.min(requestedRedeem, currentMember.currentPoints);

    const earnedPoints = calculateEarnedPoints(paidAmount, currentMember.pointsMultiplier);
    const afterRedeemPoints = Math.max(0, currentMember.currentPoints - actualRedeem);
    const nextCurrentPoints = Math.max(0, afterRedeemPoints + earnedPoints);
    const nextLifetimePoints = currentMember.lifetimePoints + earnedPoints;
    const nextTotalSpent = roundMoney(currentMember.totalSpent + paidAmount);
    const nextVisitCount = currentMember.visitCount + 1;

    const targetTier = await resolveTierForPoints(nextLifetimePoints, list);
    const tierUpgraded = targetTier.tierCode !== currentMember.tierCode;

    await client.query(
      `UPDATE members
       SET points_balance = $1,
           lifetime_points = $2,
           total_spent = $3,
           visit_count = $4,
           tier_id = $5,
           tier_name = $6,
           updated_at = NOW()
       WHERE id = $7`,
      [
        nextCurrentPoints,
        nextLifetimePoints,
        nextTotalSpent,
        nextVisitCount,
        targetTier && isUuid(targetTier.id) ? targetTier.id : null,
        targetTier.tierCode,
        memberRow.id,
      ]
    );

    if (actualRedeem > 0 || discountAmount > 0) {
      await client.query(
        `INSERT INTO point_transactions (
           member_id, session_id, session_ref, promotion_id,
           type, points, points_before, points_after,
           discount_amount, bill_amount, description, created_by_ref
         )
         VALUES ($1, $2, $3, $4, 'REDEEM', $5, $6, $7, $8, $9, $10, $11)`,
        [
          memberRow.id,
          sqlSessionId,
          sessionRef,
          isValidObjectId(session.appliedPromotionId) ? String(session.appliedPromotionId) : null,
          -actualRedeem,
          currentMember.currentPoints,
          afterRedeemPoints,
          discountAmount,
          paidAmount,
          session.appliedPromoTitle
            ? `ใช้สิทธิ์: ${session.appliedPromoTitle}`
            : 'ใช้ส่วนลดสมาชิกท้ายบิล',
          username || 'staff',
        ]
      );
    }

    if (earnedPoints > 0) {
      await client.query(
        `INSERT INTO point_transactions (
           member_id, session_id, session_ref, promotion_id,
           type, points, points_before, points_after,
           discount_amount, bill_amount, description, created_by_ref
         )
         VALUES ($1, $2, $3, NULL, 'EARN', $4, $5, $6, 0, $7, $8, $9)`,
        [
          memberRow.id,
          sqlSessionId,
          sessionRef,
          earnedPoints,
          afterRedeemPoints,
          nextCurrentPoints,
          paidAmount,
          `สะสมแต้มจากยอดชำระ ฿${paidAmount.toFixed(2)} (${targetTier.tierName})`,
          username || 'staff',
        ]
      );
    }

    return {
      alreadySettled: false,
      memberId: memberRow.id,
      pointsRedeemed: actualRedeem,
      pointsEarned: earnedPoints,
      newBalance: nextCurrentPoints,
      previousTierName: currentMember.tierName,
      tierUpgraded,
    };
  });

  if (!txResult) return null;
  if (txResult.alreadySettled) {
    const currentMember = await getMemberById(txResult.memberRow.id);
    return {
      alreadySettled: true,
      member: currentMember,
      pointsRedeemed: txResult.pointsRedeemed,
      pointsEarned: txResult.pointsEarned,
    };
  }

  await syncSqlMemberAndRecentTxsToMongo(txResult.memberId);
  const updatedMember = await getMemberById(txResult.memberId);
  return {
    alreadySettled: false,
    member: updatedMember,
    pointsRedeemed: txResult.pointsRedeemed,
    pointsEarned: txResult.pointsEarned,
    newBalance: txResult.newBalance,
    previousTierName: txResult.previousTierName,
    newTierName: updatedMember ? updatedMember.tierName : txResult.previousTierName,
    tierUpgraded: txResult.tierUpgraded,
  };
}

module.exports = {
  DEFAULT_TIERS,
  DEFAULT_PROMOTIONS,
  normalizePhone,
  tryNormalizePhone,
  calculateEarnedPoints,
  computePromoDiscountAmount,
  ensureLoyaltyInitialized,
  listTiers,
  getLoyaltyOverview,
  listMembers,
  getMemberById,
  lookupMember,
  lookupMemberByPhone,
  createMember,
  upsertMemberFromCustomer,
  getPublicMemberCard,
  updateMember,
  deleteMember,
  adjustMemberPoints,
  listTransactions,
  listPromotions,
  getPromotionById,
  createPromotion,
  updatePromotion,
  deletePromotion,
  evaluateBenefitForBill,
  settleSessionLoyalty,
};
