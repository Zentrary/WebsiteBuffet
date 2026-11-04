const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { rateLimit, keyByIp, keyBySession } = require('../middlewares/rateLimit');
const sessionController = require('../controllers/sessionController');

const router = express.Router();

router.post(
  '/start',
  rateLimit({ name: 'session-start', windowMs: 60_000, max: 15, keyGenerator: keyByIp }),
  sessionController.startSession
);

router.get('/', protect, authorize('admin', 'manager', 'waiter'), sessionController.getSessions);

router.get(
  '/:id',
  rateLimit({ name: 'session-read', windowMs: 60_000, max: 120, keyGenerator: keyByIp }),
  sessionController.getSession
);

router.post(
  '/:id/checkout',
  rateLimit({ name: 'session-checkout', windowMs: 60_000, max: 15, keyGenerator: keyBySession }),
  sessionController.requestCheckout
);

router.post(
  '/:id/resume',
  rateLimit({ name: 'session-resume', windowMs: 60_000, max: 15, keyGenerator: keyBySession }),
  sessionController.resumeDining
);

router.post('/end', protect, authorize('admin'), sessionController.endSession);

module.exports = router;
