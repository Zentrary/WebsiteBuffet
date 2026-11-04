(() => {
  const T = (key, vars) => (window.t ? window.t(key, vars) : key);
  const LEGACY_STORAGE_KEY = 'customerMemberPhone';

  const tabRegister = document.getElementById('tab-btn-register');
  const tabCheck = document.getElementById('tab-btn-check');
  const registerForm = document.getElementById('member-register-form');
  const checkForm = document.getElementById('member-check-form');
  const alertEl = document.getElementById('member-alert');
  const cardSection = document.getElementById('member-card-section');
  const clearBtn = document.getElementById('card-clear-btn');

  let activeTab = 'register';
  let currentCardPayload = null;

  function clearLegacyStoredPhone() {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]
    );
  }

  function localizePrefix(prefix) {
    const map = {
      'นาย': T('common.prefixMr'),
      'นาง': T('common.prefixMrs'),
      'นางสาว': T('common.prefixMiss'),
    };
    return map[prefix] || prefix || '';
  }

  function formatDisplayMemberName(member) {
    const pfx = localizePrefix(member.prefix);
    const base = pfx ? `${pfx} ${member.fullName}`.trim() : member.fullName;
    return member.nickname ? `${base} (${member.nickname})` : base;
  }

  function displayTierName(tierCode, tierName) {
    if (tierCode === 'MEMBER' || tierName === 'สมาชิกทั่วไป') {
      return T('admin.members.tierNameMember');
    }
    return tierName || tierCode || T('admin.members.tierNameMember');
  }

  function showAlert(msg, type = 'info') {
    if (!msg) {
      alertEl.classList.add('hidden');
      alertEl.textContent = '';
      return;
    }
    const styles = {
      success: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
      error: 'border border-red-200 bg-red-50 text-red-800',
      info: 'border border-amber-200 bg-amber-50 text-amber-900',
    };
    alertEl.className = `mb-4 rounded-xl p-3.5 text-sm font-semibold ${styles[type] || styles.info}`;
    alertEl.textContent = msg;
  }

  function switchTab(tab) {
    activeTab = tab === 'check' ? 'check' : 'register';
    const isReg = activeTab === 'register';
    tabRegister.setAttribute('aria-selected', String(isReg));
    tabCheck.setAttribute('aria-selected', String(!isReg));
    tabRegister.className = isReg
      ? 'rounded-lg bg-orange-600 px-3 py-2.5 text-sm font-bold text-white shadow-sm transition'
      : 'rounded-lg px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-white/70';
    tabCheck.className = !isReg
      ? 'rounded-lg bg-orange-600 px-3 py-2.5 text-sm font-bold text-white shadow-sm transition'
      : 'rounded-lg px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-white/70';

    registerForm.classList.toggle('hidden', !isReg);
    checkForm.classList.toggle('hidden', isReg);
    showAlert('');
  }

  function renderMemberCard(payload) {
    currentCardPayload = payload;
    if (!payload || !payload.found || !payload.member) {
      cardSection.classList.add('hidden');
      return;
    }

    const { member, nextTier, promotions = [] } = payload;
    const tierLabel = displayTierName(member.tierCode, member.tierName);
    const metaParts = [member.memberCode, member.phone];
    if (member.age) {
      metaParts.push(T('common.ageYearsShort', { age: member.age }));
    }

    document.getElementById('card-member-name').textContent = formatDisplayMemberName(member);
    document.getElementById('card-member-code').textContent = metaParts.join(' • ');
    document.getElementById('card-tier-badge').textContent = tierLabel;
    document.getElementById('card-current-points').textContent = new Intl.NumberFormat().format(
      member.currentPoints || 0
    );
    document.getElementById('card-tier-perk').textContent =
      member.discountPercent > 0
        ? T('member.perkDiscount', { pct: member.discountPercent })
        : T('member.perkStandard');
    document.getElementById('card-points-mult').textContent =
      `x${Number(member.pointsMultiplier || 1).toFixed(1)}`;

    const nextWrap = document.getElementById('card-next-tier-wrap');
    const nextLabel = document.getElementById('card-next-tier-label');
    const nextProgress = document.getElementById('card-next-tier-progress');
    const nextBar = document.getElementById('card-next-tier-bar');

    if (nextTier) {
      nextWrap.classList.remove('hidden');
      nextLabel.textContent = T('member.nextTierNeeded', {
        points: nextTier.pointsNeeded,
        tier: displayTierName(nextTier.tierCode, nextTier.tierName),
      });
      nextProgress.textContent = `${member.lifetimePoints || 0} / ${nextTier.minPoints}`;
      const pct =
        nextTier.minPoints > 0
          ? Math.min(100, Math.round(((member.lifetimePoints || 0) / nextTier.minPoints) * 100))
          : 100;
      nextBar.style.width = `${pct}%`;
    } else {
      nextWrap.classList.remove('hidden');
      nextLabel.textContent = T('member.maxTierReached');
      nextProgress.textContent = '100%';
      nextBar.style.width = '100%';
    }

    const promosSection = document.getElementById('card-promos-section');
    const promosList = document.getElementById('card-promos-list');
    promosList.replaceChildren();

    if (promotions.length === 0) {
      promosSection.classList.add('hidden');
    } else {
      promosSection.classList.remove('hidden');
      for (const promo of promotions) {
        const canRedeem = (member.currentPoints || 0) >= (promo.pointsCost || 0);
        const costText =
          promo.pointsCost > 0
            ? T('admin.checkout.loyaltyCostPoints', { points: promo.pointsCost })
            : T('admin.checkout.loyaltyCostFree');
        const minSpendText =
          promo.minSpend > 0
            ? T('member.promoMinSpend', { amount: `฿${Number(promo.minSpend).toLocaleString()}` })
            : '';
        const item = document.createElement('div');
        item.className = `rounded-xl border p-3 text-xs ${
          canRedeem ? 'border-orange-200 bg-white' : 'border-slate-200 bg-white/60 opacity-75'
        }`;
        item.innerHTML = `
          <div class="flex items-center justify-between gap-2">
            <span class="rounded-md bg-orange-100 px-2 py-0.5 font-mono font-black text-orange-800">${escapeHTML(promo.promoCode)}</span>
            <span class="font-bold ${canRedeem ? 'text-emerald-700' : 'text-slate-500'}">${escapeHTML(costText)}</span>
          </div>
          <p class="mt-1.5 font-bold text-slate-900">${escapeHTML(promo.title)}</p>
          ${minSpendText ? `<p class="mt-0.5 text-[11px] text-slate-500">${escapeHTML(minSpendText)}</p>` : ''}
        `;
        promosList.append(item);
      }
    }

    cardSection.classList.remove('hidden');
  }

  async function checkByPhone(rawPhone) {
    const phone = String(rawPhone || '').trim();
    if (!phone) return;
    const submitBtn = document.getElementById('check-submit-btn');
    submitBtn.disabled = true;
    try {
      const response = await fetch(`/api/members/public/check?phone=${encodeURIComponent(phone)}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(
          (payload.code && T(`error.${payload.code}`)) ||
            payload.message ||
            T('error.REQUEST_FAILED')
        );
      }
      if (!payload.data || !payload.data.found) {
        renderMemberCard(null);
        showAlert(T('member.notFoundSwitchRegister'), 'info');
        document.getElementById('reg-phone').value = phone;
        return;
      }
      showAlert('', 'info');
      renderMemberCard(payload.data);
    } catch (error) {
      showAlert(error.message || T('error.REQUEST_FAILED'), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  }

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = document.getElementById('reg-submit-btn');
    const prefix = document.getElementById('reg-prefix').value.trim();
    const fullName = document.getElementById('reg-fullname').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const ageRaw = document.getElementById('reg-age').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    submitBtn.disabled = true;
    showAlert('');

    try {
      const response = await fetch('/api/members/public/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix,
          fullName,
          nickname,
          age: ageRaw ? Number.parseInt(ageRaw, 10) : null,
          phone,
          email,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(
          (payload.code && T(`error.${payload.code}`)) ||
            payload.message ||
            T('error.REQUEST_FAILED')
        );
      }
      showAlert(
        payload.data.isNewMember
          ? T('member.registerSuccessNew')
          : T('member.registerAlreadyExists'),
        'success'
      );
      renderMemberCard(payload.data);
      cardSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      showAlert(error.message || T('error.REQUEST_FAILED'), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  checkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    checkByPhone(document.getElementById('check-phone').value);
  });

  tabRegister.addEventListener('click', () => switchTab('register'));
  tabCheck.addEventListener('click', () => switchTab('check'));

  function resetPageClean() {
    clearLegacyStoredPhone();
    currentCardPayload = null;
    cardSection.classList.add('hidden');
    registerForm.reset();
    checkForm.reset();
    document.getElementById('check-phone').value = '';
    showAlert('');
    switchTab('register');
  }

  clearBtn.addEventListener('click', resetPageClean);

  window.addEventListener('pageshow', (event) => {
    clearLegacyStoredPhone();
    if (event.persisted) {
      resetPageClean();
    }
  });

  window.addEventListener('languageChanged', () => {
    if (currentCardPayload) renderMemberCard(currentCardPayload);
  });

  resetPageClean();
})();
