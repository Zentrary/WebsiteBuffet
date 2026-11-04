(() => {
  const T = (key, vars) => (window.t ? window.t(key, vars) : key);
  const form = document.getElementById('shop-settings-form');
  const openButton = document.getElementById('open-shop-button');
  const statusElement = document.getElementById('shop-status');
  const countdownElement = document.getElementById('closing-countdown');
  const billingPreviewBody = document.getElementById('billing-preview-body');
  const refreshDbButton = document.getElementById('refresh-db-status');
  const syncMirrorButton = document.getElementById('sync-mirror-now');
  const refreshDbIcon = document.getElementById('refresh-db-icon');
  const dbCheckedAtEl = document.getElementById('db-checked-at');
  const CACHE_KEY = 'shopStatusCache';
  let current;
  let dbStatusSnapshot = null;
  let countdownTimer;

  function setPreview(type, source) {
    const image = document.querySelector(`[data-preview="${type}"]`);
    if (image && source) image.src = source;
  }

  function bindFileName(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const display = document.querySelector(`[data-file-name="${inputId}"]`);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (display) display.textContent = file ? file.name : '';
    });
  }

  function bindImagePreview(fieldName, previewType, fallback) {
    const field = form.elements[fieldName];
    const fileField = form.elements[`${previewType}File`];
    if (field)
      field.addEventListener('input', () =>
        setPreview(previewType, field.value.trim() || fallback)
      );
    if (fileField) {
      fileField.addEventListener('change', () => {
        const file = fileField.files && fileField.files[0];
        if (file) setPreview(previewType, URL.createObjectURL(file));
      });
    }
  }

  function renderCountdown() {
    if (
      !current ||
      !current.status ||
      !current.status.isOpen ||
      current.status.isTestMode ||
      !current.status.closesAt
    ) {
      countdownElement.classList.add('hidden');
      return;
    }
    const remaining = Math.max(0, new Date(current.status.closesAt).getTime() - Date.now());
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    const s = Math.floor((remaining % 60_000) / 1000);
    countdownElement.textContent = T('admin.settings.closingIn', {
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    });
    countdownElement.classList.remove('hidden');
  }

  function applyStatusLabel() {
    if (!current || !current.status) {
      statusElement.textContent = T('admin.settings.statusUnknown');
      openButton.classList.add('hidden');
      return;
    }
    const { status } = current;
    let label;
    if (status.isTestMode) label = T('admin.settings.statusTest');
    else if (status.isOpen)
      label = T('admin.settings.statusOpen', { time: current.closeTime || '--:--' });
    else label = T('admin.settings.statusClosed');
    statusElement.textContent = label;
    openButton.classList.toggle('hidden', Boolean(status.isOpen));
  }

  const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const fmt = (v) =>
    `฿${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0)}`;

  function renderBillingPreview() {
    if (!billingPreviewBody) return;
    const sample = 100;
    const vatPercent = Number(form.elements.vatPercent.value) || 0;
    const servicePercent = Number(form.elements.serviceChargePercent.value) || 0;
    const vatMode = form.elements.vatMode.value;
    const serviceMode = form.elements.serviceChargeMode.value;
    const s = servicePercent / 100;
    const v = vatPercent / 100;
    let serviceCharge = 0,
      vat = 0,
      grandTotal = 0;
    if (serviceMode === 'included' && vatMode === 'included') {
      const denom = (1 + s) * (1 + v);
      const base = denom > 0 ? sample / denom : sample;
      serviceCharge = round(base * s);
      vat = round(base * (1 + s) * v);
      grandTotal = sample;
    } else if (serviceMode === 'excluded' && vatMode === 'excluded') {
      serviceCharge = round(sample * s);
      vat = round((sample + serviceCharge) * v);
      grandTotal = round(sample + serviceCharge + vat);
    } else if (serviceMode === 'excluded' && vatMode === 'included') {
      serviceCharge = round(sample * s);
      const withService = round(sample + serviceCharge);
      const baseForVat = v > 0 ? withService / (1 + v) : withService;
      vat = round(withService - baseForVat);
      grandTotal = withService;
    } else {
      const base = 1 + s > 0 ? sample / (1 + s) : sample;
      serviceCharge = round(sample - base);
      vat = round(sample * v);
      grandTotal = round(sample + vat);
    }
    billingPreviewBody.innerHTML = `
      <div class="flex justify-between"><span>${T('admin.settings.previewFood')}</span><span>${fmt(sample)}</span></div>
      <div class="flex justify-between"><span>${T('admin.settings.previewService', { percent: servicePercent, mode: serviceMode === 'included' ? T('checkout.serviceIncluded') : T('checkout.serviceExcluded') })}</span><span>${fmt(serviceCharge)}</span></div>
      <div class="flex justify-between"><span>${T('admin.settings.previewVat', { percent: vatPercent, mode: vatMode === 'included' ? T('checkout.vatIncluded') : T('checkout.vatExcluded') })}</span><span>${fmt(vat)}</span></div>
      <div class="flex justify-between font-bold text-slate-800"><span>${T('admin.settings.previewCustomerPays')}</span><span>${fmt(grandTotal)}</span></div>`;
  }

  function bindBillingPreview() {
    ['vatPercent', 'serviceChargePercent', 'vatMode', 'serviceChargeMode'].forEach((n) => {
      const f = form.elements[n];
      if (f) {
        f.addEventListener('input', renderBillingPreview);
        f.addEventListener('change', renderBillingPreview);
      }
    });
  }

  function applyDbBadge(prefix, state) {
    const card = document.getElementById(`db-${prefix}-card`);
    const badge = document.getElementById(`db-${prefix}-badge`);
    const dot = document.getElementById(`db-${prefix}-dot`);
    const label = document.getElementById(`db-${prefix}-state`);
    if (!badge || !dot || !label) return;

    const spacingClass = prefix === 'sql' ? 'mt-3 ' : '';
    label.removeAttribute('data-i18n');
    if (state === 'connected') {
      badge.className =
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200';
      dot.className = 'h-2 w-2 rounded-full bg-emerald-500';
      label.textContent = T('admin.settings.dbConnected');
      if (card)
        card.className = `${spacingClass}rounded-xl border border-emerald-200/80 bg-emerald-50/30 p-4 transition`;
    } else if (state === 'disconnected') {
      badge.className =
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800 ring-1 ring-red-200';
      dot.className = 'h-2 w-2 rounded-full bg-red-500';
      label.textContent = T('admin.settings.dbDisconnected');
      if (card)
        card.className = `${spacingClass}rounded-xl border border-red-200 bg-red-50/40 p-4 transition`;
    } else {
      badge.className =
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-200/80 px-2.5 py-1 text-xs font-bold text-slate-600';
      dot.className = 'h-2 w-2 rounded-full bg-slate-400 animate-pulse';
      label.textContent = T('admin.settings.dbChecking');
      if (card)
        card.className = `${spacingClass}rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition`;
    }
  }

  function renderDatabaseStatus(snapshot) {
    if (!snapshot) return;
    const { mongodb = {}, sql = {}, checkedAt } = snapshot;

    if (dbCheckedAtEl && checkedAt) {
      const dt = new Date(checkedAt);
      if (!Number.isNaN(dt.getTime())) {
        const lang =
          window.i18n && typeof window.i18n.getLang === 'function' && window.i18n.getLang() === 'en'
            ? 'en-GB'
            : 'th-TH';
        const formatted = dt.toLocaleTimeString(lang, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        dbCheckedAtEl.textContent = T('admin.settings.dbCheckedAt', { time: formatted });
      }
    }

    applyDbBadge('mongo', mongodb.connected ? 'connected' : 'disconnected');
    applyDbBadge('sql', sql.connected ? 'connected' : 'disconnected');

    const mongoNameEl = document.getElementById('db-mongo-name');
    const mongoHostEl = document.getElementById('db-mongo-host');
    const mongoLatencyEl = document.getElementById('db-mongo-latency');
    const mongoErrorEl = document.getElementById('db-mongo-error');
    if (mongoNameEl) mongoNameEl.textContent = mongodb.database || '—';
    if (mongoHostEl) mongoHostEl.textContent = mongodb.host || '—';
    if (mongoLatencyEl) {
      mongoLatencyEl.textContent = Number.isFinite(mongodb.latencyMs)
        ? `${mongodb.latencyMs} ms`
        : '—';
    }
    if (mongoErrorEl) {
      if (!mongodb.connected && mongodb.error) {
        mongoErrorEl.textContent = mongodb.error;
        mongoErrorEl.classList.remove('hidden');
      } else {
        mongoErrorEl.textContent = '';
        mongoErrorEl.classList.add('hidden');
      }
    }

    const sqlNameEl = document.getElementById('db-sql-name');
    const sqlHostEl = document.getElementById('db-sql-host');
    const sqlLatencyEl = document.getElementById('db-sql-latency');
    const sqlErrorEl = document.getElementById('db-sql-error');
    if (sqlNameEl) {
      sqlNameEl.textContent = sql.database ? `${sql.database} (PostgreSQL)` : 'PostgreSQL';
    }
    if (sqlHostEl) sqlHostEl.textContent = sql.host || '—';
    if (sqlLatencyEl) {
      sqlLatencyEl.textContent = Number.isFinite(sql.latencyMs)
        ? `${sql.latencyMs} ms`
        : '—';
    }
    if (sqlErrorEl) {
      if (!sql.connected && sql.error) {
        sqlErrorEl.textContent = sql.error;
        sqlErrorEl.classList.remove('hidden');
      } else {
        sqlErrorEl.textContent = '';
        sqlErrorEl.classList.add('hidden');
      }
    }
  }

  const PARITY_LABELS = {
    users: 'ผู้ใช้งาน',
    membership_tiers: 'ระดับสมาชิก',
    members: 'สมาชิก',
    point_transactions: 'ธุรกรรมแต้ม',
    shop_settings: 'ตั้งค่าร้าน',
    sessions: 'เซสชัน',
    orders: 'ออเดอร์',
    payments: 'การชำระเงิน',
    tables: 'โต๊ะ',
    queues: 'คิว',
    queue_counters: 'ตัวนับคิว',
    menus: 'เมนู',
    promotions: 'โปรโมชัน',
    feedbacks: 'ความคิดเห็น',
    audit_logs: 'บันทึกตรวจสอบ',
  };

  function renderParity(parity, parityError) {
    const badge = document.getElementById('db-parity-badge');
    const rows = document.getElementById('db-parity-rows');
    const errorEl = document.getElementById('db-parity-error');
    if (errorEl) {
      errorEl.textContent = parityError || '';
      errorEl.classList.toggle('hidden', !parityError);
    }
    if (!rows) return;
    const datasets = (parity && parity.datasets) || [];
    if (badge) {
      if (!parity) {
        badge.textContent = T('admin.settings.parityUnknown');
        badge.className =
          'inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600';
      } else if (parity.allMatched) {
        badge.textContent = T('admin.settings.parityMatched');
        badge.className =
          'inline-flex items-center rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800';
      } else {
        badge.textContent = T('admin.settings.parityMismatch', {
          n: (parity.mismatches || []).length,
        });
        badge.className =
          'inline-flex items-center rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900';
      }
    }
    rows.replaceChildren();
    datasets.forEach((row) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t border-slate-100';
      const matched = Boolean(row.matched);
      tr.innerHTML = `<td class="py-1.5 pr-3 font-semibold">${Admin.escapeHTML(PARITY_LABELS[row.key] || row.key)}</td>
        <td class="py-1.5 pr-3 font-mono">${Number(row.mongo) || 0}</td>
        <td class="py-1.5 pr-3 font-mono">${Number(row.sql) || 0}</td>
        <td class="py-1.5 font-bold ${matched ? 'text-emerald-700' : 'text-red-700'}">${matched ? 'OK' : 'DIFF'}</td>`;
      rows.append(tr);
    });
  }

  async function syncMirrorNow() {
    if (!syncMirrorButton) return;
    const ok = await Admin.confirm(T('admin.settings.paritySyncConfirm'), {
      title: T('admin.settings.paritySync'),
      okText: T('admin.settings.paritySync'),
      cancelText: T('common.cancel'),
    });
    if (!ok) return;
    syncMirrorButton.disabled = true;
    try {
      const result = await Admin.api('/api/admin/migrations/sync-mongo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      Admin.message(result.message || T('admin.settings.paritySyncDone'));
      await loadDatabaseStatus();
    } catch (error) {
      Admin.message(error.message || T('admin.settings.paritySyncFailed'), true);
    } finally {
      syncMirrorButton.disabled = false;
    }
  }

  async function loadDatabaseStatus() {
    applyDbBadge('mongo', 'checking');
    applyDbBadge('sql', 'checking');
    if (refreshDbButton) refreshDbButton.disabled = true;
    if (refreshDbIcon) refreshDbIcon.classList.add('animate-spin');
    try {
      const res = await Admin.api('/api/settings/db-status');
      dbStatusSnapshot = res.data;
      renderDatabaseStatus(dbStatusSnapshot);
      renderParity(dbStatusSnapshot.parity, dbStatusSnapshot.parityError);
    } catch (error) {
      dbStatusSnapshot = {
        checkedAt: new Date().toISOString(),
        mongodb: {
          connected: false,
          database: '—',
          host: '—',
          latencyMs: null,
          error: error.message,
        },
        sql: {
          connected: false,
          latencyMs: null,
          error: error.message,
        },
        parity: null,
        parityError: error.message,
      };
      renderDatabaseStatus(dbStatusSnapshot);
      renderParity(null, error.message);
    } finally {
      if (refreshDbButton) refreshDbButton.disabled = false;
      if (refreshDbIcon) refreshDbIcon.classList.remove('animate-spin');
    }
  }

  window.addEventListener('languageChanged', () => {
    applyStatusLabel();
    renderCountdown();
    renderBillingPreview();
    if (dbStatusSnapshot) {
      renderDatabaseStatus(dbStatusSnapshot);
      renderParity(dbStatusSnapshot.parity, dbStatusSnapshot.parityError);
    }
  });

  function render(data) {
    current = data;
    if (!data) {
      statusElement.textContent = T('admin.settings.statusUnknown');
      return;
    }
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          restaurantName: data.restaurantName,
          openTime: data.openTime,
          closeTime: data.closeTime,
          status: data.status,
          savedAt: Date.now(),
        })
      );
    } catch {}

    if (form.elements.openTime) form.elements.openTime.value = data.openTime || '10:30';
    if (form.elements.closeTime) form.elements.closeTime.value = data.closeTime || '03:00';
    if (form.elements.lastQueueTime)
      form.elements.lastQueueTime.value = data.lastQueueTime || '02:00';
    const businessDateEl = document.getElementById('business-date');
    if (businessDateEl) businessDateEl.textContent = data.businessDate || '—';
    if (form.elements.isTestMode) form.elements.isTestMode.checked = Boolean(data.isTestMode);
    [
      'restaurantName',
      'welcomeMessage',
      'phone',
      'address',
      'diningDurationMinutes',
      'logoUrl',
      'heroImageUrl',
    ].forEach((n) => {
      if (form.elements[n]) form.elements[n].value = data[n] || '';
    });
    if (form.elements.vatPercent) form.elements.vatPercent.value = data.vatPercent ?? 7;
    if (form.elements.serviceChargePercent)
      form.elements.serviceChargePercent.value = data.serviceChargePercent ?? 10;
    if (form.elements.vatMode) form.elements.vatMode.value = data.vatMode || 'included';
    if (form.elements.serviceChargeMode)
      form.elements.serviceChargeMode.value = data.serviceChargeMode || 'included';
    if (form.elements.buffetSignaturePrice)
      form.elements.buffetSignaturePrice.value = data.buffetSignaturePrice ?? 499;
    if (form.elements.buffetPremiumPrice)
      form.elements.buffetPremiumPrice.value = data.buffetPremiumPrice ?? 599;
    if (form.elements.buffetDeluxePrice)
      form.elements.buffetDeluxePrice.value = data.buffetDeluxePrice ?? 699;
    if (form.elements.refillDrinkPrice)
      form.elements.refillDrinkPrice.value = data.refillDrinkPrice ?? 49;
    if (form.elements.promptPayId) form.elements.promptPayId.value = data.promptPayId || '';
    if (form.elements.paymentQrImageUrl)
      form.elements.paymentQrImageUrl.value =
        data.paymentQrImageUrl || '/assets/images/payment/promptpay.png';

    setPreview('logo', data.logoUrl || '/assets/images/logo.png');
    setPreview('hero', data.heroImageUrl || '/assets/images/default-food.jpg');
    setPreview('paymentQr', data.paymentQrImageUrl || '/assets/images/payment/promptpay.png');

    applyStatusLabel();
    renderCountdown();
    renderBillingPreview();
  }

  function applyCachedStatus() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.status) {
        current = { ...cached };
        applyStatusLabel();
      }
    } catch {}
  }

  function syncBrand(name) {
    if (!name) return;
    try {
      localStorage.setItem('shopBrand', name);
    } catch {}
    if (typeof window.applyBrandName === 'function') window.applyBrandName(name);
    const sidebarBrand = document.querySelector('[data-sidebar-brand]');
    if (sidebarBrand) sidebarBrand.textContent = name;
  }

  async function load() {
    try {
      const data = (await Admin.api('/api/settings/shop')).data;
      render(data);
      syncBrand(data.restaurantName);
    } catch (error) {
      statusElement.textContent = T('admin.settings.statusUnknown');
      Admin.message(error.message, true);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const uploads = [
        ['logoFile', 'logoUrl'],
        ['heroFile', 'heroImageUrl'],
        ['paymentQrFile', 'paymentQrImageUrl'],
      ];
      for (const [fileName, target] of uploads) {
        const input = form.elements[fileName];
        if (!input) continue;
        const file = input.files && input.files[0];
        if (!file) continue;
        const body = new FormData();
        body.append('image', file);
        const res = await Admin.api('/api/settings/shop/image', { method: 'POST', body });
        form.elements[target].value = res.data.imageUrl;
      }

      const data = Object.fromEntries(new FormData(form));
      data.isTestMode = form.elements.isTestMode.checked;
      delete data.logoFile;
      delete data.heroFile;
      delete data.paymentQrFile;

      const saved = (
        await Admin.api('/api/settings/shop', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      ).data;
      render(saved);
      syncBrand(saved.restaurantName);
      Admin.message(T('admin.settings.saveSuccess'));

      document.querySelectorAll('[data-file-name]').forEach((el) => {
        el.textContent = '';
      });
      const icon = document.querySelector('link[rel="icon"]');
      if (icon) icon.href = `/api/settings/favicon?v=${Date.now()}`;
    } catch (error) {
      Admin.message(error.message, true);
    }
  });

  openButton.addEventListener('click', async () => {
    const ok = await Admin.confirm(T('admin.settings.confirmOpenMsg'), {
      title: T('admin.settings.confirmOpenTitle'),
      okText: T('admin.settings.confirmOpenOk'),
      cancelText: T('admin.settings.confirmOpenCancel'),
    });
    if (!ok) return;
    try {
      const data = (await Admin.api('/api/settings/shop/open', { method: 'POST' })).data;
      render(data);
      syncBrand(data.restaurantName);
      Admin.message(T('admin.settings.openSuccess'));
    } catch (error) {
      Admin.message(error.message, true);
    }
  });

  const socket = Admin.connectSocket();
  if (socket) socket.on('shop_status_changed', load);

  if (refreshDbButton) {
    refreshDbButton.addEventListener('click', loadDatabaseStatus);
  }
  if (syncMirrorButton) {
    syncMirrorButton.addEventListener('click', syncMirrorNow);
  }
  window.setInterval(loadDatabaseStatus, 20000);

  applyCachedStatus();
  load();
  loadDatabaseStatus();
  bindImagePreview('logoUrl', 'logo', '/assets/images/logo.png');
  bindImagePreview('heroImageUrl', 'hero', '/assets/images/default-food.jpg');
  bindImagePreview('paymentQrImageUrl', 'paymentQr', '/assets/images/payment/promptpay.png');
  bindFileName('logoFileInput');
  bindFileName('heroFileInput');
  bindFileName('paymentQrFileInput');
  bindBillingPreview();
  countdownTimer = window.setInterval(renderCountdown, 1000);
  window.addEventListener('beforeunload', () => window.clearInterval(countdownTimer));
})();
