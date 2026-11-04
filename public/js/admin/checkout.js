(() => {
  const Admin = window.Admin;
  if (!Admin) return;
  const T = (key, vars) => (window.t ? window.t(key, vars) : key);
  const sessionCards = document.getElementById('session-cards');
  const sessionRows = document.getElementById('session-rows');
  const sessionTableWrap = document.getElementById('session-table-wrap');
  const paymentModal = document.getElementById('payment-modal');
  const paymentForm = document.getElementById('payment-form');
  let selectedSessionId = '';
  let selectedSession = null;
  let selectedBill = null;
  let selectedQrPayment = null;
  let lookedUpMemberData = null;
  let initialSessionLinkHandled = false;
  let checkoutView = localStorage.getItem('checkoutView') || 'cards';

  function currentLocale() {
    return localStorage.getItem('lang') === 'en' ? 'en-US' : 'th-TH';
  }

  async function loadSessions() {
    try {
      const payload = await Admin.api('/api/payment/sessions');
      const sessions = Array.isArray(payload.data) ? payload.data : [];
      renderSessionCards(sessions);
      const requestedId = new URLSearchParams(window.location.search).get('sessionId');
      const requestedSession = sessions.find((session) => session._id === requestedId);
      if (!initialSessionLinkHandled && requestedSession && requestedSession.checkoutRequestedAt) {
        initialSessionLinkHandled = true;
        await openPayment(requestedSession);
      }
    } catch (error) {
      Admin.message(error.message || T('admin.checkout.loadSessionsFailed'), true);
      sessionCards.replaceChildren();
      document.getElementById('sessions-loading').classList.add('hidden');
    }
  }

  function isSessionExpired(session) {
    if (!session.endTime) return false;
    return new Date(session.endTime).getTime() <= Date.now();
  }

  async function forceCompleteSession(sessionId, button) {
    const ok = await Admin.confirm(T('admin.checkout.confirmForceComplete'), {
      title: T('admin.checkout.confirmForceCompleteTitle'),
      okText: T('admin.checkout.confirmForceCompleteOk'),
      danger: true,
    });
    if (!ok) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = T('admin.checkout.loading');
    try {
      await Admin.api(`/api/admin/session/${encodeURIComponent(sessionId)}/force-complete`, {
        method: 'POST',
      });
      Admin.message(T('admin.checkout.forceCompleteDone'));
      await loadSessions();
    } catch (error) {
      Admin.message(error.message || T('admin.checkout.forceCompleteFailed'), true);
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function forceFreeSession(sessionId, button) {
    const ok = await Admin.confirm(T('admin.checkout.confirmForceFree'), {
      title: T('admin.checkout.confirmForceFreeTitle'),
      okText: T('admin.checkout.confirmForceFreeOk'),
      danger: true,
    });
    if (!ok) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = T('admin.checkout.loading');
    try {
      await Admin.api(`/api/admin/session/${encodeURIComponent(sessionId)}/force-free`, {
        method: 'POST',
      });
      Admin.message(T('admin.checkout.forceFreeDone'));
      await loadSessions();
    } catch (error) {
      Admin.message(error.message || T('admin.checkout.forceFreeFailed'), true);
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function renderSessionCards(sessions) {
    sessionCards.replaceChildren();
    sessionRows.replaceChildren();
    sessionCards.classList.toggle('hidden', checkoutView === 'table');
    sessionTableWrap.classList.toggle('hidden', checkoutView !== 'table');
    document.getElementById('sessions-empty').classList.toggle('hidden', sessions.length > 0);
    document.getElementById('sessions-loading').classList.add('hidden');

    for (const session of sessions) {
      const card = document.createElement('article');
      card.className =
        'flex min-h-[16rem] flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition hover:border-slate-300';
      const tableNumber = (session.table && session.table.tableNumber) || '—';
      const zoneLabel = T(`table.zone.${session.table && session.table.zone}`) || '—';
      const queueNumber = session.queue && session.queue.queueNumber;
      const items = session.items || [];
      const diningLines =
        session.dining && Array.isArray(session.dining.lines) ? session.dining.lines : [];
      const isBuffet = session.diningStyle === 'buffet';
      const pkgBadgeLabel = isBuffet
        ? `${session.buffetPackageName || session.buffetPackageCode || 'Buffet'} · ${Number(session.customerCount) || 1} ${T('common.people')}${session.hasRefillDrink ? ` · ${T('dining.refillShort')}` : ''}`
        : `${T('dining.alacarteShort')}${session.hasRefillDrink ? ` · ${T('dining.refillShort')} (${Number(session.customerCount) || 1})` : ''}`;
      const itemCount = Number(session.itemCount) || 0;
      const visibleItems = items.slice(0, 3);
      const extraCount = Math.max(0, items.length - visibleItems.length);
      const baseLineRows = diningLines
        .map(
          (line) => `
        <li class="flex justify-between gap-3 border-b border-orange-100/80 bg-orange-50/50 px-2.5 py-1.5 font-medium text-slate-800">
          <span class="min-w-0 truncate">${Admin.escapeHTML(line.type === 'refill_drink' ? T('dining.refillShort') : line.label)} × ${Number(line.quantity) || 1}</span>
          <span class="shrink-0 tabular-nums text-orange-700">${Admin.currency(line.total)}</span>
        </li>`
        )
        .join('');
      const itemRows =
        baseLineRows +
        visibleItems
          .map(
            (item) => `
        <li class="flex justify-between gap-3 border-b border-slate-100 px-2.5 py-1.5 font-normal text-slate-600 last:border-0">
          <span class="min-w-0 truncate">${Admin.escapeHTML(item.name)} × ${Number(item.quantity) || 0}</span>
          <span class="shrink-0 font-medium tabular-nums text-slate-800">${Admin.currency((Number(item.price) || 0) * (Number(item.quantity) || 0))}</span>
        </li>`
          )
          .join('');

      const hasCheckout = Boolean(session.checkoutRequestedAt);
      const expired = isSessionExpired(session);
      const canPay = hasCheckout;
      const isQrWaiting =
        session.pendingPayment && session.pendingPayment.status === 'awaiting_confirmation';
      const stuck = expired && !hasCheckout;

      let mainLabel;
      if (isQrWaiting) mainLabel = T('admin.checkout.waitingSlip');
      else if (canPay) mainLabel = T('admin.checkout.pay');
      else if (expired) mainLabel = T('admin.checkout.expired');
      else mainLabel = T('admin.checkout.waitConfirm');

      const mainClass = canPay
        ? 'bg-emerald-700 hover:bg-emerald-800'
        : 'cursor-not-allowed bg-slate-300 text-slate-600';

      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-xl font-semibold leading-tight text-slate-900">${Admin.escapeHTML(T('queue.table'))} ${Admin.escapeHTML(tableNumber)}</h2>
            <p class="mt-0.5 text-xs font-normal text-slate-500">${Admin.escapeHTML(zoneLabel)}${queueNumber ? ` · ${Admin.escapeHTML(queueNumber)}` : ''} · ${Admin.escapeHTML(T('admin.checkout.startedAt', { time: new Date(session.startTime).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }) }))}</p>
            <span class="mt-1.5 inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${isBuffet ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-200/80' : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}">${Admin.escapeHTML(pkgBadgeLabel)}</span>
          </div>
          <span class="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums ${session.status === 'expired' ? 'border-red-200 bg-red-50 text-red-700' : 'border-orange-200 bg-orange-50/70 text-orange-800'}" data-endtime="${Admin.escapeHTML(session.endTime)}">${remaining(session.endTime)}</span>
        </div>
        <div class="mt-3 flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/60">
          <div class="border-b border-slate-200/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-500">${Admin.escapeHTML(T('admin.checkout.itemsCount', { n: itemCount }))}</div>
          <ul class="flex-1 overflow-hidden text-xs">${itemRows || `<li class="px-2.5 py-2.5 font-normal text-slate-400">${Admin.escapeHTML(T('admin.checkout.noItems'))}</li>`}${extraCount > 0 ? `<li class="px-2.5 py-1 text-[11px] font-normal text-slate-400">${Admin.escapeHTML(T('admin.checkout.moreItems', { n: extraCount }))}</li>` : ''}</ul>
        </div>
        <div class="mt-3 flex items-baseline justify-between pt-1">
          <span class="text-xs font-normal text-slate-500">${Admin.escapeHTML(T('admin.checkout.netTotal'))}</span>
          <span class="text-lg font-semibold tabular-nums text-orange-700">${Admin.currency(session.bill && session.bill.grandTotal)}</span>
        </div>
        <button type="button" data-no-btn data-pay-session="${Admin.escapeHTML(session._id)}" class="mt-2.5 h-10 w-full rounded-xl px-4 text-sm font-medium ${canPay ? 'text-white shadow-sm' : ''} transition ${mainClass}" ${canPay ? '' : 'disabled'}>
          ${mainLabel}
        </button>
        ${
          stuck
            ? `
        <button type="button" data-no-btn data-force-session="${Admin.escapeHTML(session._id)}" data-force-mode="${itemCount > 0 ? 'complete' : 'free'}" class="mt-1.5 h-9 w-full rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-medium text-red-700 transition hover:bg-red-100">
          ${itemCount > 0 ? Admin.escapeHTML(T('admin.checkout.forceComplete')) : Admin.escapeHTML(T('admin.checkout.forceFree'))}
        </button>`
            : ''
        }`;

      const hasAnyCharge = diningLines.length > 0 || itemCount > 0;
      const forceMode = hasAnyCharge ? 'complete' : 'free';
      const stuckBtnCard = card.querySelector('[data-force-session]');
      if (stuckBtnCard) {
        stuckBtnCard.dataset.forceMode = forceMode;
        stuckBtnCard.textContent = hasAnyCharge
          ? T('admin.checkout.forceComplete')
          : T('admin.checkout.forceFree');
      }
      const payButton = card.querySelector('[data-pay-session]');
      if (canPay && payButton) payButton.addEventListener('click', () => openPayment(session));

      const forceButton = card.querySelector('[data-force-session]');
      if (forceButton) {
        forceButton.addEventListener('click', () => {
          const mode = forceButton.dataset.forceMode;
          if (mode === 'complete') forceCompleteSession(session._id, forceButton);
          else forceFreeSession(session._id, forceButton);
        });
      }

      sessionCards.append(card);

      const row = document.createElement('tr');
      row.innerHTML = `<td class="p-3"><p class="font-semibold text-slate-900">${Admin.escapeHTML(T('queue.table'))} ${Admin.escapeHTML(tableNumber)}</p><p class="text-xs font-normal text-slate-500">${Admin.escapeHTML(zoneLabel)}</p></td>
        <td class="max-w-sm p-3 text-xs font-normal text-slate-600">${
          items.length
            ? items
                .slice(0, 4)
                .map((item) => `${Admin.escapeHTML(item.name)} × ${Number(item.quantity) || 0}`)
                .join(', ') + (items.length > 4 ? ` …+${items.length - 4}` : '')
            : Admin.escapeHTML(T('admin.checkout.noItems'))
        }</td>
        <td class="p-3"><span class="inline-block rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums ${session.status === 'expired' ? 'border-red-200 bg-red-50 text-red-700' : 'border-orange-200 bg-orange-50/70 text-orange-800'}" data-endtime="${Admin.escapeHTML(session.endTime)}">${remaining(session.endTime)}</span></td>
        <td class="p-3 text-right font-semibold tabular-nums text-orange-700">${Admin.currency(session.bill && session.bill.grandTotal)}</td>
        <td class="p-3 text-right space-y-1">
          <button type="button" data-no-btn class="h-9 w-full rounded-lg px-3 text-xs font-medium transition ${canPay ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'cursor-not-allowed bg-slate-300 text-slate-600'}" ${canPay ? '' : 'disabled'}>${isQrWaiting ? Admin.escapeHTML(T('admin.checkout.viewQr')) : canPay ? Admin.escapeHTML(T('admin.checkout.pay')) : Admin.escapeHTML(T('admin.checkout.waitCustomer'))}</button>
          ${stuck ? `<button type="button" data-no-btn data-force-row="${Admin.escapeHTML(session._id)}" data-force-row-mode="${itemCount > 0 ? 'complete' : 'free'}" class="h-9 w-full rounded-lg border border-red-200 bg-red-50 px-3 text-[11px] font-medium text-red-700 hover:bg-red-100">${itemCount > 0 ? Admin.escapeHTML(T('admin.checkout.forceComplete')) : Admin.escapeHTML(T('admin.checkout.forceFree'))}</button>` : ''}
        </td>`;

      const rowButton = row.querySelector('button:not([data-force-row])');
      if (canPay) rowButton.addEventListener('click', () => openPayment(session));

      const forceRow = row.querySelector('[data-force-row]');
      if (forceRow) {
        forceRow.addEventListener('click', () => {
          const mode = forceRow.dataset.forceRowMode;
          if (mode === 'complete') forceCompleteSession(session._id, forceRow);
          else forceFreeSession(session._id, forceRow);
        });
      }

      sessionRows.append(row);
    }
    document.querySelectorAll('[data-checkout-view]').forEach((button) => {
      const selected = button.dataset.checkoutView === checkoutView;
      button.classList.toggle('bg-orange-600', selected);
      button.classList.toggle('text-white', selected);
      button.classList.toggle('text-slate-600', !selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function remaining(endTime) {
    const seconds = Math.max(0, Math.ceil((new Date(endTime).getTime() - Date.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function updateCountdowns() {
    sessionCards.querySelectorAll('[data-endtime]').forEach((element) => {
      element.textContent = remaining(element.dataset.endtime);
    });
    sessionRows.querySelectorAll('[data-endtime]').forEach((element) => {
      element.textContent = remaining(element.dataset.endtime);
    });
  }

  async function openPayment(session) {
    selectedSession = session;
    selectedSessionId = String(session._id);
    selectedBill = session.bill;
    selectedQrPayment = session.pendingPayment || null;
    paymentModal.classList.replace('hidden', 'flex');
    document.getElementById('payment-error').classList.add('hidden');
    document.getElementById('receipt-paid').classList.add('hidden');
    document.getElementById('print-receipt').classList.add('hidden');
    document.getElementById('print-receipt-actions').classList.add('hidden');
    document.getElementById('print-proforma-actions').classList.remove('hidden');
    paymentForm.classList.remove('hidden');
    paymentForm.elements.method.value = 'cash';
    paymentForm.elements.method.disabled = false;
    document.getElementById('cash-received').disabled = false;
    document.getElementById('confirm-payment').classList.remove('hidden');
    document.getElementById('receipt-cash-row').classList.add('hidden');
    document.getElementById('receipt-change-row').classList.add('hidden');
    document.getElementById('cash-received').value = '';
    resetLoyaltyPanel(session);
    updateCashPreview();
    document.getElementById('qr-payment-amount').textContent = Admin.currency(
      session.bill && session.bill.grandTotal
    );
    setPaymentMethodView();
    await loadBill();
    const linkedMemberId =
      (selectedBill && selectedBill.loyalty && selectedBill.loyalty.memberId) ||
      (session && session.loyalty && session.loyalty.memberId) ||
      '';
    const initialQuery = document.getElementById('loyalty-phone-input').value.trim();
    if (linkedMemberId) {
      await lookupLoyaltyMember({ memberId: linkedMemberId, silentNotFound: true });
    } else if (initialQuery) {
      await lookupLoyaltyMember({ silentNotFound: true });
    }
  }

  async function loadPaymentQrImage(targetSessionId = selectedSessionId) {
    const image = document.getElementById('payment-qr-image');
    const missing = document.getElementById('payment-qr-missing');
    if (!image) return;
    try {
      if (targetSessionId) {
        const res = await Admin.api(
          `/api/payment/promptpay-qr/${encodeURIComponent(targetSessionId)}`
        );
        const data = res && res.data;
        if (data && data.qrImageUrl) {
          image.src = data.qrImageUrl;
          image.classList.remove('hidden');
          missing.classList.add('hidden');
          return;
        }
      }
    } catch {}
    image.src = '/assets/images/payment/promptpay.png';
    image.classList.remove('hidden');
    missing.classList.add('hidden');
    image.onerror = () => {
      image.classList.add('hidden');
      missing.classList.remove('hidden');
    };
  }

  async function renderItems(sessionId, diningMeta = null) {
    const payload = await Admin.api(`/api/order/session/${encodeURIComponent(sessionId)}`);
    const container = document.getElementById('receipt-items');
    container.replaceChildren();
    let count = 0;
    const diningLines = diningMeta && Array.isArray(diningMeta.lines) ? diningMeta.lines : [];
    for (const line of diningLines) {
      count += 1;
      const row = document.createElement('div');
      row.className =
        'flex justify-between gap-4 border-b border-dashed border-slate-200 pb-1 text-sm font-bold text-slate-900';
      const labelText =
        line.type === 'refill_drink'
          ? `${T('dining.refillShort')} (${Admin.currency(line.unitPrice)} × ${line.quantity} ${T('common.people')})`
          : `${line.label} (${Admin.currency(line.unitPrice)} × ${line.quantity} ${T('common.people')})`;
      row.innerHTML = `<span>${Admin.escapeHTML(labelText)}</span><span class="font-black">${Admin.currency(line.total)}</span>`;
      container.append(row);
    }
    for (const order of payload.data || []) {
      for (const item of order.items || []) {
        if (item.itemStatus === 'cancelled' || order.status === 'cancelled') continue;
        count += 1;
        const unitPrice = Number(item.price) || 0;
        const lineTotal = unitPrice * (Number(item.quantity) || 0);
        const row = document.createElement('div');
        row.className = 'flex justify-between gap-4 text-sm';
        const priceHtml =
          unitPrice === 0 && diningMeta && diningMeta.diningStyle === 'buffet'
            ? `<span class="text-xs font-bold text-emerald-800">${Admin.escapeHTML(T('dining.includedInBuffet'))} (${Admin.currency(0)})</span>`
            : `<span class="font-semibold">${Admin.currency(lineTotal)}</span>`;
        row.innerHTML = `<span>${Admin.escapeHTML(item.name)} × ${Number(item.quantity) || 0}</span>${priceHtml}`;
        container.append(row);
      }
    }
    document.getElementById('receipt-empty').classList.toggle('hidden', count > 0);
  }

  async function loadBill() {
    if (!selectedSessionId) return;
    document.getElementById('page-message').classList.add('hidden');
    try {
      const [bill, session] = await Promise.all([
        Admin.api('/api/payment/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: selectedSessionId }),
        }),
        Admin.api(`/api/session/${encodeURIComponent(selectedSessionId)}`),
      ]);
      await Promise.all([
        renderItems(selectedSessionId, bill.data && bill.data.dining),
        loadPaymentQrImage(selectedSessionId),
      ]);
      const pendingPayment = selectedSession && selectedSession.pendingPayment;
      selectedSession = { ...session.data, pendingPayment };
      selectedBill = bill.data;
      const tableNumber = session.data.tableId && session.data.tableId.tableNumber;
      document.getElementById('receipt-session').textContent = T('admin.checkout.receiptSession', {
        table: tableNumber || '—',
        id: selectedSessionId,
      });
      document.getElementById('receipt-time').textContent = T('admin.checkout.receiptStarted', {
        time: new Date(session.data.startTime).toLocaleString(currentLocale()),
      });
      document.getElementById('bill-subtotal').textContent = Admin.currency(bill.data.subtotal);
      document.getElementById('bill-service').textContent = Admin.currency(bill.data.serviceCharge);
      document.getElementById('bill-vat').textContent = Admin.currency(bill.data.vat);
      document.getElementById('bill-total').textContent = Admin.currency(bill.data.grandTotal);
      document.getElementById('qr-payment-amount').textContent = Admin.currency(
        bill.data.grandTotal
      );
      const serviceLabel = document.querySelector('[data-bill-service-label]');
      const vatLabel = document.querySelector('[data-bill-vat-label]');
      const serviceMode =
        bill.data.serviceChargeMode === 'excluded'
          ? T('checkout.serviceExcluded')
          : T('checkout.serviceIncluded');
      const vatMode =
        bill.data.vatMode === 'excluded' ? T('checkout.vatExcluded') : T('checkout.vatIncluded');
      if (serviceLabel)
        serviceLabel.textContent = T('checkout.serviceLabel', { mode: serviceMode });
      if (vatLabel) vatLabel.textContent = T('checkout.vatLabel', { mode: vatMode });
      const discount = Number(bill.data.discount) || 0;
      document.getElementById('bill-discount-row').classList.toggle('hidden', discount <= 0);
      document.getElementById('bill-discount').textContent = `-${Admin.currency(discount)}`;
      renderReceiptLoyaltyMeta(bill.data.loyalty || null, discount);
      const isPayable = Boolean(session.data.checkoutRequestedAt || pendingPayment);
      paymentForm.classList.toggle('hidden', !isPayable);
      document
        .getElementById('loyalty-panel')
        .classList.toggle('hidden', !isPayable || Boolean(session.data.isPaid));
      if (pendingPayment) {
        selectedQrPayment = { ...pendingPayment, amount: bill.data.grandTotal };
        paymentForm.elements.method.value = 'qr_payment';
        setPaymentMethodView();
      } else {
        setPaymentMethodView();
      }
      updateCashPreview();
      document.getElementById('confirm-payment').disabled = false;
    } catch (error) {
      const paymentError = document.getElementById('payment-error');
      paymentError.textContent = error.message || T('admin.checkout.loadBillFailed');
      paymentError.classList.remove('hidden');
    }
  }

  function updateCashPreview() {
    const input = document.getElementById('cash-received');
    const preview = document.getElementById('cash-change-preview');
    if (!selectedBill || input.value === '') {
      preview.textContent = T('admin.checkout.cashChangePlaceholder');
      preview.className = 'mt-2 rounded-lg bg-slate-50 p-3 text-sm';
      return;
    }
    const received = Math.round((Number(input.value) + Number.EPSILON) * 100) / 100;
    const total = Number(selectedBill.grandTotal) || 0;
    if (!Number.isFinite(received) || received < total) {
      preview.textContent = T('admin.checkout.cashInsufficient', {
        amount: Admin.currency(Math.max(0, total - received)),
      });
      preview.className = 'mt-2 rounded-lg bg-red-100 p-3 text-sm font-semibold text-red-800';
      return;
    }
    preview.textContent = T('admin.checkout.cashChange', {
      amount: Admin.currency(received - total),
    });
    preview.className = 'mt-2 rounded-lg bg-green-100 p-3 text-sm font-semibold text-green-800';
  }

  function setPaymentMethodView() {
    const isQr = paymentForm.elements.method.value === 'qr_payment';
    document.getElementById('cash-received-field').classList.toggle('hidden', isQr);
    document.getElementById('cash-received').required = !isQr;
    document.getElementById('cash-change-preview').classList.toggle('hidden', isQr);
    document.getElementById('qr-payment-panel').classList.toggle('hidden', !isQr);
    document.getElementById('confirm-payment').classList.toggle('hidden', isQr);
    document.getElementById('confirm-payment-label').textContent = T('admin.checkout.confirmCash');
    document.getElementById('payment-workflow-hint').textContent = isQr
      ? T('admin.checkout.qrHint')
      : T('admin.checkout.cashHint');
    if (isQr) ensureQrPayment();
  }

  async function ensureQrPayment() {
    if (!selectedSessionId) return;
    if (
      selectedQrPayment &&
      ['pending', 'awaiting_confirmation'].includes(selectedQrPayment.status)
    ) {
      document.getElementById('qr-payment-status').textContent =
        `${T('admin.checkout.amountDue')} ${Admin.currency(selectedQrPayment.amount)} · ${T('admin.checkout.waitingSlip')}`;
      return;
    }
    try {
      const payload = await Admin.api('/api/payment/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedSessionId, method: 'qr_payment' }),
      });
      selectedQrPayment = payload.data;
      if (selectedSession) selectedSession.pendingPayment = payload.data;
      document.getElementById('qr-payment-status').textContent =
        `${T('admin.checkout.amountDue')} ${Admin.currency(payload.data.amount)} · ${T('admin.checkout.waitingSlip')}`;
    } catch (error) {
      const paymentError = document.getElementById('payment-error');
      paymentError.textContent = error.message || T('admin.checkout.processFailed');
      paymentError.classList.remove('hidden');
    }
  }

  function displayTierName(tierCode, tierName) {
    if (tierCode === 'MEMBER' || tierName === 'สมาชิกทั่วไป') {
      return T('admin.members.tierNameMember');
    }
    return tierName || tierCode || T('admin.members.tierNameMember');
  }

  function formatPromoIneligibleReason(promo) {
    if (promo.ineligibleCode === 'MEMBER_INACTIVE') {
      return T('admin.checkout.loyaltyIneligibleInactive');
    }
    if (promo.ineligibleCode === 'INSUFFICIENT_POINTS') {
      return T('admin.checkout.loyaltyIneligiblePoints', { points: promo.pointsCost });
    }
    if (promo.ineligibleCode === 'MIN_SPEND_NOT_MET') {
      return T('admin.checkout.loyaltyIneligibleMinSpend', {
        amount: Admin.currency(promo.minSpend),
      });
    }
    return promo.ineligibleReason || '';
  }

  function formatLoyaltySettlementText(loyalty) {
    if (!loyalty || !loyalty.member) return '';
    const parts = [T('admin.checkout.settlementMember', { name: loyalty.member.fullName })];
    if (loyalty.pointsRedeemed > 0) {
      parts.push(T('admin.checkout.settlementRedeemed', { points: loyalty.pointsRedeemed }));
    }
    parts.push(
      T('admin.checkout.settlementEarned', {
        earned: loyalty.pointsEarned || 0,
        balance: loyalty.member.currentPoints,
      })
    );
    if (loyalty.tierUpgraded) {
      parts.push(
        T('admin.checkout.settlementUpgraded', {
          tier: displayTierName(loyalty.newTierCode, loyalty.newTierName),
        })
      );
    }
    return ` · ${parts.join(' · ')}`;
  }

  function resetLoyaltyPanel(session) {
    lookedUpMemberData = null;
    const loyaltyPanel = document.getElementById('loyalty-panel');
    const phoneInput = document.getElementById('loyalty-phone-input');
    const statusMsg = document.getElementById('loyalty-status-msg');
    const candidatesEl = document.getElementById('loyalty-candidates');
    const memberBox = document.getElementById('loyalty-member-box');
    const quickReg = document.getElementById('loyalty-quick-register');
    const regName = document.getElementById('loyalty-register-name');
    const regPhone = document.getElementById('loyalty-register-phone');
    const clearBtn = document.getElementById('loyalty-clear-btn');

    loyaltyPanel.classList.remove('hidden');
    statusMsg.classList.add('hidden');
    if (candidatesEl) {
      candidatesEl.replaceChildren();
      candidatesEl.classList.add('hidden');
    }
    memberBox.classList.add('hidden');
    quickReg.classList.add('hidden');
    clearBtn.classList.add('hidden');

    const queuePhone = (session && session.queue && session.queue.customerPhone) || '';
    const queueName = (session && session.queue && session.queue.customerName) || '';
    const linkedPhone =
      (session && session.loyalty && session.loyalty.memberPhone) || session.memberPhone || '';
    phoneInput.value = linkedPhone || queuePhone || queueName || '';
    regName.value = queueName || '';
    if (regPhone) regPhone.value = linkedPhone || queuePhone || '';
  }

  function renderReceiptLoyaltyMeta(loyalty, discount) {
    const receiptRow = document.getElementById('receipt-member-row');
    const receiptInfo = document.getElementById('receipt-member-info');
    const discountLabel = document.getElementById('bill-discount-label');
    const activeBadge = document.getElementById('loyalty-active-badge');
    const clearBtn = document.getElementById('loyalty-clear-btn');

    if (loyalty && loyalty.memberId) {
      const tierLabel = displayTierName(loyalty.memberTierCode, loyalty.memberTierName);
      receiptRow.classList.remove('hidden');
      receiptInfo.textContent = `${loyalty.memberName} (${tierLabel})`;
      activeBadge.textContent = loyalty.appliedPromoCode
        ? T('admin.checkout.loyaltyActivePromo', { code: loyalty.appliedPromoCode })
        : T('admin.checkout.loyaltyLinkedMember', { name: loyalty.memberName });
      activeBadge.classList.remove('hidden');
      clearBtn.classList.remove('hidden');
      if (discountLabel) {
        discountLabel.textContent =
          loyalty.appliedPromoTitle && discount > 0
            ? `${T('checkout.discount')} (${loyalty.appliedPromoCode || loyalty.appliedPromoTitle})`
            : T('checkout.discount');
      }
    } else {
      receiptRow.classList.add('hidden');
      receiptInfo.textContent = '';
      activeBadge.classList.add('hidden');
      clearBtn.classList.add('hidden');
      if (discountLabel) discountLabel.textContent = T('checkout.discount');
    }
  }

  function showLoyaltyStatus(msg, isError = false) {
    const el = document.getElementById('loyalty-status-msg');
    el.textContent = msg;
    el.className = `mt-2 text-xs font-semibold ${isError ? 'text-red-700' : 'text-emerald-800'}`;
    el.classList.remove('hidden');
  }

  function populateLoyaltyMemberBox(data) {
    lookedUpMemberData = data;
    const member = data.member;
    const memberBox = document.getElementById('loyalty-member-box');
    const quickReg = document.getElementById('loyalty-quick-register');
    const select = document.getElementById('loyalty-benefit-select');
    const previousChoice = select.value;

    quickReg.classList.add('hidden');
    memberBox.classList.remove('hidden');

    const candidatesEl = document.getElementById('loyalty-candidates');
    if (candidatesEl) {
      candidatesEl.replaceChildren();
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      if (candidates.length > 1) {
        candidatesEl.classList.remove('hidden');
        candidatesEl.classList.add('flex');
        for (const cand of candidates) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.noBtn = '1';
          const isCurrent = String(cand.memberId) === String(member.memberId);
          btn.className = isCurrent
            ? 'rounded-lg bg-orange-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm'
            : 'rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-orange-400 hover:bg-orange-50';
          btn.textContent = `${cand.fullName} · ${cand.phone}`;
          btn.addEventListener('click', () => {
            document.getElementById('loyalty-phone-input').value = cand.phone;
            lookupLoyaltyMember({ memberId: cand.memberId });
          });
          candidatesEl.append(btn);
        }
      } else {
        candidatesEl.classList.add('hidden');
      }
    }

    const tierLabel = displayTierName(member.tierCode, member.tierName);
    document.getElementById('loyalty-member-name').textContent =
      `${member.fullName} (${member.memberCode}) · ${member.phone}`;
    document.getElementById('loyalty-member-meta').textContent = T(
      'admin.checkout.loyaltyMemberMeta',
      {
        tier: tierLabel,
        points: data.estimatedEarnedPoints || 0,
      }
    );
    document.getElementById('loyalty-member-points').textContent = T('admin.members.pointsCount', {
      n: member.currentPoints,
    });

    select.replaceChildren();
    const optNone = document.createElement('option');
    optNone.value = 'NONE';
    optNone.textContent = T('admin.checkout.loyaltyBenefitNone');
    select.append(optNone);

    if (data.tierBenefit && data.tierBenefit.discountPercent > 0) {
      const optTier = document.createElement('option');
      optTier.value = 'TIER';
      optTier.textContent = T('admin.checkout.loyaltyBenefitTier', {
        tier: tierLabel,
        pct: data.tierBenefit.discountPercent,
        amount: Admin.currency(data.tierBenefit.estimatedDiscount),
      });
      select.append(optTier);
    }

    for (const promo of data.availablePromotions || []) {
      const opt = document.createElement('option');
      opt.value = `PROMO:${promo.promotionId}`;
      opt.disabled = !promo.eligible;
      const costText =
        promo.pointsCost > 0
          ? T('admin.checkout.loyaltyCostPoints', { points: promo.pointsCost })
          : T('admin.checkout.loyaltyCostFree');
      if (promo.eligible) {
        opt.textContent = `[${promo.promoCode}] ${promo.title} (-${Admin.currency(promo.estimatedDiscount)} · ${costText})`;
      } else {
        opt.textContent = `[${promo.promoCode}] ${promo.title} (${formatPromoIneligibleReason(promo)})`;
      }
      select.append(opt);
    }

    const currentLoyalty = selectedBill && selectedBill.loyalty;
    if (currentLoyalty && String(currentLoyalty.memberId) === String(member.memberId)) {
      if (currentLoyalty.benefitType === 'TIER') {
        select.value = 'TIER';
      } else if (currentLoyalty.benefitType === 'PROMO' && currentLoyalty.appliedPromotionId) {
        const val = `PROMO:${currentLoyalty.appliedPromotionId}`;
        if ([...select.options].some((o) => o.value === val)) select.value = val;
      } else {
        select.value = 'NONE';
      }
    } else if (previousChoice && [...select.options].some((o) => o.value === previousChoice)) {
      select.value = previousChoice;
    }
  }

  async function lookupLoyaltyMember({ memberId = '', silentNotFound = false } = {}) {
    const rawQuery = document.getElementById('loyalty-phone-input').value.trim();
    if (!memberId && !rawQuery) {
      if (!silentNotFound) showLoyaltyStatus(T('admin.checkout.loyaltyEnterPhone'), true);
      return;
    }
    const subtotal = (selectedBill && selectedBill.subtotal) || 0;
    try {
      const qs = memberId
        ? `memberId=${encodeURIComponent(memberId)}&subtotal=${encodeURIComponent(subtotal)}`
        : `q=${encodeURIComponent(rawQuery)}&subtotal=${encodeURIComponent(subtotal)}`;
      const res = await Admin.api(`/api/members/lookup?${qs}`);
      if (!res.data || !res.data.found) {
        document.getElementById('loyalty-member-box').classList.add('hidden');
        const candidatesEl = document.getElementById('loyalty-candidates');
        if (candidatesEl) candidatesEl.classList.add('hidden');
        document.getElementById('loyalty-quick-register').classList.remove('hidden');

        const digitsOnly = rawQuery.replace(/[^\d]/g, '');
        const looksLikePhone = /^[\d\s\-+()]+$/.test(rawQuery) && digitsOnly.length >= 6;
        const fallbackName =
          (selectedSession && selectedSession.queueId && selectedSession.queueId.customerName) ||
          (selectedSession && selectedSession.queue && selectedSession.queue.customerName) ||
          (!looksLikePhone ? rawQuery : '');
        const fallbackPhone = looksLikePhone
          ? digitsOnly
          : (selectedSession && selectedSession.queueId && selectedSession.queueId.customerPhone) ||
            (selectedSession && selectedSession.queue && selectedSession.queue.customerPhone) ||
            '';

        const regNameInput = document.getElementById('loyalty-register-name');
        const regPhoneInput = document.getElementById('loyalty-register-phone');
        if (regNameInput && !regNameInput.value && fallbackName) regNameInput.value = fallbackName;
        if (regPhoneInput && fallbackPhone) regPhoneInput.value = fallbackPhone;
        if (!silentNotFound) showLoyaltyStatus(T('admin.checkout.loyaltyPhoneNotFound'), false);
        return;
      }
      document.getElementById('loyalty-status-msg').classList.add('hidden');
      populateLoyaltyMemberBox(res.data);
    } catch (error) {
      if (!silentNotFound)
        showLoyaltyStatus(error.message || T('admin.checkout.loyaltyLookupFailed'), true);
    }
  }

  async function quickRegisterLoyaltyMember() {
    const regPhoneEl = document.getElementById('loyalty-register-phone');
    const searchVal = document.getElementById('loyalty-phone-input').value.trim();
    const searchDigits = searchVal.replace(/[^\d]/g, '');
    const phone =
      (regPhoneEl && regPhoneEl.value.trim()) ||
      (/^\d{9,15}$/.test(searchDigits) ? searchDigits : '');
    const fullName =
      document.getElementById('loyalty-register-name').value.trim() ||
      T('admin.checkout.loyaltyDefaultCustomer');
    if (!phone) {
      showLoyaltyStatus(T('admin.checkout.loyaltyEnterPhone'), true);
      if (regPhoneEl) regPhoneEl.focus();
      return;
    }
    try {
      const created = await Admin.api('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, phone }),
      });
      document.getElementById('loyalty-phone-input').value = created.data.phone;
      showLoyaltyStatus(
        T('admin.checkout.loyaltyQuickRegSuccess', {
          name: created.data.fullName,
          code: created.data.memberCode,
        })
      );
      await lookupLoyaltyMember({ memberId: created.data.memberId });
      await applySelectedLoyaltyBenefit();
    } catch (error) {
      showLoyaltyStatus(error.message || T('admin.checkout.loyaltyQuickRegFailed'), true);
    }
  }

  async function applySelectedLoyaltyBenefit() {
    if (!selectedSessionId || !lookedUpMemberData || !lookedUpMemberData.member) return;
    const rawChoice = document.getElementById('loyalty-benefit-select').value || 'NONE';
    let benefitType = 'NONE';
    let promotionId = null;
    if (rawChoice === 'TIER') {
      benefitType = 'TIER';
    } else if (rawChoice.startsWith('PROMO:')) {
      benefitType = 'PROMO';
      promotionId = rawChoice.slice('PROMO:'.length);
    }

    try {
      await Admin.api('/api/payment/apply-loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          memberId: lookedUpMemberData.member.memberId,
          benefitType,
          promotionId,
        }),
      });
      showLoyaltyStatus(T('admin.checkout.loyaltyBenefitApplied'));
      await loadBill();
      await loadSessions();
    } catch (error) {
      showLoyaltyStatus(error.message || T('admin.checkout.loyaltyBenefitApplyFailed'), true);
    }
  }

  async function clearSelectedLoyaltyBenefit() {
    if (!selectedSessionId) return;
    try {
      await Admin.api(`/api/payment/apply-loyalty/${encodeURIComponent(selectedSessionId)}`, {
        method: 'DELETE',
      });
      showLoyaltyStatus(T('admin.checkout.loyaltyBenefitCleared'));
      await loadBill();
      await loadSessions();
    } catch (error) {
      showLoyaltyStatus(error.message || T('admin.checkout.loyaltyBenefitClearFailed'), true);
    }
  }

  async function confirmQrPayment() {
    if (!selectedQrPayment || !selectedQrPayment._id) {
      Admin.message(T('admin.checkout.noQrPending'), true);
      return;
    }
    const button = document.getElementById('confirm-qr-payment');
    const spinner = document.getElementById('confirm-qr-spinner');
    const paymentError = document.getElementById('payment-error');
    paymentError.classList.add('hidden');
    button.disabled = true;
    spinner.classList.remove('hidden');
    try {
      const payload = await Admin.api(
        `/api/payment/confirm-qr/${encodeURIComponent(selectedQrPayment._id)}`,
        { method: 'POST' }
      );
      const receiptPaid = document.getElementById('receipt-paid');
      receiptPaid.textContent = `${T('admin.checkout.receiptPaid', { amount: Admin.currency(payload.data.amount), change: Admin.currency(0) })}${formatLoyaltySettlementText(payload.loyalty)}`;
      receiptPaid.classList.remove('hidden');
      paymentForm.classList.add('hidden');
      document.getElementById('loyalty-panel').classList.add('hidden');
      document.getElementById('print-receipt').classList.remove('hidden');
      document.getElementById('print-receipt-actions').classList.remove('hidden');
      document.getElementById('print-proforma-actions').classList.add('hidden');
      await loadSessions();
    } catch (error) {
      paymentError.textContent = error.message || T('admin.checkout.confirmQrFailed');
      paymentError.classList.remove('hidden');
      button.disabled = false;
    } finally {
      spinner.classList.add('hidden');
    }
  }

  async function processPayment(event) {
    event.preventDefault();
    if (!selectedSessionId) {
      Admin.message(T('admin.checkout.selectSession'), true);
      return;
    }
    const button = document.getElementById('confirm-payment');
    const spinner = document.getElementById('payment-spinner');
    const paymentError = document.getElementById('payment-error');
    paymentError.classList.add('hidden');
    button.disabled = true;
    spinner.classList.remove('hidden');
    try {
      const payload = await Admin.api('/api/payment/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          method: paymentForm.elements.method.value,
          receivedAmount: Number(document.getElementById('cash-received').value),
        }),
      });
      document.getElementById('receipt-cash').textContent = Admin.currency(
        payload.data.cashReceived
      );
      document.getElementById('receipt-change').textContent = Admin.currency(
        payload.data.changeDue
      );
      document.getElementById('receipt-cash-row').classList.remove('hidden');
      document.getElementById('receipt-change-row').classList.remove('hidden');
      const receiptPaid = document.getElementById('receipt-paid');
      receiptPaid.textContent = `${T('admin.checkout.receiptPaid', { amount: Admin.currency(payload.data.amount), change: Admin.currency(payload.data.changeDue) })}${formatLoyaltySettlementText(payload.loyalty)}`;
      receiptPaid.classList.remove('hidden');
      paymentForm.classList.add('hidden');
      document.getElementById('loyalty-panel').classList.add('hidden');
      document.getElementById('print-receipt').classList.remove('hidden');
      document.getElementById('print-receipt-actions').classList.remove('hidden');
      document.getElementById('print-proforma-actions').classList.add('hidden');
      await loadSessions();
    } catch (error) {
      paymentError.textContent = error.message || T('admin.checkout.processFailed');
      paymentError.classList.remove('hidden');
      button.disabled = false;
    } finally {
      spinner.classList.add('hidden');
    }
  }

  document
    .getElementById('loyalty-search-btn')
    .addEventListener('click', () => lookupLoyaltyMember());
  document.getElementById('loyalty-phone-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      lookupLoyaltyMember();
    }
  });
  document
    .getElementById('loyalty-register-btn')
    .addEventListener('click', quickRegisterLoyaltyMember);
  document
    .getElementById('loyalty-apply-btn')
    .addEventListener('click', applySelectedLoyaltyBenefit);
  document
    .getElementById('loyalty-clear-btn')
    .addEventListener('click', clearSelectedLoyaltyBenefit);
  document.getElementById('cash-received').addEventListener('input', updateCashPreview);
  document.getElementById('checkout-view-switcher').addEventListener('click', (event) => {
    const button = event.target.closest('[data-checkout-view]');
    if (!button) return;
    checkoutView = button.dataset.checkoutView;
    localStorage.setItem('checkoutView', checkoutView);
    loadSessions();
  });
  paymentForm.elements.method.addEventListener('change', setPaymentMethodView);
  paymentForm.addEventListener('submit', processPayment);
  document.getElementById('print-receipt').addEventListener('click', () => printReceipt(80));
  document.getElementById('print-receipt-58').addEventListener('click', () => printReceipt(58));
  document.getElementById('print-receipt-80').addEventListener('click', () => printReceipt(80));
  document.getElementById('print-proforma-58').addEventListener('click', () => printReceipt(58, 'Proforma'));
  document.getElementById('print-proforma-80').addEventListener('click', () => printReceipt(80, 'Proforma'));
  document.getElementById('confirm-qr-payment').addEventListener('click', confirmQrPayment);
  document
    .getElementById('close-payment-modal')
    .addEventListener('click', () => paymentModal.classList.replace('flex', 'hidden'));
  paymentModal.addEventListener('click', (event) => {
    if (event.target === paymentModal) paymentModal.classList.replace('flex', 'hidden');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') paymentModal.classList.replace('flex', 'hidden');
  });
  window.setInterval(updateCountdowns, 1000);
  window.setInterval(loadSessions, 30000);
  const socket = Admin.connectSocket();
  if (socket) {
    socket.on('payment_completed', loadSessions);
    socket.on('table_waiting_for_cleaning', loadSessions);
    socket.on('queue_seated', loadSessions);
    socket.on('table_board_updated', loadSessions);
  }
  window.addEventListener('languageChanged', () => {
    loadSessions();
    if (!paymentModal.classList.contains('hidden') && selectedSessionId) {
      loadBill();
      if (lookedUpMemberData) populateLoyaltyMemberBox(lookedUpMemberData);
      updateCashPreview();
    }
  });
  loadSessions();

  function printReceipt(widthMm = 80, title = 'Receipt') {
    const source = document.querySelector('#payment-modal .receipt-print');
    if (!source) {
      Admin.message(T('admin.checkout.receiptNotFound'), true);
      return;
    }
    const contentWidth = Number(widthMm) <= 58 ? 48 : 74;
    Admin.printThermal(source.outerHTML, {
      title,
      widthMm,
      extraCss: `
        .receipt-print { width: ${contentWidth}mm; }
        .receipt-print * { color: #000 !important; background: transparent !important; box-shadow: none !important; }
        .text-orange-700, .text-slate-600, .text-slate-500, .text-slate-400 { color: #000 !important; }
        .text-xs { font-size: 8pt; }
        .text-sm { font-size: 9pt; }
        .text-lg, .text-xl { font-size: 11pt; font-weight: 700; }
        .font-black, .font-bold, .font-semibold { font-weight: 700; }
        .border-dashed { border-top: 1px dashed #666 !important; }
        .border-t { border-top: 1px solid #666 !important; }
        .my-3 { margin: 2.5mm 0; }
        .my-4 { margin: 3.5mm 0; }
        .mt-1 { margin-top: 1mm; }
        .pt-3 { padding-top: 2mm; }
        .space-y-2 > * + * { margin-top: 1.5mm; }
        ul, ol { padding-left: 0; list-style: none; }
        .flex { display: flex; }
        .justify-between { justify-content: space-between; gap: 2mm; }
      `,
    });
  }
})();
