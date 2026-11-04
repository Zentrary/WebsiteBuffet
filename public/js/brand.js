(() => {
  const CACHE_KEY = 'shopBrand';
  let brandName = '';

  function baseTitle() {
    const raw = document.title || '';
    const sep = raw.lastIndexOf(' | ');
    if (sep > 0) return raw.slice(0, sep).trim();
    return raw.trim();
  }

  function applyTitle() {
    if (!brandName) return;
    const base = baseTitle();
    if (!base) return;
    const next = `${base} | ${brandName}`;
    if (document.title !== next) document.title = next;
  }

  function applyBrand(name) {
    if (!name) return;
    brandName = String(name);
    window.__shopBrandName = brandName;

    document.querySelectorAll('[data-shop-name]').forEach((el) => {
      el.textContent = brandName;
    });

    const sidebarBrand = document.querySelector('[data-sidebar-brand]');
    if (sidebarBrand) sidebarBrand.textContent = brandName;

    applyTitle();
  }

  window.applyBrandName = applyBrand;
  window.getShopBrandName = () => brandName;

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  whenReady(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) applyBrand(cached);
    } catch {}

    requestAnimationFrame(applyTitle);
  });

  window.addEventListener('languageChanged', () => {
    requestAnimationFrame(() => {
      if (!brandName) {
        try {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached) brandName = cached;
        } catch {}
      }
      applyBrand(brandName);
    });
  });

  fetch('/api/settings/public', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const name = payload && payload.data && payload.data.restaurantName;
      if (!name) return;
      try {
        localStorage.setItem(CACHE_KEY, name);
      } catch {}
      applyBrand(name);
    })
    .catch(() => {});

  const STEPPER_BTN_CLASS =
    'flex min-h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';
  const STEPPER_MINUS_SVG =
    '<svg viewBox="0 0 20 20" class="pointer-events-none h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M4.5 10h11"/></svg>';
  const STEPPER_PLUS_SVG =
    '<svg viewBox="0 0 20 20" class="pointer-events-none h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"/></svg>';

  function installStepper(input) {
    if (!input || input.dataset.stepperInstalled === '1') return;
    if (input.type !== 'number') return;
    if (input.hasAttribute('data-no-stepper')) return;

    const parent = input.parentElement;
    if (!parent) return;

    if (parent.querySelector('[data-count-step], [data-stepper-btn], [data-walkin-step], button')) {
      input.dataset.stepperInstalled = '1';
      return;
    }

    input.dataset.stepperInstalled = '1';

    const rawStep = Number(input.step) || 1;
    const increment = rawStep >= 1 ? rawStep : 1;
    const precision = Math.max(0, (String(rawStep).split('.')[1] || '').length);
    const min = input.min !== '' ? Number(input.min) : null;
    const max = input.max !== '' ? Number(input.max) : null;

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-stretch gap-1.5';
    parent.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    input.classList.add('min-w-0', 'flex-1');

    const dec = document.createElement('button');
    dec.type = 'button';
    dec.dataset.noBtn = '1';
    dec.dataset.stepperBtn = 'dec';
    dec.className = STEPPER_BTN_CLASS;
    dec.innerHTML = STEPPER_MINUS_SVG;
    dec.setAttribute('data-i18n-aria-label', 'common.decrease');
    dec.setAttribute('aria-label', (window.t && window.t('common.decrease')) || 'ลดลง');

    const inc = document.createElement('button');
    inc.type = 'button';
    inc.dataset.noBtn = '1';
    inc.dataset.stepperBtn = 'inc';
    inc.className = STEPPER_BTN_CLASS;
    inc.innerHTML = STEPPER_PLUS_SVG;
    inc.setAttribute('data-i18n-aria-label', 'common.increase');
    inc.setAttribute('aria-label', (window.t && window.t('common.increase')) || 'เพิ่มขึ้น');

    wrapper.insertBefore(dec, input);
    wrapper.appendChild(inc);

    function syncDisabled() {
      const raw = input.value;
      if (raw === '') {
        dec.disabled = false;
        inc.disabled = false;
        return;
      }
      const current = Number(raw) || 0;
      dec.disabled = min !== null && current <= min;
      inc.disabled = max !== null && current >= max;
    }

    function adjust(direction) {
      const current = Number(input.value) || 0;
      let next = current + direction * increment;
      if (min !== null && next < min) next = min;
      if (max !== null && next > max) next = max;
      if (precision > 0) next = Number(next.toFixed(precision));
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      syncDisabled();
    }

    dec.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      adjust(-1);
    });
    inc.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      adjust(1);
    });
    input.addEventListener('input', syncDisabled);
    input.addEventListener('change', syncDisabled);

    syncDisabled();
  }

  function installAllSteppers(root = document) {
    if (root.matches && root.matches('input[type="number"]')) installStepper(root);
    if (root.querySelectorAll) {
      root.querySelectorAll('input[type="number"]').forEach(installStepper);
    }
  }

  whenReady(() => installAllSteppers());

  new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) installAllSteppers(node);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
