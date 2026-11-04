const mongoose = require('mongoose');
const Queue = require('../models/Queue');
const QueueCounter = require('../models/QueueCounter');
const { upsertMemberFromCustomer, getMemberById } = require('../services/loyaltyService');
const {
  getBusinessDateKey,
  getBusinessDayRange,
  getQueueAcceptance,
} = require('../utils/businessDay');
const { completeQueueById } = require('../services/queueLifecycle');
const { allocateQueueNumber, queueCounterId, skipSequence } = require('../services/queueNumbering');
const Table = require('../models/Table');
const Session = require('../models/Session');
const Order = require('../models/Order');
const ShopSettings = require('../models/ShopSettings');
const getBaseUrl = require('../utils/getBaseUrl');
const { generateQRCode } = require('../utils/qrGenerator');
const { SESSION_DURATION } = require('../config/constants');
const { calculateEndTime } = require('../utils/timer');
const {
  canCompleteQueue,
  canTransitionQueue,
  canTransitionTable,
  isSeatedQueueActive,
} = require('../utils/sessionLifecycle');
const sqlBridge = require('../services/sqlBridge');
const {
  createQueueAccessToken,
  hashQueueAccessToken,
  hasQueueAccess,
} = require('../utils/queueAccess');
const { normalizeDiningSelection } = require('../utils/buffetPricing');

const MAX_PARTY_SIZE = 12;
const ZONE_RULES = {
  small: { minCapacity: 1, maxCapacity: 2, label: 'โต๊ะเล็ก' },
  medium: { minCapacity: 3, maxCapacity: 6, label: 'โต๊ะกลาง' },
  large: { minCapacity: 7, maxCapacity: 12, label: 'โต๊ะใหญ่' },
};

function zoneForCount(count) {
  if (count <= 2) return 'small';
  if (count <= 6) return 'medium';
  if (count <= 12) return 'large';
  return null;
}

function zoneLabel(zone) {
  return (ZONE_RULES[zone] && ZONE_RULES[zone].label) || zone;
}

async function loadSettings() {
  return ShopSettings.findById('shop-settings').lean();
}

async function getQueueStatus(queue) {
  const settings = await loadSettings();
  const diningSelection = normalizeDiningSelection(
    {
      diningStyle: queue.diningStyle || 'alacarte',
      buffetPackageCode: queue.buffetPackageCode || '',
      hasRefillDrink: Boolean(queue.hasRefillDrink),
    },
    settings
  );
  const { start: startOfDay, end: endOfDay } = getBusinessDayRange(
    settings,
    queue.createdAt || new Date(),
    1
  );
  const [waitingAhead, waitingCount, session] = await Promise.all([
    queue.status === 'waiting'
      ? Queue.countDocuments({
          status: 'waiting',
          $or: [
            { createdAt: { $gte: startOfDay, $lt: queue.createdAt } },
            { createdAt: queue.createdAt, _id: { $lt: queue._id } },
          ],
        })
      : 0,
    Queue.countDocuments({
      status: 'waiting',
      createdAt: { $gte: startOfDay, $lt: endOfDay },
    }),
    queue.sessionId ? Session.findById(queue.sessionId).select('endTime startTime status') : null,
  ]);
  return {
    _id: queue._id,
    queueNumber: queue.queueNumber,
    businessDate: queue.businessDate || null,
    customerCount: queue.customerCount,
    diningStyle: diningSelection.diningStyle,
    buffetPackageCode: diningSelection.buffetPackageCode,
    buffetPackageName: diningSelection.buffetPackageName,
    buffetPricePerPerson: diningSelection.buffetPricePerPerson,
    hasRefillDrink: diningSelection.hasRefillDrink,
    refillPricePerPerson: diningSelection.refillPricePerPerson,
    status: queue.status,
    createdAt: queue.createdAt,
    calledAt: queue.calledAt,
    seatedAt: queue.seatedAt,
    waitingAhead,
    waitingCount,
    tableNumber: queue.tableId && queue.tableId.tableNumber,
    preferredZone: queue.preferredZone || null,
    preferredTableId: queue.preferredTableId || null,
    assignedTableId: queue.assignedTableId || null,
    assignmentNote: queue.assignmentNote || '',
    sessionId: queue.sessionId,
    startTime: session && session.startTime,
    endTime: session && session.endTime,
  };
}

function getAccessToken(req) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : (req.body && req.body.accessToken) || '';
}

function normalizePreferredTable(preferredTableId) {
  if (!preferredTableId) return null;
  const value = String(preferredTableId).trim();
  if (!/^[a-f\d]{24}$/i.test(value)) return null;
  return value;
}

async function createQueue(req, res) {
  try {
    const { customerCount, customerName, customerPhone, preferredZone, preferredTableId } =
      req.body;
    const count = Number(customerCount);

    if (!Number.isInteger(count) || count < 1 || count > MAX_PARTY_SIZE) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PARTY_SIZE',
        data: null,
        message: `จำนวนลูกค้าต้องอยู่ระหว่าง 1-${MAX_PARTY_SIZE} คน กรุณาแยกการจองหากเกิน ${MAX_PARTY_SIZE} คน`,
      });
    }

    const expectedZone = zoneForCount(count);
    let zone = preferredZone ? String(preferredZone) : null;
    if (zone && !ZONE_RULES[zone]) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ZONE',
        data: null,
        message: 'โซนที่เลือกไม่ถูกต้อง',
      });
    }
    if (!zone) zone = expectedZone;
    const rule = ZONE_RULES[zone];
    if (count < rule.minCapacity || count > rule.maxCapacity) {
      return res.status(400).json({
        success: false,
        code: 'ZONE_CAPACITY_MISMATCH',
        data: null,
        message: `${rule.label}รับ ${rule.minCapacity}-${rule.maxCapacity} คน ลูกค้า ${count} คนไม่เข้าเกณฑ์`,
      });
    }

    let preferredTable = null;
    const normalizedTableId = normalizePreferredTable(preferredTableId);
    if (normalizedTableId) {
      preferredTable = await Table.findById(normalizedTableId);
      if (!preferredTable) {
        return res.status(400).json({
          success: false,
          code: 'TABLE_NOT_FOUND',
          data: null,
          message: 'ไม่พบโต๊ะที่เลือก',
        });
      }
      if (preferredTable.zone !== zone) {
        return res.status(400).json({
          success: false,
          code: 'TABLE_ZONE_MISMATCH',
          data: null,
          message: 'โต๊ะที่เลือกไม่ตรงกับโซน',
        });
      }
      if (count < preferredTable.minCapacity || count > preferredTable.capacity) {
        return res.status(400).json({
          success: false,
          code: 'TABLE_CAPACITY_MISMATCH',
          data: null,
          message: `โต๊ะนี้รับ ${preferredTable.minCapacity}-${preferredTable.capacity} คน`,
        });
      }
      if (preferredTable.status !== 'available') {
        return res.status(409).json({
          success: false,
          code: 'TABLE_NOT_AVAILABLE',
          data: null,
          message: 'โต๊ะนี้ไม่ว่างในขณะนี้ กรุณาเลือกโต๊ะอื่นหรือปล่อยให้พนักงานจัดให้',
        });
      }
    }

    const accessToken = createQueueAccessToken();
    const now = new Date();
    const shopSettings = await loadSettings();
    const diningSelection = normalizeDiningSelection(req.body || {}, shopSettings);
    const businessDate = getBusinessDateKey(shopSettings, now);
    const { start: startOfDay, end: endOfDay } = getBusinessDayRange(shopSettings, now, 1);
    const waitingAhead = await Queue.countDocuments({
      status: 'waiting',
      createdAt: { $gte: startOfDay, $lt: endOfDay },
    });

    let enrolledMember = null;
    if (customerPhone && mongoose.connection.readyState === 1) {
      try {
        enrolledMember = await upsertMemberFromCustomer({
          fullName: customerName,
          phone: customerPhone,
          source: 'queue',
        });
      } catch (memberError) {
        console.warn('Auto-enrolling member from queue skipped:', memberError.message);
      }
    }

    let queueNumber;
    let queue;
    let lastDuplicate = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allocation = await allocateQueueNumber(businessDate);
      queueNumber = allocation.queueNumber;
      try {
        queue = await Queue.create({
          queueNumber,
          businessDate,
          sequence: allocation.sequence,
          customerCount: count,
          diningStyle: diningSelection.diningStyle,
          buffetPackageCode: diningSelection.buffetPackageCode,
          hasRefillDrink: diningSelection.hasRefillDrink,
          customerName,
          customerPhone,
          ...(enrolledMember && enrolledMember.member
            ? { memberId: enrolledMember.member.memberId }
            : {}),
          accessTokenHash: hashQueueAccessToken(accessToken),
          preferredZone: zone,
          preferredTableId: preferredTable ? preferredTable._id : null,
          autoAssign: !preferredTable,
        });
        break;
      } catch (error) {
        const duplicateQueueNumber =
          error.code === 11000 && String(error.message || '').includes('queueNumber');
        if (!duplicateQueueNumber) throw error;
        lastDuplicate = error;

        await skipSequence(businessDate, allocation.sequence).catch(() => {});
        console.warn(`Queue number ${queueNumber} collided; allocating the next one.`);
      }
    }
    if (!queue) {
      throw Object.assign(new Error('คิวหมายเลขซ้ำกันบ่อยเกินไป กรุณากดลองอีกครั้ง'), {
        code: 'QUEUE_NUMBER_CONFLICT',
        cause: lastDuplicate,
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('new_queue', {
        _id: queue._id,
        queueNumber: queue.queueNumber,
        customerCount: queue.customerCount,
        diningStyle: queue.diningStyle,
        buffetPackageCode: queue.buffetPackageCode,
        hasRefillDrink: queue.hasRefillDrink,
        status: queue.status,
        preferredZone: queue.preferredZone,
        preferredTableId: queue.preferredTableId,
        createdAt: queue.createdAt,
      });
      io.to('customer').emit('queue_board_updated');
    }
    return res.status(201).json({
      success: true,
      data: {
        _id: queue._id,
        businessDate: queue.businessDate,
        queueNumber: queue.queueNumber,
        customerCount: queue.customerCount,
        diningStyle: queue.diningStyle,
        buffetPackageCode: queue.buffetPackageCode,
        hasRefillDrink: queue.hasRefillDrink,
        buffetPackageName: diningSelection.buffetPackageName,
        buffetPricePerPerson: diningSelection.buffetPricePerPerson,
        refillPricePerPerson: diningSelection.refillPricePerPerson,
        status: queue.status,
        preferredZone: queue.preferredZone,
        preferredTableId: queue.preferredTableId,
        createdAt: queue.createdAt,
        waitingAhead,
        waitingCount: waitingAhead + 1,
        accessToken,
        member:
          enrolledMember && enrolledMember.member
            ? {
                memberId: enrolledMember.member.memberId,
                memberCode: enrolledMember.member.memberCode,
                fullName: enrolledMember.member.fullName,
                phone: enrolledMember.member.phone,
                tierCode: enrolledMember.member.tierCode,
                tierName: enrolledMember.member.tierName,
                currentPoints: enrolledMember.member.currentPoints,
                isNewMember: enrolledMember.isNewMember,
              }
            : null,
      },
      message: 'สร้างคิวสำเร็จ',
    });
  } catch (error) {
    console.error('Create queue failed:', error);
    if (error.code === 'QUEUE_NUMBER_CONFLICT' || error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_NUMBER_CONFLICT',
        data: null,
        message: 'ระบบกำลังออกเลขคิวใหม่ กรุณากด “ยืนยัน” อีกครั้ง',
      });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_QUEUE_PAYLOAD',
        data: null,
        message: error.message || 'ข้อมูลคิวไม่ถูกต้อง',
      });
    }
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่',
    });
  }
}

async function getQueues(req, res) {
  try {
    const supportedStatuses = ['waiting', 'called', 'seated', 'completed', 'cancelled', 'no_show'];
    if (req.query.status && !supportedStatuses.includes(req.query.status)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_QUEUE_STATUS',
        data: null,
        message: 'สถานะคิวที่ระบุไม่ถูกต้อง',
      });
    }
    const filter = req.query.status
      ? { status: req.query.status }
      : { status: { $in: ['waiting', 'called', 'seated'] } };
    const queues = await Queue.find(filter)
      .populate('tableId')
      .populate('preferredTableId', 'tableNumber zone')
      .populate('sessionId', 'startTime endTime status isPaid')
      .sort({ createdAt: 1 });

    const activeQueues = queues.filter((queue) => isSeatedQueueActive(queue));
    return res
      .status(200)
      .json({ success: true, data: activeQueues, message: 'ดึงรายการคิวสำเร็จ' });
  } catch (error) {
    console.error('Get queues failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function findTableForQueue(queue) {
  const count = queue.customerCount;

  if (queue.preferredTableId) {
    const preferred = await Table.findOne({
      _id: queue.preferredTableId,
      status: 'available',
      minCapacity: { $lte: count },
      capacity: { $gte: count },
    });
    if (preferred) return { table: preferred, fallbackReason: '' };
  }

  const zone = queue.preferredZone || zoneForCount(count);
  if (zone) {
    const rule = ZONE_RULES[zone];
    if (rule && count >= rule.minCapacity && count <= rule.maxCapacity) {
      const zoneMatch = await Table.findOne({
        status: 'available',
        zone,
        minCapacity: { $lte: count },
        capacity: { $gte: count },
      }).sort({ capacity: 1 });
      if (zoneMatch) {
        return {
          table: zoneMatch,
          fallbackReason: queue.preferredTableId ? 'preferred_table_taken' : '',
        };
      }
    }
  }

  const anyTable = await Table.findOne({
    status: 'available',
    minCapacity: { $lte: count },
    capacity: { $gte: count },
  }).sort({ capacity: 1 });
  if (anyTable) {
    return { table: anyTable, fallbackReason: 'zone_full' };
  }

  return { table: null, fallbackReason: 'no_table' };
}

async function callQueue(req, res) {
  let reservedTableId;
  let createdSessionId;
  try {
    const queue = await Queue.findOne({ status: 'waiting' }).sort({ createdAt: 1 });
    if (!queue) {
      return res.status(404).json({
        success: false,
        code: 'NO_QUEUES_WAITING',
        data: null,
        message: 'There are no queues waiting to be called.',
      });
    }
    if (!canTransitionQueue(queue.status, 'called')) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_TRANSITION_NOT_ALLOWED',
        data: null,
        message: 'สถานะคิวไม่อนุญาตให้เรียกคิวนี้',
      });
    }

    const { table, fallbackReason } = await findTableForQueue(queue);
    if (!table) {
      return res.status(409).json({
        success: false,
        code: 'NO_AVAILABLE_TABLE',
        data: null,
        message: 'No available table can seat this party.',
      });
    }
    if (!canTransitionTable(table.status, 'reserved')) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_TRANSITION_NOT_ALLOWED',
        data: null,
        message: 'สถานะโต๊ะไม่อนุญาตให้เรียกคิวนี้',
      });
    }

    const reservedTable = await Table.findOneAndUpdate(
      { _id: table._id, status: 'available', currentSessionId: null },
      { $set: { status: 'reserved', currentSessionId: null, reservedForQueueId: queue._id } },
      { new: true }
    );
    if (!reservedTable) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_BUSY',
        data: null,
        message: 'The table was reserved by another request.',
      });
    }
    reservedTableId = reservedTable._id;

    const calledAt = new Date();
    const shopSettings = await ShopSettings.findById('shop-settings').select(
      'diningDurationMinutes buffetSignaturePrice buffetPremiumPrice buffetDeluxePrice refillDrinkPrice'
    );
    const diningDuration = Number.isInteger(shopSettings && shopSettings.diningDurationMinutes)
      ? shopSettings.diningDurationMinutes
      : SESSION_DURATION;
    const diningSelection = normalizeDiningSelection(
      {
        diningStyle:
          req.body && req.body.diningStyle !== undefined ? req.body.diningStyle : queue.diningStyle,
        buffetPackageCode:
          req.body && req.body.buffetPackageCode !== undefined
            ? req.body.buffetPackageCode
            : queue.buffetPackageCode,
        hasRefillDrink:
          req.body && req.body.hasRefillDrink !== undefined
            ? req.body.hasRefillDrink
            : queue.hasRefillDrink,
      },
      shopSettings
    );
    let sessionLoyaltyInit = {};
    if (mongoose.connection.readyState === 1 && (queue.memberId || queue.customerPhone)) {
      try {
        let linkedMember = queue.memberId ? await getMemberById(queue.memberId) : null;
        if (!linkedMember && queue.customerPhone) {
          const enrolled = await upsertMemberFromCustomer({
            fullName: queue.customerName,
            phone: queue.customerPhone,
            source: 'queue',
          });
          linkedMember = enrolled && enrolled.member;
        }
        if (linkedMember && linkedMember.isActive) {
          sessionLoyaltyInit = {
            memberId: linkedMember.memberId,
            memberPhone: linkedMember.phone,
            memberName: linkedMember.fullName,
            memberTierName: linkedMember.tierName,
            benefitType: 'NONE',
          };
        }
      } catch (memberError) {
        console.warn('Auto-linking member to session skipped:', memberError.message);
      }
    }

    const session = await Session.create({
      queueId: queue._id,
      tableId: reservedTable._id,
      customerCount: Math.max(1, Number(queue.customerCount) || 1),
      ...diningSelection,
      startTime: calledAt,
      endTime: calculateEndTime(calledAt, diningDuration),
      ...sessionLoyaltyInit,
    });
    createdSessionId = session._id;

    try {
      await sqlBridge.createSqlSession({
        mongoSessionId: String(session._id),
        queueId: String(queue._id),
        tableId: String(reservedTable._id),
        customerCount: Math.max(1, Number(queue.customerCount) || 1),
        diningStyle: diningSelection.diningStyle || 'alacarte',
        endTime: calculateEndTime(calledAt, diningDuration),
        buffetData: {
          buffetPackageCode: diningSelection.buffetPackageCode || '',
          buffetPackageName: diningSelection.buffetPackageName || '',
          buffetPricePerPerson: Number(diningSelection.buffetPricePerPerson || 0),
          hasRefillDrink: Boolean(diningSelection.hasRefillDrink),
          refillPricePerPerson: Number(diningSelection.refillPricePerPerson || 0),
        },
      });
    } catch (sqlError) {
      console.error('SQL session creation failed:', sqlError.message);
    }

    let assignmentNote = '';
    if (fallbackReason === 'preferred_table_taken') {
      assignmentNote = `โต๊ะที่เลือกถูกใช้แล้ว ระบบจัด ${reservedTable.tableNumber} แทน`;
    } else if (fallbackReason === 'zone_full') {
      assignmentNote = `โซนที่เลือกเต็ม ระบบจัด ${reservedTable.tableNumber} แทน`;
    }

    const calledQueue = await Queue.findOneAndUpdate(
      { _id: queue._id, status: 'waiting' },
      {
        $set: {
          status: 'called',
          calledAt,
          tableId: reservedTable._id,
          assignedTableId: reservedTable._id,
          assignmentNote,
          sessionId: session._id,
        },
      },
      { new: true }
    );
    if (!calledQueue) {
      await Session.findByIdAndDelete(session._id);
      await Table.findOneAndUpdate(
        { _id: reservedTable._id, status: 'reserved', currentSessionId: null },
        { $set: { status: 'available', currentSessionId: null, reservedForQueueId: null } }
      );
      reservedTableId = null;
      return res.status(409).json({
        success: false,
        code: 'QUEUE_ALREADY_CALLED',
        data: null,
        message: 'The queue was called by another request.',
      });
    }
    reservedTableId = null;
    createdSessionId = null;

    const io = req.app.get('io');
    if (io) {
      const callEvent = {
        queue: {
          _id: calledQueue._id,
          queueNumber: calledQueue.queueNumber,
          status: calledQueue.status,
          calledAt: calledQueue.calledAt,
          sessionId: session._id,
          endTime: session.endTime,
          preferredTableId: calledQueue.preferredTableId,
          assignedTableId: calledQueue.assignedTableId,
          assignmentNote,
        },
        table: {
          _id: reservedTable._id,
          tableNumber: reservedTable.tableNumber,
          zone: reservedTable.zone,
        },
      };
      io.to(`queue_${calledQueue._id}`).emit('queue_called', callEvent);
      io.to('admin').to('waiter').emit('queue_called', callEvent);
      io.to('customer').emit('queue_board_updated');
      io.emit('table_board_updated');
    }
    return res.status(200).json({
      success: true,
      data: {
        queue: calledQueue,
        table: reservedTable,
        session: { _id: session._id, endTime: session.endTime },
        assignmentNote,
      },
      message: 'เรียกคิวสำเร็จ',
    });
  } catch (error) {
    if (createdSessionId) {
      try {
        await Session.findByIdAndDelete(createdSessionId);
      } catch (rollbackError) {
        console.error('Failed to remove session after queue-call error:', rollbackError);
      }
    }
    if (reservedTableId) {
      try {
        await Table.findOneAndUpdate(
          { _id: reservedTableId, status: 'reserved', currentSessionId: null },
          { $set: { status: 'available', currentSessionId: null, reservedForQueueId: null } }
        );
      } catch (rollbackError) {
        console.error('Failed to release reserved table after queue-call error:', rollbackError);
      }
    }
    console.error('Call queue failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function cancelQueue(req, res) {
  let queue;
  let cancelledQueue;
  let releasedTableId;
  let previousStatus;
  let cancellationCommitted = false;
  try {
    queue = await Queue.findById(req.params.queueId || req.params.id);
    if (!queue) {
      return res
        .status(404)
        .json({ success: false, code: 'QUEUE_NOT_FOUND', data: null, message: 'Queue not found.' });
    }
    if (!canTransitionQueue(queue.status, 'cancelled')) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_CANNOT_BE_CANCELLED',
        data: null,
        message: 'คิวนี้เริ่มใช้บริการหรือสิ้นสุดแล้ว จึงยกเลิกไม่ได้',
      });
    }

    previousStatus = queue.status;
    const session = queue.sessionId ? await Session.findById(queue.sessionId) : null;
    if (session && !queue.tableId) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_STATE_CHANGED',
        data: null,
        message: 'ข้อมูลโต๊ะของคิวไม่ครบ กรุณาติดต่อผู้ดูแลระบบ',
      });
    }
    if (session && (await Order.exists({ sessionId: session._id }))) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_ALREADY_SEATED',
        data: null,
        message: 'คิวนี้เริ่มสั่งอาหารแล้ว จึงยกเลิกไม่ได้',
      });
    }
    if (queue.status === 'called' && queue.tableId) {
      const reservedTable = await Table.findOne({
        _id: queue.tableId,
        status: 'reserved',
        currentSessionId: null,
      });
      if (!reservedTable || !canTransitionTable(reservedTable.status, 'available')) {
        return res.status(409).json({
          success: false,
          code: 'TABLE_STATE_CHANGED',
          data: null,
          message: 'สถานะโต๊ะเปลี่ยนไปแล้ว จึงยกเลิกคิวนี้ไม่ได้',
        });
      }
    }

    cancelledQueue = await Queue.findOneAndUpdate(
      { _id: queue._id, status: queue.status },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    if (!cancelledQueue) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_STATE_CHANGED',
        data: null,
        message: 'สถานะคิวเปลี่ยนไปแล้ว กรุณาโหลดรายการคิวใหม่',
      });
    }
    if (cancelledQueue.tableId) {
      const releasedTable = await Table.findOneAndUpdate(
        {
          _id: cancelledQueue.tableId,
          status: 'reserved',
          currentSessionId: null,
        },
        { $set: { status: 'available', currentSessionId: null, reservedForQueueId: null } },
        { new: true }
      );
      if (!releasedTable) {
        throw new Error('The reserved table could not be released during queue cancellation.');
      }
      releasedTableId = releasedTable._id;
      if (session) {
        const deletedSession = await Session.deleteOne({ _id: session._id, isPaid: false });
        if (deletedSession.deletedCount !== 1) {
          throw new Error('The unpaid queue session could not be removed during cancellation.');
        }
      }
    }
    cancellationCommitted = true;
    const io = req.app.get('io');
    if (io) {
      io.to(`queue_${cancelledQueue._id}`).emit('queue_cancelled', { queueId: cancelledQueue._id });
      io.to('customer').emit('queue_board_updated');
      io.to('admin').to('waiter').emit('queue_board_updated');
      io.emit('table_board_updated');
    }
    return res
      .status(200)
      .json({ success: true, data: cancelledQueue, message: 'ยกเลิกคิวสำเร็จ' });
  } catch (error) {
    if (!cancellationCommitted && cancelledQueue) {
      try {
        if (releasedTableId) {
          await Table.findOneAndUpdate(
            { _id: releasedTableId, status: 'available', currentSessionId: null },
            { $set: { status: 'reserved' } }
          );
        }
        await Queue.findOneAndUpdate(
          { _id: cancelledQueue._id, status: 'cancelled' },
          { $set: { status: previousStatus } }
        );
      } catch (rollbackError) {
        console.error('Failed to restore queue or table after cancellation error:', rollbackError);
      }
    }
    console.error('Cancel queue failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function getQueueById(req, res) {
  try {
    const queue = await Queue.findById(req.params.queueId || req.params.id)
      .select(
        'queueNumber businessDate customerCount diningStyle buffetPackageCode hasRefillDrink status createdAt calledAt seatedAt tableId sessionId preferredZone preferredTableId assignedTableId assignmentNote +accessTokenHash'
      )
      .populate('tableId', 'tableNumber')
      .populate('preferredTableId', 'tableNumber zone');
    if (!queue) {
      return res
        .status(404)
        .json({ success: false, code: 'QUEUE_NOT_FOUND', data: null, message: 'Queue not found.' });
    }
    if (!hasQueueAccess(queue, getAccessToken(req) || String(queue._id))) {
      return res.status(404).json({
        success: false,
        code: 'QUEUE_NOT_FOUND',
        data: null,
        message: 'ไม่พบคิวหรือรหัสกู้คืนไม่ถูกต้อง',
      });
    }
    return res.status(200).json({
      success: true,
      data: await getQueueStatus(queue),
      message: 'ดึงข้อมูลคิวสำเร็จ',
    });
  } catch (error) {
    console.error('Get queue failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function recoverQueue(req, res) {
  try {
    const accessToken = req.body && req.body.accessToken;
    const accessTokenHash = hashQueueAccessToken(accessToken);
    if (!accessTokenHash && !/^[a-f\d]{24}$/i.test(accessToken || '')) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_QUEUE_RECOVERY_CODE',
        data: null,
        message: 'รหัสกู้คืนคิวไม่ถูกต้อง',
      });
    }
    const queue = await (
      accessTokenHash
        ? Queue.findOne({ accessTokenHash })
        : Queue.findOne({ _id: accessToken, accessTokenHash: { $exists: false } })
    )
      .select(
        'queueNumber businessDate customerCount diningStyle buffetPackageCode hasRefillDrink status createdAt calledAt seatedAt tableId sessionId preferredZone preferredTableId assignedTableId assignmentNote +accessTokenHash'
      )
      .populate('tableId', 'tableNumber')
      .populate('preferredTableId', 'tableNumber zone');
    if (!queue) {
      return res.status(404).json({
        success: false,
        code: 'QUEUE_NOT_FOUND',
        data: null,
        message: 'ไม่พบคิวสำหรับรหัสกู้คืนนี้',
      });
    }
    return res.status(200).json({
      success: true,
      data: await getQueueStatus(queue),
      message: 'กู้คืนคิวสำเร็จ',
    });
  } catch (error) {
    console.error('Recover queue failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถกู้คืนคิวได้ กรุณาลองอีกครั้ง',
    });
  }
}

async function confirmQueue(req, res) {
  let transitionedQueueId;
  let confirmationSessionId;
  try {
    const queue = await Queue.findById(
      req.params.queueId || req.params.id || (req.body && req.body.queueId)
    )
      .select(
        'queueNumber businessDate customerCount diningStyle buffetPackageCode hasRefillDrink status calledAt seatedAt tableId sessionId +accessTokenHash'
      )
      .populate('tableId', 'tableNumber');
    if (!queue || !hasQueueAccess(queue, getAccessToken(req) || String(queue._id))) {
      return res.status(404).json({
        success: false,
        code: 'QUEUE_NOT_FOUND',
        data: null,
        message: 'ไม่พบคิวหรือรหัสกู้คืนไม่ถูกต้อง',
      });
    }
    if (queue.status === 'seated' && queue.sessionId) {
      const seatedSession = await Session.findOne({
        _id: queue.sessionId,
        status: 'active',
        isPaid: false,
      });
      const seatedTable = seatedSession
        ? await Table.findOne({
            _id: queue.tableId,
            status: 'occupied',
            currentSessionId: seatedSession._id,
          })
        : null;
      if (seatedSession && seatedTable) {
        return res.status(200).json({
          success: true,
          data: await getQueueStatus(queue),
          message: 'ยืนยันที่นั่งแล้ว',
        });
      }
      return res.status(409).json({
        success: false,
        code: 'QUEUE_STATE_CHANGED',
        data: null,
        message: 'สถานะคิวหรือโต๊ะเปลี่ยนไปแล้ว กรุณาติดต่อพนักงาน',
      });
    }
    if (!canTransitionQueue(queue.status, 'seated') || !queue.tableId || !queue.sessionId) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_NOT_CALLED',
        data: null,
        message: 'คิวนี้ยังไม่ถูกเรียก หรือไม่สามารถยืนยันที่นั่งได้',
      });
    }

    const now = new Date();
    const session = await Session.findOne({
      _id: queue.sessionId,
      queueId: queue._id,
      tableId: queue.tableId,
      status: 'active',
      isPaid: false,
      endTime: { $gt: now },
    });
    if (!session) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_CALL_EXPIRED',
        data: null,
        message: 'เวลารอบนี้หมดแล้ว กรุณาติดต่อพนักงานเพื่อดำเนินการต่อ',
      });
    }

    const seatedQueue = await Queue.findOneAndUpdate(
      { _id: queue._id, status: 'called', sessionId: session._id },
      { $set: { status: 'seated', seatedAt: now } },
      { new: true }
    );
    if (!seatedQueue) {
      const currentQueue = await Queue.findById(queue._id)
        .select(
          'queueNumber businessDate customerCount diningStyle buffetPackageCode hasRefillDrink status createdAt calledAt seatedAt tableId sessionId'
        )
        .populate('tableId', 'tableNumber');
      if (currentQueue && currentQueue.status === 'seated') {
        const currentTable = await Table.findOne({
          _id: queue.tableId,
          status: 'occupied',
          currentSessionId: session._id,
        });
        if (currentTable) {
          return res.status(200).json({
            success: true,
            data: await getQueueStatus(currentQueue),
            message: 'ยืนยันที่นั่งแล้ว',
          });
        }
      }
      return res.status(409).json({
        success: false,
        code: 'QUEUE_STATE_CHANGED',
        data: null,
        message: 'สถานะคิวเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่',
      });
    }
    transitionedQueueId = seatedQueue._id;
    confirmationSessionId = session._id;

    const occupiedTable = await Table.findOneAndUpdate(
      { _id: queue.tableId, status: 'reserved', currentSessionId: null },
      { $set: { status: 'occupied', currentSessionId: session._id, reservedForQueueId: null } },
      { new: true }
    );
    if (!occupiedTable) {
      const restoredQueue = await Queue.findOneAndUpdate(
        { _id: seatedQueue._id, status: 'seated', sessionId: session._id },
        { $set: { status: 'called' }, $unset: { seatedAt: 1 } }
      );
      if (!restoredQueue) {
        throw new Error('Queue state could not be restored after the reserved table changed.');
      }
      transitionedQueueId = null;
      return res.status(409).json({
        success: false,
        code: 'TABLE_STATE_CHANGED',
        data: null,
        message: 'โต๊ะถูกเปลี่ยนสถานะแล้ว กรุณาติดต่อพนักงาน',
      });
    }
    transitionedQueueId = null;

    const io = req.app.get('io');
    if (io) {
      const payload = { queueId: seatedQueue._id, sessionId: session._id, table: occupiedTable };
      io.to(`queue_${seatedQueue._id}`).emit('queue_seated', payload);
      io.to('admin').to('waiter').emit('queue_seated', payload);
      io.to('customer').emit('queue_board_updated');
      io.emit('table_board_updated');
    }
    const populatedQueue = await Queue.findById(seatedQueue._id)
      .select(
        'queueNumber businessDate customerCount diningStyle buffetPackageCode hasRefillDrink status createdAt calledAt seatedAt tableId sessionId'
      )
      .populate('tableId', 'tableNumber');
    return res.status(200).json({
      success: true,
      data: await getQueueStatus(populatedQueue),
      message: 'ยืนยันที่นั่งแล้ว',
    });
  } catch (error) {
    if (transitionedQueueId) {
      try {
        await Queue.findOneAndUpdate(
          { _id: transitionedQueueId, status: 'seated', sessionId: confirmationSessionId },
          { $set: { status: 'called' }, $unset: { seatedAt: 1 } }
        );
      } catch (rollbackError) {
        console.error(
          'Failed to restore called queue after seat-confirmation error:',
          rollbackError
        );
      }
    }
    console.error('Confirm queue failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: status === 400 ? 'INVALID_QUEUE_ID' : 'REQUEST_FAILED',
      data: null,
      message:
        status === 400 ? 'รูปแบบคิวไม่ถูกต้อง' : 'ไม่สามารถยืนยันที่นั่งได้ กรุณาลองอีกครั้ง',
    });
  }
}

async function getEntryQRCode(req, res) {
  try {
    const queueUrl = `${getBaseUrl(req)}/queue.html`;
    const qrCodeData = await generateQRCode(queueUrl);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      data: { queueUrl, qrCodeData },
      message: 'สร้าง QR สำหรับรับคิวแล้ว',
    });
  } catch (error) {
    console.error('Create queue entry QR failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'Unable to create the queue entry QR code.',
    });
  }
}

async function recoverQueueById(req, res) {
  try {
    const queueId = (req.body && req.body.queueId) || req.query.queueId;
    if (!/^[a-f\d]{24}$/i.test(String(queueId || ''))) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_QUEUE_RECOVERY_CODE',
        data: null,
        message: 'รหัสคิวไม่ถูกต้อง',
      });
    }
    const queue = await Queue.findById(queueId)
      .select(
        'queueNumber businessDate customerCount diningStyle buffetPackageCode hasRefillDrink status createdAt calledAt seatedAt tableId sessionId preferredZone preferredTableId assignedTableId assignmentNote'
      )
      .populate('tableId', 'tableNumber')
      .populate('preferredTableId', 'tableNumber zone');
    if (!queue) {
      return res
        .status(404)
        .json({ success: false, code: 'QUEUE_NOT_FOUND', data: null, message: 'ไม่พบคิวนี้' });
    }
    return res.status(200).json({
      success: true,
      data: await getQueueStatus(queue),
      message: 'เปิดคิวสำเร็จ',
    });
  } catch (error) {
    console.error('Recover queue by id failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'ไม่สามารถเปิดคิวได้' });
  }
}

async function getTicketData(req, res) {
  try {
    const queue = await Queue.findById(req.params.id)
      .populate('tableId', 'tableNumber')
      .populate('preferredTableId', 'tableNumber zone');
    if (!queue) {
      return res
        .status(404)
        .json({ success: false, code: 'QUEUE_NOT_FOUND', data: null, message: 'ไม่พบคิวนี้' });
    }

    const settings = await ShopSettings.findById('shop-settings').select(
      'restaurantName phone address logoUrl buffetSignaturePrice buffetPremiumPrice buffetDeluxePrice refillDrinkPrice'
    );
    const diningSelection = normalizeDiningSelection(
      {
        diningStyle: queue.diningStyle || 'alacarte',
        buffetPackageCode: queue.buffetPackageCode || '',
        hasRefillDrink: Boolean(queue.hasRefillDrink),
      },
      settings
    );
    const baseUrl = getBaseUrl(req);
    const ticketUrl = `${baseUrl}/queue.html?recover=${queue._id}`;
    const qrCodeData = await generateQRCode(ticketUrl);

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      data: {
        _id: queue._id,
        queueNumber: queue.queueNumber,
        customerCount: queue.customerCount,
        diningStyle: diningSelection.diningStyle,
        buffetPackageCode: diningSelection.buffetPackageCode,
        buffetPackageName: diningSelection.buffetPackageName,
        buffetPricePerPerson: diningSelection.buffetPricePerPerson,
        hasRefillDrink: diningSelection.hasRefillDrink,
        refillPricePerPerson: diningSelection.refillPricePerPerson,
        customerName: queue.customerName || '',
        customerPhone: queue.customerPhone || '',
        status: queue.status,
        createdAt: queue.createdAt,
        calledAt: queue.calledAt,
        tableNumber: queue.tableId && queue.tableId.tableNumber ? queue.tableId.tableNumber : '',
        restaurantName: (settings && settings.restaurantName) || 'Smart Queue',
        phone: (settings && settings.phone) || '',
        address: (settings && settings.address) || '',
        logoUrl: (settings && settings.logoUrl) || '/assets/images/logo.png',
        ticketUrl,
        qrCodeData,
      },
      message: 'ดึงข้อมูลบัตรคิวสำเร็จ',
    });
  } catch (error) {
    console.error('Get ticket data failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function completeQueue(req, res) {
  try {
    const queue = await Queue.findById(req.params.id);
    if (!queue) {
      return res
        .status(404)
        .json({ success: false, code: 'QUEUE_NOT_FOUND', data: null, message: 'ไม่พบคิวนี้' });
    }
    if (queue.status === 'completed') {
      return res.status(200).json({ success: true, data: queue, message: 'คิวนี้จบรายการแล้ว' });
    }
    if (!canCompleteQueue(queue.status)) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_CANNOT_BE_COMPLETED',
        data: null,
        message: 'จบรายการได้เฉพาะคิวที่ลูกค้านั่งโต๊ะแล้ว',
      });
    }

    const completed = await completeQueueById(queue._id, { io: req.app.get('io') });
    if (!completed) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_STATE_CHANGED',
        data: null,
        message: 'สถานะคิวเปลี่ยนไปแล้ว กรุณาโหลดใหม่',
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`queue_${completed._id}`).emit('queue_completed', { queueId: completed._id });
      io.emit('table_board_updated');
    }
    return res.status(200).json({ success: true, data: completed, message: 'จบรายการคิวสำเร็จ' });
  } catch (error) {
    console.error('Complete queue failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function cancelQueueByCustomer(req, res) {
  try {
    const queueId = req.params.id;
    const accessToken =
      (req.body && req.body.accessToken) ||
      (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!queueId || !accessToken) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_QUEUE_RECOVERY_CODE',
        data: null,
        message: 'ไม่พบรหัสคิว',
      });
    }

    const queue = await Queue.findById(queueId).select('+accessTokenHash');
    if (!queue || !hasQueueAccess(queue, accessToken)) {
      return res.status(404).json({
        success: false,
        code: 'QUEUE_NOT_FOUND',
        data: null,
        message: 'ไม่พบคิวหรือรหัสไม่ถูกต้อง',
      });
    }
    if (!['waiting', 'called'].includes(queue.status)) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_CANNOT_BE_CANCELLED',
        data: null,
        message: 'คิวนี้เริ่มใช้บริการหรือสิ้นสุดแล้ว จึงยกเลิกไม่ได้',
      });
    }

    const previousStatus = queue.status;
    const session = queue.sessionId ? await Session.findById(queue.sessionId) : null;

    const cancelledQueue = await Queue.findOneAndUpdate(
      { _id: queue._id, status: previousStatus },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    if (!cancelledQueue) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_STATE_CHANGED',
        data: null,
        message: 'สถานะคิวเปลี่ยนไปแล้ว กรุณาโหลดใหม่',
      });
    }

    if (cancelledQueue.tableId) {
      await Table.updateOne(
        { _id: cancelledQueue.tableId, status: 'reserved', currentSessionId: null },
        { $set: { status: 'available', currentSessionId: null, reservedForQueueId: null } }
      );
    }

    if (session && !session.isPaid) {
      await Session.deleteOne({ _id: session._id, isPaid: false });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`queue_${cancelledQueue._id}`).emit('queue_cancelled', { queueId: cancelledQueue._id });
      io.to('customer').emit('queue_board_updated');
      io.to('admin').to('waiter').emit('queue_board_updated');
      io.emit('table_board_updated');
    }
    return res
      .status(200)
      .json({ success: true, data: cancelledQueue, message: 'ยกเลิกคิวสำเร็จ' });
  } catch (error) {
    console.error('Customer cancel queue failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถยกเลิกคิวได้ กรุณาลองใหม่',
    });
  }
}

async function getDisplayData(req, res) {
  try {
    const [called, waiting, totalWaiting] = await Promise.all([
      Queue.find({ status: 'called' })
        .populate('tableId', 'tableNumber zone')
        .populate('assignedTableId', 'tableNumber zone')
        .sort({ calledAt: -1 })
        .limit(20)
        .lean(),
      Queue.find({ status: 'waiting' })
        .select('queueNumber customerCount preferredZone createdAt')
        .sort({ createdAt: 1 })
        .limit(50)
        .lean(),
      Queue.countDocuments({ status: 'waiting' }),
    ]);

    const nowServing = called.map((q) => {
      const table =
        q.tableId && q.tableId.tableNumber
          ? q.tableId
          : q.assignedTableId && q.assignedTableId.tableNumber
            ? q.assignedTableId
            : null;
      return {
        _id: String(q._id),
        queueNumber: q.queueNumber,
        status: q.status,
        tableNumber: (table && table.tableNumber) || null,
        zone: (table && table.zone) || q.preferredZone || null,
        customerCount: q.customerCount,
        calledAt: q.calledAt,
      };
    });

    const waitingList = waiting.map((q) => ({
      _id: String(q._id),
      queueNumber: q.queueNumber,
      customerCount: q.customerCount,
      preferredZone: q.preferredZone || null,
      createdAt: q.createdAt,
    }));

    const settings = await loadSettings();
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      data: {
        nowServing,
        waiting: waitingList,
        totalWaiting,
        queueStatus: getQueueAcceptance(settings || {}, new Date()),
        updatedAt: new Date().toISOString(),
      },
      message: 'ดึงข้อมูลจอแสดงคิวสำเร็จ',
    });
  } catch (error) {
    console.error('Get display data failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถโหลดข้อมูลจอแสดงคิวได้',
    });
  }
}

module.exports = {
  createQueue,
  getQueues,
  callQueue,
  cancelQueue,
  cancelQueueByCustomer,
  completeQueue,
  getQueueById,
  recoverQueue,
  recoverQueueById,
  confirmQueue,
  getEntryQRCode,
  getTicketData,
  queueCounterId,
  getNextQueueNumber: async (businessDate) => (await allocateQueueNumber(businessDate)).queueNumber,
  findTableForQueue,
  zoneForCount,
  ZONE_RULES,
  MAX_PARTY_SIZE,
  getDisplayData,
};
