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

async function api(path, options = {}) {
  const adminKey = new URLSearchParams(window.location.search).get('admin_key') || 'tutaller-admin-2026';
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Key': adminKey,
    ...(options.headers || {})
  };
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    throw new Error('No autorizado. Verificá tu acceso de administrador.');
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

    // Filtro de Estado
    if (filterStatus) {
      if (filterStatus === 'active' && (w.status !== 'active' || w.is_expired)) return false;
      if (filterStatus === 'expiring' && (w.status !== 'active' || w.days_remaining > 7 || w.days_remaining <= 0)) return false;
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
    if (w.status === 'suspended') {
      statusBadge = '<span class="badge suspended">⏸️ Suspendido</span>';
    } else if (w.is_expired) {
      statusBadge = '<span class="badge suspended">⌛ Vencido</span>';
    } else if (w.days_remaining <= 7) {
      statusBadge = `<span class="badge expiring">⏳ Vence en ${w.days_remaining}d</span>`;
    } else {
      statusBadge = '<span class="badge active">✓ Activo</span>';
    }

    // Badge de plan
    const planBadge = w.plan === 'pro' 
      ? '<span class="badge pro">⭐ Plan Pro</span>' 
      : '<span class="badge basic">Plan Básico</span>';

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
      const waText = w.days_remaining <= 7
        ? `Hola ${w.name}! Te escribo de Tu Taller Soft para avisarte que tu suscripción vence en ${w.days_remaining} días. ¿Querés renovar para continuar sin interrupciones?`
        : `Hola ${w.name}! Te escribo del equipo de soporte de Tu Taller Soft para ver cómo viene funcionando el sistema en tu taller.`;
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`;
      waButton = `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="secondary" title="Enviar WhatsApp al dueño" style="text-decoration:none;display:inline-flex;align-items:center;padding:6px 9px;">💬</a>`;

      const welcomeText = `¡Hola ${w.name}! Te damos la bienvenida a Tu Taller Soft 🚀. Tu taller ya está habilitado con Plan ${w.plan === 'pro' ? 'Pro' : 'Básico'}. Podés ingresar desde tu celular o PC en: https://app.tutallersoft.com/t/${w.slug} ¡Guardalo en la pantalla de inicio como una app!`;
      const welcomeUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(welcomeText)}`;
      welcomeButton = `<a href="${welcomeUrl}" target="_blank" rel="noopener noreferrer" class="secondary" title="Enviar Bienvenida con enlace por WhatsApp" style="text-decoration:none;display:inline-flex;align-items:center;padding:6px 9px;background:rgba(37, 211, 102, 0.15);color:#25d366;border-color:rgba(37, 211, 102, 0.3);">📲</a>`;
    }

    const openLink = `<a href="/t/${w.slug}" target="_blank" class="secondary" title="Abrir Taller del Técnico" style="text-decoration:none;display:inline-flex;align-items:center;padding:6px 9px;">🔗</a>`;

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
        <td>${planBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div>${formatDate(w.expires_at)}</div>
          <div style="font-size:11px;color:${w.days_remaining <= 7 ? 'var(--warning)' : 'var(--text-muted)'};">
            ${w.is_expired ? 'Vencido' : `${w.days_remaining} días restantes`}
          </div>
        </td>
        <td>
          ${activityHtml}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Total: ${w.total_orders || 0} órdenes · ${w.client_count || 0} clientes</div>
        </td>
        <td>
          <div class="actions-cell">
            ${openLink}
            ${welcomeButton}
            ${waButton}
            <button class="secondary" onclick="openRenewModal('${w.id}', '${esc(w.name)}')" title="Renovar suscripción">📅 Renovar</button>
            <button class="secondary" onclick="toggleStatus('${w.id}', '${w.status}')" title="${w.status === 'active' ? 'Suspender taller' : 'Reactivar taller'}">
              ${w.status === 'active' ? '⏸️' : '▶️'}
            </button>
            <button class="secondary" onclick="togglePlan('${w.id}', '${w.plan}')" title="Cambiar a ${w.plan === 'pro' ? 'Básico' : 'Pro'}">
              🔄 ${w.plan === 'pro' ? 'Básico' : 'Pro'}
            </button>
            <button class="secondary" onclick="deleteWorkshop('${w.id}', '${esc(w.name)}')" title="Eliminar taller" style="color:#ef4444;">🗑️</button>
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

window.togglePlan = async function(id, currentPlan) {
  const newPlan = currentPlan === 'pro' ? 'basic' : 'pro';
  try {
    await api(`/api/admin/workshops/${id}/plan`, {
      method: 'POST',
      body: JSON.stringify({ plan: newPlan })
    });
    toast(`Plan actualizado a ${newPlan.toUpperCase()}.`);
    await loadData();
  } catch (err) {
    toast(err.message, true);
  }
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
  loadData();

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
});
