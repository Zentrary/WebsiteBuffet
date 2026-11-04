const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const validateSession = require('../middlewares/validateSession');
const orderController = require('../controllers/orderController');
const requireShopOpen = require('../middlewares/requireShopOpen');
const { rateLimit, keyByIp, keyBySession } = require('../middlewares/rateLimit');

const router = express.Router();

router.post(
  '/',
  rateLimit({ name: 'order-create', windowMs: 60_000, max: 10, keyGenerator: keyBySession }),
  validateSession(),
  requireShopOpen,
  orderController.createOrder
);

router.get(
  '/',
  protect,
  authorize('admin', 'kitchen', 'waiter'),
  orderController.getOrdersForStaff
);

router.get(
  '/session/:sessionId',
  rateLimit({ name: 'order-read-session', windowMs: 60_000, max: 60, keyGenerator: keyByIp }),
  orderController.getOrdersBySession
);

router.get(
  '/:id',
  protect,
  authorize('admin', 'manager', 'kitchen', 'waiter'),
  orderController.getOrderById
);

router.post(
  '/:id/customer-cancel',
  rateLimit({
    name: 'order-cancel-customer',
    windowMs: 60_000,
    max: 5,
    keyGenerator: keyBySession,
  }),
  orderController.cancelOrderByCustomer
);

router.put(
  '/:id/status',
  protect,
  authorize('admin', 'kitchen', 'waiter'),
  orderController.updateOrderStatus
);

router.put(
  '/:id/item/:itemId/status',
  protect,
  authorize('kitchen', 'waiter'),
  orderController.updateItemStatus
);

router.post('/:id/cancel', protect, authorize('admin', 'waiter'), orderController.cancelOrder);

module.exports = router;
