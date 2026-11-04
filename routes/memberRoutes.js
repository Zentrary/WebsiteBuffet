const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { rateLimit, keyByIp } = require('../middlewares/rateLimit');
const memberController = require('../controllers/memberController');

const router = express.Router();

router.post(
  '/public/register',
  rateLimit({
    name: 'member-public-register',
    windowMs: 60_000,
    max: 15,
    keyGenerator: keyByIp,
    message: 'ส่งคำขอสมัครสมาชิกบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
  }),
  memberController.publicRegisterMember
);

router.get(
  '/public/check',
  rateLimit({
    name: 'member-public-check',
    windowMs: 60_000,
    max: 30,
    keyGenerator: keyByIp,
    message: 'ตรวจสอบข้อมูลสมาชิกบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
  }),
  memberController.publicCheckMember
);

router.get('/status', protect, authorize('admin', 'manager', 'waiter'), memberController.getStatus);
router.get(
  '/lookup',
  protect,
  authorize('admin', 'manager', 'waiter'),
  memberController.lookupMember
);
router.get(
  '/promotions',
  protect,
  authorize('admin', 'manager', 'waiter'),
  memberController.getPromotions
);
router.post('/', protect, authorize('admin', 'manager', 'waiter'), memberController.createMember);

router.get('/overview', protect, authorize('admin', 'manager'), memberController.getOverview);
router.get('/export', protect, authorize('admin', 'manager'), memberController.exportMembers);
router.get('/tiers', protect, authorize('admin', 'manager'), memberController.getTiers);
router.get(
  '/transactions',
  protect,
  authorize('admin', 'manager'),
  memberController.getTransactions
);
router.get('/', protect, authorize('admin', 'manager'), memberController.getMembers);
router.put('/:id', protect, authorize('admin', 'manager'), memberController.updateMember);
router.delete('/:id', protect, authorize('admin', 'manager'), memberController.deleteMember);
router.post('/:id/points', protect, authorize('admin', 'manager'), memberController.adjustPoints);

router.post(
  '/promotions',
  protect,
  authorize('admin', 'manager'),
  memberController.createPromotion
);
router.put(
  '/promotions/:id',
  protect,
  authorize('admin', 'manager'),
  memberController.updatePromotion
);
router.delete(
  '/promotions/:id',
  protect,
  authorize('admin', 'manager'),
  memberController.deletePromotion
);

module.exports = router;
