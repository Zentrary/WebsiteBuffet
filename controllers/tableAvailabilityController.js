const Table = require('../models/Table');

const ZONE_RULES = {
  small: { minCapacity: 1, maxCapacity: 2, label: 'โต๊ะเล็ก' },
  medium: { minCapacity: 3, maxCapacity: 6, label: 'โต๊ะกลาง' },
  large: { minCapacity: 7, maxCapacity: 12, label: 'โต๊ะใหญ่' },
};

async function getAvailabilityByZone(req, res) {
  try {
    const zones = Object.keys(ZONE_RULES);
    const aggregate = await Table.aggregate([
      { $match: { zone: { $in: zones } } },
      {
        $group: {
          _id: { zone: '$zone', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]);

    const summary = {};
    for (const zone of zones) {
      summary[zone] = {
        available: 0,
        reserved: 0,
        occupied: 0,
        cleaning: 0,
        total: 0,
        ...ZONE_RULES[zone],
      };
    }
    for (const row of aggregate) {
      const { zone, status } = row._id;
      if (!summary[zone]) continue;
      if (status in summary[zone]) summary[zone][status] = row.count;
      summary[zone].total += row.count;
    }

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      data: summary,
      message: 'ดึงสถานะโต๊ะตามโซนสำเร็จ',
    });
  } catch (error) {
    console.error('Get zone availability failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถโหลดสถานะโต๊ะได้',
    });
  }
}

async function getTablesByZone(req, res) {
  try {
    const zone = req.params.zone;
    if (!ZONE_RULES[zone]) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ZONE',
        data: null,
        message: 'โซนไม่ถูกต้อง',
      });
    }
    const tables = await Table.find({ zone })
      .select('tableNumber capacity minCapacity zone status')
      .sort({ tableNumber: 1 })
      .lean();
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      data: tables,
      message: 'ดึงโต๊ะในโซนสำเร็จ',
    });
  } catch (error) {
    console.error('Get tables by zone failed:', error);
    return res.status(500).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: 'ไม่สามารถโหลดโต๊ะได้',
    });
  }
}

module.exports = {
  getAvailabilityByZone,
  getTablesByZone,
  ZONE_RULES,
};
