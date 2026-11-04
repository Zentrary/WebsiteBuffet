const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const authController = require('../controllers/authController');
const { rateLimit, keyByIp, keyByIpAndUsername } = require('../middlewares/rateLimit');

const router = express.Router();

router.post(
  '/login',
  rateLimit({
    name: 'auth-login-ip',
    windowMs: 15 * 60_000,
    max: 20,
    keyGenerator: keyByIp,
    message: 'มีการพยายามเข้าสู่ระบบจากเครือข่ายนี้มากเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
  }),
  rateLimit({
    name: 'auth-login',
    windowMs: 15 * 60_000,
    max: 5,
    keyGenerator: keyByIpAndUsername,
    message: 'เข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
  }),
  authController.login
);

router.get('/me', protect, authController.getMe);

router.post('/register', protect, authorize('admin'), authController.register);

router.get('/staff', protect, authorize('admin'), authController.getStaff);

router.put('/staff/:id', protect, authorize('admin'), authController.updateStaff);

router.delete('/staff/:id', protect, authorize('admin'), authController.deleteStaff);

module.exports = router;
