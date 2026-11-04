(() => {
  const Admin = window.Admin;
  if (!Admin) return;
  const T = (key, vars) => (window.t ? window.t(key, vars) : key);
  if (!Admin.isAdmin) {
    window.location.replace('/admin/dashboard.html');
    return;
  }
  const form = document.getElementById('staff-form');
  const modal = document.getElementById('staff-modal');
  let staff = [];

  function roleLabel(role) {
    return T(`staff.role.${role}Short`) || T(`staff.role.${role}`) || role;
  }

  function localizePrefix(prefix) {
    const map = {
      'นาย': T('common.prefixMr'),
      'นาง': T('common.prefixMrs'),
      'นางสาว': T('common.prefixMiss'),
    };
    return map[prefix] || prefix || '';
  }

  function formatStaffDisplayName(person) {
    const pfx = localizePrefix(person.prefix);
    const composedName =
      [person.firstName, person.lastName].filter(Boolean).join(' ').trim() ||
      person.fullName ||
      '—';
    const withPrefix = pfx && composedName !== '—' ? `${pfx} ${composedName}`.trim() : composedName;
    return person.nickname ? `${withPrefix} (${person.nickname})` : withPrefix;
  }

  function splitLegacyFullName(person) {
    if (person.firstName || person.lastName) {
      return {
        firstName: person.firstName || '',
        lastName: person.lastName || '',
      };
    }
    const raw = String(person.fullName || '').trim();
    if (!raw) return { firstName: '', lastName: '' };
    const idx = raw.indexOf(' ');
    if (idx < 0) return { firstName: raw, lastName: '' };
    return {
      firstName: raw.slice(0, idx).trim(),
      lastName: raw.slice(idx + 1).trim(),
    };
  }

  async function loadStaff() {
    document.getElementById('staff-loading').classList.remove('hidden');
    try {
      const payload = await Admin.api('/api/auth/staff');
      staff = Array.isArray(payload.data) ? payload.data : [];
      renderStaff();
    } catch (error) {
      Admin.message(error.message || T('admin.staff.saveFailed'), true);
    } finally {
      document.getElementById('staff-loading').classList.add('hidden');
    }
  }

  function renderStaff() {
    const rows = document.getElementById('staff-rows');
    rows.replaceChildren();
    document.getElementById('staff-empty').classList.toggle('hidden', staff.length > 0);
    staff.forEach((person) => {
      const ageText = person.age ? T('common.ageYearsShort', { age: person.age }) : '—';
      const row = document.createElement('tr');
      row.className = 'hover:bg-slate-50/80';
      row.innerHTML = `
        <td class="p-4 font-mono text-sm font-medium text-slate-800">${Admin.escapeHTML(person.username)}</td>
        <td class="p-4">
          <p class="font-medium text-slate-900">${Admin.escapeHTML(formatStaffDisplayName(person))}</p>
          ${person.phone ? `<p class="mt-0.5 text-xs font-normal text-slate-500">${Admin.escapeHTML(person.phone)}</p>` : ''}
        </td>
        <td class="p-4 text-slate-600">${Admin.escapeHTML(ageText)}</td>
        <td class="p-4 font-normal text-slate-700">${Admin.escapeHTML(roleLabel(person.role))}</td>
        <td class="p-4">
          <span class="inline-block rounded-md px-2.5 py-1 text-xs font-medium ${person.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}">
            ${Admin.escapeHTML(person.isActive ? T('admin.statusActive') : T('admin.statusInactive'))}
          </span>
        </td>
        <td class="p-4">
          <div class="flex justify-end gap-2">
            <button type="button" data-no-btn data-edit="${Admin.escapeHTML(person._id)}" class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100">${Admin.escapeHTML(T('admin.edit'))}</button>
            <button type="button" data-no-btn data-delete="${Admin.escapeHTML(person._id)}" class="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100">${Admin.escapeHTML(T('admin.delete'))}</button>
          </div>
        </td>`;
      row.querySelector('[data-edit]').addEventListener('click', () => openEditor(person));
      row.querySelector('[data-delete]').addEventListener('click', () => deleteStaff(person));
      rows.append(row);
    });
  }

  let editingPerson = null;

  function updateStaffModalTitle() {
    const titleEl = document.getElementById('staff-modal-title');
    if (!titleEl) return;
    titleEl.textContent = editingPerson ? T('admin.staff.edit') : T('admin.staff.add');
  }

  function openEditor(person = null) {
    form.reset();
    editingPerson = person || null;
    form.elements.staffId.value = person ? person._id : '';
    form.elements.username.value = person ? person.username : '';
    form.elements.username.readOnly = Boolean(person);
    form.elements.password.required = !person;
    form.elements.password.value = '';

    if (person) {
      const split = splitLegacyFullName(person);
      form.elements.prefix.value = person.prefix || '';
      form.elements.firstName.value = split.firstName;
      form.elements.lastName.value = split.lastName;
      form.elements.nickname.value = person.nickname || '';
      form.elements.age.value = person.age ?? '';
      form.elements.phone.value = person.phone || '';
      form.elements.role.value = person.role || 'waiter';
      form.elements.isActive.checked = Boolean(person.isActive);
    } else {
      form.elements.prefix.value = '';
      form.elements.role.value = 'waiter';
      form.elements.isActive.checked = true;
    }

    const statusWrap = document.getElementById('staff-status-wrap');
    statusWrap.classList.toggle('hidden', !person);
    statusWrap.classList.toggle('flex', Boolean(person));

    updateStaffModalTitle();
    document.getElementById('password-hint').textContent = person
      ? T('admin.staff.passwordOptional')
      : T('admin.staff.passwordMin');
    modal.classList.replace('hidden', 'flex');
  }

  async function saveStaff(event) {
    event.preventDefault();
    const staffId = form.elements.staffId.value.trim();
    const firstName = form.elements.firstName.value.trim();
    const lastName = form.elements.lastName.value.trim();
    const ageVal = form.elements.age.value.trim();
    const passwordVal = form.elements.password.value;

    const payload = {
      prefix: form.elements.prefix.value.trim(),
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' ').trim(),
      nickname: form.elements.nickname.value.trim(),
      age: ageVal === '' ? null : Number.parseInt(ageVal, 10),
      phone: form.elements.phone.value.trim(),
      username: form.elements.username.value.trim(),
      role: form.elements.role.value,
    };

    if (!staffId || passwordVal) {
      payload.password = passwordVal;
    }
    if (staffId) {
      payload.isActive = form.elements.isActive.checked;
    }

    try {
      await Admin.api(
        staffId ? `/api/auth/staff/${encodeURIComponent(staffId)}` : '/api/auth/register',
        {
          method: staffId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      modal.classList.replace('flex', 'hidden');
      Admin.message(staffId ? T('admin.staff.editSuccess') : T('admin.staff.addSuccess'));
      await loadStaff();
    } catch (error) {
      Admin.message(error.message || T('admin.staff.saveFailed'), true);
    }
  }

  async function deleteStaff(person) {
    const ok = await Admin.confirm(
      T('admin.staff.confirmDeleteMsg', { username: person.username }),
      {
        title: T('admin.staff.confirmDeleteTitle'),
        okText: T('admin.staff.confirmDeleteOk'),
        cancelText: T('admin.staff.confirmDeleteCancel'),
        danger: true,
      }
    );
    if (!ok) return;
    try {
      await Admin.api(`/api/auth/staff/${encodeURIComponent(person._id)}`, { method: 'DELETE' });
      Admin.message(T('admin.staff.deleteSuccess'));
      await loadStaff();
    } catch (error) {
      Admin.message(error.message || T('admin.staff.deleteFailed'), true);
    }
  }

  document.getElementById('add-staff-button').addEventListener('click', () => openEditor(null));
  form.addEventListener('submit', saveStaff);
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => modal.classList.replace('flex', 'hidden'));
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.classList.replace('flex', 'hidden');
  });

  window.addEventListener('languageChanged', () => {
    renderStaff();
    document.getElementById('add-staff-button').textContent = T('admin.staff.add');
    updateStaffModalTitle();
    const passwordHint = document.getElementById('password-hint');
    if (passwordHint) {
      passwordHint.textContent = editingPerson
        ? T('admin.staff.passwordOptional')
        : T('admin.staff.passwordMin');
    }
  });

  loadStaff();
})();
