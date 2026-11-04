const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const feedbackController = require('../controllers/feedbackController');
const { rateLimit, keyBySession, keyByIp } = require('../middlewares/rateLimit');

const router = express.Router();

router.post(
  '/',
  rateLimit({ name: 'feedback-create', windowMs: 60 * 60_000, max: 3, keyGenerator: keyBySession }),
  feedbackController.createFeedback
);

router.get('/', protect, authorize('admin', 'manager'), feedbackController.getAllFeedbacks);

router.get(
  '/session/:sessionId',
  rateLimit({ name: 'feedback-read', windowMs: 60_000, max: 60, keyGenerator: keyByIp }),
  feedbackController.getFeedbackBySession
);

module.exports = router;
