(() => {
  const Admin = window.Admin;
  if (!Admin) return;
  const T = (key, vars) => (window.t ? window.t(key, vars) : key);

  const ZONE_RULES = {
    small: { minCapacity: 1, maxCapacity: 2 },
    medium: { minCapacity: 3, maxCapacity: 6 },
    large: { minCapacity: 7, maxCapacity: 12 },
  };
  let tables = [];
  let selectedTable = null;
  let pendingDeleteId = null;
  let editingTableNumber = '';
  let pricingConfig = { SIGNATURE: 499, PREMIUM: 599, DELUXE: 699, refillDrinkPrice: 49 };

  const STATUS_THEME = {
    available: {
      cardAccent: 'border-l-emerald-500 hover:border-emerald-300',
      badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
    },
    reserved: {
      cardAccent: 'border-l-amber-500 hover:border-amber-300',
      badge: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80',
    },
    occupied: {
      cardAccent: 'border-l-orange-500 hover:border-orange-300',
      badge: 'bg-orange-50 text-orange-800 ring-1 ring-orange-200/80',
    },
    cleaning: {
      cardAccent: 'border-l-sky-500 hover:border-sky-300',
      badge: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200/80',
    },
  };

  function formatSessionBadge(sessionObj) {
    if (!sessionObj || typeof sessionObj !== 'object') return '';
    const count = Number(sessionObj.customerCount) || 1;
    const pkgLabel =
      sessionObj.diningStyle === 'buffet'
        ? sessionObj.buffetPackageName || sessionObj.buffetPackageCode || 'Buffet'
        : T('dining.alacarteShort');
    const refill = sessionObj.hasRefillDrink ? ` · ${T('dining.refillShort')}` : '';
    return `${pkgLabel} · ${count} ${T('common.people')}${refill}`;
  }

  function perPersonLabel() {
    const translated = T('dining.perPerson');
    return translated && translated !== 'dining.perPerson' ? translated : '/ ท่าน';
  }

  function syncWalkinPricingLabels() {
    ['SIGNATURE', 'PREMIUM', 'DELUXE'].forEach((code) => {
      const el = document.querySelector(`[data-walkin-price="${code}"]`);
      if (el) el.textContent = `฿${pricingConfig[code]}`;
    });
    const refillBadge = document.getElementById('walkin-refill-badge');
    if (refillBadge)
      refillBadge.textContent = `+฿${pricingConfig.refillDrinkPrice} ${perPersonLabel()}`;
  }

  async function loadPricingConfig() {
    try {
      const res = await fetch('/api/settings/public', { cache: 'no-store' });
      const payload = await res.json();
      if (payload && payload.data) {
        pricingConfig.SIGNATURE = Number(payload.data.buffetSignaturePrice) || 499;
        pricingConfig.PREMIUM = Number(payload.data.buffetPremiumPrice) || 599;
        pricingConfig.DELUXE = Number(payload.data.buffetDeluxePrice) || 699;
        pricingConfig.refillDrinkPrice = Number(payload.data.refillDrinkPrice) || 49;
      }
    } catch {}
    syncWalkinPricingLabels();
  }

  function zoneShortName(zone) {
    return T(`table.zone.${zone}`) || zone;
  }

  function zoneLabel(zone) {
    return T(`admin.tables.zone.${zone}`) || zoneShortName(zone);
  }

  function statusLabel(status) {
    return T(`table.status.${status}`) || status;
  }

  function renderTables() {
    const root = document.getElementById('table-zones');
    root.replaceChildren();
    for (const [zone, rule] of Object.entries(ZONE_RULES)) {
      const zoneTables = tables.filter((t) => t.zone === zone);
      const section = document.createElement('section');
      section.innerHTML = `
        <div class="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 class="text-base font-semibold text-slate-800">${Admin.escapeHTML(zoneShortName(zone))}</h2>
          <span class="text-xs font-normal text-slate-500">(${zoneTables.length}) · ${Admin.escapeHTML(T('admin.tables.zoneRangeShort', { min: rule.minCapacity, max: rule.maxCapacity }))}</span>
        </div>`;
      const grid = document.createElement('div');
      grid.className =
        'grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';
      zoneTables.forEach((table) => {
        const theme = STATUS_THEME[table.status] || {
          cardAccent: 'border-l-slate-300',
          badge: 'bg-slate-100 text-slate-700',
        };
        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.noBtn = '1';
        card.className = `flex min-h-[6.5rem] flex-col justify-between rounded-xl border border-slate-200/90 border-l-4 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${theme.cardAccent}`;
        const sessionBadge =
          table.status === 'occupied' || table.status === 'reserved'
            ? formatSessionBadge(table.currentSessionId)
            : '';
        card.innerHTML = `
          <div class="flex items-start justify-between gap-2">
            <span class="text-xl font-semibold leading-none tracking-tight text-slate-900">${Admin.escapeHTML(table.tableNumber)}</span>
            <span class="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${theme.badge}">${Admin.escapeHTML(statusLabel(table.status))}</span>
          </div>
          <div class="mt-2.5">
            <span class="block text-xs font-normal text-slate-500">${table.minCapacity || 1}–${table.capacity} ${Admin.escapeHTML(T('common.people'))}</span>
            ${sessionBadge ? `<span class="mt-1.5 inline-block max-w-full truncate rounded-md border border-slate-200/70 bg-slate-50 px-2 py-0.5 text-[11px] font-normal text-slate-700">${Admin.escapeHTML(sessionBadge)}</span>` : ''}
          </div>`;
        card.addEventListener('click', () => openTableModal(table));
        grid.append(card);
      });
      if (zoneTables.length === 0) {
        grid.innerHTML = `<p class="col-span-full rounded-xl border border-slate-200/80 bg-white p-4 text-sm font-normal text-slate-400">${Admin.escapeHTML(T('admin.tables.noInZone'))}</p>`;
      }
      section.append(grid);
      root.append(section);
    }
  }

  async function loadTables() {
    document.getElementById('tables-loading').classList.remove('hidden');
    try {
      const payload = await Admin.api('/api/table');
      tables = Array.isArray(payload.data) ? payload.data : [];
      renderTables();
    } catch (error) {
      Admin.message(error.message || T('admin.tables.loadFailed'), true);
    } finally {
      document.getElementById('tables-loading').classList.add('hidden');
    }
  }

  function detailRowHtml(label, valueHtml) {
    return `
      <div class="flex items-center justify-between gap-4 px-3.5 py-2.5">
        <span class="shrink-0 font-normal text-slate-500">${Admin.escapeHTML(label)}</span>
        <span class="min-w-0 text-right font-medium text-slate-800">${valueHtml}</span>
      </div>`;
  }

  function openTableModal(table) {
    selectedTable = table;
    updateTableDetailTitle();

    const theme = STATUS_THEME[table.status] || { badge: 'bg-slate-100 text-slate-700' };
    const statusBadgeEl = document.getElementById('table-modal-status-badge');
    if (statusBadgeEl) {
      statusBadgeEl.className = `shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium ${theme.badge}`;
      statusBadgeEl.textContent = statusLabel(table.status);
    }

    const activeSessionInfo = formatSessionBadge(table.currentSessionId);
    const sessionIdVal = table.currentSessionId
      ? String(table.currentSessionId._id || table.currentSessionId)
      : '';

    const rows = [
      detailRowHtml(T('admin.tables.zoneLabel'), Admin.escapeHTML(zoneShortName(table.zone))),
      detailRowHtml(
        T('admin.tables.capacity'),
        `${table.minCapacity || 1}–${table.capacity} ${Admin.escapeHTML(T('common.people'))}`
      ),
      detailRowHtml(
        T('admin.tables.status'),
        `<span class="inline-block rounded-md px-2 py-0.5 text-xs font-medium ${theme.badge}">${Admin.escapeHTML(statusLabel(table.status))}</span>`
      ),
    ];
    if (activeSessionInfo) {
      rows.push(
        detailRowHtml(
          T('dining.sectionTitle'),
          `<span class="text-orange-700">${Admin.escapeHTML(activeSessionInfo)}</span>`
        )
      );
    }
    rows.push(
      detailRowHtml(
        T('admin.tables.session'),
        sessionIdVal
          ? `<span class="font-mono text-xs font-normal text-slate-600">${Admin.escapeHTML(sessionIdVal)}</span>`
          : `<span class="font-normal text-slate-400">${Admin.escapeHTML(T('admin.tables.none'))}</span>`
      )
    );
    document.getElementById('table-details').innerHTML = rows.join('');

    const isFree =
      table.status === 'available' && !table.currentSessionId && !table.reservedForQueueId;
    const hasActiveSession = Boolean(
      (table.status === 'occupied' && table.currentSessionId) ||
      (table.status === 'reserved' && (table.currentSessionId || table.reservedForQueueId))
    );
    const openWalkinBtn = document.getElementById('open-walkin-btn');
    const printOrderQrBtn = document.getElementById('print-order-qr-btn');
    const editBtn = document.getElementById('edit-table');
    const deleteBtn = document.getElementById('delete-table');
    const secondaryWrap = document.getElementById('table-secondary-actions');

    if (openWalkinBtn) openWalkinBtn.classList.toggle('hidden', !isFree);
    if (printOrderQrBtn) printOrderQrBtn.classList.toggle('hidden', !hasActiveSession);
    document.getElementById('clear-table').classList.toggle('hidden', table.status !== 'cleaning');

    const showEdit = isFree;
    const showDelete = isFree && Admin.isAdmin;
    editBtn.classList.toggle('hidden', !showEdit);
    deleteBtn.classList.toggle('hidden', !showDelete);
    if (secondaryWrap) secondaryWrap.classList.toggle('hidden', !showEdit && !showDelete);

    document.getElementById('table-modal').classList.replace('hidden', 'flex');
  }

  async function clearTable() {
    if (!selectedTable) return;
    try {
      await Admin.api(`/api/table/${encodeURIComponent(selectedTable._id)}/clear`, {
        method: 'POST',
      });
      document.getElementById('table-modal').classList.replace('flex', 'hidden');
      Admin.message(T('admin.tables.cleared'));
      await loadTables();
    } catch (error) {
      Admin.message(error.message || T('admin.tables.clearFailed'), true);
    }
  }

  function openDeleteModal(table) {
    pendingDeleteId = table._id;
    document.getElementById('delete-confirm-target').textContent =
      `${table.tableNumber} (${zoneShortName(table.zone)} · ${table.minCapacity || 1}–${table.capacity} ${T('common.people')})`;
    document.getElementById('delete-confirm-modal').classList.replace('hidden', 'flex');
  }

  function closeDeleteModal() {
    pendingDeleteId = null;
    document.getElementById('delete-confirm-modal').classList.replace('flex', 'hidden');
    document.getElementById('delete-confirm-ok').disabled = false;
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    const okButton = document.getElementById('delete-confirm-ok');
    okButton.disabled = true;
    okButton.textContent = T('admin.tables.deleting');
    try {
      await Admin.api(`/api/table/${encodeURIComponent(pendingDeleteId)}`, { method: 'DELETE' });
      closeDeleteModal();
      document.getElementById('table-modal').classList.replace('flex', 'hidden');
      Admin.message(T('admin.tables.deleteSuccess'));
      await loadTables();
    } catch (error) {
      Admin.message(error.message || T('admin.tables.deleteFailed'), true);
      okButton.disabled = false;
    } finally {
      okButton.textContent = T('admin.tables.confirmDeleteOk');
    }
  }

  function zoneRuleFor(zone) {
    return ZONE_RULES[zone] || ZONE_RULES.small;
  }

  function clampCapacity(value, rule, fallback) {
    const number = Number(value);
    if (value === '' || value === null || value === undefined || !Number.isFinite(number))
      return fallback;
    return Math.min(Math.max(Math.round(number), rule.minCapacity), rule.maxCapacity);
  }

  function updateCapacityHint(options = {}) {
    const form = document.getElementById('add-table-form');
    const zoneSelect = document.getElementById('table-zone-select');
    if (!form || !zoneSelect) return;
    const rule = zoneRuleFor(zoneSelect.value);
    const minInput = form.elements.minCapacity;
    const capacityInput = form.elements.capacity;
    if (!minInput || !capacityInput) return;

    minInput.min = rule.minCapacity;
    minInput.max = rule.maxCapacity;
    capacityInput.min = rule.minCapacity;
    capacityInput.max = rule.maxCapacity;
    minInput.placeholder = String(rule.minCapacity);
    capacityInput.placeholder = String(rule.maxCapacity);

    if (!options.preserveValues) {
      if (options.autofill) {
        minInput.value = rule.minCapacity;
        capacityInput.value = rule.maxCapacity;
      } else {
        minInput.value = clampCapacity(minInput.value, rule, rule.minCapacity);
        capacityInput.value = clampCapacity(capacityInput.value, rule, rule.maxCapacity);
        if (Number(minInput.value) > Number(capacityInput.value)) {
          capacityInput.value = minInput.value;
        }
      }
    }

    const hint = document.getElementById('capacity-hint');
    if (hint)
      hint.textContent = T('admin.tables.zoneRange', {
        min: rule.minCapacity,
        max: rule.maxCapacity,
      });
  }

  function updateAddTableTitle() {
    const title = document.getElementById('add-table-modal-title');
    if (!title) return;
    const form = document.getElementById('add-table-form');
    if (!form || !form.elements.tableId.value) {
      title.textContent = T('admin.tables.addTitle');
      return;
    }
    const typedNumber = String(form.elements.tableNumber.value || '').trim();
    title.textContent = T('admin.tables.editTitle', { table: typedNumber || editingTableNumber });
  }

  function updateTableDetailTitle() {
    const title = document.getElementById('table-modal-title');
    if (!title) return;
    title.textContent =
      selectedTable && selectedTable.tableNumber
        ? T('admin.tables.detailTitle', { table: selectedTable.tableNumber })
        : T('admin.tables.detailTitleFallback');
  }

  function openAddTable() {
    const form = document.getElementById('add-table-form');
    form.reset();
    form.elements.tableId.value = '';
    editingTableNumber = '';
    document.getElementById('table-number-error').classList.add('hidden');
    form.elements.tableNumber.readOnly = false;
    form.elements.zone.value = 'small';
    updateCapacityHint({ autofill: true });
    updateAddTableTitle();
    document.getElementById('add-table-modal').classList.replace('hidden', 'flex');
  }

  function openEditTable(table) {
    if (!table) return;
    const form = document.getElementById('add-table-form');
    const rule = zoneRuleFor(table.zone);
    form.reset();
    form.elements.tableId.value = table._id;
    form.elements.tableNumber.value = table.tableNumber;
    form.elements.tableNumber.readOnly = false;
    form.elements.zone.value = table.zone;
    form.elements.minCapacity.value = table.minCapacity || rule.minCapacity;
    form.elements.capacity.value = table.capacity || rule.maxCapacity;
    editingTableNumber = table.tableNumber;
    document.getElementById('table-number-error').classList.add('hidden');
    updateCapacityHint();
    updateAddTableTitle();
    document.getElementById('table-modal').classList.replace('flex', 'hidden');
    document.getElementById('add-table-modal').classList.replace('hidden', 'flex');
  }

  document.getElementById('add-table-button').addEventListener('click', openAddTable);
  document
    .getElementById('edit-table')
    .addEventListener('click', () => openEditTable(selectedTable));
  document.getElementById('delete-table').addEventListener('click', () => {
    if (selectedTable) openDeleteModal(selectedTable);
  });
  document.getElementById('delete-confirm-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('delete-confirm-ok').addEventListener('click', confirmDelete);

  document.getElementById('add-table-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const tableId = values.tableId;
    delete values.tableId;
    values.tableNumber = String(values.tableNumber || '').trim();
    values.capacity = Number(values.capacity);
    values.minCapacity = Number(values.minCapacity);

    const numberError = document.getElementById('table-number-error');
    if (!tableId) {
      const duplicate = tables.some(
        (t) => String(t.tableNumber || '').trim() === values.tableNumber
      );
      if (duplicate) {
        numberError.textContent = T('admin.tables.numberExists');
        numberError.classList.remove('hidden');
        form.elements.tableNumber.focus();
        return;
      }
    }
    numberError.classList.add('hidden');

    try {
      await Admin.api(tableId ? `/api/table/${encodeURIComponent(tableId)}` : '/api/table', {
        method: tableId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      document.getElementById('add-table-modal').classList.replace('flex', 'hidden');
      form.elements.tableId.value = '';
      editingTableNumber = '';
      Admin.message(tableId ? T('admin.tables.editSuccess') : T('admin.tables.createSuccess'));
      await loadTables();
    } catch (error) {
      Admin.message(
        error.message || (tableId ? T('admin.tables.editFailed') : T('admin.tables.createFailed')),
        true
      );
    }
  });

  document.querySelector('[name="tableNumber"]').addEventListener('input', () => {
    document.getElementById('table-number-error').classList.add('hidden');
    updateAddTableTitle();
  });
  document.getElementById('table-zone-select').addEventListener('change', () => {
    updateCapacityHint({ autofill: true });
  });
  document.getElementById('clear-table').addEventListener('click', clearTable);

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('table-modal').classList.replace('flex', 'hidden');
      document.getElementById('add-table-modal').classList.replace('flex', 'hidden');
    });
  });

  const socket = Admin.connectSocket();
  if (socket) {
    socket.on('table_cleared', loadTables);
    socket.on('table_waiting_for_cleaning', loadTables);
    socket.on('table_board_updated', loadTables);
  }
  window.setInterval(loadTables, 30000);

  window.addEventListener('languageChanged', () => {
    renderTables();
    document.getElementById('add-table-button').textContent = T('admin.tables.addTable');
    document.getElementById('clear-table').textContent = T('admin.tables.clearDone');
    document.getElementById('edit-table').textContent = T('admin.tables.editRename');
    document.getElementById('delete-table').textContent = T('admin.tables.deleteTable');
    document.getElementById('delete-confirm-title').textContent = T(
      'admin.tables.confirmDeleteTitle'
    );
    document.getElementById('delete-confirm-cancel').textContent = T(
      'admin.tables.confirmDeleteCancel'
    );
    document.getElementById('delete-confirm-ok').textContent = T('admin.tables.confirmDeleteOk');
    const zoneSelect = document.getElementById('table-zone-select');
    if (zoneSelect) {
      const currentZone = ZONE_RULES[zoneSelect.value] ? zoneSelect.value : 'small';
      zoneSelect.innerHTML = `
        <option value="small">${T('admin.tables.zone.small')}</option>
        <option value="medium">${T('admin.tables.zone.medium')}</option>
        <option value="large">${T('admin.tables.zone.large')}</option>`;
      zoneSelect.value = currentZone;
    }
    updateCapacityHint({ preserveValues: true });
    updateAddTableTitle();
    updateTableDetailTitle();
    syncWalkinPricingLabels();
  });

  const walkinModal = document.getElementById('walkin-modal');
  const walkinForm = document.getElementById('walkin-form');
  const qrSlipModal = document.getElementById('table-qr-slip-modal');

  function syncWalkinStepperButtons() {
    const input = document.getElementById('walkin-customer-count');
    if (!input) return;
    const min = Number(input.min) || 1;
    const max = Number(input.max) || 12;
    const val = Number(input.value) || 1;
    const decBtn = document.querySelector('[data-walkin-step="-1"]');
    const incBtn = document.querySelector('[data-walkin-step="1"]');
    if (decBtn) decBtn.disabled = val <= min;
    if (incBtn) incBtn.disabled = val >= max;
  }

  function syncWalkinDiningUI() {
    if (!walkinForm) return;
    const style =
      (walkinForm.querySelector('input[name="diningStyle"]:checked') || {}).value || 'buffet';
    const pkg =
      (walkinForm.querySelector('input[name="buffetPackageCode"]:checked') || {}).value ||
      'SIGNATURE';
    const refillCheck = document.getElementById('walkin-refill-check');
    const hasRefill = Boolean(refillCheck && refillCheck.checked);

    walkinForm.querySelectorAll('[data-walkin-style]').forEach((el) => {
      const active = el.dataset.walkinStyle === style;
      el.classList.toggle('border-orange-500', active);
      el.classList.toggle('bg-orange-50', active);
      el.classList.toggle('text-orange-900', active);
      el.classList.toggle('font-medium', active);
      el.classList.toggle('shadow-sm', active);
      el.classList.toggle('border-slate-200', !active);
      el.classList.toggle('bg-white', !active);
      el.classList.toggle('text-slate-600', !active);
      el.classList.toggle('font-normal', !active);
    });

    const picker = document.getElementById('walkin-package-picker');
    if (picker) picker.classList.toggle('hidden', style !== 'buffet');

    walkinForm.querySelectorAll('[data-walkin-tier]').forEach((el) => {
      const active = el.dataset.walkinTier === pkg;
      el.classList.toggle('border-orange-500', active);
      el.classList.toggle('bg-orange-50', active);
      el.classList.toggle('shadow-sm', active);
      el.classList.toggle('border-slate-200', !active);
      el.classList.toggle('bg-white', !active);

      const nameEl = el.querySelector('[data-walkin-tier-name]');
      if (nameEl) {
        nameEl.classList.toggle('text-orange-800', active);
        nameEl.classList.toggle('font-medium', active);
        nameEl.classList.toggle('text-slate-500', !active);
        nameEl.classList.toggle('font-normal', !active);
      }

      const priceEl = el.querySelector('[data-walkin-price]');
      if (priceEl) {
        priceEl.classList.toggle('text-orange-700', active);
        priceEl.classList.toggle('font-semibold', active);
        priceEl.classList.toggle('text-slate-800', !active);
        priceEl.classList.toggle('font-medium', !active);
      }
    });

    const refillCard = document.getElementById('walkin-refill-card');
    if (refillCard) {
      refillCard.classList.toggle('border-orange-500', hasRefill);
      refillCard.classList.toggle('bg-orange-50/60', hasRefill);
      refillCard.classList.toggle('border-slate-200', !hasRefill);
      refillCard.classList.toggle('bg-white', !hasRefill);
    }
  }

  function openWalkinModal() {
    if (!selectedTable || !walkinForm || !walkinModal) return;
    walkinForm.reset();
    walkinForm.elements.tableId.value = selectedTable._id;
    const countInput = document.getElementById('walkin-customer-count');
    const minCap = Math.max(1, Number(selectedTable.minCapacity) || 1);
    const maxCap = Number(selectedTable.capacity) || 12;
    const defaultCount = Math.min(minCap, maxCap);
    if (countInput) {
      countInput.min = 1;
      countInput.max = maxCap;
      countInput.value = defaultCount;
    }
    const subtitle = document.getElementById('walkin-modal-subtitle');
    if (subtitle) {
      subtitle.textContent = `${T('queue.table')} ${selectedTable.tableNumber} · ${zoneShortName(selectedTable.zone)} (1–${maxCap} ${T('common.people')})`;
    }
    syncWalkinPricingLabels();
    syncWalkinStepperButtons();
    syncWalkinDiningUI();
    document.getElementById('table-modal').classList.replace('flex', 'hidden');
    walkinModal.classList.replace('hidden', 'flex');
  }

  function closeWalkinModal() {
    if (walkinModal) walkinModal.classList.replace('flex', 'hidden');
  }

  function renderTableQrSlip(slip) {
    if (!slip || !qrSlipModal) return;
    const isBuffet = slip.diningStyle === 'buffet';
    const pkgLine = isBuffet
      ? `${slip.buffetPackageName || slip.buffetPackageCode} (฿${Number(slip.buffetPricePerPerson) || 0}${T('dining.perPerson')})`
      : T('dining.alacarte');
    const refillLine = slip.hasRefillDrink
      ? `${T('dining.refillShort')} (+฿${Number(slip.refillPricePerPerson) || 49}${T('dining.perPerson')})`
      : '';
    const startStr = slip.startTime
      ? new Date(slip.startTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
      : '--:--';
    const endStr = slip.endTime
      ? new Date(slip.endTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
      : '--:--';

    const slipHtml = `
      <div style="text-align:center;font-family:'Prompt',sans-serif;">
        <p style="font-size:15px;font-weight:700;margin:0;">${Admin.escapeHTML(slip.restaurantName || '')}</p>
        <p style="font-size:11px;color:#475569;margin:2px 0 8px;">${Admin.escapeHTML(T('admin.tables.qrSlipSub'))}</p>
        <div style="border-top:1px dashed #94a3b8;border-bottom:1px dashed #94a3b8;padding:6px 0;margin-bottom:8px;">
          <p style="font-size:21px;font-weight:700;margin:0;">${Admin.escapeHTML(T('queue.table'))} ${Admin.escapeHTML(slip.tableNumber)}</p>
          <p style="font-size:12px;font-weight:500;margin:2px 0 0;">${Admin.escapeHTML(T('queue.ticket'))}: ${Admin.escapeHTML(slip.queueNumber || '-')} · ${Number(slip.customerCount) || 1} ${Admin.escapeHTML(T('common.people'))}</p>
          <p style="font-size:12px;font-weight:600;color:#c2410c;margin:2px 0 0;">${Admin.escapeHTML(pkgLine)}</p>
          ${refillLine ? `<p style="font-size:11px;font-weight:500;color:#047857;margin:1px 0 0;">${Admin.escapeHTML(refillLine)}</p>` : ''}
          <p style="font-size:11px;color:#475569;margin:3px 0 0;">${Admin.escapeHTML(T('admin.tables.diningTimeRange'))}: ${Admin.escapeHTML(startStr)} - ${Admin.escapeHTML(endStr)}</p>
        </div>
        <img src="${Admin.escapeHTML(slip.qrCodeData)}" alt="Table Order QR" style="width:180px;height:180px;margin:0 auto;display:block;">
        <p style="font-size:11px;font-weight:500;margin:6px 0 0;">${Admin.escapeHTML(T('admin.tables.scanToOrder'))}</p>
      </div>`;

    const preview = document.getElementById('table-qr-slip-preview');
    const printArea = document.getElementById('table-qr-print-area');
    if (preview) preview.innerHTML = slipHtml;
    if (printArea) printArea.innerHTML = slipHtml;
    qrSlipModal.classList.replace('hidden', 'flex');
  }

  async function fetchAndShowTableQr() {
    if (!selectedTable) return;
    try {
      const res = await Admin.api(`/api/table/${encodeURIComponent(selectedTable._id)}/order-qr`);
      document.getElementById('table-modal').classList.replace('flex', 'hidden');
      renderTableQrSlip(res.data);
    } catch (error) {
      Admin.message(error.message || T('error.REQUEST_FAILED'), true);
    }
  }

  const openWalkinBtn = document.getElementById('open-walkin-btn');
  if (openWalkinBtn) openWalkinBtn.addEventListener('click', openWalkinModal);
  const printOrderQrBtn = document.getElementById('print-order-qr-btn');
  if (printOrderQrBtn) printOrderQrBtn.addEventListener('click', fetchAndShowTableQr);

  document.querySelectorAll('[data-close-walkin]').forEach((btn) => {
    btn.addEventListener('click', closeWalkinModal);
  });
  document.querySelectorAll('[data-close-qr-slip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (qrSlipModal) qrSlipModal.classList.replace('flex', 'hidden');
    });
  });
  function printTableQrSlip(widthMm) {
    const preview = document.getElementById('table-qr-slip-preview');
    if (preview && preview.innerHTML.trim()) {
      Admin.printThermal(preview.innerHTML, {
        title: 'Table Ordering QR Slip',
        widthMm,
      });
    }
  }
  const printQrNowBtn = document.getElementById('print-qr-slip-now');
  if (printQrNowBtn) printQrNowBtn.addEventListener('click', () => printTableQrSlip(80));
  const printQr58Btn = document.getElementById('print-qr-slip-58');
  if (printQr58Btn) printQr58Btn.addEventListener('click', () => printTableQrSlip(58));

  document.querySelectorAll('[data-walkin-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('walkin-customer-count');
      if (!input) return;
      const step = Number(btn.dataset.walkinStep) || 0;
      const min = Number(input.min) || 1;
      const max = Number(input.max) || 12;
      const next = Math.min(Math.max((Number(input.value) || 1) + step, min), max);
      input.value = String(next);
      syncWalkinStepperButtons();
    });
  });

  const walkinCountInput = document.getElementById('walkin-customer-count');
  if (walkinCountInput) {
    walkinCountInput.addEventListener('input', syncWalkinStepperButtons);
    walkinCountInput.addEventListener('change', syncWalkinStepperButtons);
  }

  if (walkinForm) {
    walkinForm.addEventListener('click', (event) => {
      const tierCard = event.target.closest('[data-walkin-tier]');
      if (tierCard) {
        const radio = tierCard.querySelector('input[name="buffetPackageCode"]');
        if (radio && !radio.checked) {
          radio.checked = true;
        }
        syncWalkinDiningUI();
        return;
      }
      const styleCard = event.target.closest('[data-walkin-style]');
      if (styleCard) {
        const radio = styleCard.querySelector('input[name="diningStyle"]');
        if (radio && !radio.checked) {
          radio.checked = true;
        }
        syncWalkinDiningUI();
      }
    });

    walkinForm
      .querySelectorAll(
        'input[name="diningStyle"], input[name="buffetPackageCode"], #walkin-refill-check'
      )
      .forEach((el) => {
        el.addEventListener('change', syncWalkinDiningUI);
      });

    walkinForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = document.getElementById('walkin-submit-btn');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const fd = new FormData(walkinForm);
        const tableId = fd.get('tableId');
        const diningStyle = String(fd.get('diningStyle') || 'buffet');
        const body = {
          customerCount: Number(fd.get('customerCount')) || 1,
          diningStyle,
          buffetPackageCode:
            diningStyle === 'buffet' ? String(fd.get('buffetPackageCode') || 'SIGNATURE') : '',
          hasRefillDrink: Boolean(fd.get('hasRefillDrink')),
          customerName: String(fd.get('customerName') || '').trim(),
          customerPhone: String(fd.get('customerPhone') || '').trim(),
        };
        const res = await Admin.api(`/api/table/${encodeURIComponent(tableId)}/open-walkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        closeWalkinModal();
        Admin.message(res.message || T('admin.tables.walkinSuccess'));
        await loadTables();
        if (res.data && res.data.qrSlip) {
          renderTableQrSlip(res.data.qrSlip);
        }
      } catch (error) {
        Admin.message(error.message || T('error.REQUEST_FAILED'), true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  loadPricingConfig();
  loadTables();
})();
