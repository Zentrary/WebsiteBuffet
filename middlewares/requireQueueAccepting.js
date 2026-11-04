const ShopSettings = require('../models/ShopSettings');
const { getQueueAcceptance } = require('../utils/businessDay');

async function requireQueueAccepting(req, res, next) {
  try {
    const settings = await ShopSettings.findById('shop-settings');
    const acceptance = settings
      ? getQueueAcceptance(settings)
      : { accepting: false, reason: 'closed', businessDate: null, cutoffAt: null, closesAt: null };

    if (acceptance.accepting) return next();

    const messages = {
      test_mode: 'ร้านกำลังทดสอบระบบ จึงยังไม่เปิดรับคิวจากลูกค้าจริง',
      cutoff: 'ปิดรับคิวสำหรับวันนี้แล้ว กรุณาติดต่อพนักงาน',
      closed: 'ร้านยังไม่เปิดให้บริการในขณะนี้',
    };
    return res.status(503).json({
      success: false,
      code: acceptance.reason === 'test_mode' ? 'SHOP_TEST_MODE' : 'QUEUE_CLOSED',
      data: acceptance,
      message: messages[acceptance.reason] || messages.closed,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = requireQueueAccepting;
