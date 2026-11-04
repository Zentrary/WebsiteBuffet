const Session = require('../models/Session');
const Table = require('../models/Table');
const Queue = require('../models/Queue');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const ShopSettings = require('../models/ShopSettings');
const sqlBridge = require('../services/sqlBridge');
const { recordAudit } = require('../utils/auditLog');
const { calculateTotal } = require('../utils/calculateBilling');
const { computeSessionBaseCharges } = require('../utils/buffetPricing');

function staffOnly(req, res) {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      data: null,
      message: 'ต้องเป็นผู้ดูแลระบบหรือผู้จัดการเท่านั้น',
    });
    return false;
  }
  return true;
}

async function forceCompleteSession(req, res) {
  if (!staffOnly(req, res)) return;
  try {
    const session = await Session.findById(req.params.id);
    if (!session)
      return res
        .status(404)
        .json({ success: false, code: 'SESSION_NOT_FOUND', data: null, message: 'ไม่พบรอบนี้' });
    if (session.isPaid)
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'รอบนี้ชำระแล้ว',
      });

    const now = new Date();
    const [orders, settings] = await Promise.all([
      Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } }),
      ShopSettings.findById('shop-settings')
        .select('vatPercent serviceChargePercent vatMode serviceChargeMode')
        .lean()
        .catch(() => ({})),
    ]);
    const orderSubtotal = orders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);
    const baseCharges = computeSessionBaseCharges(session);
    const rawSubtotal =
      Math.round((baseCharges.baseTotal + orderSubtotal + Number.EPSILON) * 100) / 100;
    const bill = calculateTotal(
      rawSubtotal,
      Math.min(rawSubtotal, Math.max(0, Number(session.discount) || 0)),
      settings || {}
    );
    const { subtotal, serviceCharge, vat, grandTotal } = bill;

    const updated = await Session.findOneAndUpdate(
      { _id: session._id, isPaid: false },
      {
        $set: {
          isPaid: true,
          paidAt: now,
          status: 'completed',
          actualEndTime: now,
          subtotal,
          serviceCharge,
          vat,
          grandTotal,
        },
      },
      { new: true }
    );
    if (!updated)
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'มีการชำระไปแล้ว',
      });

    const createdPayment = await Payment.create({
      sessionId: updated._id,
      amount: grandTotal,
      method: 'cash',
      status: 'completed',
      paidAt: now,
      receivedBy: req.user._id,
      note: 'force-complete by staff',
    });
    sqlBridge
      .syncSessionFromMongo(updated)
      .catch((err) => console.error('SQL force-complete session sync failed:', err.message));
    sqlBridge
      .syncPaymentFromMongo(createdPayment)
      .catch((err) => console.error('SQL force-complete payment sync failed:', err.message));
    await Table.updateOne(
      { _id: updated.tableId },
      {
        $set: {
          status: 'cleaning',
          currentSessionId: null,
          reservedForQueueId: null,
          lastSessionId: updated._id,
        },
      }
    );
    await Order.updateMany(
      { sessionId: updated._id, status: { $ne: 'cancelled' } },
      { $set: { status: 'paid' } }
    );
    await Payment.updateMany(
      { sessionId: updated._id, method: 'qr_payment', status: 'pending' },
      { $set: { status: 'failed' } }
    );

    const io = req.app.get('io');
    if (io) {
      io.to('admin').to('waiter').emit('payment_completed', { sessionId: updated._id });
      io.to('waiter').emit('table_waiting_for_cleaning', { sessionId: updated._id });
      io.emit('table_board_updated');
    }
    return res.json({ success: true, data: updated, message: 'บังคับปิดรอบสำเร็จ' });
  } catch (error) {
    console.error('forceCompleteSession failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'ไม่สำเร็จ' });
  }
}

async function forceFreeSession(req, res) {
  if (!staffOnly(req, res)) return;
  try {
    const session = await Session.findById(req.params.id);
    if (!session)
      return res
        .status(404)
        .json({ success: false, code: 'SESSION_NOT_FOUND', data: null, message: 'ไม่พบรอบนี้' });
    if (session.isPaid)
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'รอบนี้ชำระแล้ว',
      });

    const now = new Date();
    await Session.updateOne(
      { _id: session._id, isPaid: false },
      { $set: { status: 'cancelled', actualEndTime: now } }
    );
    await Order.updateMany(
      { sessionId: session._id, status: { $nin: ['cancelled', 'paid', 'served'] } },
      { $set: { status: 'cancelled' } }
    );
    await Payment.updateMany(
      { sessionId: session._id, status: 'pending' },
      { $set: { status: 'failed' } }
    );
    if (session.tableId) {
      await Table.updateOne(
        { _id: session.tableId },
        { $set: { status: 'available', currentSessionId: null, reservedForQueueId: null } }
      );
    }

    const io = req.app.get('io');
    if (io) {
      io.to('admin').to('waiter').emit('table_cleared', { _id: session.tableId });
      io.emit('table_board_updated');
    }
    return res.json({ success: true, data: session, message: 'ล้างบิลและคืนโต๊ะสำเร็จ' });
  } catch (error) {
    console.error('forceFreeSession failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'ไม่สำเร็จ' });
  }
}

async function forceFreeTable(req, res) {
  if (!staffOnly(req, res)) return;
  try {
    const table = await Table.findById(req.params.id);
    if (!table)
      return res
        .status(404)
        .json({ success: false, code: 'TABLE_NOT_FOUND', data: null, message: 'ไม่พบโต๊ะ' });

    const now = new Date();
    if (table.currentSessionId) {
      await Session.updateOne(
        { _id: table.currentSessionId, isPaid: false },
        { $set: { status: 'cancelled', actualEndTime: now } }
      );
      await Order.updateMany(
        { sessionId: table.currentSessionId, status: { $nin: ['cancelled', 'paid', 'served'] } },
        { $set: { status: 'cancelled' } }
      );
      await Payment.updateMany(
        { sessionId: table.currentSessionId, status: 'pending' },
        { $set: { status: 'failed' } }
      );
    }

    const updated = await Table.findOneAndUpdate(
      { _id: table._id },
      { $set: { status: 'available', currentSessionId: null, reservedForQueueId: null } },
      { new: true }
    );

    const io = req.app.get('io');
    if (io) io.to('admin').to('waiter').emit('table_cleared', updated);
    return res.json({ success: true, data: updated, message: 'บังคับคืนโต๊ะสำเร็จ' });
  } catch (error) {
    console.error('forceFreeTable failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'ไม่สำเร็จ' });
  }
}

async function forceCancelQueue(req, res) {
  if (!staffOnly(req, res)) return;
  try {
    const queue = await Queue.findById(req.params.id);
    if (!queue)
      return res
        .status(404)
        .json({ success: false, code: 'QUEUE_NOT_FOUND', data: null, message: 'ไม่พบคิว' });
    if (['seated', 'cancelled', 'no_show'].includes(queue.status)) {
      return res.status(409).json({
        success: false,
        code: 'QUEUE_STATE_CHANGED',
        data: null,
        message: 'คิวนี้สิ้นสุดแล้ว',
      });
    }

    if (queue.tableId) {
      await Table.updateOne(
        { _id: queue.tableId, status: 'reserved' },
        { $set: { status: 'available', currentSessionId: null } }
      );
    }
    if (queue.sessionId) {
      await Session.updateOne(
        { _id: queue.sessionId, isPaid: false },
        { $set: { status: 'cancelled', actualEndTime: new Date() } }
      );
    }
    const updated = await Queue.findOneAndUpdate(
      { _id: queue._id },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    const io = req.app.get('io');
    if (io) io.to('customer').to('admin').to('waiter').emit('queue_board_updated');
    return res.json({ success: true, data: updated, message: 'บังคับยกเลิกคิวสำเร็จ' });
  } catch (error) {
    console.error('forceCancelQueue failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'ไม่สำเร็จ' });
  }
}

async function reconcileNow(req, res) {
  if (!staffOnly(req, res)) return;
  try {
    const { reconcileStaleState } = require('../services/reconcileState');
    const report = await reconcileStaleState(req.app.get('io'));
    recordAudit(req, {
      action: 'ADMIN_RECONCILE',
      targetType: 'System',
      summary: 'สั่งตรวจสอบและจัดระเบียบสถานะระบบ',
    });
    return res.json({ success: true, data: report, message: 'ตรวจสอบและจัดระเบียบข้อมูลสำเร็จ' });
  } catch (error) {
    console.error('reconcileNow failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'ไม่สำเร็จ' });
  }
}

async function getAuditLogs(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    return res
      .status(403)
      .json({ success: false, code: 'FORBIDDEN', data: null, message: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
  }
  try {
    const rawLimit = Number.parseInt(String(req.query.limit || '100'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100;
    const filter = {};
    if (typeof req.query.action === 'string' && req.query.action.trim()) {
      filter.action = req.query.action.trim().slice(0, 80);
    }
    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return res
      .status(200)
      .json({ success: true, data: logs, message: 'ดึงบันทึกความปลอดภัยสำเร็จ' });
  } catch (error) {
    console.error('getAuditLogs failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'ไม่สำเร็จ' });
  }
}

module.exports = {
  forceCompleteSession,
  forceFreeSession,
  forceFreeTable,
  forceCancelQueue,
  reconcileNow,
  getAuditLogs,
};
