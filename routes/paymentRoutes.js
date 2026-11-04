const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { rateLimit, keyBySession } = require('../middlewares/rateLimit');
const validateSession = require('../middlewares/validateSession');
const paymentController = require('../controllers/paymentController');

const router = express.Router();

router.post(
  '/calculate',
  rateLimit({ name: 'payment-calculate', windowMs: 60_000, max: 60, keyGenerator: keyBySession }),
  validateSession({ allowExpired: true }),
  paymentController.calculateBill
);

router.post(
  '/process',
  protect,
  authorize('admin', 'manager', 'waiter'),
  paymentController.processPayment
);

router.get(
  '/sessions',
  protect,
  authorize('admin', 'manager', 'waiter'),
  paymentController.getPaymentSessions
);

router.get('/history', protect, authorize('admin'), paymentController.getPaymentHistory);

router.post(
  '/confirm-qr/:paymentId',
  protect,
  authorize('admin', 'manager', 'waiter'),
  paymentController.confirmQrPayment
);

router.post(
  '/apply-loyalty',
  protect,
  authorize('admin', 'manager', 'waiter'),
  paymentController.applyLoyaltyBenefit
);

router.delete(
  '/apply-loyalty/:sessionId',
  protect,
  authorize('admin', 'manager', 'waiter'),
  paymentController.clearLoyaltyBenefit
);

router.get(
  '/promptpay-qr/:sessionId',
  protect,
  authorize('admin', 'manager', 'waiter'),
  paymentController.getSessionPromptPayQr
);

module.exports = router;
