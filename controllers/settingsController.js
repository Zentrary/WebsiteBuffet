const mongoose = require('mongoose');
const ShopSettings = require('../models/ShopSettings');
const { querySQL, getSQLConnectionInfo } = require('../config/db.sql');
const sqlBridge = require('../services/sqlBridge');
const { parseTime, getShopStatus } = require('../utils/shopStatus');
const { getQueueAcceptance, getBusinessDateKey } = require('../utils/businessDay');
const { getConfiguredBuffetPackages, getConfiguredRefillPrice } = require('../utils/buffetPricing');
const { normalizePromptPayTarget } = require('../utils/promptpayQr');
const { getMirrorParitySummary } = require('../services/mongoToSqlMigration');
const uploadImage = require('../middlewares/uploadImage');

async function loadSettings() {
  return ShopSettings.findByIdAndUpdate(
    'shop-settings',
    { $setOnInsert: { _id: 'shop-settings' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function output(settings) {
  return {
    ...settings.toObject(),
    status: getShopStatus(settings),
    queueStatus: getQueueAcceptance(settings, new Date()),
    businessDate: getBusinessDateKey(settings, new Date()),
  };
}

async function getSettings(req, res, next) {
  try {
    return res.json({ success: true, data: output(await loadSettings()) });
  } catch (error) {
    return next(error);
  }
}

async function getPublicSettings(req, res, next) {
  try {
    const settings = await loadSettings();
    const buffetPackages = getConfiguredBuffetPackages(settings);
    const refillDrinkPrice = getConfiguredRefillPrice(settings);
    return res.json({
      success: true,
      data: {
        restaurantName: settings.restaurantName,
        welcomeMessage: settings.welcomeMessage,
        phone: settings.phone,
        address: settings.address,
        logoUrl: settings.logoUrl,
        heroImageUrl: settings.heroImageUrl,
        diningDurationMinutes: settings.diningDurationMinutes,
        vatPercent: settings.vatPercent,
        serviceChargePercent: settings.serviceChargePercent,
        vatMode: settings.vatMode,
        serviceChargeMode: settings.serviceChargeMode,
        buffetPackages,
        buffetSignaturePrice: buffetPackages[0].pricePerPerson,
        buffetPremiumPrice: buffetPackages[1].pricePerPerson,
        buffetDeluxePrice: buffetPackages[2].pricePerPerson,
        refillDrinkPrice,
        hasDynamicPromptPay: Boolean(normalizePromptPayTarget(settings.promptPayId)),
        status: getShopStatus(settings),
        queueStatus: getQueueAcceptance(settings, new Date()),
      },
    });
  } catch (error) {
    return next(error);
  }
}

function clampPercent(value, fallback, max = 30) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, 0), max);
}

function clampMoney(value, fallback, max = 99999) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.round(Math.min(num, max) * 100) / 100;
}

async function updateSettings(req, res, next) {
  try {
    const {
      openTime,
      closeTime,
      lastQueueTime,
      isTestMode,
      restaurantName,
      welcomeMessage,
      phone,
      address,
      diningDurationMinutes,
      logoUrl,
      heroImageUrl,
      vatPercent,
      serviceChargePercent,
      vatMode,
      serviceChargeMode,
      paymentQrImageUrl,
      buffetSignaturePrice,
      buffetPremiumPrice,
      buffetDeluxePrice,
      refillDrinkPrice,
      promptPayId,
    } = req.body;

    if (parseTime(openTime) === null || parseTime(closeTime) === null || openTime === closeTime) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SHOP_TIME',
        message: 'เวลาเปิดและปิดต้องเป็น HH:MM และต้องไม่เท่ากัน',
      });
    }

    if (lastQueueTime !== undefined && parseTime(lastQueueTime) === null) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_QUEUE_TIME',
        message: 'เวลาปิดรับคิวต้องเป็นรูปแบบ HH:MM',
      });
    }

    if (promptPayId !== undefined && String(promptPayId).trim() !== '') {
      const normalizedTarget = normalizePromptPayTarget(promptPayId);
      if (!normalizedTarget) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PROMPTPAY_ID',
          message:
            'กรุณากรอกเบอร์พร้อมเพย์ 10 หลัก หรือเลขประจำตัวผู้เสียภาษี/บัตรประชาชน 13 หลัก (หรือเว้นว่างไว้)',
        });
      }
    }

    const settings = await loadSettings();
    settings.openTime = openTime;
    settings.closeTime = closeTime;
    if (lastQueueTime !== undefined) settings.lastQueueTime = lastQueueTime;
    settings.isTestMode = Boolean(isTestMode);
    settings.restaurantName = String(restaurantName || '').trim() || 'Smart Queue';
    settings.welcomeMessage = String(welcomeMessage || '').trim();
    settings.phone = String(phone || '').trim();
    settings.address = String(address || '').trim();
    settings.diningDurationMinutes = Number(diningDurationMinutes) || 90;
    settings.logoUrl = validImageUrl(logoUrl) || '/assets/images/logo.png';
    settings.heroImageUrl = validImageUrl(heroImageUrl);

    settings.vatPercent = clampPercent(vatPercent, settings.vatPercent ?? 7);
    settings.serviceChargePercent = clampPercent(
      serviceChargePercent,
      settings.serviceChargePercent ?? 10
    );
    settings.vatMode = vatMode === 'excluded' ? 'excluded' : 'included';
    settings.serviceChargeMode = serviceChargeMode === 'excluded' ? 'excluded' : 'included';

    settings.buffetSignaturePrice = clampMoney(
      buffetSignaturePrice,
      settings.buffetSignaturePrice ?? 499
    );
    settings.buffetPremiumPrice = clampMoney(
      buffetPremiumPrice,
      settings.buffetPremiumPrice ?? 599
    );
    settings.buffetDeluxePrice = clampMoney(buffetDeluxePrice, settings.buffetDeluxePrice ?? 699);
    settings.refillDrinkPrice = clampMoney(refillDrinkPrice, settings.refillDrinkPrice ?? 49, 9999);
    if (promptPayId !== undefined) {
      const target = normalizePromptPayTarget(promptPayId);
      settings.promptPayId = target ? target.rawDigits : '';
    }
    if (paymentQrImageUrl !== undefined) {
      settings.paymentQrImageUrl = validImageUrl(paymentQrImageUrl) || settings.paymentQrImageUrl;
    }

    await settings.save();
    try {
      await sqlBridge.updateSqlShopSettings({
        restaurantName: settings.restaurantName || '',
        welcomeMessage: settings.welcomeMessage || '',
        phone: settings.phone || '',
        address: settings.address || '',
        openTime: settings.openTime || '10:30',
        closeTime: settings.closeTime || '03:00',
        lastQueueTime: settings.lastQueueTime || '02:00',
        timezone: settings.timezone || 'Asia/Bangkok',
        isTestMode: Boolean(settings.isTestMode),
        diningDurationMinutes: settings.diningDurationMinutes || 90,
        logoUrl: settings.logoUrl || '/assets/images/logo.png',
        heroImageUrl: settings.heroImageUrl || '',
        vatPercent: settings.vatPercent,
        serviceChargePercent: settings.serviceChargePercent,
        vatMode: settings.vatMode,
        serviceChargeMode: settings.serviceChargeMode,
        buffetSignaturePrice: settings.buffetSignaturePrice,
        buffetPremiumPrice: settings.buffetPremiumPrice,
        buffetDeluxePrice: settings.buffetDeluxePrice,
        refillDrinkPrice: settings.refillDrinkPrice,
        promptPayId: settings.promptPayId || '',
        paymentQrImageUrl: settings.paymentQrImageUrl || '',
      });
    } catch (sqlError) {
      console.error('SQL shop settings sync failed:', sqlError.message);
    }
    req.app
      .get('io')
      .to('admin')
      .to('customer')
      .emit('shop_status_changed', getShopStatus(settings));
    req.app
      .get('io')
      .to('admin')
      .to('customer')
      .emit('queue_status_changed', getQueueAcceptance(settings));
    return res.json({ success: true, data: output(settings), message: 'บันทึกการตั้งค่าร้านแล้ว' });
  } catch (error) {
    return next(error);
  }
}

function validImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('/assets/') || url.startsWith('/uploads/')) return url;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

async function uploadShopImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_IMAGE',
        message: 'รองรับเฉพาะ JPG, PNG, WEBP หรือ GIF ขนาดไม่เกิน 5 MB',
      });
    }
    const folder = String(req.query.folder || req.body?.folder || 'shop');
    const imageUrl = await uploadImage.persistUploadedFile(req.file, folder);
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

async function openShopEarly(req, res, next) {
  try {
    const settings = await loadSettings();
    const status = getShopStatus(settings);
    if (status.isOpen)
      return res
        .status(409)
        .json({ success: false, code: 'SHOP_ALREADY_OPEN', message: 'ร้านเปิดให้บริการอยู่แล้ว' });
    settings.manualOpenAt = new Date();
    settings.manualOpenSawScheduledWindow = status.scheduledOpen;
    await settings.save();
    req.app
      .get('io')
      .to('admin')
      .to('customer')
      .emit('shop_status_changed', getShopStatus(settings));
    return res.json({
      success: true,
      data: output(settings),
      message: 'เปิดร้านก่อนเวลาตามที่ยืนยันแล้ว',
    });
  } catch (error) {
    return next(error);
  }
}

async function getFavicon(req, res) {
  try {
    const settings = await loadSettings();
    const target = (settings && settings.logoUrl) || '/assets/images/favicon.png';
    res.set('Cache-Control', 'public, max-age=60');
    return res.redirect(302, target);
  } catch (error) {
    return res.redirect(302, '/assets/images/favicon.png');
  }
}

async function inspectMongoStatus() {
  const readyState = mongoose.connection.readyState;
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  const database = mongoose.connection.db?.databaseName || process.env.DB_NAME || 'Buffetdb';
  const host = mongoose.connection.host || null;

  if (readyState !== 1 || !mongoose.connection.db) {
    return {
      connected: false,
      state: stateMap[readyState] || 'disconnected',
      database,
      host,
      latencyMs: null,
      error: null,
    };
  }

  try {
    const startedAt = Date.now();
    await mongoose.connection.db.admin().ping();
    const latencyMs = Date.now() - startedAt;
    return {
      connected: true,
      state: 'connected',
      database,
      host,
      latencyMs,
      error: null,
    };
  } catch (error) {
    return {
      connected: false,
      state: 'error',
      database,
      host,
      latencyMs: null,
      error: error.message,
    };
  }
}

async function inspectSQLStatus() {
  try {
    const startedAt = Date.now();
    const result = await querySQL('SELECT current_database() AS database_name');
    const latencyMs = Date.now() - startedAt;
    const info = getSQLConnectionInfo();
    const dbName = result.rows?.[0]?.database_name || info.database || 'postgres';
    return {
      connected: true,
      state: 'connected',
      engine: 'PostgreSQL (Supabase)',
      database: dbName,
      host: info.host || null,
      port: info.port || null,
      latencyMs,
      error: null,
    };
  } catch (error) {
    const info = getSQLConnectionInfo();
    return {
      connected: false,
      state: 'error',
      engine: 'PostgreSQL (Supabase)',
      database: info.database || 'postgres',
      host: info.host || null,
      port: info.port || null,
      latencyMs: null,
      error: error.message,
    };
  }
}

const PARITY_DATASETS = [
  ['users', 'users', 'users'],
  ['membership_tiers', 'membershiptiers', 'membership_tiers'],
  ['members', 'members', 'members'],
  ['point_transactions', 'pointtransactions', 'point_transactions'],
  ['shop_settings', 'shopsettings', 'shop_settings'],
  ['sessions', 'sessions', 'sessions'],
  ['orders', 'orders', 'orders'],
  ['payments', 'payments', 'payments'],
  ['tables', 'tables', 'tables'],
  ['queues', 'queues', 'queues'],
  ['queue_counters', 'queuecounters', 'queue_counters'],
  ['menus', 'menus', 'menus'],
  ['promotions', 'promotions', 'promotions'],
  ['feedbacks', 'feedbacks', 'feedbacks'],
  ['audit_logs', 'auditlogs', 'audit_logs'],
];

function shapeParity(parity) {
  if (!parity) return null;
  const datasets = PARITY_DATASETS.map(([key, mongoKey, sqlKey]) => {
    const mongo = Number(parity.mongodb?.[mongoKey] ?? 0);
    const sql = Number(parity.postgresql?.[sqlKey] ?? 0);
    return { key, mongo, sql, matched: mongo === sql };
  });
  return {
    allMatched: datasets.every((row) => row.matched),
    mismatches: datasets
      .filter((row) => !row.matched)
      .map((row) => ({ key: row.key, mongo: row.mongo, sql: row.sql })),
    datasets,
    orderItems: Number(parity.postgresql?.order_items ?? 0),
  };
}

async function getDatabaseStatus(_req, res, next) {
  try {
    const mongodb = await inspectMongoStatus();
    const sql = await inspectSQLStatus();
    let parity = null;
    let parityError = null;
    try {
      parity = shapeParity(await getMirrorParitySummary());
    } catch (error) {
      parityError = error.message;
    }
    return res.json({
      success: true,
      data: {
        checkedAt: new Date().toISOString(),
        mongodb,
        sql,
        parity,
        parityError,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getPublicSettings,
  getSettings,
  updateSettings,
  openShopEarly,
  uploadShopImage,
  getFavicon,
  getDatabaseStatus,
  inspectMongoStatus,
};
