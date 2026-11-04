const ExcelJS = require('exceljs');
const { isSqlReady, testSQLConnection, querySQL } = require('../config/db.sql');
const loyaltyService = require('../services/loyaltyService');
const { recordAudit } = require('../utils/auditLog');

function sendMemberError(res, error, fallbackMessage = 'ไม่สามารถดำเนินการกับข้อมูลสมาชิกได้') {
  const status =
    error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  if (status >= 500) {
    console.error('[memberController]', error.message);
  }
  return res.status(status).json({
    success: false,
    code: error.code || 'MEMBER_REQUEST_FAILED',
    data: null,
    message: error.message || fallbackMessage,
  });
}

async function getStatus(_req, res) {
  const connected = isSqlReady() || (await testSQLConnection());
  return res.status(200).json({
    success: true,
    data: {
      connected: Boolean(connected),
      engine: 'postgresql',
      database: 'Supabase PostgreSQL',
    },
    message: 'ตรวจสอบสถานะระบบสมาชิกสำเร็จ',
  });
}

async function getOverview(_req, res) {
  try {
    const data = await loyaltyService.getLoyaltyOverview();
    return res.status(200).json({
      success: true,
      data,
      message: 'ดึงภาพรวมระบบสมาชิกและโปรโมชันสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function getTiers(_req, res) {
  try {
    const data = await loyaltyService.listTiers();
    return res.status(200).json({
      success: true,
      data,
      message: 'ดึงข้อมูลระดับบัตรสมาชิกสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function getMembers(req, res) {
  try {
    const data = await loyaltyService.listMembers({
      search: req.query.search || '',
      tierCode: req.query.tierCode || '',
      activeOnly: req.query.activeOnly === 'true',
    });
    return res.status(200).json({
      success: true,
      data,
      message: 'ดึงรายชื่อสมาชิกสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function lookupMember(req, res) {
  try {
    const query = req.query.q || req.query.query || '';
    const phone = req.query.phone || '';
    const memberId = req.query.memberId || '';
    const subtotal = Number(req.query.subtotal) || 0;
    const data = await loyaltyService.lookupMember({ query, phone, memberId, subtotal });
    return res.status(200).json({
      success: true,
      data,
      message: data.found ? 'พบข้อมูลสมาชิก' : 'ไม่พบข้อมูลสมาชิกที่ค้นหา',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function createMember(req, res) {
  try {
    const createdBy = (req.user && req.user.username) || 'staff';
    const registeredVia = req.user && req.user.role === 'admin' ? 'admin' : 'staff';
    const data = await loyaltyService.createMember({
      prefix: req.body.prefix,
      fullName: req.body.fullName,
      nickname: req.body.nickname,
      age: req.body.age,
      phone: req.body.phone,
      email: req.body.email,
      initialPoints: req.body.initialPoints,
      registeredVia,
      createdBy,
    });
    return res.status(201).json({
      success: true,
      data,
      message: 'สมัครสมาชิกใหม่สำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function publicRegisterMember(req, res) {
  try {
    const prefix = String((req.body && req.body.prefix) || '').trim();
    const fullName = String((req.body && req.body.fullName) || '').trim();
    const nickname = String((req.body && req.body.nickname) || '').trim();
    const age = req.body ? req.body.age : null;
    const phone = String((req.body && req.body.phone) || '').trim();
    const email = String((req.body && req.body.email) || '').trim();

    if (!fullName) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_MEMBER_NAME',
        data: null,
        message: 'กรุณากรอกชื่อ-นามสกุลของสมาชิก',
      });
    }
    loyaltyService.normalizePhone(phone);

    const enrolled = await loyaltyService.upsertMemberFromCustomer({
      prefix,
      fullName,
      nickname,
      age,
      phone,
      email,
      source: 'web',
    });
    const card = await loyaltyService.getPublicMemberCard(phone);

    return res.status(enrolled.isNewMember ? 201 : 200).json({
      success: true,
      data: {
        ...card,
        isNewMember: enrolled.isNewMember,
      },
      message: enrolled.isNewMember
        ? 'สมัครสมาชิกสำเร็จ พร้อมสะสมแต้มได้ทันที'
        : 'เบอร์โทรศัพท์นี้เป็นสมาชิกอยู่แล้ว ระบบแสดงบัตรสมาชิกของคุณ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function publicCheckMember(req, res) {
  try {
    const phone = String(req.query.phone || '').trim();
    const card = await loyaltyService.getPublicMemberCard(phone);
    return res.status(200).json({
      success: true,
      data: card,
      message: card.found ? 'พบข้อมูลบัตรสมาชิก' : 'ยังไม่พบเบอร์โทรศัพท์นี้ในระบบสมาชิก',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function updateMember(req, res) {
  try {
    const data = await loyaltyService.updateMember(req.params.id, req.body || {});
    return res.status(200).json({
      success: true,
      data,
      message: 'บันทึกข้อมูลสมาชิกสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function deleteMember(req, res) {
  try {
    const data = await loyaltyService.deleteMember(req.params.id);
    recordAudit(req, {
      action: 'MEMBER_DELETE',
      targetType: 'Member',
      targetId: req.params.id,
      summary: `ลบข้อมูลสมาชิก ID ${req.params.id}`,
    });
    return res.status(200).json({
      success: true,
      data,
      message: 'ลบข้อมูลสมาชิกสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function adjustPoints(req, res) {
  try {
    const createdBy = (req.user && req.user.username) || 'admin';
    const data = await loyaltyService.adjustMemberPoints(req.params.id, {
      pointsDelta: req.body.pointsDelta,
      note: req.body.note,
      createdBy,
    });
    recordAudit(req, {
      action: 'MEMBER_ADJUST_POINTS',
      targetType: 'Member',
      targetId: req.params.id,
      summary: `ปรับแต้มสมาชิก (${req.body.pointsDelta}) หมายเหตุ: ${String(req.body.note || '-').slice(0, 80)}`,
    });
    return res.status(200).json({
      success: true,
      data,
      message: 'ปรับปรุงแต้มสะสมสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function getTransactions(req, res) {
  try {
    const data = await loyaltyService.listTransactions({
      memberId: req.query.memberId,
      limit: req.query.limit || 50,
    });
    return res.status(200).json({
      success: true,
      data,
      message: 'ดึงประวัติการใช้แต้มและคูปองสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function getPromotions(req, res) {
  try {
    const data = await loyaltyService.listPromotions({
      activeOnly: req.query.activeOnly === 'true',
    });
    return res.status(200).json({
      success: true,
      data,
      message: 'ดึงรายการคูปองและโปรโมชันสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function createPromotion(req, res) {
  try {
    const data = await loyaltyService.createPromotion(req.body || {});
    return res.status(201).json({
      success: true,
      data,
      message: 'สร้างโปรโมชัน/คูปองใหม่สำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

async function updatePromotion(req, res) {
  try {
    const data = await loyaltyService.updatePromotion(req.params.id, req.body || {});
    return res.status(200).json({
      success: true,
      data,
      message: 'อัปเดตโปรโมชัน/คูปองสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

async function loadMemberExportData() {
  const [members, promotions] = await Promise.all([
    loyaltyService.listMembers({}),
    loyaltyService.listPromotions({}),
  ]);
  const txRes = await querySQL(
    `SELECT
       pt.id,
       pt.type,
       pt.points,
       pt.discount_amount,
       pt.bill_amount,
       pt.description,
       pt.session_ref,
       pt.created_by_ref,
       pt.created_at,
       m.member_id AS member_code,
       m.full_name AS member_name,
       m.phone AS member_phone
     FROM point_transactions pt
     LEFT JOIN members m ON m.id = pt.member_id
     ORDER BY pt.created_at DESC
     LIMIT 5000`
  );
  return { members, promotions, transactions: txRes.rows || [] };
}

async function exportMembers(req, res) {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const { members, promotions, transactions } = await loadMemberExportData();
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const rows = [
        ['สมาชิก'],
        [
          'รหัสสมาชิก',
          'ชื่อ',
          'ชื่อเล่น',
          'เบอร์โทร',
          'อีเมล',
          'ระดับ',
          'แต้มคงเหลือ',
          'แต้มสะสมทั้งชีวิต',
          'ยอดใช้จ่าย',
          'จำนวนครั้ง',
          'สถานะ',
          'สมัครเมื่อ',
        ],
        ...members.map((member) => [
          member.memberCode,
          member.fullName,
          member.nickname,
          member.phone,
          member.email,
          member.tierName,
          member.currentPoints,
          member.lifetimePoints,
          member.totalSpent,
          member.visitCount,
          member.isActive ? 'ใช้งาน' : 'ปิดใช้งาน',
          member.createdAt ? new Date(member.createdAt).toISOString() : '',
        ]),
        [],
        ['ธุรกรรมแต้ม'],
        ['เวลา', 'รหัสสมาชิก', 'ชื่อ', 'เบอร์โทร', 'ประเภท', 'แต้ม', 'ส่วนลด', 'ยอดบิล', 'หมายเหตุ'],
        ...transactions.map((tx) => [
          tx.created_at ? new Date(tx.created_at).toISOString() : '',
          tx.member_code || '',
          tx.member_name || '',
          tx.member_phone || '',
          tx.type || '',
          tx.points || 0,
          tx.discount_amount || 0,
          tx.bill_amount || 0,
          tx.description || '',
        ]),
        [],
        ['โปรโมชัน'],
        ['รหัส', 'ชื่อ', 'ประเภทส่วนลด', 'มูลค่า', 'แต้มที่ใช้', 'ยอดขั้นต่ำ', 'สถานะ'],
        ...promotions.map((promo) => [
          promo.promoCode,
          promo.title,
          promo.discountType,
          promo.discountValue,
          promo.pointsCost,
          promo.minSpend,
          promo.isActive ? 'ใช้งาน' : 'ปิด',
        ]),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="members-${stamp}.csv"`);
      return res.status(200).send(toCsv(rows));
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'WebsiteBuffet';
    const memberSheet = workbook.addWorksheet('Members');
    memberSheet.columns = [
      { header: 'รหัสสมาชิก', key: 'memberCode', width: 16 },
      { header: 'ชื่อ', key: 'fullName', width: 24 },
      { header: 'ชื่อเล่น', key: 'nickname', width: 16 },
      { header: 'เบอร์โทร', key: 'phone', width: 16 },
      { header: 'อีเมล', key: 'email', width: 24 },
      { header: 'ระดับ', key: 'tierName', width: 16 },
      { header: 'แต้มคงเหลือ', key: 'currentPoints', width: 14 },
      { header: 'แต้มสะสมทั้งชีวิต', key: 'lifetimePoints', width: 18 },
      { header: 'ยอดใช้จ่าย', key: 'totalSpent', width: 14 },
      { header: 'จำนวนครั้ง', key: 'visitCount', width: 12 },
      { header: 'สถานะ', key: 'status', width: 12 },
      { header: 'สมัครเมื่อ', key: 'createdAt', width: 22 },
    ];
    members.forEach((member) => {
      memberSheet.addRow({
        memberCode: member.memberCode,
        fullName: member.fullName,
        nickname: member.nickname,
        phone: member.phone,
        email: member.email,
        tierName: member.tierName,
        currentPoints: member.currentPoints,
        lifetimePoints: member.lifetimePoints,
        totalSpent: member.totalSpent,
        visitCount: member.visitCount,
        status: member.isActive ? 'ใช้งาน' : 'ปิดใช้งาน',
        createdAt: member.createdAt ? new Date(member.createdAt) : '',
      });
    });
    memberSheet.getRow(1).font = { bold: true };

    const txSheet = workbook.addWorksheet('Point Transactions');
    txSheet.columns = [
      { header: 'เวลา', key: 'createdAt', width: 22 },
      { header: 'รหัสสมาชิก', key: 'memberCode', width: 16 },
      { header: 'ชื่อ', key: 'memberName', width: 24 },
      { header: 'เบอร์โทร', key: 'phone', width: 16 },
      { header: 'ประเภท', key: 'type', width: 12 },
      { header: 'แต้ม', key: 'points', width: 10 },
      { header: 'ส่วนลด', key: 'discount', width: 12 },
      { header: 'ยอดบิล', key: 'bill', width: 12 },
      { header: 'หมายเหตุ', key: 'note', width: 36 },
    ];
    transactions.forEach((tx) => {
      txSheet.addRow({
        createdAt: tx.created_at ? new Date(tx.created_at) : '',
        memberCode: tx.member_code || '',
        memberName: tx.member_name || '',
        phone: tx.member_phone || '',
        type: tx.type || '',
        points: Number(tx.points) || 0,
        discount: Number(tx.discount_amount) || 0,
        bill: Number(tx.bill_amount) || 0,
        note: tx.description || '',
      });
    });
    txSheet.getRow(1).font = { bold: true };

    const promoSheet = workbook.addWorksheet('Promotions');
    promoSheet.columns = [
      { header: 'รหัส', key: 'promoCode', width: 16 },
      { header: 'ชื่อ', key: 'title', width: 28 },
      { header: 'รายละเอียด', key: 'description', width: 36 },
      { header: 'ประเภทส่วนลด', key: 'discountType', width: 14 },
      { header: 'มูลค่า', key: 'discountValue', width: 12 },
      { header: 'แต้มที่ใช้', key: 'pointsCost', width: 12 },
      { header: 'ยอดขั้นต่ำ', key: 'minSpend', width: 12 },
      { header: 'สถานะ', key: 'status', width: 12 },
    ];
    promotions.forEach((promo) => {
      promoSheet.addRow({
        promoCode: promo.promoCode,
        title: promo.title,
        description: promo.description || '',
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        pointsCost: promo.pointsCost,
        minSpend: promo.minSpend,
        status: promo.isActive ? 'ใช้งาน' : 'ปิด',
      });
    });
    promoSheet.getRow(1).font = { bold: true };

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="members-${stamp}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return sendMemberError(res, error, 'ไม่สามารถส่งออกข้อมูลสมาชิกได้');
  }
}

async function deletePromotion(req, res) {
  try {
    const data = await loyaltyService.deletePromotion(req.params.id);
    return res.status(200).json({
      success: true,
      data,
      message: 'ลบโปรโมชัน/คูปองสำเร็จ',
    });
  } catch (error) {
    return sendMemberError(res, error);
  }
}

module.exports = {
  getStatus,
  getOverview,
  getTiers,
  getMembers,
  lookupMember,
  createMember,
  publicRegisterMember,
  publicCheckMember,
  updateMember,
  deleteMember,
  adjustPoints,
  getTransactions,
  getPromotions,
  exportMembers,
  createPromotion,
  updatePromotion,
  deletePromotion,
};
