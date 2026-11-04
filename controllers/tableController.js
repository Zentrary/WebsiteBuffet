const mongoose = require('mongoose');
const Table = require('../models/Table');
const Queue = require('../models/Queue');
const ShopSettings = require('../models/ShopSettings');
const { completeSeatedQueues } = require('../services/queueLifecycle');
const { allocateQueueNumber, skipSequence } = require('../services/queueNumbering');
const { upsertMemberFromCustomer } = require('../services/loyaltyService');
const { getBusinessDateKey } = require('../utils/businessDay');
const { createQueueAccessToken, hashQueueAccessToken } = require('../utils/queueAccess');
const { normalizeDiningSelection } = require('../utils/buffetPricing');
const { generateQRCode } = require('../utils/qrGenerator');
const getBaseUrl = require('../utils/getBaseUrl');
const { SESSION_DURATION } = require('../config/constants');
const { calculateEndTime } = require('../utils/timer');
const Session = require('../models/Session');
const { canTransitionTable } = require('../utils/sessionLifecycle');

const ZONE_RULES = {
  small: { minCapacity: 1, maxCapacity: 2 },
  medium: { minCapacity: 3, maxCapacity: 6 },
  large: { minCapacity: 7, maxCapacity: 12 },
};

async function getAllTables(req, res) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.zone) filter.zone = req.query.zone;
    const tables = await Table.find(filter)
      .populate('currentSessionId', '-memberPhone -memberName')
      .sort({ tableNumber: 1 });
    return res.status(200).json({ success: true, data: tables, message: 'ดึงรายการโต๊ะสำเร็จ' });
  } catch (error) {
    console.error('Get tables failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function createTable(req, res) {
  try {
    if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        data: null,
        message: 'You are not allowed to perform this action.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const tableNumber = typeof body.tableNumber === 'string' ? body.tableNumber.trim() : '';
    const capacity = Number(body.capacity);
    const zone = body.zone === undefined ? 'small' : body.zone;
    const rule = ZONE_RULES[zone];

    if (!tableNumber || !Number.isInteger(capacity) || capacity < 1 || !rule) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TABLE_DATA',
        data: null,
        message: 'กรุณาระบุหมายเลขโต๊ะ ความจุเป็นจำนวนเต็มบวก และประเภทโต๊ะที่ถูกต้อง',
      });
    }
    if (capacity < rule.minCapacity || capacity > rule.maxCapacity) {
      return res.status(400).json({
        success: false,
        code: 'CAPACITY_OUT_OF_ZONE_RANGE',
        data: null,
        message: `โซนนี้รับได้ ${rule.minCapacity}-${rule.maxCapacity} คน`,
      });
    }
    const minCapacity = Number(body.minCapacity) || rule.minCapacity;
    if (minCapacity < rule.minCapacity || minCapacity > capacity) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_MIN_CAPACITY',
        data: null,
        message: `ความจุขั้นต่ำต้องอยู่ระหว่าง ${rule.minCapacity} ถึง ${capacity}`,
      });
    }
    if (await Table.exists({ tableNumber })) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_NUMBER_EXISTS',
        data: null,
        message: 'หมายเลขโต๊ะนี้มีอยู่แล้ว กรุณาใช้หมายเลขอื่น',
      });
    }
    const table = await Table.create({ tableNumber, capacity, minCapacity, zone });
    return res.status(201).json({ success: true, data: table, message: 'เพิ่มโต๊ะสำเร็จ' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_NUMBER_EXISTS',
        data: null,
        message: 'หมายเลขโต๊ะนี้มีอยู่แล้ว กรุณาใช้หมายเลขอื่น',
      });
    }
    console.error('Create table failed:', error);
    const status = error.name === 'ValidationError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: status === 400 ? 'INVALID_TABLE_DATA' : 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'ข้อมูลโต๊ะไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function updateTable(req, res) {
  try {
    if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        data: null,
        message: 'You are not allowed to perform this action.',
      });
    }
    const tableId = req.params.tableId || req.params.id;
    const table = await Table.findById(tableId);
    if (!table) {
      return res
        .status(404)
        .json({ success: false, code: 'TABLE_NOT_FOUND', data: null, message: 'ไม่พบโต๊ะนี้' });
    }
    const body = req.body || {};
    const capacity = body.capacity !== undefined ? Number(body.capacity) : table.capacity;
    const zone = body.zone !== undefined ? body.zone : table.zone;
    const rule = ZONE_RULES[zone];
    if (!rule) {
      return res
        .status(400)
        .json({ success: false, code: 'INVALID_ZONE', data: null, message: 'โซนไม่ถูกต้อง' });
    }
    if (!Number.isInteger(capacity) || capacity < rule.minCapacity || capacity > rule.maxCapacity) {
      return res.status(400).json({
        success: false,
        code: 'CAPACITY_OUT_OF_ZONE_RANGE',
        data: null,
        message: `โซนนี้รับได้ ${rule.minCapacity}-${rule.maxCapacity} คน`,
      });
    }
    const minCapacity =
      body.minCapacity !== undefined ? Number(body.minCapacity) : rule.minCapacity;
    if (minCapacity < rule.minCapacity || minCapacity > capacity) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_MIN_CAPACITY',
        data: null,
        message: `ความจุขั้นต่ำต้องอยู่ระหว่าง ${rule.minCapacity} ถึง ${capacity}`,
      });
    }

    const newTableNumber =
      body.tableNumber !== undefined ? String(body.tableNumber).trim() : table.tableNumber;
    if (!newTableNumber) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TABLE_DATA',
        data: null,
        message: 'หมายเลขโต๊ะห้ามว่าง',
      });
    }
    if (newTableNumber !== table.tableNumber) {
      if (table.status !== 'available' || table.currentSessionId) {
        return res.status(409).json({
          success: false,
          code: 'TABLE_IN_USE',
          data: null,
          message: 'เปลี่ยนชื่อโต๊ะได้เฉพาะเมื่อโต๊ะว่างและไม่มีลูกค้าเท่านั้น',
        });
      }
      const duplicate = await Table.exists({
        tableNumber: newTableNumber,
        _id: { $ne: table._id },
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          code: 'TABLE_NUMBER_EXISTS',
          data: null,
          message: 'หมายเลขโต๊ะนี้มีอยู่แล้ว กรุณาใช้หมายเลขอื่น',
        });
      }
    }

    if (zone !== table.zone && table.currentSessionId) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_IN_USE',
        data: null,
        message: 'ไม่สามารถเปลี่ยนโซนได้ขณะมีลูกค้าใช้งานอยู่',
      });
    }

    table.tableNumber = newTableNumber;
    table.capacity = capacity;
    table.minCapacity = minCapacity;
    table.zone = zone;
    await table.save();
    return res.status(200).json({ success: true, data: table, message: 'อัปเดตโต๊ะสำเร็จ' });
  } catch (error) {
    console.error('Update table failed:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_NUMBER_EXISTS',
        data: null,
        message: 'หมายเลขโต๊ะนี้มีอยู่แล้ว',
      });
    }
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function deleteTable(req, res) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        data: null,
        message: 'ลบโต๊ะได้เฉพาะผู้ดูแลระบบ',
      });
    }
    const tableId = req.params.tableId || req.params.id;
    const table = await Table.findById(tableId);
    if (!table) {
      return res
        .status(404)
        .json({ success: false, code: 'TABLE_NOT_FOUND', data: null, message: 'ไม่พบโต๊ะนี้' });
    }
    if (table.status !== 'available' || table.currentSessionId || table.reservedForQueueId) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_IN_USE',
        data: null,
        message: 'ลบได้เฉพาะโต๊ะว่างที่ไม่มีลูกค้า ไม่มีการจอง และไม่มีการทำความสะอาดค้างอยู่',
      });
    }
    const activeSession = await Session.exists({
      tableId: table._id,
      status: { $in: ['active', 'expired'] },
      isPaid: false,
    });
    if (activeSession) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_IN_USE',
        data: null,
        message: 'มีรอบรับประทานที่ยังไม่ปิดอยู่บนโต๊ะนี้ ไม่สามารถลบได้',
      });
    }
    await Table.deleteOne({ _id: table._id });
    const io = req.app.get('io');
    if (io) io.to('admin').to('waiter').emit('table_board_updated');
    return res.status(200).json({
      success: true,
      data: { _id: table._id },
      message: `ลบโต๊ะ ${table.tableNumber} แล้ว`,
    });
  } catch (error) {
    console.error('Delete table failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function updateTableStatus(req, res) {
  return res.status(409).json({
    success: false,
    code: 'TABLE_STATUS_WORKFLOW_REQUIRED',
    data: null,
    message:
      'เปลี่ยนสถานะโต๊ะด้วยตนเองไม่ได้ กรุณาทำรายการผ่านขั้นตอนเรียกคิว ชำระเงิน และทำความสะอาด',
  });
}

async function clearTable(req, res) {
  try {
    const tableId = req.params.tableId || req.params.id;
    const currentTable = await Table.findById(tableId);
    if (!currentTable) {
      return res
        .status(404)
        .json({ success: false, code: 'TABLE_NOT_FOUND', data: null, message: 'ไม่พบโต๊ะนี้' });
    }
    if (currentTable.status !== 'cleaning') {
      return res.status(409).json({
        success: false,
        code: 'TABLE_NOT_CLEANING',
        data: null,
        message: 'ทำความสะอาดได้เฉพาะโต๊ะที่ชำระเงินแล้วและอยู่ในสถานะรอทำความสะอาด',
      });
    }
    let session = null;
    if (currentTable.lastSessionId) {
      session = await Session.findOne({ _id: currentTable.lastSessionId, isPaid: true });
    }
    if (!session) {
      session = await Session.findOne({ tableId: currentTable._id, isPaid: true }).sort({
        paidAt: -1,
        updatedAt: -1,
      });
    }
    if (!session) {
      console.warn(
        '[clearTable] no paid session found for',
        currentTable.tableNumber,
        '- clearing anyway'
      );
    }
    const lastSessionId = currentTable.lastSessionId || (session && session._id) || null;
    const table = await Table.findOneAndUpdate(
      { _id: currentTable._id, status: 'cleaning' },
      {
        $set: {
          status: 'available',
          currentSessionId: null,
          reservedForQueueId: null,
          lastSessionId,
        },
      },
      { new: true, runValidators: true }
    );
    if (!table) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_STATE_CHANGED',
        data: null,
        message: 'สถานะโต๊ะเปลี่ยนไปแล้ว กรุณาโหลดผังโต๊ะใหม่',
      });
    }

    try {
      await completeSeatedQueues(
        {
          $or: [{ tableId: table._id }, ...(lastSessionId ? [{ sessionId: lastSessionId }] : [])],
        },
        { io: req.app.get('io'), reason: 'table cleared' }
      );
    } catch (queueError) {
      console.error('Closing seated queue after clearTable failed:', queueError);
    }

    const io = req.app.get('io');
    if (io) {
      io.to('admin').to('waiter').emit('table_cleared', table);
      io.emit('table_board_updated');
    }
    return res.status(200).json({ success: true, data: table, message: 'เคลียร์โต๊ะสำเร็จ' });
  } catch (error) {
    console.error('Clear table failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function getAvailableTables(req, res) {
  try {
    const tables = await Table.find({ status: 'available' }).sort({ capacity: 1 });
    return res.status(200).json({ success: true, data: tables, message: 'ดึงโต๊ะว่างสำเร็จ' });
  } catch (error) {
    console.error('Get available tables failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function openWalkinTable(req, res) {
  let claimedTable = null;
  let createdQueue = null;
  let createdSession = null;
  try {
    const tableId = req.params.tableId;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({
        success: false,
        code: 'TABLE_NOT_FOUND',
        data: null,
        message: 'ไม่พบโต๊ะที่ต้องการเปิด',
      });
    }
    if (table.status !== 'available' || table.currentSessionId) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_NOT_AVAILABLE',
        data: null,
        message: 'โต๊ะนี้ไม่ว่างในขณะนี้ กรุณาเลือกโต๊ะสถานะว่าง',
      });
    }

    const customerCount = Number(body.customerCount);
    const minCap = Number(table.minCapacity) || 1;
    const maxCap = Number(table.capacity) || 12;
    if (!Number.isInteger(customerCount) || customerCount < 1 || customerCount > maxCap) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PARTY_SIZE',
        data: null,
        message: `จำนวนลูกค้าต้องอยู่ระหว่าง 1 ถึง ${maxCap} ท่าน (ตามความจุโต๊ะ ${table.tableNumber})`,
      });
    }
    if (customerCount < minCap && !body.allowUnderMinCapacity) {
    }

    const customerName = String(body.customerName || '')
      .trim()
      .slice(0, 80);
    const customerPhone = String(body.customerPhone || '')
      .replace(/[^\d+]/g, '')
      .slice(0, 15);

    const shopSettings = await ShopSettings.findById('shop-settings').lean();
    const diningDuration = Number.isInteger(shopSettings && shopSettings.diningDurationMinutes)
      ? shopSettings.diningDurationMinutes
      : SESSION_DURATION;
    const diningSelection = normalizeDiningSelection(body, shopSettings);

    claimedTable = await Table.findOneAndUpdate(
      { _id: table._id, status: 'available', currentSessionId: null },
      { $set: { status: 'occupied' } },
      { new: true }
    );
    if (!claimedTable) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_BUSY',
        data: null,
        message: 'โต๊ะนี้เพิ่งถูกเปิดใช้งานโดยพนักงานท่านอื่น',
      });
    }

    let sessionLoyaltyInit = {};
    let enrolledMember = null;
    if (customerPhone && mongoose.connection.readyState === 1) {
      try {
        enrolledMember = await upsertMemberFromCustomer({
          fullName: customerName,
          phone: customerPhone,
          source: 'walkin',
        });
        if (enrolledMember && enrolledMember.member && enrolledMember.member.isActive) {
          sessionLoyaltyInit = {
            memberId: enrolledMember.member.memberId,
            memberPhone: enrolledMember.member.phone,
            memberName: enrolledMember.member.fullName,
            memberTierName: enrolledMember.member.tierName,
            benefitType: 'NONE',
          };
        }
      } catch (memberError) {
        console.warn('Walk-in member auto-link skipped:', memberError.message);
      }
    }

    const now = new Date();
    const businessDate = getBusinessDateKey(shopSettings, now);
    const accessToken = createQueueAccessToken();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allocation = await allocateQueueNumber(businessDate);
      try {
        createdQueue = await Queue.create({
          queueNumber: allocation.queueNumber,
          businessDate,
          sequence: allocation.sequence,
          customerCount,
          diningStyle: diningSelection.diningStyle,
          buffetPackageCode: diningSelection.buffetPackageCode,
          hasRefillDrink: diningSelection.hasRefillDrink,
          customerName,
          customerPhone,
          ...(enrolledMember && enrolledMember.member
            ? { memberId: enrolledMember.member.memberId }
            : {}),
          accessTokenHash: hashQueueAccessToken(accessToken),
          status: 'seated',
          calledAt: now,
          seatedAt: now,
          tableId: claimedTable._id,
          assignedTableId: claimedTable._id,
          preferredZone: claimedTable.zone || null,
          autoAssign: false,
          assignmentNote: 'เปิดโต๊ะหน้าร้าน (Walk-in)',
        });
        break;
      } catch (err) {
        const dup = err.code === 11000 && String(err.message || '').includes('queueNumber');
        if (!dup) throw err;
        await skipSequence(businessDate, allocation.sequence).catch(() => {});
      }
    }
    if (!createdQueue) {
      throw new Error('ไม่สามารถออกเลขคิวสำหรับเปิดโต๊ะหน้าร้านได้');
    }

    createdSession = await Session.create({
      queueId: createdQueue._id,
      tableId: claimedTable._id,
      customerCount,
      ...diningSelection,
      startTime: now,
      endTime: calculateEndTime(now, diningDuration),
      status: 'active',
      ...sessionLoyaltyInit,
    });

    createdQueue.sessionId = createdSession._id;
    await createdQueue.save();

    const updatedTable = await Table.findByIdAndUpdate(
      claimedTable._id,
      {
        $set: {
          status: 'occupied',
          currentSessionId: createdSession._id,
          reservedForQueueId: null,
        },
      },
      { new: true }
    );

    const menuUrl = `${getBaseUrl(req)}/menu.html?sessionId=${createdSession._id}`;
    const qrCodeData = await generateQRCode(menuUrl);

    const io = req.app.get('io');
    if (io) {
      io.emit('table_board_updated');
      io.emit('queue_board_updated');
    }

    return res.status(201).json({
      success: true,
      data: {
        table: updatedTable,
        session: createdSession,
        queue: createdQueue,
        qrSlip: {
          restaurantName: (shopSettings && shopSettings.restaurantName) || 'Shabu Restaurant',
          tableNumber: updatedTable.tableNumber,
          queueNumber: createdQueue.queueNumber,
          sessionId: createdSession._id,
          customerCount,
          diningStyle: createdSession.diningStyle,
          buffetPackageCode: createdSession.buffetPackageCode,
          buffetPackageName: createdSession.buffetPackageName,
          buffetPricePerPerson: createdSession.buffetPricePerPerson,
          hasRefillDrink: createdSession.hasRefillDrink,
          refillPricePerPerson: createdSession.refillPricePerPerson,
          startTime: createdSession.startTime,
          endTime: createdSession.endTime,
          menuUrl,
          qrCodeData,
        },
      },
      message: `เปิดโต๊ะ ${updatedTable.tableNumber} สำเร็จ`,
    });
  } catch (error) {
    console.error('Open walk-in table failed:', error);
    if (createdSession) {
      await Session.findByIdAndDelete(createdSession._id).catch(() => {});
    }
    if (createdQueue) {
      await Queue.findByIdAndDelete(createdQueue._id).catch(() => {});
    }
    if (claimedTable) {
      await Table.findByIdAndUpdate(claimedTable._id, {
        $set: { status: 'available', currentSessionId: null, reservedForQueueId: null },
      }).catch(() => {});
    }
    return res.status(500).json({
      success: false,
      code: 'OPEN_WALKIN_FAILED',
      data: null,
      message: error.message || 'ไม่สามารถเปิดโต๊ะหน้าร้านได้',
    });
  }
}

async function getTableOrderingQr(req, res) {
  try {
    const table = await Table.findById(req.params.tableId);
    if (!table) {
      return res
        .status(404)
        .json({ success: false, code: 'TABLE_NOT_FOUND', data: null, message: 'ไม่พบข้อมูลโต๊ะ' });
    }
    let session = null;
    if (table.currentSessionId) {
      session = await Session.findById(table.currentSessionId).populate(
        'queueId',
        'queueNumber customerCount'
      );
    } else if (table.reservedForQueueId) {
      const q = await Queue.findById(table.reservedForQueueId);
      if (q && q.sessionId) {
        session = await Session.findById(q.sessionId).populate(
          'queueId',
          'queueNumber customerCount'
        );
      }
    }
    if (!session || session.status !== 'active') {
      return res.status(404).json({
        success: false,
        code: 'ACTIVE_SESSION_NOT_FOUND',
        data: null,
        message: 'โต๊ะนี้ยังไม่มีรอบรับประทานที่กำลังใช้งานอยู่',
      });
    }

    const shopSettings = await ShopSettings.findById('shop-settings')
      .select('restaurantName')
      .lean();
    const menuUrl = `${getBaseUrl(req)}/menu.html?sessionId=${session._id}`;
    const qrCodeData = await generateQRCode(menuUrl);

    return res.status(200).json({
      success: true,
      data: {
        restaurantName: (shopSettings && shopSettings.restaurantName) || 'Shabu Restaurant',
        tableNumber: table.tableNumber,
        queueNumber: (session.queueId && session.queueId.queueNumber) || '-',
        sessionId: session._id,
        customerCount:
          session.customerCount || (session.queueId && session.queueId.customerCount) || 1,
        diningStyle: session.diningStyle || 'alacarte',
        buffetPackageCode: session.buffetPackageCode || '',
        buffetPackageName: session.buffetPackageName || '',
        buffetPricePerPerson: session.buffetPricePerPerson || 0,
        hasRefillDrink: Boolean(session.hasRefillDrink),
        refillPricePerPerson: session.refillPricePerPerson || 0,
        startTime: session.startTime,
        endTime: session.endTime,
        menuUrl,
        qrCodeData,
      },
      message: 'สร้างใบ QR สั่งอาหารสำเร็จ',
    });
  } catch (error) {
    console.error('Get table ordering QR failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถสร้างใบ QR สั่งอาหารได้',
    });
  }
}

module.exports = {
  getAllTables,
  createTable,
  updateTable,
  deleteTable,
  updateTableStatus,
  clearTable,
  getAvailableTables,
  openWalkinTable,
  getTableOrderingQr,
  ZONE_RULES,
};
