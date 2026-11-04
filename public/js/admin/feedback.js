(() => {
  const Admin = window.Admin;
  if (!Admin) return;
  const T = (key, vars) => (window.t ? window.t(key, vars) : key);

  let allFeedbacks = [];
  let activeFilter = 'all';
  let searchQuery = '';

  const loadingEl = document.getElementById('feedback-loading');
  const emptyEl = document.getElementById('feedback-empty');
  const listEl = document.getElementById('feedback-list');
  const searchInput = document.getElementById('feedback-search');
  const filterTabs = document.getElementById('feedback-filter-tabs');
  const showingCountEl = document.getElementById('feedback-showing-count');

  function currentLocale() {
    return localStorage.getItem('lang') === 'en' ? 'en-US' : 'th-TH';
  }

  function renderStars(rating) {
    const r = Math.min(5, Math.max(1, Math.round(Number(rating) || 0)));
    let html = '';
    for (let i = 1; i <= 5; i += 1) {
      const filled = i <= r;
      html += `<svg viewBox="0 0 24 24" class="h-4 w-4 ${filled ? (r <= 3 ? 'fill-red-500 text-red-500' : 'fill-amber-400 text-amber-400') : 'fill-slate-200 text-slate-200'}" aria-hidden="true"><path d="m12 3 2.8 5.68 6.27.91-4.54 4.42 1.07 6.24L12 17.3l-5.6 2.95 1.07-6.24L2.93 9.59l6.27-.91L12 3Z"/></svg>`;
    }
    return html;
  }

  function renderSummary() {
    const total = allFeedbacks.length;
    const sum = allFeedbacks.reduce((acc, f) => acc + (Number(f.rating) || 0), 0);
    const avg = total > 0 ? (sum / total).toFixed(1) : '0.0';
    const lowCount = allFeedbacks.filter((f) => Number(f.rating) <= 3).length;
    const highCount = allFeedbacks.filter((f) => Number(f.rating) >= 4).length;
    const highRate = total > 0 ? `${Math.round((highCount / total) * 100)}%` : '0%';

    document.getElementById('kpi-avg-rating').textContent = avg;
    document.getElementById('kpi-total-count').textContent = String(total);
    document.getElementById('kpi-low-count').textContent = String(lowCount);
    document.getElementById('kpi-high-rate').textContent = highRate;

    const barsContainer = document.getElementById('rating-bars');
    if (!barsContainer) return;
    barsContainer.replaceChildren();
    for (let star = 5; star >= 1; star -= 1) {
      const count = allFeedbacks.filter((f) => Math.round(Number(f.rating) || 0) === star).length;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      const barColor = star <= 2 ? 'bg-red-500' : star === 3 ? 'bg-amber-500' : 'bg-emerald-500';
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2.5';
      row.innerHTML = `
        <span class="w-9 shrink-0 font-bold text-slate-700 tabular-nums">${star} ★</span>
        <div class="h-2.5 flex-1 overflow-hidden rounded-md bg-slate-100">
          <div class="h-full rounded-md ${barColor}" style="width: ${pct}%"></div>
        </div>
        <span class="w-16 shrink-0 text-right font-semibold text-slate-500 tabular-nums">${count} (${pct}%)</span>`;
      barsContainer.append(row);
    }
  }

  function syncFilterButtons() {
    if (!filterTabs) return;
    filterTabs.querySelectorAll('[data-filter]').forEach((btn) => {
      const selected = btn.dataset.filter === activeFilter;
      if (selected) {
        const px = ['1', '2', '3', '4', '5'].includes(btn.dataset.filter) ? 'px-3' : 'px-3.5';
        btn.className = `rounded-lg bg-orange-600 ${px} py-2 text-xs font-bold text-white shadow-sm transition`;
      } else {
        const px = ['1', '2', '3', '4', '5'].includes(btn.dataset.filter) ? 'px-3' : 'px-3.5';
        btn.className = `rounded-lg border border-slate-200 bg-slate-50 ${px} py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100`;
      }
    });
  }

  function getFilteredList() {
    const q = searchQuery.trim().toLocaleLowerCase();
    return allFeedbacks.filter((item) => {
      const rating = Math.round(Number(item.rating) || 0);
      const comment = String(item.comment || '').trim();
      if (activeFilter === 'commented' && !comment) return false;
      if (['1', '2', '3', '4', '5'].includes(activeFilter) && rating !== Number(activeFilter))
        return false;

      if (!q) return true;
      const tableNum = (item.tableId && item.tableId.tableNumber) || '';
      const queueNum =
        (item.sessionId && item.sessionId.queueId && item.sessionId.queueId.queueNumber) || '';
      const pkg = (item.sessionId && item.sessionId.buffetPackageName) || '';
      const haystack = `${comment} ${tableNum} ${queueNum} ${pkg}`.toLocaleLowerCase();
      return haystack.includes(q);
    });
  }

  function renderList() {
    syncFilterButtons();
    const visible = getFilteredList();
    listEl.replaceChildren();
    emptyEl.classList.toggle('hidden', visible.length > 0);
    if (showingCountEl) {
      showingCountEl.textContent = T('admin.feedbackPage.filterShowing', {
        n: visible.length,
        total: allFeedbacks.length,
      });
    }

    for (const item of visible) {
      const rating = Math.round(Number(item.rating) || 0);
      const isLow = rating <= 3;
      const comment = String(item.comment || '').trim();
      const tableNum = (item.tableId && item.tableId.tableNumber) || '—';
      const session = item.sessionId && typeof item.sessionId === 'object' ? item.sessionId : null;
      const queueNum = (session && session.queueId && session.queueId.queueNumber) || '';
      const count =
        (session &&
          (session.customerCount || (session.queueId && session.queueId.customerCount))) ||
        null;
      const diningTag = session
        ? session.diningStyle === 'buffet'
          ? `${session.buffetPackageName || session.buffetPackageCode || 'Buffet'}${session.hasRefillDrink ? ` + ${T('dining.refillShort')}` : ''}`
          : T('dining.alacarteShort')
        : '';
      const grandTotal =
        session && Number(session.grandTotal) > 0 ? Admin.currency(session.grandTotal) : '';
      const createdStr = item.createdAt
        ? new Date(item.createdAt).toLocaleString(currentLocale())
        : '—';

      const card = document.createElement('article');
      card.className = isLow
        ? 'flex flex-col justify-between rounded-2xl border-2 border-red-200 bg-white p-5 shadow-sm'
        : 'flex flex-col justify-between rounded-2xl border border-slate-100 bg-white p-5 shadow-sm';

      card.innerHTML = `
        <div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-0.5">${renderStars(rating)}</div>
              <span class="rounded-md px-2 py-0.5 text-xs font-semibold ${isLow ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}">${rating}.0 / 5</span>
              ${isLow ? `<span class="rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white">${Admin.escapeHTML(T('admin.feedbackPage.needsAttention'))}</span>` : ''}
            </div>
            <time class="text-xs font-normal text-slate-400">${Admin.escapeHTML(createdStr)}</time>
          </div>

          <div class="mt-3 rounded-xl ${comment ? (isLow ? 'bg-red-50/70 text-slate-800' : 'bg-slate-50 text-slate-700') : 'bg-slate-50/60 text-slate-400 italic'} p-3.5 text-sm font-normal leading-relaxed">
            ${comment ? Admin.escapeHTML(comment) : Admin.escapeHTML(T('admin.feedbackPage.noComment'))}
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs font-normal text-slate-600">
          <span class="rounded-md bg-slate-100 px-2.5 py-1 font-medium text-slate-800">${Admin.escapeHTML(T('queue.table'))} ${Admin.escapeHTML(tableNum)}</span>
          ${queueNum ? `<span class="rounded-md bg-slate-100 px-2.5 py-1">${Admin.escapeHTML(queueNum)}</span>` : ''}
          ${count ? `<span class="rounded-md bg-slate-100 px-2.5 py-1">${Number(count)} ${Admin.escapeHTML(T('common.people'))}</span>` : ''}
          ${diningTag ? `<span class="rounded-md bg-orange-50 px-2.5 py-1 font-medium text-orange-800 ring-1 ring-orange-200/70">${Admin.escapeHTML(diningTag)}</span>` : ''}
          ${grandTotal ? `<span class="ml-auto font-semibold text-slate-900 tabular-nums">${Admin.escapeHTML(grandTotal)}</span>` : ''}
        </div>`;
      listEl.append(card);
    }
  }

  async function loadFeedbacks() {
    loadingEl.classList.remove('hidden');
    try {
      const res = await Admin.api('/api/feedback');
      allFeedbacks = Array.isArray(res.data) ? res.data : [];
      renderSummary();
      renderList();
    } catch (error) {
      Admin.message(error.message || T('error.REQUEST_FAILED'), true);
    } finally {
      loadingEl.classList.add('hidden');
    }
  }

  if (filterTabs) {
    filterTabs.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-filter]');
      if (!btn) return;
      activeFilter = btn.dataset.filter;
      renderList();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value || '';
      renderList();
    });
  }

  const refreshBtn = document.getElementById('refresh-feedback-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadFeedbacks);

  const socket = Admin.connectSocket();
  if (socket) {
    socket.on('new_feedback', loadFeedbacks);
  }

  window.addEventListener('languageChanged', () => {
    renderSummary();
    renderList();
  });

  loadFeedbacks();
})();
