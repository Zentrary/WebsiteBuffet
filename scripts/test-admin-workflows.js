const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const loyaltyService = require('../services/loyaltyService');
const Menu = require('../models/Menu');
const Promotion = require('../models/Promotion');
const Member = require('../models/Member');
const MembershipTier = require('../models/MembershipTier');
const PointTransaction = require('../models/PointTransaction');
const QueueCounter = require('../models/QueueCounter');
const menuRoutes = require('../routes/menuRoutes');
const memberRoutes = require('../routes/memberRoutes');
const { calculateTotal } = require('../utils/calculateBilling');

const root = path.resolve(__dirname, '..');
const locales = {
  th: require('../public/locales/th.json'),
  en: require('../public/locales/en.json'),
};
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function assertEventually(assertion, message) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      try {
        if (assertion()) return resolve();
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - startedAt > 3000) return reject(new Error(message));
      setTimeout(check, 10);
    };
    check();
  });
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function translate(locale, key, vars = {}) {
  const template = locale[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

async function openAdminPage(file, scripts, handler) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const dom = new JSDOM(html, {
    url: `http://localhost/${file}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  window.URL.createObjectURL = () => 'blob:fixture-image';
  window.sessionStorage.setItem('token', 'fixture-token');
  window.sessionStorage.setItem('staffUser', JSON.stringify({ username: 'Fixture', role: 'admin' }));
  window.localStorage.setItem('lang', 'th');
  window.t = (key, vars) => translate(locales.th, key, vars);
  const calls = [];
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    const method = options.method || 'GET';
    let body = options.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const call = { pathname, method, body, options };
    calls.push(call);
    return handler(call, calls);
  };

  for (const script of scripts) {
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  await wait();
  return { dom, window, calls };
}

function submit(window, form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

async function testMenuEditor() {
  const menus = [
    {
      _id: 'menu-existing',
      name: 'Original dish',
      description: 'Original description',
      category: 'main',
      price: 80,
      preparationTime: 10,
      buffetTier: 'auto',
      imageUrl: '/assets/images/default-food.jpg',
      isAvailable: true,
      stockQuantity: null,
      lowStockThreshold: 5,
      maxOrderQuantity: 99,
    },
  ];
  const writes = [];
  let rejectImageUpload = true;
  let nextMenuId = 0;
  const page = await openAdminPage(
    'public/admin/manage-menu.html',
    [
      'public/js/staff-auth.js',
      'public/js/admin/common.js',
      'public/js/menu-categories.js',
      'public/js/admin/manageMenu.js',
    ],
    (call) => {
      if (call.pathname === '/api/menu' && call.method === 'GET') {
        return response({ success: true, data: menus });
      }
      if (call.pathname === '/api/menu/image' && call.method === 'POST') {
        if (rejectImageUpload) {
          return response(
            {
              success: false,
              code: 'UPLOAD_STORAGE_UNAVAILABLE',
              message: 'Enter a hosted image URL.',
            },
            501
          );
        }
        return response({ success: true, data: { imageUrl: '/uploads/fixture.png' } }, 201);
      }
      if (call.pathname === '/api/menu' && call.method === 'POST') {
        const created = {
          ...call.body,
          _id: `menu-created-${++nextMenuId}`,
          isAvailable: true,
        };
        menus.push(created);
        writes.push({ method: 'POST', values: call.body });
        return response({ success: true, data: created }, 201);
      }
      if (call.pathname.startsWith('/api/menu/') && call.method === 'PUT') {
        const id = call.pathname.split('/').pop();
        const menu = menus.find((item) => item._id === id);
        assert.ok(menu, `Unexpected menu ID ${id}`);
        Object.assign(menu, call.body);
        writes.push({ method: 'PUT', id, values: call.body });
        return response({ success: true, data: menu });
      }
      return response({ success: false, code: 'NOT_FOUND', message: 'Not found.' }, 404);
    }
  );
  const { window, dom, calls } = page;
  const document = window.document;
  await assertEventually(() => document.querySelectorAll('#menu-rows tr').length === 1, 'Menu list did not load');

  document.getElementById('add-menu-button').click();
  const form = document.getElementById('menu-form');
  form.elements.name.value = 'New curry';
  form.elements.description.value = 'Freshly prepared';
  form.elements.price.value = '129.50';
  form.elements.preparationTime.value = '12';
  form.elements.category.value = 'main';
  form.elements.stockQuantity.value = '20';
  form.elements.lowStockThreshold.value = '4';
  form.elements.maxOrderQuantity.value = '8';
  submit(window, form);
  submit(window, form);
  await assertEventually(() => writes.some((write) => write.method === 'POST'), 'Menu creation request did not run');
  await assertEventually(() => document.getElementById('menu-modal').classList.contains('hidden'), 'New menu editor did not close');
  await assertEventually(() => form.dataset.saving === 'false', 'Menu form did not finish saving');
  assert.equal(writes.filter((write) => write.method === 'POST').length, 1);
  assert.equal(writes[0].values.name, 'New curry');
  assert.equal(writes[0].values.category, 'main');
  assert.equal(writes[0].values.price, 129.5);
  assert.equal(writes[0].values.stockQuantity, 20);

  const imageInput = document.getElementById('menuImageFile');
  document.querySelector('#menu-rows [data-edit="menu-existing"]').click();
  assert.equal(form.elements.name.value, 'Original dish');
  form.elements.name.value = 'Updated dish';
  Object.defineProperty(imageInput, 'files', {
    configurable: true,
    value: [new window.File(['image'], 'replacement.png', { type: 'image/png' })],
  });
  imageInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(form.elements.imageUrl.value, '', 'Selecting a replacement file must clear the old image URL');
  rejectImageUpload = false;
  submit(window, form);
  await assertEventually(() => writes.some((write) => write.method === 'PUT'), 'Menu update request did not run');
  await assertEventually(() => form.dataset.saving === 'false', 'Menu update did not finish saving');
  assert.equal(writes.find((write) => write.method === 'PUT').values.name, 'Updated dish');
  assert.equal(writes.find((write) => write.method === 'PUT').values.imageUrl, '/uploads/fixture.png');

  rejectImageUpload = true;
  document.getElementById('add-menu-button').click();
  form.elements.name.value = 'Menu with image';
  form.elements.category.value = 'dessert';
  Object.defineProperty(imageInput, 'files', {
    configurable: true,
    value: [new window.File(['image'], 'dish.png', { type: 'image/png' })],
  });
  const beforeFailedSave = writes.length;
  submit(window, form);
  await assertEventually(() => writes.length > beforeFailedSave, 'Menu was not saved after an unavailable image upload');
  await assertEventually(() => form.dataset.saving === 'false', 'Menu form did not finish saving after an unavailable image upload');
  assert.equal(document.getElementById('menu-modal').classList.contains('hidden'), true);
  assert.equal(writes.at(-1).values.imageUrl, '/assets/images/default-food.jpg');
  assert.equal(
    document.getElementById('page-message').textContent.includes(locales.th['form.menuImageUploadWarning']),
    true,
    'The user must be told that the default image was saved instead of the selected file'
  );

  document.getElementById('add-menu-button').click();
  form.elements.name.value = 'Menu with hosted image';
  form.elements.category.value = 'dessert';
  form.elements.imageUrl.value = 'https://images.example.test/dish.png';
  const beforeHostedSave = writes.length;
  submit(window, form);
  await assertEventually(() => writes.length > beforeHostedSave, 'Menu with a hosted image URL was not saved');
  await assertEventually(() => form.dataset.saving === 'false', 'Hosted-image menu did not finish saving');
  assert.equal(writes.at(-1).values.imageUrl, 'https://images.example.test/dish.png');
  assert.equal(
    calls.filter((call) => call.pathname === '/api/menu/image').length,
    2,
    'A hosted URL must bypass file upload, while a selected replacement image must upload'
  );

  window.localStorage.setItem('lang', 'en');
  window.t = (key, vars) => translate(locales.en, key, vars);
  dom.window.close();
  console.log('PASS menu creation, editing, image-upload errors, hosted image fallback, and duplicate-submit guard');
}

async function testPromotionEditor() {
  const promotions = [];
  const writes = [];
  const page = await openAdminPage(
    'public/admin/manage-members.html',
    ['public/js/staff-auth.js', 'public/js/admin/common.js', 'public/js/admin/manageMembers.js'],
    (call) => {
      if (call.pathname === '/api/members/overview') {
        return response({ success: true, data: { summary: {}, tiers: [] } });
      }
      if (call.pathname === '/api/members' && call.method === 'GET') {
        return response({ success: true, data: [] });
      }
      if (call.pathname === '/api/members/promotions' && call.method === 'GET') {
        return response({ success: true, data: promotions });
      }
      if (call.pathname === '/api/members/transactions') {
        return response({ success: true, data: [] });
      }
      if (call.pathname === '/api/members/promotions' && call.method === 'POST') {
        if (call.body.promoCode === 'DUPLICATE') {
          return response(
            { success: false, code: 'DUPLICATE_PROMO_CODE', message: 'Duplicate coupon code.' },
            409
          );
        }
        const created = { ...call.body, promotionId: 'promo-1', usageCount: 0, totalDiscountGiven: 0 };
        promotions.push(created);
        writes.push({ method: 'POST', values: call.body });
        return response({ success: true, data: created }, 201);
      }
      if (call.pathname === '/api/members/promotions/promo-1' && call.method === 'PUT') {
        Object.assign(promotions[0], call.body);
        writes.push({ method: 'PUT', values: call.body });
        return response({ success: true, data: promotions[0] });
      }
      if (call.pathname === '/api/members/promotions/promo-1' && call.method === 'DELETE') {
        promotions.splice(0, 1);
        writes.push({ method: 'DELETE' });
        return response({ success: true, data: {} });
      }
      return response({ success: false, code: 'NOT_FOUND', message: 'Not found.' }, 404);
    }
  );
  const { window, dom, calls } = page;
  const document = window.document;
  const form = document.getElementById('promo-form');
  await assertEventually(
    () => document.getElementById('loyalty-loading').classList.contains('hidden'),
    'Membership data did not load'
  );

  document.getElementById('add-promo-button').click();
  form.elements.promoCode.value = 'duplicate';
  form.elements.title.value = 'Duplicate test';
  form.elements.discountType.value = 'FIXED';
  form.elements.discountValue.value = '25';
  submit(window, form);
  submit(window, form);
  await assertEventually(
    () => document.getElementById('page-message').textContent === locales.th['error.DUPLICATE_PROMO_CODE'],
    'Duplicate promotion errors were not shown'
  );
  await assertEventually(() => form.dataset.saving === 'false', 'Promotion form did not recover from a duplicate code');
  assert.equal(
    calls.filter((call) => call.pathname === '/api/members/promotions' && call.body?.promoCode === 'DUPLICATE').length,
    1
  );
  assert.equal(document.getElementById('promo-modal').classList.contains('hidden'), false);
  assert.equal(form.querySelector('button[type="submit"]').disabled, false);

  form.elements.promoCode.value = 'hbd100';
  form.elements.pointsCost.value = '0';
  form.elements.title.value = 'คูปองทานฟรีสำหรับวันเกิด';
  form.elements.description.value = 'ส่วนลดวันเกิด 100%';
  form.elements.discountType.value = 'PERCENT';
  form.elements.discountValue.value = '100';
  form.elements.minSpend.value = '0';
  form.elements.maxDiscount.value = '';
  form.elements.isActive.checked = true;
  submit(window, form);
  await assertEventually(() => writes.some((write) => write.method === 'POST'), 'Promotion creation request did not run');
  await assertEventually(() => document.getElementById('promo-modal').classList.contains('hidden'), 'Promotion editor did not close');
  await assertEventually(() => form.dataset.saving === 'false', 'Promotion creation did not finish saving');
  assert.deepEqual(writes[0].values, {
    promoCode: 'HBD100',
    pointsCost: 0,
    title: 'คูปองทานฟรีสำหรับวันเกิด',
    description: 'ส่วนลดวันเกิด 100%',
    discountType: 'PERCENT',
    discountValue: 100,
    minSpend: 0,
    maxDiscount: null,
    isActive: true,
  });
  assert.equal(promotions.length, 1);
  assert.equal(document.querySelector('#promo-rows [data-edit-promo="promo-1"]') !== null, true);

  document.querySelector('#promo-rows [data-edit-promo="promo-1"]').click();
  assert.equal(form.elements.promoCode.value, 'HBD100');
  form.elements.title.value = 'Birthday offer updated';
  submit(window, form);
  await assertEventually(() => writes.some((write) => write.method === 'PUT'), 'Promotion update request did not run');
  await assertEventually(() => form.dataset.saving === 'false', 'Promotion update did not finish saving');
  assert.equal(promotions[0].title, 'Birthday offer updated');

  document.querySelector('#promo-rows [data-delete-promo="promo-1"]').click();
  await assertEventually(() => document.querySelector('#admin-confirm-modal.flex'), 'Delete confirmation did not open');
  document.querySelector('#admin-confirm-modal [data-confirm-ok]').click();
  await assertEventually(() => writes.some((write) => write.method === 'DELETE'), 'Promotion delete request did not run');
  await assertEventually(() => promotions.length === 0, 'Deleted promotion remained in the list');
  assert.equal(calls.filter((call) => call.pathname === '/api/members/promotions' && call.method === 'POST').length, 2);
  dom.window.close();
  console.log('PASS promotion validation errors, HBD100 creation, editing, and deletion');
}

function replaceMethod(target, key, value, restorers) {
  const previous = target[key];
  target[key] = value;
  restorers.push(() => {
    target[key] = previous;
  });
}

function queryResult(value) {
  return {
    sort() {
      return this;
    },
    lean: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

async function testPromotionService() {
  const restorers = [];
  const records = new Map();
  const promotionId = new mongoose.Types.ObjectId();
  const memberId = new mongoose.Types.ObjectId();
  let forceDuplicateKey = false;
  replaceMethod(MembershipTier, 'countDocuments', async () => 1, restorers);
  replaceMethod(
    MembershipTier,
    'find',
    () =>
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          tierCode: 'MEMBER',
          tierName: 'Member',
          minPoints: 0,
          discountPercent: 0,
          pointsMultiplier: 1,
        },
      ]),
    restorers
  );
  replaceMethod(
    Member,
    'findById',
    () =>
      queryResult({
        _id: memberId,
        memberCode: 'MB0001',
        fullName: 'Fixture member',
        phone: '0800000000',
        currentPoints: 0,
        lifetimePoints: 0,
        totalSpent: 0,
        visitCount: 0,
        isActive: true,
        tierCode: 'MEMBER',
        registeredVia: 'admin',
      }),
    restorers
  );
  replaceMethod(QueueCounter, 'findById', () => queryResult({ _id: 'loyalty-promos-seeded' }), restorers);
  replaceMethod(QueueCounter, 'findByIdAndUpdate', async () => ({ sequence: 1 }), restorers);
  replaceMethod(Promotion, 'countDocuments', async () => records.size, restorers);
  replaceMethod(
    Promotion,
    'findOne',
    (filter) =>
      queryResult(
        [...records.values()].find(
          (record) =>
            record.promoCode === filter.promoCode &&
            (!filter._id || String(record._id) !== String(filter._id.$ne))
        ) || null
      ),
    restorers
  );
  replaceMethod(
    Promotion,
    'create',
    async (payload) => {
      if (forceDuplicateKey) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      const record = {
        ...payload,
        _id: promotionId,
        createdAt: new Date(),
        async save() {
          records.set(String(this._id), this);
          return this;
        },
      };
      records.set(String(record._id), record);
      return record;
    },
    restorers
  );
  replaceMethod(Promotion, 'findById', (id) => queryResult(records.get(String(id)) || null), restorers);
  replaceMethod(
    Promotion,
    'findByIdAndDelete',
    async (id) => {
      const existing = records.get(String(id)) || null;
      records.delete(String(id));
      return existing;
    },
    restorers
  );
  replaceMethod(PointTransaction, 'aggregate', async () => [], restorers);

  try {
    const created = await loyaltyService.createPromotion({
      promoCode: 'hbd100',
      title: 'Birthday coupon',
      description: 'One hundred percent off',
      discountType: 'PERCENT',
      discountValue: 100,
      pointsCost: 0,
      minSpend: 0,
      maxDiscount: null,
      isActive: true,
    });
    assert.equal(created.promoCode, 'HBD100');
    assert.equal(created.discountValue, 100);
    assert.equal(created.maxDiscount, null);
    assert.equal(loyaltyService.computePromoDiscountAmount(created, 350), 350);
    const applied = await loyaltyService.evaluateBenefitForBill({
      memberId: String(memberId),
      benefitType: 'PROMO',
      promotionId: created.promotionId,
      subtotal: 350,
    });
    assert.equal(applied.discountAmount, 350);
    assert.equal(applied.appliedPromoCode, 'HBD100');
    assert.equal(calculateTotal(350, applied.discountAmount).grandTotal, 0);

    await assert.rejects(
      loyaltyService.createPromotion({
        promoCode: 'BADPCT',
        title: 'Invalid percent',
        discountType: 'PERCENT',
        discountValue: 100.01,
      }),
      (error) => error.code === 'INVALID_DISCOUNT_VALUE' && error.status === 400
    );
    await assert.rejects(
      loyaltyService.createPromotion({
        promoCode: 'BADPTS',
        title: 'Fractional points',
        discountType: 'FIXED',
        discountValue: 10,
        pointsCost: 1.5,
      }),
      (error) => error.code === 'INVALID_POINTS_COST' && error.status === 400
    );
    await assert.rejects(
      loyaltyService.createPromotion({
        promoCode: 'BADTEXT',
        title: 'Long description',
        description: 'x'.repeat(401),
        discountType: 'FIXED',
        discountValue: 10,
      }),
      (error) => error.code === 'INVALID_PROMO_DESCRIPTION' && error.status === 400
    );
    await assert.rejects(
      loyaltyService.createPromotion({
        promoCode: 'HBD100',
        title: 'Duplicate',
        discountType: 'FIXED',
        discountValue: 10,
      }),
      (error) => error.code === 'DUPLICATE_PROMO_CODE' && error.status === 409
    );

    forceDuplicateKey = true;
    await assert.rejects(
      loyaltyService.createPromotion({
        promoCode: 'RACE100',
        title: 'Concurrent duplicate',
        discountType: 'FIXED',
        discountValue: 10,
      }),
      (error) => error.code === 'DUPLICATE_PROMO_CODE' && error.status === 409
    );
    console.log('PASS promotion service validation, 100% discount, duplicate, and race-conflict handling');
  } finally {
    for (const restore of restorers.reverse()) restore();
  }
}

async function testProtectedRoutes() {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'admin-workflow-test-secret';
  const restorers = [];
  const app = express();
  app.use(express.json());
  app.use('/api/menu', menuRoutes);
  app.use('/api/members', memberRoutes);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminToken = jwt.sign({ role: 'admin', username: 'fixture-admin' }, process.env.JWT_SECRET);
  const waiterToken = jwt.sign({ role: 'waiter', username: 'fixture-waiter' }, process.env.JWT_SECRET);
  const menuId = new mongoose.Types.ObjectId();

  replaceMethod(
    Menu,
    'create',
    async (payload) => ({ ...payload, _id: menuId, stockQuantity: null, lowStockThreshold: 5, maxOrderQuantity: 99 }),
    restorers
  );
  replaceMethod(
    loyaltyService,
    'createPromotion',
    async (payload) => {
      if (payload.promoCode === 'SCHEMAERR') {
        const error = new mongoose.Error.ValidationError();
        error.addError('title', new mongoose.Error.ValidatorError({ path: 'title', message: 'Invalid title.' }));
        throw error;
      }
      return { promotionId: 'fixture-promo', ...payload };
    },
    restorers
  );

  try {
    const menuResponse = await fetch(`${baseUrl}/api/menu`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Route menu', category: 'main', price: 45 }),
    });
    assert.equal(menuResponse.status, 201);
    assert.equal((await menuResponse.json()).data.name, 'Route menu');

    const promotionResponse = await fetch(`${baseUrl}/api/members/promotions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ promoCode: 'ROUTE10', discountType: 'FIXED', discountValue: 10 }),
    });
    assert.equal(promotionResponse.status, 201);
    assert.equal((await promotionResponse.json()).data.promoCode, 'ROUTE10');

    const validationResponse = await fetch(`${baseUrl}/api/members/promotions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ promoCode: 'SCHEMAERR' }),
    });
    assert.equal(validationResponse.status, 400);

    const deniedResponse = await fetch(`${baseUrl}/api/menu`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiterToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized menu', category: 'main' }),
    });
    assert.equal(deniedResponse.status, 403);

    const unauthenticatedResponse = await fetch(`${baseUrl}/api/members/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promoCode: 'NOAUTH', discountType: 'FIXED', discountValue: 10 }),
    });
    assert.equal(unauthenticatedResponse.status, 401);
    console.log('PASS menu and promotion API routes, authenticated writes, and role restrictions');
  } finally {
    for (const restore of restorers.reverse()) restore();
    await new Promise((resolve) => server.close(resolve));
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
}

async function main() {
  await testMenuEditor();
  await testPromotionEditor();
  await testPromotionService();
  await testProtectedRoutes();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
