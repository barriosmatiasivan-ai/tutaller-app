// Super Admin Client Controller (Tu Taller Soft)

let allWorkshops = [];

function toast(message, isError = false) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.className = isError ? 'show error' : 'show';
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => {
    el.className = '';
  }, 4500);
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(d);
  } catch {
    return isoStr;
  }
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getToken() {
  return localStorage.getItem('tutaller_admin_token') || '';
}

function setToken(token) {
  localStorage.setItem('tutaller_admin_token', token);
}

function clearToken() {
  localStorage.removeItem('tutaller_admin_token');
}

function showLoginView(errorMsg = '') {
  document.querySelector('#dashboard-view').style.display = 'none';
  const loginView = document.querySelector('#login-view');
  loginView.style.display = 'flex';
  const errEl = document.querySelector('#login-error');
  if (errorMsg) {
    errEl.textContent = errorMsg;
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }
}

function showDashboardView(admin = {}) {
  document.querySelector('#login-view').style.display = 'none';
  document.querySelector('#dashboard-view').style.display = 'block';
  const badge = document.querySelector('#admin-user-badge');
  if (badge) {
    badge.textContent = `👤 ${admin.name || admin.email || 'Matías Barrios'}`;
  }
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    showLoginView('Sesión expirada o no autorizada. Por favor iniciá sesión nuevamente.');
    throw new Error('No autorizado');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Error en la solicitud');
  }
  return data;
}

async function loadData() {
  try {
    const [metricsData, workshopsData, storageData] = await Promise.all([
      api('/api/admin/metrics'),
      api('/api/admin/workshops'),
      api('/api/admin/maintenance/storage').catch(() => null)
    ]);

    // Actualizar KPIs
    document.querySelector('#kpi-active').textContent = metricsData.active_workshops;
    document.querySelector('#kpi-total-desc').textContent = `${metricsData.total_workshops} talleres registrados en total`;
    document.querySelector('#kpi-expiring').textContent = metricsData.expiring_soon;
    document.querySelector('#kpi-suspended').textContent = metricsData.suspended_or_expired;
    document.querySelector('#kpi-orders').textContent = metricsData.orders_this_week;
    document.querySelector('#kpi-churn').textContent = metricsData.churn_risk_workshops;

    // Actualizar Métricas de Almacenamiento
    if (storageData) {
      document.querySelector('#storage-pending-orders').textContent = storageData.pending_purge_orders || 0;
      document.querySelector('#storage-purged-photos').textContent = storageData.total_photos_purged || 0;
      const mbFreed = ((storageData.total_bytes_freed || 0) / (1024 * 1024)).toFixed(2);
      document.querySelector('#storage-freed-mb').textContent = `${mbFreed} MB`;
      if (storageData.last_run && storageData.last_run.executed_at) {
        document.querySelector('#storage-last-run').textContent = formatDate(storageData.last_run.executed_at);
      } else {
        document.querySelector('#storage-last-run').textContent = 'Pendiente de ciclo';
      }
    }

    allWorkshops = workshopsData.workshops || [];
    renderWorkshops();
  } catch (err) {
    toast(err.message, true);
    document.querySelector('#workshops-tbody').innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: #ef4444; padding: 30px;">
          Error al cargar datos: ${esc(err.message)}
        </td>
      </tr>
    `;
  }
}

function renderWorkshops() {
  const query = document.querySelector('#search-input').value.trim().toLowerCase();
  const filterPlan = document.querySelector('#filter-plan').value;
  const filterStatus = document.querySelector('#filter-status').value;

  const filtered = allWorkshops.filter(w => {
    // Búsqueda
    if (query) {
      const match = (w.name && w.name.toLowerCase().includes(query)) ||
                    (w.slug && w.slug.toLowerCase().includes(query)) ||
                    (w.owner_email && w.owner_email.toLowerCase().includes(query)) ||
                    (w.phone && w.phone.includes(query));
      if (!match) return false;
    }
    // Filtro de Plan
    if (filterPlan && w.plan !== filterPlan) return false;

    // Filtro de Estado / Vigencia
    if (filterStatus) {
      if (filterStatus === 'active' && (w.status !== 'active' || w.is_expired)) return false;
      if (filterStatus === 'lifetime' && !(w.plan === 'lifetime' || w.is_lifetime)) return false;
      if (filterStatus === 'expiring' && (w.status !== 'active' || w.is_lifetime || w.days_remaining > 7 || w.days_remaining <= 0)) return false;
      if (filterStatus === 'suspended' && (w.status === 'active' && !w.is_expired)) return false;
      if (filterStatus === 'churn_risk' && w.activity_status !== 'churn_risk') return false;
    }
    return true;
  });

  const tbody = document.querySelector('#workshops-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No hay talleres que coincidan con la búsqueda o filtros.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(w => {
    // Badge de estado
    let statusBadge = '';
    const isLifetime = w.plan === 'lifetime' || w.is_lifetime;
    if (w.status === 'suspended') {
      statusBadge = '<span class="badge suspended">⏸️ Suspendido</span>';
    } else if (w.is_expired) {
      statusBadge = '<span class="badge suspended">⌛ Vencido</span>';
    } else if (!isLifetime && w.days_remaining <= 7) {
      statusBadge = `<span class="badge expiring">⏳ Vence en ${w.days_remaining}d</span>`;
    } else {
      statusBadge = '<span class="badge active">✓ Activo</span>';
    }

    // Badge de plan (Solo Básico vs Pro)
    const planBadge = w.plan === 'pro'
      ? '<span class="badge pro">⭐ Plan Pro</span>' 
      : '<span class="badge basic">🥉 Plan Básico</span>';

    // Actividad semanal
    let activityHtml = '';
    if (w.activity_status === 'churn_risk') {
      activityHtml = `<span class="activity-badge churn_risk" title="Caída de actividad: tuvo ${w.orders_last_week} órdenes la semana anterior y ${w.orders_this_week} esta semana">🚨 Alerta Abandono (${w.orders_this_week}/sem)</span>`;
    } else if (w.activity_status === 'healthy') {
      activityHtml = `<span class="activity-badge healthy">🟢 ${w.orders_this_week} órdenes/sem</span>`;
    } else {
      activityHtml = `<span class="activity-badge moderate">⚪ ${w.orders_this_week} órdenes/sem</span>`;
    }

    // Bandera de país
    const countryFlags = {
      AR: '🇦🇷 AR', MX: '🇲🇽 MX', CO: '🇨🇴 CO', CL: '🇨🇱 CL',
      PE: '🇵🇪 PE', UY: '🇺🇾 UY', ES: '🇪🇸 ES', US: '🌐 Global'
    };
    const cBadge = `<span class="brand-badge" style="font-size:10px;padding:2px 6px;">${countryFlags[w.country] || '🇦🇷 AR'}</span>`;

    // WhatsApp Directo y Bienvenida
    let waButton = '';
    let welcomeButton = '';
    if (w.phone) {
      const cleanPhone = w.phone.replace(/[^0-9]/g, '');
      const waText = isLifetime
        ? `Hola ${w.name}! Te escribo del equipo de soporte de Tu Taller Soft para ver cómo viene funcionando el sistema en tu taller.`
        : w.days_remaining <= 7
          ? `Hola ${w.name}! Te escribo de Tu Taller Soft para avisarte que tu suscripción vence en ${w.days_remaining} días. ¿Querés renovar para continuar sin interrupciones?`
          : `Hola ${w.name}! Te escribo del equipo de soporte de Tu Taller Soft para ver cómo viene funcionando el sistema en tu taller.`;
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`;
      waButton = `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="secondary" title="Enviar WhatsApp al dueño" style="text-decoration:none;display:inline-flex;align-items:center;padding:5px 8px;font-size:13px;">💬</a>`;

      const planLabel = isLifetime ? 'Pro Vitalicio 👑' : w.plan === 'pro' ? 'Pro ⭐' : 'Básico';
      const welcomeText = `¡Hola ${w.name}! Te damos la bienvenida a Tu Taller Soft 🚀. Tu taller ya está habilitado con Plan ${planLabel}. Podés ingresar desde tu celular o PC en: https://app.tutallersoft.com/t/${w.slug} ¡Guardalo en la pantalla de inicio como una app!`;
      const welcomeUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(welcomeText)}`;
      welcomeButton = `<a href="${welcomeUrl}" target="_blank" rel="noopener noreferrer" class="secondary" title="Enviar Bienvenida con enlace por WhatsApp" style="text-decoration:none;display:inline-flex;align-items:center;padding:5px 8px;background:rgba(37, 211, 102, 0.15);color:#25d366;border-color:rgba(37, 211, 102, 0.3);font-size:13px;">📲</a>`;
    }

    const openLink = `<a href="/t/${w.slug}" target="_blank" class="secondary" title="Abrir Taller del Técnico" style="text-decoration:none;display:inline-flex;align-items:center;padding:5px 8px;font-size:13px;">🔗</a>`;

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="workshop-name">${esc(w.name)}</span>
            ${cBadge}
          </div>
          <div class="slug-badge">app.tutallersoft.com/t/${esc(w.slug)}</div>
        </td>
        <td>
          <div><strong>${esc(w.owner_email)}</strong></div>
          <div style="font-size:12px;color:var(--text-muted);">${esc(w.phone || 'Sin teléfono')}</div>
        </td>
        <td style="white-space:nowrap;">${planBadge}</td>
        <td style="white-space:nowrap;">${statusBadge}</td>
        <td>
          ${isLifetime
            ? '<div style="font-weight:700;color:#ffffff;white-space:nowrap;">Permanente</div><div style="font-size:11px;color:#10b981;font-weight:600;white-space:nowrap;">✓ Vitalicio</div>'
            : `<div style="white-space:nowrap;">${formatDate(w.expires_at)}</div>
               <div style="font-size:11px;color:${w.days_remaining <= 7 ? 'var(--warning)' : 'var(--text-muted)'};white-space:nowrap;">
                 ${w.is_expired ? 'Vencido' : `${w.days_remaining} días restantes`}
               </div>`
          }
        </td>
        <td>
          ${activityHtml}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;white-space:nowrap;">Total: ${w.total_orders || 0} órdenes · ${w.client_count || 0} clientes</div>
        </td>
        <td>
          <div class="actions-cell">
            <div style="display:flex;gap:5px;align-items:center;">
              ${openLink}
              ${welcomeButton}
              ${waButton}
            </div>
            <div style="display:flex;gap:5px;align-items:center;">
              <button class="secondary" onclick="openRenewModal('${w.id}', '${esc(w.name)}')" title="Renovar suscripción" style="padding:4px 7px;font-size:12px;white-space:nowrap;">📅 Renovar</button>
              <button class="secondary" onclick="openPlanModal('${w.id}', '${esc(w.name)}', '${w.plan}')" title="Cambiar nivel de plan" style="padding:4px 7px;font-size:12px;white-space:nowrap;">🏷️ Plan</button>
              <button class="secondary" onclick="toggleStatus('${w.id}', '${w.status}')" title="${w.status === 'active' ? 'Suspender taller' : 'Reactivar taller'}" style="padding:4px 7px;font-size:12px;">${w.status === 'active' ? '⏸️' : '▶️'}</button>
              <button class="secondary" onclick="deleteWorkshop('${w.id}', '${esc(w.name)}')" title="Eliminar taller" style="color:#ef4444;padding:4px 7px;font-size:12px;">🗑️</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Acciones operativas
window.toggleStatus = async function(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  const label = newStatus === 'active' ? 'reactivar' : 'suspender';
  if (!confirm(`¿Estás seguro de que querés ${label} este taller?`)) return;

  try {
    await api(`/api/admin/workshops/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: newStatus })
    });
    toast(`Taller ${newStatus === 'active' ? 'reactivado' : 'suspendido'} con éxito.`);
    await loadData();
  } catch (err) {
    toast(err.message, true);
  }
};

window.openPlanModal = function(id, name, currentPlan) {
  document.querySelector('#plan-target-id').value = id;
  const currentLabel = currentPlan === 'pro' ? '⭐ Plan Pro' : '🥉 Plan Básico';
  document.querySelector('#plan-target-name').textContent = `${name} · Nivel actual: ${currentLabel}`;
  document.querySelector('#plan-select').value = currentPlan === 'pro' ? 'pro' : 'basic';
  document.querySelector('#plan-modal').showModal();
};

window.togglePlan = function(id, currentPlan) {
  window.openPlanModal(id, '', currentPlan);
};

window.openRenewModal = function(id, name) {
  document.querySelector('#renew-id').value = id;
  document.querySelector('#renew-target-name').textContent = `Renovando a: ${name}`;
  document.querySelector('#renew-modal').showModal();
};

window.deleteWorkshop = async function(id, name) {
  if (!confirm(`⚠️ ATENCIÓN: ¿Seguro que querés eliminar el taller "${name}" y todos sus datos? Esta acción es irreversible.`)) return;

  try {
    await api(`/api/admin/workshops/${id}`, { method: 'DELETE' });
    toast('Taller eliminado.');
    await loadData();
  } catch (err) {
    toast(err.message, true);
  }
};

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  async function initAuth() {
    const token = getToken();
    if (!token) {
      showLoginView();
      return;
    }

    try {
      const res = await api('/api/admin/auth/me');
      showDashboardView(res.admin || {});
      await loadData();
    } catch {
      showLoginView();
    }
  }

  initAuth();

  // Búsqueda y Filtros
  document.querySelector('#search-input').addEventListener('input', renderWorkshops);
  document.querySelector('#filter-plan').addEventListener('change', renderWorkshops);
  document.querySelector('#filter-status').addEventListener('change', renderWorkshops);
  document.querySelector('#refresh-btn').addEventListener('click', loadData);

  // Modal Crear
  const createModal = document.querySelector('#create-modal');
  document.querySelector('#open-create-modal').addEventListener('click', () => {
    document.querySelector('#create-form').reset();
    createModal.showModal();
  });
  document.querySelector('#close-create-modal').addEventListener('click', () => createModal.close());
  document.querySelector('#cancel-create-btn').addEventListener('click', () => createModal.close());

  // Auto-seleccionar vigencia permanente si eligen Plan Vitalicio
  document.querySelector('#new-plan')?.addEventListener('change', e => {
    const durationSelect = document.querySelector('#new-duration');
    if (!durationSelect) return;
    if (e.target.value === 'lifetime') {
      durationSelect.value = '36500';
    } else if (durationSelect.value === '36500') {
      durationSelect.value = '30';
    }
  });

  // Slug automático al tipear nombre
  document.querySelector('#new-name').addEventListener('input', e => {
    const slugInput = document.querySelector('#new-slug');
    if (!slugInput.dataset.touched) {
      slugInput.value = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 25);
    }
  });
  document.querySelector('#new-slug').addEventListener('input', () => {
    document.querySelector('#new-slug').dataset.touched = '1';
  });

  // Submit Crear Taller
  document.querySelector('#create-form').addEventListener('submit', async e => {
    e.preventDefault();
    const submitBtn = e.submitter;
    submitBtn.disabled = true;

    try {
      const payload = {
        name: document.querySelector('#new-name').value.trim(),
        slug: document.querySelector('#new-slug').value.trim(),
        owner_email: document.querySelector('#new-email').value.trim(),
        phone: document.querySelector('#new-phone').value.trim(),
        country: document.querySelector('#new-country').value,
        plan: document.querySelector('#new-plan').value,
        duration_days: document.querySelector('#new-duration').value,
        notes: document.querySelector('#new-notes').value.trim()
      };

      await api('/api/admin/workshops', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      toast(`¡Taller "${payload.name}" habilitado con éxito!`);
      createModal.close();
      await loadData();
    } catch (err) {
      toast(err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Modal Renovar
  const renewModal = document.querySelector('#renew-modal');
  document.querySelector('#close-renew-modal').addEventListener('click', () => renewModal.close());
  document.querySelector('#cancel-renew-btn').addEventListener('click', () => renewModal.close());

  document.querySelector('#renew-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.querySelector('#renew-id').value;
    const days = document.querySelector('#renew-days').value;

    try {
      await api(`/api/admin/workshops/${id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ days })
      });
      toast('¡Suscripción renovada exitosamente!');
      renewModal.close();
      await loadData();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Modal Cambiar Plan (Nivel de software: basic vs pro)
  const planModal = document.querySelector('#plan-modal');
  if (planModal) {
    document.querySelector('#close-plan-modal')?.addEventListener('click', () => planModal.close());
    document.querySelector('#cancel-plan-btn')?.addEventListener('click', () => planModal.close());

    document.querySelector('#plan-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const submitBtn = e.submitter;
      if (submitBtn) submitBtn.disabled = true;

      const id = document.querySelector('#plan-target-id').value;
      const plan = document.querySelector('#plan-select').value;
      const planNames = { pro: '⭐ Plan Pro', basic: '🥉 Plan Básico' };

      try {
        await api(`/api/admin/workshops/${id}/plan`, {
          method: 'POST',
          body: JSON.stringify({ plan })
        });
        toast(`¡Plan actualizado a ${planNames[plan] || plan} con éxito!`);
        planModal.close();
        await loadData();
      } catch (err) {
        toast(err.message, true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Botón Ejecutar Purga Manual de Fotos (+6 meses)
  const purgeBtn = document.querySelector('#trigger-purge-btn');
  if (purgeBtn) {
    purgeBtn.addEventListener('click', async () => {
      const ok = confirm(
        '¿Deseas ejecutar la purga de fotos de recepción para todas las órdenes marcadas como "Entregadas" hace más de 6 meses?\n\n' +
        '• Se liberará espacio en el bucket R2.\n' +
        '• El historial técnico, datos del cliente, fallas, repuestos y montos permanecerán intactos.\n' +
        '• Esta acción no se puede deshacer.'
      );
      if (!ok) return;

      purgeBtn.disabled = true;
      purgeBtn.innerHTML = '<span>⏳</span> Procesando purga...';

      try {
        const res = await api('/api/admin/maintenance/purge-photos', {
          method: 'POST'
        });

        const mb = ((res.bytes_freed || 0) / (1024 * 1024)).toFixed(2);
        toast(`Purga completada: ${res.orders_processed} órdenes revisadas, ${res.photos_deleted} fotos eliminadas (${mb} MB liberados).`);
        await loadData();
      } catch (err) {
        toast(`Error al ejecutar purga: ${err.message}`, true);
      } finally {
        purgeBtn.disabled = false;
        purgeBtn.innerHTML = '<span>⚡</span> Ejecutar Purga Manual Ahora';
      }
    });
  }

  // Toggle visibilidad de contraseña
  const togglePwdBtn = document.querySelector('#toggle-pwd-btn');
  const pwdInput = document.querySelector('#login-password');
  if (togglePwdBtn && pwdInput) {
    togglePwdBtn.addEventListener('click', () => {
      const isPwd = pwdInput.type === 'password';
      pwdInput.type = isPwd ? 'text' : 'password';
      togglePwdBtn.textContent = isPwd ? '🙈' : '👁️';
    });
  }

  // Manejo de Inicio de Sesión
  const loginForm = document.querySelector('#login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const submitBtn = document.querySelector('#login-submit-btn');
      const errEl = document.querySelector('#login-error');
      errEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verificando... ⏳';

      const email = document.querySelector('#login-email').value.trim();
      const password = document.querySelector('#login-password').value.trim();

      try {
        const res = await fetch('/api/admin/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Credenciales inválidas.');

        setToken(data.token);
        showDashboardView(data.admin || { email });
        toast(`¡Bienvenido ${data.admin?.name || 'Administrador'}!`);
        await loadData();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Iniciar Sesión 🔐';
      }
    });
  }

  // Cerrar Sesión
  const logoutBtn = document.querySelector('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await api('/api/admin/auth/logout', { method: 'POST' }).catch(() => {});
      } finally {
        clearToken();
        showLoginView();
        toast('Sesión cerrada.');
      }
    });
  }

  // Modal Cambiar Contraseña
  const changePwdModal = document.querySelector('#change-pwd-modal');
  const openChangePwdBtn = document.querySelector('#open-change-pwd-btn');
  const closeChangePwdBtn = document.querySelector('#close-change-pwd-modal');
  const cancelChangePwdBtn = document.querySelector('#cancel-change-pwd-btn');
  const changePwdForm = document.querySelector('#change-pwd-form');

  if (openChangePwdBtn && changePwdModal) {
    openChangePwdBtn.addEventListener('click', () => changePwdModal.showModal());
    closeChangePwdBtn.addEventListener('click', () => changePwdModal.close());
    cancelChangePwdBtn.addEventListener('click', () => changePwdModal.close());

    changePwdForm.addEventListener('submit', async e => {
      e.preventDefault();
      const current_password = document.querySelector('#pwd-current').value;
      const new_password = document.querySelector('#pwd-new').value;

      try {
        await api('/api/admin/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ current_password, new_password })
        });
        toast('¡Contraseña maestra actualizada con éxito!');
        changePwdModal.close();
        changePwdForm.reset();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ==========================================
  // Bot Central de WhatsApp (Super-Admin)
  // ==========================================
  const WA_DEFAULT_URL = 'https://tutaller-app-production.up.railway.app';
  function getAdminWaUrl() {
    return localStorage.getItem('tutaller_superadmin_wa_url') || WA_DEFAULT_URL;
  }
  function setAdminWaUrl(url) {
    localStorage.setItem('tutaller_superadmin_wa_url', url);
  }

  const waStatusBadge = document.querySelector('#wa-admin-status-badge');
  const waPhoneEl = document.querySelector('#wa-admin-phone');
  const waServerEl = document.querySelector('#wa-admin-server-display');
  const waUrlInput = document.querySelector('#wa-admin-url-input');
  const btnOpenWaQr = document.querySelector('#btn-admin-open-wa-qr');
  const btnTestWa = document.querySelector('#btn-admin-test-wa');
  const btnSaveWaUrl = document.querySelector('#btn-admin-save-wa-url');
  const btnDisconnectWa = document.querySelector('#btn-admin-disconnect-wa');
  const btnModalDisconnect = document.querySelector('#btn-admin-modal-disconnect');

  const waQrModal = document.querySelector('#admin-wa-qr-dialog');
  const closeWaQrBtn = document.querySelector('#close-admin-wa-qr-btn');
  const waQrLoading = document.querySelector('#admin-wa-qr-loading');
  const waQrContainer = document.querySelector('#admin-wa-qr-container');
  const waQrConnected = document.querySelector('#admin-wa-qr-connected');
  const waQrImg = document.querySelector('#admin-wa-qr-img');
  const waPhoneVal = document.querySelector('#admin-wa-phone-val');

  let waAdminPollInterval = null;

  async function checkAdminWaStatus() {
    const url = getAdminWaUrl();
    if (waUrlInput) waUrlInput.value = url;
    if (waServerEl) waServerEl.textContent = url.replace(/^https?:\/\//, '');

    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/api/status`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.state === 'connected') {
        if (waStatusBadge) {
          waStatusBadge.textContent = '🟢 Conectado';
          waStatusBadge.style.color = '#10b981';
        }
        if (waPhoneEl) waPhoneEl.textContent = data.phone ? `+${data.phone}` : 'Línea activa';
        if (btnOpenWaQr) btnOpenWaQr.innerHTML = '<span>🟢</span> Ver Conexión';
      } else if (data.state === 'qr_ready') {
        if (waStatusBadge) {
          waStatusBadge.textContent = '🟡 Esperando escaneo';
          waStatusBadge.style.color = '#f59e0b';
        }
        if (waPhoneEl) waPhoneEl.textContent = 'Pendiente de vincular';
        if (btnOpenWaQr) btnOpenWaQr.innerHTML = '<span>📲</span> Escanear QR';
      } else {
        if (waStatusBadge) {
          waStatusBadge.textContent = '⚪ Desconectado';
          waStatusBadge.style.color = '#94a3b8';
        }
        if (waPhoneEl) waPhoneEl.textContent = '-';
        if (btnOpenWaQr) btnOpenWaQr.innerHTML = '<span>📲</span> Vincular QR';
      }
    } catch (err) {
      if (waStatusBadge) {
        waStatusBadge.textContent = '🔴 Inaccesible';
        waStatusBadge.style.color = '#ef4444';
      }
      if (waPhoneEl) waPhoneEl.textContent = 'Servidor sin respuesta';
    }
  }

  async function openAdminWaQrModal() {
    if (!waQrModal) return;
    const url = getAdminWaUrl();

    if (waQrLoading) waQrLoading.style.display = 'block';
    if (waQrContainer) waQrContainer.style.display = 'none';
    if (waQrConnected) waQrConnected.style.display = 'none';

    waQrModal.showModal();

    if (waAdminPollInterval) clearInterval(waAdminPollInterval);

    const fetchQr = async () => {
      try {
        const data = await api('/api/admin/bot/qr');

        if (data.connected) {
          if (waQrLoading) waQrLoading.style.display = 'none';
          if (waQrContainer) waQrContainer.style.display = 'none';
          if (waQrConnected) waQrConnected.style.display = 'block';
          if (waPhoneVal) waPhoneVal.textContent = data.phone ? `+${data.phone}` : 'Línea conectada';
          clearInterval(waAdminPollInterval);
          checkAdminWaStatus();
          return;
        }

        if (data.qr) {
          if (waQrImg) waQrImg.src = data.qr;
          if (waQrLoading) waQrLoading.style.display = 'none';
          if (waQrConnected) waQrConnected.style.display = 'none';
          if (waQrContainer) waQrContainer.style.display = 'block';
        }
      } catch (err) {
        if (waQrLoading) waQrLoading.innerHTML = `<p style="color:#ef4444;">Error conectando al bot: ${err.message}</p>`;
      }
    };

    fetchQr();
    waAdminPollInterval = setInterval(fetchQr, 3500);

    waQrModal.onclose = () => {
      if (waAdminPollInterval) clearInterval(waAdminPollInterval);
      checkAdminWaStatus();
    };
  }

  async function disconnectAdminWa() {
    const url = getAdminWaUrl();
    if (!confirm('¿Seguro que deseás desvincular la línea de WhatsApp?')) return;
    try {
      await api('/api/admin/bot/disconnect',{method:'POST'});
      toast('WhatsApp desvinculado con éxito');
      waQrModal?.close();
    } catch (err) {
      toast(`Error al desvincular: ${err.message}`, true);
    } finally {
      checkAdminWaStatus();
    }
  }

  btnOpenWaQr?.addEventListener('click', openAdminWaQrModal);
  closeWaQrBtn?.addEventListener('click', () => waQrModal?.close());
  btnDisconnectWa?.addEventListener('click', disconnectAdminWa);
  btnModalDisconnect?.addEventListener('click', disconnectAdminWa);

  btnSaveWaUrl?.addEventListener('click', () => {
    const newUrl = waUrlInput?.value.trim();
    if (newUrl) {
      setAdminWaUrl(newUrl);
      toast('URL del servidor bot guardada');
      checkAdminWaStatus();
    }
  });

  btnTestWa?.addEventListener('click', async () => {
    const url = getAdminWaUrl();
    toast('Comprobando servidor bot... ⏳');
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/health`);
      if (res.ok) {
        toast('🟢 Servidor Bot activo y respondiendo correctamente');
      } else {
        toast(`⚠️ Servidor respondió con código ${res.status}`, true);
      }
    } catch (e) {
      toast(`🔴 Error al conectar: ${e.message}`, true);
    }
    checkAdminWaStatus();
  });

  // Chequear estado del bot al iniciar la vista
  checkAdminWaStatus();
});
