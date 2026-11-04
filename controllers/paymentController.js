const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Order = require('../models/Order');
const Session = require('../models/Session');
const Table = require('../models/Table');
const ShopSettings = require('../models/ShopSettings');
const { calculateTotal } = require('../utils/calculateBilling');
const { calculateCashChange } = require('../utils/calculateCashChange');
const { calculateOrderSubtotal } = require('../utils/calculateOrderSubtotal');
const { computeSessionBaseCharges } = require('../utils/buffetPricing');
const { generatePromptPayQrDataUrl, normalizePromptPayTarget } = require('../utils/promptpayQr');
const { completeSeatedQueuesForSession } = require('../services/queueLifecycle');
const { evaluateBenefitForBill, settleSessionLoyalty } = require('../services/loyaltyService');
const { canCompletePayment, canTransitionTable } = require('../utils/sessionLifecycle');
const { recordAudit } = require('../utils/auditLog');
const sqlBridge = require('../services/sqlBridge');
const { querySQL } = require('../config/db.sql');
const sessionModel = require('../models/sql/sessionModel');

function normalizeTaxMode(mode, fallback = 'included') {
  if (mode === 'excluded' || mode === 'exclusive') return 'excluded';
  if (mode === 'included' || mode === 'inclusive') return 'included';
  return fallback;
}

async function loadBillingSettings() {
  let mongoDoc = null;
  if (mongoose.connection.readyState === 1) {
    try {
      mongoDoc = await ShopSettings.findById('shop-settings')
        .select(
          'vatPercent serviceChargePercent vatMode serviceChargeMode promptPayId paymentQrImageUrl restaurantName'
        )
        .lean();
    } catch {
      mongoDoc = null;
    }
  }

  try {
    const sqlSettings = await sqlBridge.getSqlShopSettings();
    if (sqlSettings) {
      return {
        vatPercent: Number(sqlSettings.vat_percent ?? mongoDoc?.vatPercent ?? 7),
        serviceChargePercent: Number(
          sqlSettings.service_charge_percent ?? mongoDoc?.serviceChargePercent ?? 10
        ),
        vatMode: normalizeTaxMode(sqlSettings.vat_mode, mongoDoc?.vatMode || 'included'),
        serviceChargeMode: normalizeTaxMode(
          sqlSettings.service_charge_mode,
          mongoDoc?.serviceChargeMode || 'included'
        ),
        promptPayId: sqlSettings.prompt_pay_id || mongoDoc?.promptPayId || '',
        paymentQrImageUrl: sqlSettings.payment_qr_image_url || mongoDoc?.paymentQrImageUrl || '',
        restaurantName: sqlSettings.restaurant_name || mongoDoc?.restaurantName || '',
      };
    }
  } catch {
  }

  return mongoDoc || {};
}

function computeCombinedSessionSubtotal(session, orders) {
  const orderSubtotal = calculateOrderSubtotal(orders);
  const baseCharges = computeSessionBaseCharges(session);
  const subtotal = Math.round((baseCharges.baseTotal + orderSubtotal + Number.EPSILON) * 100) / 100;
  return {
    subtotal,
    orderSubtotal,
    dining: {
      ...baseCharges,
      orderSubtotal,
    },
  };
}

function clampSessionDiscount(subtotal, discount) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  const safeDiscount = Math.max(0, Number(discount) || 0);
  return Math.min(safeDiscount, safeSubtotal);
}

function buildSessionLoyaltyMeta(session) {
  if (!session || !session.memberId) return null;
  return {
    memberId: session.memberId,
    memberPhone: session.memberPhone || '',
    memberName: session.memberName || '',
    memberTierName: session.memberTierName || '',
    benefitType: session.benefitType || 'NONE',
    appliedPromotionId: session.appliedPromotionId || null,
    appliedPromoCode: session.appliedPromoCode || '',
    appliedPromoTitle: session.appliedPromoTitle || '',
    pointsToRedeem: Number(session.pointsToRedeem) || 0,
    pointsEarned: Number(session.pointsEarned) || 0,
  };
}

async function calculateBill(req, res) {
  try {
    const sessionId = req.body.sessionId || req.params.sessionId;
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        data: null,
        message: 'Session not found.',
      });
    }

    const [orders, billingSettings] = await Promise.all([
      Order.find({
        sessionId: session._id,
        status: { $ne: 'cancelled' },
      }),
      loadBillingSettings(),
    ]);
    const { subtotal, dining } = computeCombinedSessionSubtotal(session, orders);
    const bill = calculateTotal(
      subtotal,
      clampSessionDiscount(subtotal, session.discount),
      billingSettings
    );
    Object.assign(session, bill);
    await session.save();

    try {
      const sqlSession = await sessionModel.findByMongoId(sessionId);
      if (sqlSession) {
        await querySQL(
          `UPDATE sessions
           SET subtotal = $1, service_charge = $2, vat = $3, discount = $4,
               grand_total = $5, updated_at = NOW()
           WHERE mongo_session_id = $6`,
          [
            bill.subtotal || 0,
            bill.serviceCharge || 0,
            bill.vat || 0,
            session.discount || 0,
            bill.grandTotal || 0,
            sessionId,
          ]
        );
      }
    } catch (sqlError) {
      console.error('SQL session billing update failed:', sqlError.message);
    }

    return res.status(200).json({
      success: true,
      data: { ...bill, dining, loyalty: buildSessionLoyaltyMeta(session) },
      message: 'คำนวณยอดชำระสำเร็จ',
    });
  } catch (error) {
    console.error('Calculate bill failed:', error);
    const status = error.name === 'CastError' || error instanceof RangeError ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function processPayment(req, res) {
  try {
    const { sessionId, method = 'cash', receivedAmount } = req.body;
    if (!['cash', 'qr_payment'].includes(method)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PAYMENT_METHOD',
        data: null,
        message: 'รองรับเฉพาะเงินสดและ QR Payment',
      });
    }
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        data: null,
        message: 'Session not found.',
      });
    }
    if (session.isPaid) {
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'This session has already been paid.',
      });
    }
    if (!canCompletePayment(session)) {
      return res.status(409).json({
        success: false,
        code: 'CHECKOUT_CONFIRMATION_REQUIRED',
        data: null,
        message: 'กรุณารอให้ลูกค้ายืนยันจบมื้อก่อนรับชำระเงิน',
      });
    }

    const table = await Table.findOne({
      _id: session.tableId,
      status: 'occupied',
      currentSessionId: session._id,
    });
    if (!table || !canTransitionTable(table.status, 'cleaning', { isPaid: true })) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_NOT_READY_FOR_PAYMENT',
        data: null,
        message: 'ไม่พบโต๊ะที่กำลังใช้งานในรอบนี้ กรุณาตรวจสอบสถานะโต๊ะก่อนรับชำระ',
      });
    }

    const [orders, billingSettings] = await Promise.all([
      Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } }),
      loadBillingSettings(),
    ]);
    const { subtotal } = computeCombinedSessionSubtotal(session, orders);
    Object.assign(
      session,
      calculateTotal(subtotal, clampSessionDiscount(subtotal, session.discount), billingSettings)
    );
    const now = new Date();
    const userId = req.user && (req.user.id || req.user._id);
    if (method === 'qr_payment') {
      const existingPendingPayment = await Payment.findOne({
        sessionId: session._id,
        method: 'qr_payment',
        status: { $in: ['pending', 'awaiting_confirmation'] },
      }).sort({ createdAt: -1 });
      if (existingPendingPayment) {
        if (existingPendingPayment.amount !== session.grandTotal) {
          existingPendingPayment.amount = session.grandTotal;
          await existingPendingPayment.save();
        }
        return res.status(202).json({
          success: true,
          data: existingPendingPayment,
          message: 'มีรายการ QR รอตรวจสอบอยู่แล้ว ยังไม่ถือว่าชำระเงินสำเร็จ',
        });
      }
      const pendingPayment = await Payment.create({
        sessionId: session._id,
        amount: session.grandTotal,
        method: 'qr_payment',
        status: 'pending',
        receivedBy: userId || undefined,
      });
      sqlBridge
        .syncPaymentFromMongo(pendingPayment)
        .catch((err) => console.error('SQL pending QR payment sync failed:', err.message));
      return res.status(202).json({
        success: true,
        data: pendingPayment,
        message: 'บันทึกรายการ QR เป็นรอตรวจสอบแล้ว ยังไม่ถือว่าชำระเงินสำเร็จ',
      });
    }
    const cashDetails = calculateCashChange(session.grandTotal, Number(receivedAmount));
    const previousStatus = session.status;
    const previousActualEndTime = session.actualEndTime;
    const paidSession = await Session.findOneAndUpdate(
      {
        _id: session._id,
        status: previousStatus,
        isPaid: false,
        checkoutRequestedAt: session.checkoutRequestedAt,
      },
      {
        $set: {
          isPaid: true,
          paidAt: now,
          status: 'completed',
          actualEndTime: session.actualEndTime || now,
          subtotal: session.subtotal,
          serviceCharge: session.serviceCharge,
          vat: session.vat,
          grandTotal: session.grandTotal,
        },
      },
      { new: true }
    );
    if (!paidSession) {
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'มีการเปลี่ยนแปลงสถานะรอบนี้ กรุณาโหลดข้อมูลใหม่',
      });
    }

    let payment;
    let tableWasMarkedForCleaning = false;
    let tableForCleaning;
    try {
      payment = await Payment.create({
        sessionId: paidSession._id,
        amount: paidSession.grandTotal,
        method,
        cashReceived: cashDetails.cashReceived,
        changeDue: cashDetails.changeDue,
        status: 'completed',
        paidAt: now,
        receivedBy: userId || undefined,
      });
      tableForCleaning = await Table.findOneAndUpdate(
        {
          _id: paidSession.tableId,
          status: 'occupied',
          currentSessionId: paidSession._id,
        },
        {
          $set: {
            status: 'cleaning',
            currentSessionId: null,
            reservedForQueueId: null,
            lastSessionId: paidSession._id,
          },
        },
        { new: true }
      );
      tableWasMarkedForCleaning = Boolean(tableForCleaning);
      if (
        !tableForCleaning ||
        !canTransitionTable(table.status, 'cleaning', { isPaid: paidSession.isPaid })
      ) {
        throw new Error('Table state changed before payment could be completed.');
      }
      await Payment.updateMany(
        { sessionId: paidSession._id, method: 'qr_payment', status: 'pending' },
        { $set: { status: 'failed' } }
      );
    } catch (error) {
      let rollbackFailed = false;
      if (tableWasMarkedForCleaning) {
        try {
          const restoredTable = await Table.updateOne(
            { _id: paidSession.tableId, status: 'cleaning', lastSessionId: paidSession._id },
            { $set: { status: 'occupied', currentSessionId: paidSession._id, lastSessionId: null } }
          );
          if (restoredTable.modifiedCount !== 1) rollbackFailed = true;
        } catch (rollbackError) {
          rollbackFailed = true;
          console.error('Payment table rollback failed:', rollbackError);
        }
      }
      if (payment) {
        try {
          await Payment.deleteOne({ _id: payment._id });
        } catch (rollbackError) {
          rollbackFailed = true;
          console.error('Payment record rollback failed:', rollbackError);
        }
      }
      try {
        const rollbackSet = {
          isPaid: false,
          status: previousStatus,
        };
        const rollbackUnset = { paidAt: 1 };
        if (previousActualEndTime) rollbackSet.actualEndTime = previousActualEndTime;
        else rollbackUnset.actualEndTime = 1;
        const rollback = await Session.updateOne(
          { _id: paidSession._id, isPaid: true, paidAt: now },
          {
            $set: rollbackSet,
            $unset: rollbackUnset,
          }
        );
        if (rollback.modifiedCount !== 1) rollbackFailed = true;
      } catch (rollbackError) {
        rollbackFailed = true;
        console.error('Payment session rollback failed:', rollbackError);
      }
      if (rollbackFailed) {
        console.error('Payment rollback was incomplete:', { sessionId: paidSession._id });
      }
      throw error;
    }

    try {
      await completeSeatedQueuesForSession(paidSession._id, {
        io: req.app.get('io'),
        reason: 'payment completed',
      });
    } catch (queueError) {
      console.error('Closing seated queue after payment failed:', queueError);
    }

    let loyalty = null;
    if (paidSession.memberId) {
      try {
        loyalty = await settleSessionLoyalty(paidSession, {
          username: (req.user && req.user.username) || 'staff',
        });
        if (loyalty && !loyalty.alreadySettled) {
          paidSession.pointsEarned = loyalty.pointsEarned || 0;
          paidSession.loyaltyProcessedAt = new Date();
          paidSession.memberTierName =
            (loyalty.member && loyalty.member.tierName) || paidSession.memberTierName;
          await Session.updateOne(
            { _id: paidSession._id },
            {
              $set: {
                pointsEarned: paidSession.pointsEarned,
                loyaltyProcessedAt: paidSession.loyaltyProcessedAt,
                memberTierName: paidSession.memberTierName,
              },
            }
          );
        }
      } catch (loyaltyError) {
        console.error('Loyalty settlement after cash payment failed:', loyaltyError.message);
      }
    }

    try {
      await sqlBridge.syncSessionFromMongo(paidSession);
      await sqlBridge.syncPaymentFromMongo(payment);
    } catch (sqlError) {
      console.error('SQL cash payment sync failed:', sqlError.message);
    }

    const io = req.app.get('io');
    if (io) {
      const event = { payment, sessionId: session._id, amount: payment.amount, loyalty };
      io.to('admin').emit('payment_completed', event);

      io.to(`customer_${session._id}`).emit('payment_completed', event);
      io.to('admin').to('waiter').emit('table_waiting_for_cleaning', {
        table: tableForCleaning,
        sessionId: session._id,
      });
    }
    recordAudit(req, {
      action: 'PAYMENT_COMPLETED',
      targetType: 'Payment',
      targetId: payment._id,
      summary: `รับชำระเงิน ${payment.method} ยอด ${payment.amount} บ. (Session ${session._id})`,
    });
    return res
      .status(201)
      .json({ success: true, data: payment, loyalty, message: 'บันทึกการชำระเงินสำเร็จ' });
  } catch (error) {
    const status =
      error.name === 'CastError' || error.name === 'ValidationError' || error instanceof RangeError
        ? 400
        : 500;
    if (status === 500) console.error('Process payment failed:', error);
    return res.status(status).json({
      success: false,
      code: error.code || 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? error.message : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function getPaymentSessions(req, res) {
  try {
    const sessions = await Session.find({
      status: { $in: ['active', 'expired'] },
      isPaid: false,
    })
      .populate('tableId', 'tableNumber zone')
      .populate('queueId', 'queueNumber customerName customerPhone')
      .sort({ startTime: -1 })
      .limit(200);
    const sessionIds = sessions.map((session) => session._id);
    const orders = sessionIds.length
      ? await Order.find({ sessionId: { $in: sessionIds }, status: { $ne: 'cancelled' } })
          .select('sessionId items')
          .lean()
      : [];
    const pendingPayments = sessionIds.length
      ? await Payment.find({
          sessionId: { $in: sessionIds },
          method: 'qr_payment',
          status: { $in: ['pending', 'awaiting_confirmation'] },
        })
          .select('sessionId amount status createdAt')
          .sort({ createdAt: -1 })
          .lean()
      : [];
    const ordersBySession = new Map();
    const pendingBySession = new Map();
    for (const payment of pendingPayments) {
      const key = String(payment.sessionId);
      if (!pendingBySession.has(key)) pendingBySession.set(key, payment);
    }
    for (const order of orders) {
      const sessionId = String(order.sessionId);
      const currentOrders = ordersBySession.get(sessionId) || [];
      currentOrders.push(order);
      ordersBySession.set(sessionId, currentOrders);
    }
    const billingSettings = await loadBillingSettings();
    const data = sessions.map((session) => {
      const sessionOrders = ordersBySession.get(String(session._id)) || [];
      const itemsByMenu = new Map();
      for (const order of sessionOrders) {
        for (const item of order.items || []) {
          if (item.itemStatus === 'cancelled') continue;
          const unitPrice = Number(item.price) || 0;
          const menuKey = `${String(item.menuId || item.name)}:${unitPrice}`;
          const current = itemsByMenu.get(menuKey) || {
            name: item.name,
            quantity: 0,
            price: unitPrice,
          };
          current.quantity += Number(item.quantity) || 0;
          itemsByMenu.set(menuKey, current);
        }
      }
      const items = [...itemsByMenu.values()];
      const orderSubtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const baseCharges = computeSessionBaseCharges(session);
      const subtotal =
        Math.round((baseCharges.baseTotal + orderSubtotal + Number.EPSILON) * 100) / 100;
      return {
        _id: session._id,
        table: session.tableId,
        queue: session.queueId,
        customerCount:
          session.customerCount || (session.queueId && session.queueId.customerCount) || 1,
        diningStyle: session.diningStyle || 'alacarte',
        buffetPackageCode: session.buffetPackageCode || '',
        buffetPackageName: session.buffetPackageName || '',
        buffetPricePerPerson: session.buffetPricePerPerson || 0,
        hasRefillDrink: Boolean(session.hasRefillDrink),
        refillPricePerPerson: session.refillPricePerPerson || 0,
        dining: {
          ...baseCharges,
          orderSubtotal,
        },
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        checkoutRequestedAt: session.checkoutRequestedAt,
        pendingPayment: pendingBySession.get(String(session._id)) || null,
        items,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        bill: calculateTotal(
          subtotal,
          clampSessionDiscount(subtotal, session.discount),
          billingSettings
        ),
        loyalty: buildSessionLoyaltyMeta(session),
      };
    });
    return res.status(200).json({ success: true, data, message: 'ดึงรายการรอชำระสำเร็จ' });
  } catch (error) {
    console.error('Get payment sessions failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถโหลดรายการรอชำระได้',
    });
  }
}

async function getPaymentHistory(req, res) {
  try {
    let payments;
    try {
      payments = await sqlBridge.getSqlPaymentHistory(200, req.query.sessionId || null);
    } catch (sqlError) {
      console.error('SQL payment history failed, falling back to MongoDB:', sqlError.message);
      payments = [];
    }

    if (!payments || payments.length === 0) {
      const filter = req.query.sessionId ? { sessionId: req.query.sessionId } : {};
      payments = await Payment.find(filter).populate('sessionId').sort({ paidAt: -1 });
    }

    return res
      .status(200)
      .json({ success: true, data: payments, message: 'ดึงประวัติการชำระเงินสำเร็จ' });
  } catch (error) {
    console.error('Get payment history failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function confirmQrPayment(req, res) {
  try {
    const paymentId = req.params.paymentId;
    const userId = req.user && (req.user.id || req.user._id);
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        code: 'PAYMENT_NOT_FOUND',
        data: null,
        message: 'ไม่พบรายการชำระเงินนี้',
      });
    }
    if (payment.status === 'completed') {
      return res.status(409).json({
        success: false,
        code: 'PAYMENT_ALREADY_COMPLETED',
        data: null,
        message: 'รายการนี้ยืนยันไปแล้ว',
      });
    }
    if (!['awaiting_confirmation', 'pending'].includes(payment.status)) {
      return res.status(409).json({
        success: false,
        code: 'PAYMENT_STATE_CHANGED',
        data: null,
        message: 'สถานะรายการนี้ไม่พร้อมยืนยัน',
      });
    }

    const session = await Session.findById(payment.sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        data: null,
        message: 'ไม่พบรอบรับประทานของรายการนี้',
      });
    }
    if (session.isPaid) {
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'รอบนี้ชำระเงินแล้ว',
      });
    }

    const table = await Table.findOne({
      _id: session.tableId,
      status: 'occupied',
      currentSessionId: session._id,
    });
    if (!table || !canTransitionTable(table.status, 'cleaning', { isPaid: true })) {
      return res.status(409).json({
        success: false,
        code: 'TABLE_NOT_READY_FOR_PAYMENT',
        data: null,
        message: 'ไม่พบโต๊ะที่กำลังใช้งานสำหรับรอบนี้',
      });
    }

    const [orders, billingSettings] = await Promise.all([
      Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } }),
      loadBillingSettings(),
    ]);
    const { subtotal } = computeCombinedSessionSubtotal(session, orders);
    Object.assign(
      session,
      calculateTotal(subtotal, clampSessionDiscount(subtotal, session.discount), billingSettings)
    );

    const now = new Date();
    const previousStatus = session.status;
    const previousActualEndTime = session.actualEndTime;

    const paidSession = await Session.findOneAndUpdate(
      {
        _id: session._id,
        isPaid: false,
        status: previousStatus,
        checkoutRequestedAt: session.checkoutRequestedAt,
      },
      {
        $set: {
          isPaid: true,
          paidAt: now,
          status: 'completed',
          actualEndTime: session.actualEndTime || now,
          subtotal: session.subtotal,
          serviceCharge: session.serviceCharge,
          vat: session.vat,
          grandTotal: session.grandTotal,
        },
      },
      { new: true }
    );
    if (!paidSession) {
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'มีการเปลี่ยนแปลงสถานะรอบนี้ กรุณาโหลดข้อมูลใหม่',
      });
    }

    let completedPayment;
    let tableForCleaning;
    try {
      completedPayment = await Payment.findOneAndUpdate(
        { _id: payment._id, status: { $in: ['awaiting_confirmation', 'pending'] } },
        {
          $set: {
            status: 'completed',
            paidAt: now,
            amount: paidSession.grandTotal,
            confirmedBy: userId || undefined,
            confirmedAt: now,
          },
        },
        { new: true }
      );
      if (!completedPayment) {
        throw new Error('Payment was already confirmed by another request.');
      }

      tableForCleaning = await Table.findOneAndUpdate(
        {
          _id: paidSession.tableId,
          status: 'occupied',
          currentSessionId: paidSession._id,
        },
        {
          $set: {
            status: 'cleaning',
            currentSessionId: null,
            reservedForQueueId: null,
            lastSessionId: paidSession._id,
          },
        },
        { new: true }
      );
      if (!tableForCleaning) {
        throw new Error('Table state changed before QR confirmation could complete.');
      }

      await Payment.updateMany(
        {
          sessionId: paidSession._id,
          _id: { $ne: payment._id },
          status: { $in: ['pending', 'awaiting_confirmation'] },
        },
        { $set: { status: 'failed' } }
      );
    } catch (error) {
      let rollbackFailed = false;
      try {
        const rollbackSet = { isPaid: false, status: previousStatus };
        const rollbackUnset = { paidAt: 1 };
        if (previousActualEndTime) rollbackSet.actualEndTime = previousActualEndTime;
        else rollbackUnset.actualEndTime = 1;
        const r = await Session.updateOne(
          { _id: paidSession._id, isPaid: true, paidAt: now },
          { $set: rollbackSet, $unset: rollbackUnset }
        );
        if (r.modifiedCount !== 1) rollbackFailed = true;
      } catch (e) {
        rollbackFailed = true;
        console.error('QR session rollback failed:', e);
      }

      if (tableForCleaning) {
        try {
          await Table.updateOne(
            { _id: paidSession.tableId, status: 'cleaning', lastSessionId: paidSession._id },
            { $set: { status: 'occupied', currentSessionId: paidSession._id, lastSessionId: null } }
          );
        } catch (e) {
          rollbackFailed = true;
          console.error('QR table rollback failed:', e);
        }
      }
      if (completedPayment) {
        try {
          await Payment.updateOne(
            { _id: completedPayment._id, status: 'completed' },
            { $set: { status: 'awaiting_confirmation', paidAt: null } }
          );
        } catch (e) {
          rollbackFailed = true;
          console.error('QR payment rollback failed:', e);
        }
      }
      if (rollbackFailed)
        console.error('QR confirmation rollback was incomplete:', { sessionId: paidSession._id });
      throw error;
    }

    try {
      await completeSeatedQueuesForSession(paidSession._id, {
        io: req.app.get('io'),
        reason: 'QR payment confirmed',
      });
    } catch (queueError) {
      console.error('Closing seated queue after QR payment failed:', queueError);
    }

    let loyalty = null;
    if (paidSession.memberId) {
      try {
        loyalty = await settleSessionLoyalty(paidSession, {
          username: (req.user && req.user.username) || 'staff',
        });
        if (loyalty && !loyalty.alreadySettled) {
          paidSession.pointsEarned = loyalty.pointsEarned || 0;
          paidSession.loyaltyProcessedAt = new Date();
          paidSession.memberTierName =
            (loyalty.member && loyalty.member.tierName) || paidSession.memberTierName;
          await Session.updateOne(
            { _id: paidSession._id },
            {
              $set: {
                pointsEarned: paidSession.pointsEarned,
                loyaltyProcessedAt: paidSession.loyaltyProcessedAt,
                memberTierName: paidSession.memberTierName,
              },
            }
          );
        }
      } catch (loyaltyError) {
        console.error('Loyalty settlement after QR payment failed:', loyaltyError.message);
      }
    }

    try {
      await sqlBridge.syncSessionFromMongo(paidSession);
      await sqlBridge.syncPaymentFromMongo(completedPayment);
    } catch (sqlError) {
      console.error('SQL QR payment sync failed:', sqlError.message);
    }

    const io = req.app.get('io');
    if (io) {
      const event = {
        payment: completedPayment,
        sessionId: paidSession._id,
        amount: completedPayment.amount,
        loyalty,
      };
      io.to('admin').emit('payment_completed', event);
      io.to(`customer_${paidSession._id}`).emit('payment_completed', event);
      io.to('admin').to('waiter').emit('table_waiting_for_cleaning', {
        table: tableForCleaning,
        sessionId: paidSession._id,
      });
    }

    return res.status(200).json({
      success: true,
      data: completedPayment,
      loyalty,
      message: 'ยืนยันการชำระเงินสำเร็จ',
    });
  } catch (error) {
    console.error('Confirm QR payment failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function applyLoyaltyBenefit(req, res) {
  try {
    const { sessionId, memberId, benefitType = 'NONE', promotionId = null } = req.body || {};
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        data: null,
        message: 'ไม่พบรอบรับประทานนี้',
      });
    }
    if (session.isPaid || session.status === 'completed' || session.status === 'cancelled') {
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'รอบรับประทานนี้ปิดหรือชำระเงินไปแล้ว',
      });
    }

    const [orders, billingSettings] = await Promise.all([
      Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } }),
      loadBillingSettings(),
    ]);
    const { subtotal, dining } = computeCombinedSessionSubtotal(session, orders);

    const evaluated = await evaluateBenefitForBill({
      memberId,
      benefitType,
      promotionId,
      subtotal,
    });

    const clampedDiscount = clampSessionDiscount(subtotal, evaluated.discountAmount);
    const bill = calculateTotal(subtotal, clampedDiscount, billingSettings);

    Object.assign(session, bill, {
      memberId: evaluated.member.memberId,
      memberPhone: evaluated.member.phone,
      memberName: evaluated.member.fullName,
      memberTierName: evaluated.member.tierName,
      benefitType: evaluated.benefitType,
      appliedPromotionId: evaluated.appliedPromotionId,
      appliedPromoCode: evaluated.appliedPromoCode,
      appliedPromoTitle: evaluated.appliedPromoTitle,
      pointsToRedeem: evaluated.pointsToRedeem,
    });
    await session.save();
    sqlBridge
      .syncSessionFromMongo(session)
      .catch((err) => console.error('SQL apply loyalty session sync failed:', err.message));

    await Payment.updateMany(
      {
        sessionId: session._id,
        method: 'qr_payment',
        status: { $in: ['pending', 'awaiting_confirmation'] },
      },
      { $set: { amount: session.grandTotal } }
    );

    const io = req.app.get('io');
    if (io) {
      const payload = { sessionId: session._id, bill, loyalty: buildSessionLoyaltyMeta(session) };
      io.to(`customer_${session._id}`).emit('bill_updated', payload);
      io.to('admin').emit('bill_updated', payload);
    }

    return res.status(200).json({
      success: true,
      data: {
        bill,
        dining,
        loyalty: buildSessionLoyaltyMeta(session),
        member: evaluated.member,
      },
      message:
        clampedDiscount > 0
          ? `ใช้สิทธิ์ส่วนลด ฿${clampedDiscount.toFixed(2)} สำเร็จ`
          : `ผูกสมาชิก ${evaluated.member.fullName} สำหรับสะสมแต้มสำเร็จ`,
    });
  } catch (error) {
    const status =
      error.status || (error.name === 'CastError' || error instanceof RangeError ? 400 : 500);
    if (status >= 500) console.error('Apply loyalty benefit failed:', error);
    return res.status(status).json({
      success: false,
      code: error.code || 'REQUEST_FAILED',
      data: null,
      message: error.message || 'ไม่สามารถใช้สิทธิ์สมาชิกได้',
    });
  }
}

async function clearLoyaltyBenefit(req, res) {
  try {
    const sessionId = req.params.sessionId || (req.body && req.body.sessionId);
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        data: null,
        message: 'ไม่พบรอบรับประทานนี้',
      });
    }
    if (session.isPaid || session.status === 'completed' || session.status === 'cancelled') {
      return res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_PAID',
        data: null,
        message: 'รอบรับประทานนี้ปิดหรือชำระเงินไปแล้ว',
      });
    }

    const [orders, billingSettings] = await Promise.all([
      Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } }),
      loadBillingSettings(),
    ]);
    const { subtotal, dining } = computeCombinedSessionSubtotal(session, orders);
    const bill = calculateTotal(subtotal, 0, billingSettings);

    Object.assign(session, bill, {
      memberId: null,
      memberPhone: '',
      memberName: '',
      memberTierName: '',
      benefitType: '',
      appliedPromotionId: null,
      appliedPromoCode: '',
      appliedPromoTitle: '',
      pointsToRedeem: 0,
    });
    await session.save();
    sqlBridge
      .syncSessionFromMongo(session)
      .catch((err) => console.error('SQL clear loyalty session sync failed:', err.message));

    await Payment.updateMany(
      {
        sessionId: session._id,
        method: 'qr_payment',
        status: { $in: ['pending', 'awaiting_confirmation'] },
      },
      { $set: { amount: session.grandTotal } }
    );

    const io = req.app.get('io');
    if (io) {
      const payload = { sessionId: session._id, bill, loyalty: null };
      io.to(`customer_${session._id}`).emit('bill_updated', payload);
      io.to('admin').emit('bill_updated', payload);
    }

    return res.status(200).json({
      success: true,
      data: { bill, dining, loyalty: null },
      message: 'ยกเลิกการใช้สิทธิ์สมาชิก/คูปองแล้ว',
    });
  } catch (error) {
    const status = error.name === 'CastError' ? 400 : 500;
    if (status >= 500) console.error('Clear loyalty benefit failed:', error);
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถยกเลิกสิทธิ์ส่วนลดได้',
    });
  }
}

async function getSessionPromptPayQr(req, res) {
  try {
    const sessionId = req.params.sessionId || (req.query && req.query.sessionId);
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        data: null,
        message: 'ไม่พบรอบรับประทานนี้',
      });
    }

    const [orders, billingSettings] = await Promise.all([
      Order.find({ sessionId: session._id, status: { $ne: 'cancelled' } }),
      loadBillingSettings(),
    ]);
    const { subtotal } = computeCombinedSessionSubtotal(session, orders);
    const bill = calculateTotal(
      subtotal,
      clampSessionDiscount(subtotal, session.discount),
      billingSettings
    );

    const target = normalizePromptPayTarget(billingSettings.promptPayId);
    if (target && bill.grandTotal > 0) {
      const generated = await generatePromptPayQrDataUrl(target.rawDigits, bill.grandTotal);
      if (generated) {
        return res.status(200).json({
          success: true,
          data: {
            mode: 'dynamic_promptpay',
            amount: bill.grandTotal,
            qrImageUrl: generated.dataUrl,
            promptPayType: target.type,
            maskedTarget:
              target.rawDigits.length > 4
                ? `${'•'.repeat(Math.max(0, target.rawDigits.length - 4))}${target.rawDigits.slice(-4)}`
                : target.rawDigits,
            restaurantName: billingSettings.restaurantName || '',
          },
          message: 'สร้าง QR พร้อมเพย์ระบุยอดชำระสำเร็จ',
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        mode: 'static_image',
        amount: bill.grandTotal,
        qrImageUrl: billingSettings.paymentQrImageUrl || '/assets/images/payment/promptpay.png',
        promptPayType: null,
        maskedTarget: '',
        restaurantName: billingSettings.restaurantName || '',
      },
      message: 'ดึงรูป QR ชำระเงินของร้านสำเร็จ',
    });
  } catch (error) {
    console.error('Get PromptPay QR failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถสร้าง QR ชำระเงินได้',
    });
  }
}

module.exports = {
  calculateBill,
  getPaymentSessions,
  processPayment,
  getPaymentHistory,
  confirmQrPayment,
  applyLoyaltyBenefit,
  clearLoyaltyBenefit,
  getSessionPromptPayQr,
};
