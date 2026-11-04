require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { connectSQL, closeSQL, querySQL } = require('./config/db.sql');
const { migrateMongoToSql, getMirrorParitySummary } = require('./services/mongoToSqlMigration');
const { createServerlessIo } = require('./services/realtimeBroadcast');
const { initSocket } = require('./sockets/socketHandler');
const authRoutes = require('./routes/authRoutes');
const queueRoutes = require('./routes/queueRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const tableRoutes = require('./routes/tableRoutes');
const reportRoutes = require('./routes/reportRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const memberRoutes = require('./routes/memberRoutes');
const { startShopSchedule } = require('./services/shopSchedule');
const { startReconcileLoop } = require('./services/reconcileState');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const { protect, authorize } = require('./middlewares/authMiddleware');
const { rateLimit, keyByIp } = require('./middlewares/rateLimit');
const { securityHeaders, sanitizeNoSql, corsOptionsDelegate } = require('./middlewares/security');

function getLanIPv4() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    const address = (addresses || []).find(
      (item) => (item.family === 'IPv4' || item.family === 4) && !item.internal
    );
    if (address) return address.address;
  }
  return null;
}

const app = express();
app.disable('x-powered-by');
if (
  process.env.VERCEL ||
  process.env.TRUST_PROXY === 'true' ||
  process.env.NODE_ENV === 'production'
) {
  app.set('trust proxy', 1);
}
const httpServer = http.createServer(app);

const isServerless = Boolean(process.env.VERCEL);
const io = isServerless
  ? createServerlessIo()
  : new Server(httpServer, {
      cors: {
        origin(origin, callback) {
          if (!origin || String(process.env.CLIENT_ORIGIN || '').trim() === '*') {
            return callback(null, true);
          }
          const allowed = String(process.env.CLIENT_ORIGIN || '')
            .split(',')
            .map((item) => item.trim().replace(/\/+$/, ''))
            .filter(Boolean);
          if (allowed.length > 0) {
            return callback(null, allowed.includes(origin.replace(/\/+$/, '')));
          }

          return callback(null, true);
        },
        methods: ['GET', 'POST'],
      },
    });

app.set('io', io);

app.use(securityHeaders);
app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(sanitizeNoSql);
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/api',
  rateLimit({
    name: 'api-global',
    windowMs: 60_000,
    max: 300,
    keyGenerator: keyByIp,
    message: 'คุณเรียกใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
  })
);

app.get('/api/health', async (req, res) => {
  let sqlStatus = 'disconnected';
  let migration = null;
  let parity = undefined;
  try {
    const r = await querySQL(
      `SELECT setting_value FROM shop_settings WHERE setting_key = 'shop-settings' LIMIT 1`
    );
    sqlStatus = 'connected';
    migration = (r.rows[0] && r.rows[0].setting_value) || 'pending';
    if (req.query && String(req.query.counts || '') === '1') {
      parity = await getMirrorParitySummary();
    }
  } catch {
    sqlStatus = 'error';
  }
  res.json({
    success: true,
    service: 'buffet-api',
    database: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      postgresql: sqlStatus,
    },
    migration,
    ...(parity ? { parity } : {}),
  });
});

app.get('/api/admin/migrations/status', protect, authorize('admin'), async (_req, res) => {
  try {
    const parity = await getMirrorParitySummary();
    return res.json({
      success: true,
      data: parity,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/migrations/run', protect, authorize('admin'), async (_req, res) => {
  try {
    const { runMigrations } = require('./database/migrate');
    await runMigrations();
    const syncResult = await migrateMongoToSql({ force: true });
    return res.json({
      success: true,
      data: syncResult,
      message: 'รันไฟล์ฐานข้อมูล SQL และซิงก์ข้อมูลคู่ขนาน (MongoDB <-> Supabase) สำเร็จแล้ว',
    });
  } catch (error) {
    console.error('Migration run failed:', error);
    return res
      .status(500)
      .json({ success: false, message: error.message || 'รันไฟล์ฐานข้อมูล SQL ล้มเหลว' });
  }
});

app.post('/api/admin/migrations/sync-mongo', protect, authorize('admin'), async (req, res) => {
  try {
    const force = req.body?.force !== false;
    const result = await migrateMongoToSql({ force });
    return res.json({
      success: true,
      data: result,
      message: 'ซิงก์ข้อมูลคู่ขนานระหว่าง MongoDB และ Supabase PostgreSQL ครบทุกตารางสำเร็จ',
    });
  } catch (error) {
    console.error('Mongo<->SQL sync failed:', error);
    return res
      .status(500)
      .json({ success: false, message: error.message || 'ซิงก์ข้อมูลล้มเหลว' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/table', tableRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/members', memberRoutes);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
  const port = Number.parseInt(process.env.PORT, 10) || 3000;

  try {
    await connectDB();
    await connectSQL();
    await migrateMongoToSql().catch((err) => {
      console.warn('Initial Mongo->SQL sync skipped:', err.message);
    });
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, '0.0.0.0', () => {
        httpServer.removeListener('error', reject);
        console.log(`Server listening on port ${port}`);
        console.log(`Local:   http://localhost:${port}`);
        const lanIPv4 = getLanIPv4();
        if (lanIPv4) {
          console.log(`LAN:     http://${lanIPv4}:${port}`);
        } else {
          console.warn('LAN:     No non-internal IPv4 network interface was found.');
        }
        if (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.trim()) {
          console.log(`Public:  ${process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, '')}`);
        } else {
          console.log(
            'Public:  Use a reverse-proxy HTTPS tunnel; QR links follow its forwarded host and protocol.'
          );
        }

        initSocket(io);
        startShopSchedule(io);
        startReconcileLoop(io);
        resolve();
      });
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Server startup failed: port ${port} is already in use. Stop the other server or set a different PORT in .env.`
      );
    } else {
      console.error('Server startup failed:', error.message);
    }
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch (disconnectError) {
        console.error('MongoDB disconnect after startup failure failed:', disconnectError.message);
      }
    }
    try {
      await closeSQL();
    } catch (sqlDisconnectError) {
      console.error('PostgreSQL disconnect after startup failure failed:', sqlDisconnectError.message);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Unexpected startup error:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
