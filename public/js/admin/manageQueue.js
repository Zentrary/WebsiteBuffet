(() => {
  const Admin = window.Admin;
  if (!Admin) return;
  const T = (key, vars) => (window.t ? window.t(key, vars) : key);
  const loading = document.getElementById('queue-loading');
  const callButton = document.getElementById('call-next');
  const createEntryQrButton = document.getElementById('create-entry-qr');
  const printEntryQrButton = document.getElementById('print-entry-qr');
  const printEntryQr58Button = document.getElementById('print-entry-qr-58');
  const hideEntryQrButton = document.getElementById('hide-entry-qr');
  const ticketModal = document.getElementById('ticket-modal');
  const ticketPreview = document.getElementById('ticket-preview');
  const ticketPrintContent = document.getElementById('ticket-print-content');
  const ticketPrintButton = document.getElementById('ticket-modal-print');
  const ticketPrint58Button = document.getElementById('ticket-modal-print-58');
  let queues = [];
  let currentTicketData = null;

  function escapeHtml(v) {
    return String(v ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  }

  function elapsed(createdAt) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
    const hours = Math.floor(minutes / 60);
    return hours
      ? `${hours} ${T('common.hours')} ${minutes % 60} ${T('common.minutes')}`
      : `${minutes} ${T('common.minutes')}`;
  }

  function remaining(endTime) {
    const seconds = Math.max(0, Math.ceil((new Date(endTime).getTime() - Date.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function isOverdue(endTime) {
    if (!endTime) return false;
    return new Date(endTime).getTime() < Date.now();
  }

  function seatedFor(seatedAt) {
    if (!seatedAt) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(seatedAt).getTime()) / 60000));
    return T('queue.manage.seatedFor', { minutes });
  }

  function queueSitsOverdue(queue) {
    return Boolean(
      queue && queue.status === 'seated' && isOverdue(queue.sessionId && queue.sessionId.endTime)
    );
  }

  function sessionTimerLabel(endTime) {
    if (!endTime) return '—';
    return isOverdue(endTime) ? T('queue.manage.overdue') : remaining(endTime);
  }

  function renderQueues() {
    const groups = {
      waiting: document.getElementById('queue-waiting'),
      called: document.getElementById('queue-called'),
      seated: document.getElementById('queue-seated'),
    };
    Object.values(groups).forEach((c) => c.replaceChildren());
    const activeQueues = queues
      .filter((queue) => Object.hasOwn(groups, queue.status))
      .sort((a, b) => {
        if (a.status === 'seated' && b.status === 'seated') {
          const aEnd =
            a.sessionId && a.sessionId.endTime
              ? new Date(a.sessionId.endTime).getTime()
              : Number.MAX_SAFE_INTEGER;
          const bEnd =
            b.sessionId && b.sessionId.endTime
              ? new Date(b.sessionId.endTime).getTime()
              : Number.MAX_SAFE_INTEGER;
          if (aEnd !== bEnd) return aEnd - bEnd;
        }
        return new Date(a.createdAt) - new Date(b.createdAt);
      });

    for (const queue of activeQueues) {
      const card = document.createElement('article');
      card.className =
        'rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 transition hover:border-slate-300';
      const tableNumber = queue.tableId && queue.tableId.tableNumber;
      const preferredTable = queue.preferredTableId && queue.preferredTableId.tableNumber;
      const preferredZone = queue.preferredZone ? T(`table.zone.${queue.preferredZone}`) : '';
      const preferenceValue = preferredTable
        ? `${preferredZone ? `${preferredZone} · ` : ''}${preferredTable}`
        : preferredZone;
      const isBuffet = queue.diningStyle === 'buffet';
      const pkgCode = String(queue.buffetPackageCode || 'SIGNATURE').toUpperCase();
      const pkgText = isBuffet
        ? pkgCode === 'DELUXE'
          ? 'Deluxe Buffet'
          : pkgCode === 'PREMIUM'
            ? 'Premium Buffet'
            : 'Signature Buffet'
        : T('dining.alacarteShort');
      const diningBadgesHtml = `
        <div class="mt-1.5 flex flex-wrap items-center gap-1">
          <span class="rounded-md px-2 py-0.5 text-[11px] font-medium ${isBuffet ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-200/80' : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}">${escapeHtml(pkgText)}</span>
          ${queue.hasRefillDrink ? `<span class="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/80">${escapeHtml(T('dining.refillShort'))}</span>` : ''}
        </div>`;

      const rowItem = (label, valueHtml) => `
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="shrink-0 font-normal text-slate-500">${escapeHtml(label)}</span>
          <span class="min-w-0 text-right">${valueHtml}</span>
        </div>`;

      const metaRows = [
        rowItem(
          T('queue.customer'),
          `<span class="font-medium text-slate-800">${escapeHtml(queue.customerName || T('queue.customer'))}</span> <span class="font-normal text-slate-500">· ${Number(queue.customerCount) || 0} ${escapeHtml(T('common.people'))}</span>`
        ),
      ];
      if (queue.customerPhone) {
        metaRows.push(
          rowItem(
            T('queue.phone'),
            `<span class="font-normal tabular-nums text-slate-700">${escapeHtml(queue.customerPhone)}</span>`
          )
        );
      }
      if (tableNumber) {
        metaRows.push(
          rowItem(
            T('queue.table'),
            `<span class="inline-block rounded-md bg-orange-50 px-2 py-0.5 font-medium text-orange-800 ring-1 ring-orange-200/80">${escapeHtml(T('queue.table'))} ${escapeHtml(tableNumber)}</span>`
          )
        );
      } else if (preferenceValue) {
        metaRows.push(
          rowItem(
            T('queue.preferredZone'),
            `<span class="font-normal text-slate-700">${escapeHtml(preferenceValue)}</span>`
          )
        );
      }
      if (queue.status === 'seated') {
        metaRows.push(
          rowItem(
            T('admin.tables.status'),
            `<span class="font-normal text-slate-600" data-seated="${escapeHtml(queue.seatedAt || queue.createdAt || '')}">${escapeHtml(seatedFor(queue.seatedAt || queue.createdAt))}</span>`
          )
        );
      }

      const timerBadgeHtml =
        queue.status === 'seated'
          ? `<span class="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums ${queueSitsOverdue(queue) ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-white text-emerald-700'}" data-endtime="${escapeHtml((queue.sessionId && queue.sessionId.endTime) || '')}">${sessionTimerLabel(queue.sessionId && queue.sessionId.endTime)}</span>`
          : `<span class="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-slate-600" data-waiting="${escapeHtml(queue.createdAt)}">${elapsed(queue.createdAt)}</span>`;

      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-2xl font-bold leading-none tracking-tight text-orange-700">${escapeHtml(queue.queueNumber)}</p>
            ${diningBadgesHtml}
          </div>
          ${timerBadgeHtml}
        </div>
        <div class="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-white px-3 py-1 text-xs">
          ${metaRows.join('')}
        </div>
        ${queue.assignmentNote ? `<p class="mt-2 rounded-lg border border-amber-200/80 bg-amber-50/70 px-2.5 py-1.5 text-xs font-normal text-amber-800">${escapeHtml(queue.assignmentNote)}</p>` : ''}
        ${queue.status === 'called' ? `<p class="mt-2 rounded-lg border border-sky-200/80 bg-sky-50 px-2.5 py-1.5 text-xs font-normal text-sky-800">${escapeHtml(T('queue.awaitingConfirm'))}</p>` : ''}
        ${queueSitsOverdue(queue) ? `<p class="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">${escapeHtml(T('queue.manage.overdueHint'))}</p>` : ''}
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button type="button" data-no-btn data-ticket="${escapeHtml(queue._id)}" class="inline-flex h-9 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100">${escapeHtml(T('queue.ticket.print'))}</button>
          ${
            queue.status === 'seated'
              ? `<button type="button" data-no-btn data-complete="${escapeHtml(queue._id)}" data-complete-number="${escapeHtml(queue.queueNumber)}" class="inline-flex h-9 w-full items-center justify-center rounded-lg bg-slate-800 px-2.5 text-xs font-medium text-white transition hover:bg-slate-900">${escapeHtml(T('queue.manage.complete'))}</button>`
              : `<button type="button" data-no-btn data-cancel="${escapeHtml(queue._id)}" class="inline-flex h-9 w-full items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 transition hover:bg-red-100">${escapeHtml(T('queue.cancelButton'))}</button>`
          }
        </div>`;
      const cancelButton = card.querySelector('[data-cancel]');
      if (cancelButton)
        cancelButton.addEventListener('click', () => cancelQueue(queue._id, cancelButton));
      const completeButton = card.querySelector('[data-complete]');
      if (completeButton)
        completeButton.addEventListener('click', () => completeQueue(queue, completeButton));
      const ticketButton = card.querySelector('[data-ticket]');
      if (ticketButton)
        ticketButton.addEventListener('click', () => openTicket(queue._id, ticketButton));
      groups[queue.status].append(card);
    }
    for (const status of Object.keys(groups)) {
      const count = queues.filter((q) => q.status === status).length;
      document.getElementById(`${status}-count`).textContent = String(count);
      document.getElementById(`empty-${status}`).classList.toggle('hidden', count > 0);
    }
  }

  async function loadQueues() {
    try {
      const payload = await Admin.api('/api/queue');
      queues = Array.isArray(payload.data) ? payload.data : [];
      renderQueues();
    } catch (error) {
      Admin.message(error.message || 'Failed to load queues', true);
    } finally {
      loading.classList.add('hidden');
    }
  }

  function renderTicketHtml(data) {
    const created = new Date(data.calledAt || data.createdAt || Date.now());
    const locale = localStorage.getItem('lang') === 'en' ? 'en-US' : 'th-TH';
    const dt = created.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
    const tableLine = data.tableNumber
      ? `<tr><td class="text-left">${T('queue.table')}</td><td class="text-right">${escapeHtml(data.tableNumber)}</td></tr>`
      : '';
    const diningText =
      data.diningStyle === 'buffet'
        ? `${data.buffetPackageName || data.buffetPackageCode || 'Buffet'}${data.hasRefillDrink ? ` + ${T('dining.refillShort')}` : ''}`
        : data.diningStyle
          ? `${T('dining.alacarteShort')}${data.hasRefillDrink ? ` + ${T('dining.refillShort')}` : ''}`
          : '';
    const diningLine = diningText
      ? `<tr><td class="text-left">${escapeHtml(T('dining.sectionTitle'))}</td><td class="text-right" style="font-weight:700;">${escapeHtml(diningText)}</td></tr>`
      : '';
    const phoneAddress = [data.phone, data.address].filter(Boolean).join(' · ');
    const recoveryCode = data._id || '';
    const recoveryLabel = T('queue.recoveryCodeLabel');
    return `
      <div style="padding: 2mm 0; text-align: center;">
        <img src="${escapeHtml(data.logoUrl)}" alt="" onerror="this.style.display='none'" style="width:18mm;height:18mm;object-fit:contain;margin:0 auto;">
        <div style="font-size:13pt;font-weight:800;margin-top:1.5mm;">${escapeHtml(data.restaurantName || 'Restaurant')}</div>
        ${phoneAddress ? `<div style="font-size:8pt;color:#444;margin-top:0.5mm;">${escapeHtml(phoneAddress)}</div>` : ''}
      </div>
      <div style="border-top:1px dashed #999;margin:2mm 0;"></div>
      <div style="font-size:9pt;color:#333;text-align:center;">${dt}</div>
      <div style="border-top:1px dashed #999;margin:2mm 0;"></div>
      <div style="font-size:10pt;color:#666;text-align:center;">${T('queue.number')}</div>
      <div style="font-size:38pt;font-weight:800;letter-spacing:2px;line-height:1.05;margin:1mm 0;text-align:center;">${escapeHtml(data.queueNumber)}</div>
      <div style="border-top:1px dashed #999;margin:2mm 0;"></div>
      <table style="width:100%;font-size:10pt;">
        <tr><td class="text-left">${T('queue.partySize')}</td><td class="text-right" style="font-weight:700;">${Number(data.customerCount) || 0} ${escapeHtml(T('common.people'))}</td></tr>
        ${diningLine}
        ${tableLine}
      </table>
      <div style="border-top:1px dashed #999;margin:2mm 0;"></div>
      <div style="text-align:left;font-size:8pt;color:#666;">${escapeHtml(recoveryLabel)}</div>
      <div style="text-align:center;font-size:9pt;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.4px;margin-top:0.5mm;word-break:break-all;">${escapeHtml(recoveryCode)}</div>
      <div style="border-top:1px dashed #999;margin:2mm 0;"></div>
      <div style="text-align:center;">
        <img src="${escapeHtml(data.qrCodeData)}" alt="QR" style="width:42mm;height:42mm;margin:0 auto;display:block;">
      </div>
      <div style="font-size:9pt;margin-top:1mm;text-align:center;">${T('queue.staffQrDescription').split('.')[0]}</div>
      <div style="border-top:1px dashed #999;margin:2mm 0;"></div>
      <div style="font-size:8pt;color:#555;line-height:1.5;text-align:center;">
        * ${T('queue.ticket.hint')}
      </div>`;
  }

  async function openTicket(queueId, button) {
    if (button) button.disabled = true;
    try {
      const payload = await Admin.api(`/api/queue/${encodeURIComponent(queueId)}/ticket`);
      currentTicketData = payload.data;
      const html = renderTicketHtml(currentTicketData);
      ticketPreview.innerHTML = html;
      ticketPrintContent.innerHTML = html;
      ticketModal.classList.replace('hidden', 'flex');
    } catch (error) {
      Admin.message(error.message || 'Failed to load ticket', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function closeTicket() {
    ticketModal.classList.replace('flex', 'hidden');
    currentTicketData = null;
  }

  function printTicket(widthMm = 80) {
    if (!currentTicketData) return;
    Admin.printThermal(renderTicketHtml(currentTicketData), {
      title: `Queue Ticket ${currentTicketData.queueNumber || ''}`.trim(),
      widthMm,
    });
  }

  async function callNextQueue() {
    callButton.disabled = true;
    try {
      const payload = await Admin.api('/api/queue/call', { method: 'POST' });
      const note = payload.data.assignmentNote ? ` (${payload.data.assignmentNote})` : '';
      Admin.message(
        T('queue.callResult', {
          queue: payload.data.queue.queueNumber,
          table: payload.data.table.tableNumber,
        }) + note
      );
      await loadQueues();
      openTicket(payload.data.queue._id);
    } catch (error) {
      Admin.message(error.message || 'Failed to call next queue', true);
    } finally {
      callButton.disabled = false;
    }
  }

  async function completeQueue(queue, button) {
    const confirmed = await Admin.confirm(
      T('queue.manage.completeConfirm', { queue: queue.queueNumber }),
      { okText: T('queue.manage.complete'), cancelText: T('common.cancel') }
    );
    if (!confirmed) return;
    if (button) button.disabled = true;
    try {
      await Admin.api(`/api/queue/${encodeURIComponent(queue._id)}/complete`, { method: 'POST' });
      Admin.message(T('queue.manage.completeDone', { queue: queue.queueNumber }));
      await loadQueues();
    } catch (error) {
      Admin.message(error.message || T('queue.manage.completeFailed'), true);
      if (button) button.disabled = false;
    }
  }

  async function cancelQueue(queueId, button) {
    const ok = await Admin.confirm(T('queue.cancelModalDesc'), {
      title: T('queue.cancelModalTitle'),
      okText: T('queue.cancelConfirm'),
      cancelText: T('queue.cancelGoback'),
      danger: true,
    });
    if (!ok) return;
    button.disabled = true;
    try {
      await Admin.api(`/api/queue/cancel/${encodeURIComponent(queueId)}`, { method: 'POST' });
      Admin.message(T('queue.status.cancelled'));
      await loadQueues();
    } catch (error) {
      Admin.message(error.message || 'Failed to cancel queue', true);
      button.disabled = false;
    }
  }

  async function createEntryQr() {
    createEntryQrButton.disabled = true;
    createEntryQrButton.textContent = T('queue.staffQrCreating');
    try {
      const payload = await Admin.api('/api/queue/entry-qr');
      const image = document.getElementById('queue-entry-qr');
      image.src = payload.data.qrCodeData;
      image.classList.remove('hidden');
      document.getElementById('queue-entry-url').textContent = payload.data.queueUrl;
      printEntryQrButton.classList.remove('hidden');
      if (printEntryQr58Button) printEntryQr58Button.classList.remove('hidden');
      hideEntryQrButton.classList.remove('hidden');
      Admin.message(T('queue.staffQrReady'));
    } catch (error) {
      Admin.message(error.message || 'Failed to create QR', true);
    } finally {
      createEntryQrButton.disabled = false;
      createEntryQrButton.textContent = T('queue.staffQrCreate');
    }
  }

  callButton.addEventListener('click', callNextQueue);
  createEntryQrButton.addEventListener('click', createEntryQr);
  function printEntryQr(widthMm) {
    const qrImg = document.getElementById('queue-entry-qr');
    const urlText = document.getElementById('queue-entry-url')?.textContent || '';
    if (qrImg && qrImg.src) {
      const size = Number(widthMm) <= 58 ? '42mm' : '52mm';
      Admin.printThermal(
        `<div style="padding:3mm 0;text-align:center;">
          <div style="font-size:13pt;font-weight:800;">${escapeHtml(T('queue.staffQrTitle'))}</div>
          <div style="font-size:9pt;color:#444;margin-top:1mm;">${escapeHtml(T('queue.staffQrDescription'))}</div>
          <img src="${escapeHtml(qrImg.src)}" alt="Queue Entry QR" style="width:${size};height:${size};margin:3mm auto;display:block;">
          <div style="font-size:7.5pt;color:#555;word-break:break-all;">${escapeHtml(urlText)}</div>
        </div>`,
        { title: 'Queue Entry QR', widthMm }
      );
    }
  }
  printEntryQrButton.addEventListener('click', () => printEntryQr(80));
  if (printEntryQr58Button) printEntryQr58Button.addEventListener('click', () => printEntryQr(58));
  hideEntryQrButton.addEventListener('click', () => {
    document.getElementById('queue-entry-qr').classList.add('hidden');
    document.getElementById('queue-entry-qr').removeAttribute('src');
    document.getElementById('queue-entry-url').textContent = '';
    printEntryQrButton.classList.add('hidden');
    if (printEntryQr58Button) printEntryQr58Button.classList.add('hidden');
    hideEntryQrButton.classList.add('hidden');
    Admin.message(T('queue.staffQrHidden'));
  });

  document.getElementById('ticket-modal-close').addEventListener('click', closeTicket);
  document.getElementById('ticket-modal-cancel').addEventListener('click', closeTicket);
  ticketPrintButton.addEventListener('click', () => printTicket(80));
  if (ticketPrint58Button) ticketPrint58Button.addEventListener('click', () => printTicket(58));
  ticketModal.addEventListener('click', (event) => {
    if (event.target === ticketModal) closeTicket();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ticketModal.classList.contains('hidden')) closeTicket();
  });

  const socket = Admin.connectSocket();
  if (socket) {
    socket.on('connect', loadQueues);
    socket.on('new_queue', loadQueues);
    socket.on('queue_called', loadQueues);
    socket.on('queue_seated', loadQueues);
    socket.on('queue_board_updated', loadQueues);
  }
  window.setInterval(() => {
    document.querySelectorAll('[data-waiting]').forEach((el) => {
      el.textContent = elapsed(el.dataset.waiting);
    });
    document.querySelectorAll('[data-seated]').forEach((el) => {
      el.textContent = seatedFor(el.dataset.seated);
    });
    document.querySelectorAll('[data-endtime]').forEach((el) => {
      if (!el.dataset.endtime) return;
      el.textContent = sessionTimerLabel(el.dataset.endtime);
      const overdue = isOverdue(el.dataset.endtime);
      el.classList.toggle('border-red-200', overdue);
      el.classList.toggle('bg-red-50', overdue);
      el.classList.toggle('text-red-700', overdue);
      el.classList.toggle('border-emerald-200', !overdue);
      el.classList.toggle('bg-white', !overdue);
      el.classList.toggle('text-emerald-700', !overdue);
    });
    loadQueues();
  }, 30000);

  window.addEventListener('languageChanged', () => {
    renderQueues();
    callButton.textContent = T('queue.manage.callNext');
    createEntryQrButton.textContent = T('queue.staffQrCreate');
    printEntryQrButton.textContent = T('queue.staffQrPrint');
    hideEntryQrButton.textContent = T('queue.staffQrHide');
  });

  loadQueues();
})();
