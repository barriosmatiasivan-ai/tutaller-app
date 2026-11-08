// Tu Taller Soft · Workshop Tenant Client Application
let currentSlug = '';
let workshopData = null;
let currentWorkshop = null;
let currentSettings = null;

function getSlug() {
  const path = window.location.pathname;
  const match = path.match(/\/t\/([a-zA-Z0-9-]+)/);
  if (match) return match[1];
  return new URLSearchParams(window.location.search).get('slug') || 'electronica-centro';
}

function toast(msg, isErr = false) {
  const el = document.querySelector('#toast');
  el.textContent = msg;
  el.className = isErr ? 'show error' : 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = ''; }, 4500);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatMoney(amount, currency = 'ARS') {
  const num = Number(amount || 0);
  const sym = currency === 'USD' ? 'USD $' : (currency === 'EUR' ? '€' : '$');
  return `${sym} ${num.toLocaleString('es-AR')}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
  return data;
}

// Cargar información y datos del taller
async function loadWorkshop() {
  currentSlug = getSlug();
  try {
    const [infoRes, dataRes] = await Promise.all([
      api(`/api/workshop/${currentSlug}/info`),
      api(`/api/workshop/${currentSlug}/data`)
    ]);

    currentWorkshop = infoRes.workshop;
    currentSettings = dataRes.settings || {};
    workshopData = dataRes;

    // Actualizar cabecera
    document.querySelector('#header-workshop-name').textContent = currentWorkshop.name;
    document.querySelector('#header-workshop-sub').innerHTML = `
      Plan <strong>${currentWorkshop.plan === 'pro' ? 'Pro' : 'Básico'}</strong> &bull; 
      ${currentWorkshop.days_remaining} días restantes (${currentWorkshop.country || 'AR'})
    `;

    // Si no completó onboarding, mostrar banner y modal
    if (!currentWorkshop.onboarding_completed) {
      document.querySelector('#onboarding-notice').style.display = 'flex';
      document.querySelector('#onboarding-modal').showModal();
    } else {
      document.querySelector('#onboarding-notice').style.display = 'none';
    }

    renderAll();
  } catch (err) {
    toast(`Error al cargar taller: ${err.message}`, true);
    document.querySelector('#header-workshop-name').textContent = 'Error de conexión';
  }
}

function renderAll() {
  renderOrders();
  renderClients();
  renderStock();
  renderCash();
  renderSettings();
}

// 1. Render Órdenes
function renderOrders() {
  const orders = workshopData.orders || [];
  document.querySelector('#count-orders').textContent = orders.length;

  const search = document.querySelector('#order-search').value.trim().toLowerCase();
  const filterStatus = document.querySelector('#order-filter-status').value;

  const filtered = orders.filter(o => {
    if (filterStatus && o.status !== filterStatus) return false;
    if (search) {
      const match = (o.brand && o.brand.toLowerCase().includes(search)) ||
                    (o.model && o.model.toLowerCase().includes(search)) ||
                    (o.client_name && o.client_name.toLowerCase().includes(search)) ||
                    (String(o.order_number).includes(search));
      if (!match) return false;
    }
    return true;
  });

  const tbody = document.querySelector('#orders-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">No se encontraron órdenes registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(o => {
    let statusClass = 'status-progress';
    let statusLabel = 'Recibido';
    if (o.status === 'ready') { statusClass = 'status-ready'; statusLabel = 'Listo para retirar'; }
    else if (o.status === 'waiting_parts') { statusClass = 'status-parts'; statusLabel = 'Esperando repuesto'; }
    else if (o.status === 'delivered') { statusClass = 'status-delivered'; statusLabel = 'Entregado'; }
    else if (o.status === 'estimate') { statusClass = 'status-parts'; statusLabel = 'Presupuesto'; }

    const cleanPhone = (o.client_phone || '').replace(/[^0-9]/g, '');
    let waBtn = '';
    if (cleanPhone) {
      const msg = encodeURIComponent(`Hola ${o.client_name}! Te avisamos de ${currentWorkshop.name} que tu equipo ${o.brand} ${o.model} (Orden #${o.order_number}) está ${statusLabel.toLowerCase()}.`);
      waBtn = `<a href="https://wa.me/${cleanPhone}?text=${msg}" target="_blank" class="secondary" title="Avisar por WhatsApp" style="text-decoration:none;padding:5px 8px;display:inline-flex;align-items:center;">💬</a>`;
    }

    return `
      <tr>
        <td><strong>#${o.order_number}</strong></td>
        <td>
          <div style="font-weight:700;color:#fff;">${esc(o.brand)} ${esc(o.model)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${o.condition || 'Sin detalles estéticos'}</div>
        </td>
        <td>
          <div>${esc(o.client_name || 'Sin cliente')}</div>
          <div style="font-size:12px;color:var(--text-muted);">${esc(o.client_phone || '')}</div>
        </td>
        <td style="max-width:240px;font-size:13px;">${esc(o.fault)}</td>
        <td><span class="status-pill ${statusClass}" style="font-size:11px;padding:4px 10px;">${statusLabel}</span></td>
        <td>
          <div class="actions-cell">
            ${waBtn}
            <button class="secondary" onclick="openReceipt('${o.id}')" title="Ver Comprobante">🖨️</button>
            <button class="secondary" onclick="cycleStatus('${o.id}', '${o.status}')" title="Avanzar estado">⏭️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 2. Render Clientes
function renderClients() {
  const clients = workshopData.clients || [];
  document.querySelector('#count-clients').textContent = clients.length;

  const search = document.querySelector('#client-search').value.trim().toLowerCase();
  const filtered = clients.filter(c => {
    if (!search) return true;
    return (c.name && c.name.toLowerCase().includes(search)) ||
           (c.phone && c.phone.includes(search));
  });

  const tbody = document.querySelector('#clients-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);">Sin clientes cargados aún.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const cleanPhone = (c.phone || '').replace(/[^0-9]/g, '');
    const waLink = cleanPhone ? `<a href="https://wa.me/${cleanPhone}" target="_blank" class="secondary" style="text-decoration:none;padding:5px 8px;">💬</a>` : '-';
    return `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.phone || '-')}</td>
        <td>${esc(c.email || '-')}</td>
        <td>${c.order_count || 0} equipos</td>
        <td>${waLink}</td>
      </tr>
    `;
  }).join('');

  // Actualizar selector de clientes en modal de nueva orden
  const select = document.querySelector('#order-client-select');
  select.innerHTML = `
    <option value="">Seleccionar cliente existente...</option>
    <option value="NEW">＋ [Crear nuevo cliente rápido]</option>
    ${clients.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.phone || 'Sin tel')})</option>`).join('')}
  `;
}

// 3. Render Stock
function renderStock() {
  const stock = workshopData.stock || [];
  const search = document.querySelector('#stock-search').value.trim().toLowerCase();
  const filtered = stock.filter(s => !search || s.name.toLowerCase().includes(search));

  const tbody = document.querySelector('#stock-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);">No hay repuestos registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => `
    <tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td><code>${esc(s.sku || '-')}</code></td>
      <td>
        <span style="font-weight:700;color:${s.quantity <= (s.min_stock || 1) ? '#ef4444' : 'var(--accent)'};">
          ${s.quantity} un.
        </span>
      </td>
      <td>${formatMoney(s.cost_price, currentWorkshop.currency)}</td>
      <td>${formatMoney(s.sale_price, currentWorkshop.currency)}</td>
    </tr>
  `).join('');
}

// 4. Render Caja Diaria
function renderCash() {
  const entries = workshopData.cash_entries || [];
  let totalIn = 0;
  let totalMp = 0;
  let totalCash = 0;
  let totalTrans = 0;

  entries.forEach(e => {
    const amt = Number(e.amount || 0);
    totalIn += amt;
    if (e.payment_method === 'mercadopago') totalMp += amt;
    else if (e.payment_method === 'efectivo') totalCash += amt;
    else totalTrans += amt;
  });

  document.querySelector('#cash-total-today').textContent = formatMoney(totalIn, currentWorkshop.currency);
  document.querySelector('#cash-mp-today').textContent = formatMoney(totalMp, currentWorkshop.currency);
  document.querySelector('#cash-cash-today').textContent = formatMoney(totalCash, currentWorkshop.currency);
  document.querySelector('#cash-trans-today').textContent = formatMoney(totalTrans, currentWorkshop.currency);

  const tbody = document.querySelector('#cash-tbody');
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);">Sin movimientos registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(e => {
    let methodBadge = '<span class="badge-cash">Efectivo</span>';
    if (e.payment_method === 'mercadopago') methodBadge = '<span class="badge-mp">💙 Mercado Pago</span>';
    else if (e.payment_method === 'transferencia') methodBadge = '<span class="badge-trans">🏦 Transferencia</span>';
    else if (e.payment_method === 'tarjeta') methodBadge = '<span class="badge-trans">💳 Tarjeta</span>';

    return `
      <tr>
        <td>${e.created_at ? new Date(e.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
        <td>${esc(e.concept)}</td>
        <td>${methodBadge}</td>
        <td><span style="color:${e.type === 'in' ? 'var(--accent)' : '#ef4444'};font-weight:700;">${e.type === 'in' ? 'Ingreso' : 'Egreso'}</span></td>
        <td><strong>${formatMoney(e.amount, currentWorkshop.currency)}</strong></td>
      </tr>
    `;
  }).join('');
}

// 5. Render Configuración
function renderSettings() {
  if (!currentWorkshop) return;
  document.querySelector('#settings-name').value = currentWorkshop.name || '';
  document.querySelector('#settings-country').value = currentWorkshop.country || 'AR';
  document.querySelector('#settings-phone').value = currentWorkshop.phone || '';
  document.querySelector('#settings-address').value = currentWorkshop.address || '';

  const payments = (currentWorkshop.payment_methods || '').split(',');
  document.querySelector('#chk-mp').checked = payments.includes('mercadopago');
  document.querySelector('#chk-cash').checked = payments.includes('efectivo');
  document.querySelector('#chk-trans').checked = payments.includes('transferencia');
  document.querySelector('#chk-card').checked = payments.includes('tarjeta');
}

// Ciclo de estados de la orden
window.cycleStatus = async function(orderId, currentStatus) {
  const nextMap = {
    received: 'estimate',
    estimate: 'waiting_parts',
    waiting_parts: 'ready',
    ready: 'delivered',
    delivered: 'received'
  };
  const newStatus = nextMap[currentStatus] || 'received';
  try {
    await api(`/api/workshop/${currentSlug}/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    toast('Estado de orden actualizado.');
    await loadWorkshop();
  } catch (err) {
    toast(err.message, true);
  }
};

// Ver / Imprimir Comprobante
window.openReceipt = function(orderId) {
  const order = (workshopData.orders || []).find(o => o.id === orderId);
  if (!order) return;

  const content = document.querySelector('#receipt-preview-content');
  const token = order.intake_key || order.id;
  const trackingUrl = `https://app.tutallersoft.com/seguimiento/${token}`;

  content.innerHTML = `
    ========================================
    ${(currentWorkshop.name || 'TU TALLER').toUpperCase()}
    ${currentWorkshop.address || 'Servicio Técnico Especializado'}
    Tel / WhatsApp: ${currentWorkshop.phone || '-'}
    ========================================
    ORDEN DE REPARACIÓN #${order.order_number}
    Fecha: ${new Date(order.created_at || Date.now()).toLocaleDateString('es-AR')}
    ----------------------------------------
    CLIENTE: ${order.client_name || '-'}
    TELÉFONO: ${order.client_phone || '-'}
    EQUIPO: ${order.brand} ${order.model}
    FALLA: ${order.fault}
    DETALLES: ${order.condition || 'Sin golpes visibles'}
    ----------------------------------------
    CONSULTÁ EL ESTADO DE TU EQUIPO CON QR:
    🔗 ${trackingUrl}
    ----------------------------------------
    Garantía de 30 días sobre mano de obra.
    ========================================
  `;

  const cleanPhone = (order.client_phone || '').replace(/[^0-9]/g, '');
  const waBtn = document.querySelector('#share-wa-btn');
  if (cleanPhone) {
    const text = encodeURIComponent(`Hola ${order.client_name}! Constancia de ingreso de tu equipo en ${currentWorkshop.name}. Orden #${order.order_number} (${order.brand} ${order.model}). Podés consultar el estado de tu reparación en cualquier momento aquí: ${trackingUrl}`);
    waBtn.href = `https://wa.me/${cleanPhone}?text=${text}`;
    waBtn.style.display = 'inline-flex';
  } else {
    waBtn.style.display = 'none';
  }

  document.querySelector('#receipt-modal').showModal();
};

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  loadWorkshop();

  // Cambio de pestañas
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`#${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Filtros
  document.querySelector('#order-search').addEventListener('input', renderOrders);
  document.querySelector('#order-filter-status').addEventListener('change', renderOrders);
  document.querySelector('#client-search').addEventListener('input', renderClients);
  document.querySelector('#stock-search').addEventListener('input', renderStock);

  // Modales
  const orderModal = document.querySelector('#new-order-modal');
  document.querySelector('#open-new-order-btn').addEventListener('click', () => orderModal.showModal());
  document.querySelector('#close-order-modal').addEventListener('click', () => orderModal.close());
  document.querySelector('#cancel-order-btn').addEventListener('click', () => orderModal.close());

  const receiptModal = document.querySelector('#receipt-modal');
  document.querySelector('#close-receipt-modal').addEventListener('click', () => receiptModal.close());
  document.querySelector('#print-receipt-btn').addEventListener('click', () => window.print());

  const onbModal = document.querySelector('#onboarding-modal');
  document.querySelector('#open-onboarding-btn').addEventListener('click', () => onbModal.showModal());
  document.querySelector('#close-onboarding-modal').addEventListener('click', () => onbModal.close());

  // Cliente rápido en formulario de orden
  document.querySelector('#order-client-select').addEventListener('change', e => {
    const group = document.querySelector('#quick-client-group');
    group.style.display = e.target.value === 'NEW' ? 'block' : 'none';
  });

  // Crear Orden Formulario
  document.querySelector('#new-order-form').addEventListener('submit', async e => {
    e.preventDefault();
    const clientSelect = document.querySelector('#order-client-select').value;
    let clientId = clientSelect;
    let clientName = '';
    let clientPhone = '';

    if (clientSelect === 'NEW') {
      clientName = document.querySelector('#order-quick-client-name').value.trim();
      clientPhone = document.querySelector('#order-quick-client-phone').value.trim();
      if (!clientName) { toast('Ingresá el nombre del nuevo cliente', true); return; }
    }

    try {
      const payload = {
        client_id: clientId,
        client_name: clientName,
        client_phone: clientPhone,
        brand: document.querySelector('#order-brand').value.trim(),
        model: document.querySelector('#order-model').value.trim(),
        fault: document.querySelector('#order-fault').value.trim(),
        condition: document.querySelector('#order-condition').value.trim()
      };

      const res = await api(`/api/workshop/${currentSlug}/orders`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      toast(`¡Orden #${res.order_number} ingresada exitosamente!`);
      orderModal.close();
      e.target.reset();
      document.querySelector('#quick-client-group').style.display = 'none';
      await loadWorkshop();
      openReceipt(res.id);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Onboarding Form
  document.querySelector('#onboarding-form').addEventListener('submit', async e => {
    e.preventDefault();
    const country = document.querySelector('#onb-country').value;
    const payments = [];
    if (document.querySelector('#onb-mp').checked) payments.push('mercadopago');
    if (document.querySelector('#onb-cash').checked) payments.push('efectivo');
    if (document.querySelector('#onb-trans').checked) payments.push('transferencia');
    if (document.querySelector('#onb-card').checked) payments.push('tarjeta');

    try {
      await api(`/api/workshop/${currentSlug}/onboarding`, {
        method: 'POST',
        body: JSON.stringify({
          country,
          payment_methods: payments.join(','),
          onboarding_completed: 1
        })
      });

      toast('¡Configuración inicial guardada!');
      onbModal.close();
      await loadWorkshop();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Importar Demo desde Navegador
  async function importDemoData(payload) {
    try {
      const res = await api(`/api/workshop/${currentSlug}/import-demo`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast(`¡Migración exitosa! Se importaron ${res.imported_orders} órdenes y ${res.imported_clients} clientes.`);
      await loadWorkshop();
      return res;
    } catch (err) {
      toast(`Error al importar: ${err.message}`, true);
      throw err;
    }
  }

  // Botón detectar demo en navegador
  const detectDemoHandler = async () => {
    const feedback = document.querySelector('#onb-demo-feedback') || document.querySelector('#import-status');
    try {
      // Buscar en localStorage llaves conocidas de la demo
      let foundData = null;
      for (const key of Object.keys(localStorage)) {
        if (key.includes('rtc') || key.includes('demo') || key.includes('repair')) {
          try {
            const parsed = JSON.parse(localStorage.getItem(key));
            if (parsed && (parsed.orders || parsed.clients || Array.isArray(parsed))) {
              foundData = parsed;
              break;
            }
          } catch {}
        }
      }

      if (foundData) {
        feedback.textContent = 'Encontrados datos de la demo. Migrando...';
        await importDemoData(foundData);
        feedback.textContent = '✅ Datos migrados correctamente.';
      } else {
        feedback.textContent = 'ℹ️ No se detectaron datos guardados en este navegador. Podés subir el archivo JSON de respaldo abajo.';
      }
    } catch (err) {
      feedback.textContent = 'Error: ' + err.message;
    }
  };

  const btnDetectDemo = document.querySelector('#btn-import-local-demo');
  if (btnDetectDemo) btnDetectDemo.addEventListener('click', detectDemoHandler);
  const btnOnbDetect = document.querySelector('#onb-detect-demo-btn');
  if (btnOnbDetect) btnOnbDetect.addEventListener('click', detectDemoHandler);

  // Subir archivo JSON de respaldo de la demo
  const fileInput = document.querySelector('#demo-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        document.querySelector('#import-status').textContent = 'Leyendo y migrando archivo...';
        await importDemoData(json);
        document.querySelector('#import-status').textContent = '✅ Archivo importado con éxito.';
      } catch (err) {
        document.querySelector('#import-status').textContent = 'Error al leer archivo: ' + err.message;
      }
    });
  }
});
