const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const menuController = require('../controllers/menuController');
const uploadImage = require('../middlewares/uploadImage');

const router = express.Router();

router.get('/', menuController.getAllMenus);

router.get('/:id', menuController.getMenuById);

router.post('/', protect, authorize('admin', 'manager'), menuController.createMenu);
router.post(
  '/image',
  protect,
  authorize('admin', 'manager'),
  uploadImage.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_IMAGE',
          message: 'รองรับเฉพาะ JPG, PNG, WEBP หรือ GIF ขนาดไม่เกิน 5 MB',
        });
      }
      const imageUrl = await uploadImage.persistUploadedFile(req.file, 'menus');
      return res.status(201).json({ success: true, data: { imageUrl } });
    } catch (error) {
      if (error.code === 'INVALID_IMAGE' || error.code === 'UPLOAD_STORAGE_UNAVAILABLE') {
        return res.status(error.status || 400).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }
      return next(error);
    }
  }
);

router.put('/:id', protect, authorize('admin', 'manager'), menuController.updateMenu);

router.delete('/:id', protect, authorize('admin'), menuController.deleteMenu);

router.put(
  '/:id/availability',
  protect,
  authorize('admin', 'manager', 'kitchen'),
  menuController.toggleAvailability
);

module.exports = router;
