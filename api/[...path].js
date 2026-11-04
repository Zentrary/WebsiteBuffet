const app = require('../server');
const connectDB = require('../config/db');
const { migrateMongoToSql } = require('../services/mongoToSqlMigration');
const { runWithRealtime, bindResponseFlush } = require('../services/realtimeBroadcast');

module.exports = async function apiHandler(req, res) {
  return runWithRealtime(async () => {
    bindResponseFlush(res);
    try {
      const requestUrl = req.url || '/';
      if (!/^\/api(?:\/|$|\?)/.test(requestUrl)) {
        req.url = `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`;
      }

      await connectDB();
      await migrateMongoToSql().catch((err) => {
        console.error('Mongo->SQL initial sync warning:', err.message);
      });
      return app(req, res);
    } catch (error) {
      console.error('Vercel API request could not connect to MongoDB:', error.message);
      if (res.headersSent) return undefined;
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่ภายหลัง',
      });
    }
  });
};
