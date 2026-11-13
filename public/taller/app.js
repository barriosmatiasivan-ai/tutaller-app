// Tu Taller Soft · Workshop Tenant Client Application (Unified UI)
let currentSlug = '';
let currentWorkshop = null;
let currentSettings = null;
let workshopData = { orders: [], clients: [], stock: [], cash_entries: [] };
let activeSection = 'home';
let searchQuery = '';
let orderStatusFilter = '';

const STATUS_CONFIG = {
  received: { label: 'Recibido', class: 'repairing' },
  in_progress: { label: 'En reparación', class: 'repairing' },
  waiting_parts: { label: 'Esperando repuesto', class: 'parts' },
  ready: { label: 'Listo para retirar', class: 'ready' },
  delivered: { label: 'Entregado', class: 'delivered' },
  cancelled: { label: 'Cancelado', class: 'cancelled' }
};

const COUNTRY_FLAGS = {
  AR: '🇦🇷 AR', CL: '🇨🇱 CL', CO: '🇨🇴 CO', MX: '🇲🇽 MX',
  PE: '🇵🇪 PE', UY: '🇺🇾 UY', ES: '🇪🇸 ES', US: '🇺🇸 US'
};

const COUNTRY_CURRENCY = {
  AR: 'ARS', CL: 'CLP', CO: 'COP', MX: 'MXN',
  PE: 'PEN', UY: 'UYU', ES: 'EUR', US: 'USD'
};

const BRAND_ALIASES = {
  apple: ['apple', 'iphone', 'ipad'],
  samsung: ['samsung', 'galaxy'],
  motorola: ['motorola', 'moto'],
  xiaomi: ['xiaomi', 'redmi', 'poco'],
  huawei: ['huawei'],
  nokia: ['nokia'],
  oppo: ['oppo'],
  vivo: ['vivo'],
  honor: ['honor'],
  oneplus: ['oneplus', 'one plus'],
  sony: ['sony', 'xperia'],
  lg: ['lg']
};

function setText(selector, val) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (el) {
    el.textContent = val !== null && val !== undefined ? String(val) : '';
  }
  return el;
}

function getBrandKey(brandStr) {
  if (!brandStr) return null;
  const lower = brandStr.toLowerCase().trim();
  for (const [key, aliases] of Object.entries(BRAND_ALIASES)) {
    if (aliases.some(alias => lower === alias || lower.startsWith(alias + ' '))) {
      return key;
    }
  }
  return null;
}

function brandBadge(brandStr) {
  const key = getBrandKey(brandStr);
  return `
    <span class="phone-icon brand-icon" aria-hidden="true">
      ${key ? `<img src="/brands/${key}.svg" alt="${esc(brandStr)}" width="48" height="40" onerror="this.remove()">` : ''}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" focusable="false">
        <rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/>
      </svg>
    </span>
  `;
}

function getSlug() {
  const path = window.location.pathname;
  const match = path.match(/\/t\/([a-zA-Z0-9-]+)/);
  if (match) return match[1];
  return new URLSearchParams(window.location.search).get('slug') || 'electronica-centro';
}

function toast(msg, isErr = false) {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = isErr ? 'show error' : 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = ''; }, 4500);
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMoney(amount, currency = null) {
  const curr = currency || currentWorkshop?.currency || 'ARS';
  const num = Number(amount || 0);
  const sym = curr === 'USD' ? 'USD $' : (curr === 'EUR' ? '€' : '$');
  return `${sym} ${num.toLocaleString('es-AR')}`;
}

function getWorkshopToken() {
  return localStorage.getItem('tutaller_session_' + currentSlug) || '';
}

function setWorkshopToken(token) {
  localStorage.setItem('tutaller_session_' + currentSlug, token);
}

function clearWorkshopToken() {
  localStorage.removeItem('tutaller_session_' + currentSlug);
}

function showWorkshopLogin() {
  document.body.classList.add('is-login');
  document.body.classList.remove('is-app');
  const loginView = document.querySelector('#workshop-login-view');
  const appLayout = document.querySelector('#app-layout');
  if (loginView) {
    loginView.style.display = 'flex';
    loginView.removeAttribute('hidden');
  }
  if (appLayout) {
    appLayout.style.display = 'none';
    appLayout.setAttribute('hidden', '');
    appLayout.classList.add('hidden');
  }

  if (currentWorkshop) {
    setText('#login-workshop-name', currentWorkshop.name || 'Tu Taller');
    const logoEl = document.querySelector('#login-workshop-logo');
    if (logoEl && currentWorkshop.logo_url) logoEl.src = currentWorkshop.logo_url;
  }
}

function showWorkshopApp() {
  document.body.classList.remove('is-login');
  document.body.classList.add('is-app');
  const loginView = document.querySelector('#workshop-login-view');
  const appLayout = document.querySelector('#app-layout');
  if (loginView) {
    loginView.style.display = 'none';
    loginView.setAttribute('hidden', '');
  }
  if (appLayout) {
    appLayout.style.display = '';
    appLayout.removeAttribute('hidden');
    appLayout.classList.remove('hidden');
  }
}

async function api(path, options = {}) {
  const token = getWorkshopToken();
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  if (res.status === 401 && !path.includes('/auth/')) {
    clearWorkshopToken();
    showWorkshopLogin();
    throw new Error('Sesión expirada. Ingresá con tu PIN.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
  return data;
}

const photoUploadIds = new WeakMap();
async function uploadOrderPhotos(orderId, files) {
  const formData = new FormData();
  const file = files[0];
  if (!photoUploadIds.has(file)) photoUploadIds.set(file, crypto.randomUUID());
  formData.append('upload_id', photoUploadIds.get(file));
  formData.append('photos', file);
  const token = getWorkshopToken();
  const res = await fetch(`/api/workshop/${currentSlug}/orders/${encodeURIComponent(orderId)}/photos`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearWorkshopToken();
    showWorkshopLogin();
  }
  if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las fotos');
  return data;
}

const pendingPhotos = new Map();
async function savePendingPhotos(orderId, files) {
  if (files.length > 6) throw new Error('Elegí hasta seis imágenes por carga.');
  const pending = pendingPhotos.get(orderId) || [];
  for (const file of files) {
    if (!pending.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) pending.push(file);
  }
  pendingPhotos.set(orderId, pending);
  while (pending.length) {
    await uploadOrderPhotos(orderId, [pending[0]]);
    pending.shift();
  }
  pendingPhotos.delete(orderId);
}

async function renderOrderPhotoGallery(orderId, gallery) {
  if (!gallery) return;
  gallery.innerHTML = '<p class="muted">Cargando fotos…</p>';
  try {
    const result = await api(`/api/workshop/${currentSlug}/orders/${encodeURIComponent(orderId)}/photos`);
    const photos = result.photos || [];
    if (!photos.length) {
      gallery.innerHTML = '<p class="muted">Todavía no hay fotos guardadas para este equipo.</p>';
      return;
    }
    gallery.innerHTML = photos.map(photo => `
      <figure style="margin:0;">
        <img data-photo-id="${esc(photo.id)}" alt="${esc(photo.file_name || 'Foto del equipo')}"
          style="width:120px;height:100px;object-fit:cover;border-radius:10px;border:1px solid var(--border);">
        <figcaption class="muted" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;">${esc(photo.file_name || 'Foto del equipo')}</figcaption>
      </figure>
    `).join('');
    const token = getWorkshopToken();
    await Promise.all(photos.map(async photo => {
      const response = await fetch(`/api/workshop/${currentSlug}/orders/${encodeURIComponent(orderId)}/photos/${encodeURIComponent(photo.id)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error('No se pudo mostrar una foto');
      const imageUrl = URL.createObjectURL(await response.blob());
      const img = gallery.querySelector(`img[data-photo-id="${CSS.escape(photo.id)}"]`);
      if (img) img.src = imageUrl;
      else URL.revokeObjectURL(imageUrl);
    }));
  } catch (err) {
    gallery.innerHTML = `<p class="muted">No se pudieron cargar las fotos: ${esc(err.message)}</p>`;
  }
}

function modal(title, content) {
  const d = document.querySelector('#app-modal');
  if (!d) return null;
  d.innerHTML = `
    <div class="modal-heading">
      <h2>${title}</h2>
      <button type="button" class="icon-button" id="close-app-modal" aria-label="Cerrar">×</button>
    </div>
    ${content}
  `;
  d.querySelector('#close-app-modal')?.addEventListener('click', () => d.close());
  if (typeof d.showModal === 'function') d.showModal();
  return d;
}

// ==========================================
// Integración con Bot de WhatsApp QR (Baileys)
// ==========================================
const WA_BOT_STORAGE_KEY = 'tutaller_wa_bot_config';

function getWaBotConfig() {
  try {
    const raw = localStorage.getItem(WA_BOT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    url: 'https://tutaller-app-production.up.railway.app',
    apiKey: '',
    autoIntake: true,
    autoReady: true,
    autoDelivered: true
  };
}

function saveWaBotConfig(cfg) {
  try {
    localStorage.setItem(WA_BOT_STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) {}
}

async function updateWaBotStatusUI() {
  const cfg = getWaBotConfig();
  const iconEl = document.querySelector('#wa-bot-status-icon');
  const textEl = document.querySelector('#wa-bot-status-text');
  const subEl = document.querySelector('#wa-bot-status-sub');
  const btnQr = document.querySelector('#btn-open-wa-qr');
  const btnDisc = document.querySelector('#btn-disconnect-wa');

  if (!iconEl || !textEl || !subEl) return;

  if (!cfg.url) {
    iconEl.textContent = '⚪';
    textEl.textContent = 'Desconectado / Sin vincular';
    subEl.textContent = 'Configurá la URL de tu bot o vinculá tu celular para envíos automáticos';
    if (btnQr) btnQr.textContent = '📲 Vincular Celular (QR)';
    if (btnDisc) btnDisc.style.display = 'none';
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const headers = { 'Accept': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/api/status`, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.state === 'connected') {
      iconEl.textContent = '🟢';
      textEl.textContent = 'Conectado y activo';
      subEl.textContent = `Celular vinculado: +${data.phone || 'OK'} • Notificaciones listas`;
      if (btnQr) btnQr.textContent = '🔄 Cambiar dispositivo';
      if (btnDisc) btnDisc.style.display = 'inline-block';
    } else if (data.state === 'qr_ready') {
      iconEl.textContent = '🟡';
      textEl.textContent = 'Esperando escaneo de QR';
      subEl.textContent = 'Abrí el modal para escanear el código con tu WhatsApp';
      if (btnQr) btnQr.textContent = '📲 Escanear QR ahora';
      if (btnDisc) btnDisc.style.display = 'none';
    } else {
      iconEl.textContent = '⚪';
      textEl.textContent = 'Desconectado';
      subEl.textContent = 'El bot está iniciado pero aún no tiene sesión activa';
      if (btnQr) btnQr.textContent = '📲 Vincular Celular (QR)';
      if (btnDisc) btnDisc.style.display = 'none';
    }
  } catch (err) {
    iconEl.textContent = '🔴';
    textEl.textContent = 'Servidor inaccesible';
    subEl.textContent = `No se pudo conectar con ${cfg.url}`;
    if (btnQr) btnQr.textContent = '📲 Probar vincular';
    if (btnDisc) btnDisc.style.display = 'none';
  }
}

let waQrPollInterval = null;

async function openWaQrModal() {
  const cfg = getWaBotConfig();
  const dlg = document.querySelector('#wa-qr-dialog');
  if (!dlg) return;

  const loadingEl = document.querySelector('#wa-qr-loading');
  const contEl = document.querySelector('#wa-qr-container');
  const connEl = document.querySelector('#wa-qr-connected');
  const errEl = document.querySelector('#wa-qr-error');
  const errMsg = document.querySelector('#wa-qr-error-msg');
  const imgEl = document.querySelector('#wa-qr-img');

  if (!cfg.url) {
    const inputUrl = prompt('Ingresá la URL de tu servidor Bot de WhatsApp (ejemplo: https://mi-bot.up.railway.app):', '');
    if (!inputUrl) return;
    cfg.url = inputUrl.trim();
    saveWaBotConfig(cfg);
    const setUrlInp = document.querySelector('#set-wa-bot-url');
    if (setUrlInp) setUrlInp.value = cfg.url;
  }

  if (loadingEl) loadingEl.style.display = 'block';
  if (contEl) contEl.style.display = 'none';
  if (connEl) connEl.style.display = 'none';
  if (errEl) errEl.style.display = 'none';

  dlg.showModal();

  if (waQrPollInterval) clearInterval(waQrPollInterval);

  const fetchQr = async () => {
    try {
      const headers = { 'Accept': 'application/json' };
      if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

      const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/api/qr?format=json`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.connected) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (contEl) contEl.style.display = 'none';
        if (errEl) errEl.style.display = 'none';
        if (connEl) connEl.style.display = 'block';
        const phoneDisp = document.querySelector('#wa-connected-phone-display');
        if (phoneDisp) phoneDisp.textContent = data.phone ? `+${data.phone}` : 'Dispositivo vinculado';
        clearInterval(waQrPollInterval);
        updateWaBotStatusUI();
        return;
      }

      if (data.qr) {
        if (imgEl) imgEl.src = data.qr;
        if (loadingEl) loadingEl.style.display = 'none';
        if (errEl) errEl.style.display = 'none';
        if (contEl) contEl.style.display = 'block';
      }
    } catch (err) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (contEl) contEl.style.display = 'none';
      if (errEl) errEl.style.display = 'block';
      if (errMsg) errMsg.textContent = `Error al comunicar con ${cfg.url}: ${err.message}`;
    }
  };

  fetchQr();
  waQrPollInterval = setInterval(fetchQr, 3500);

  dlg.onclose = () => {
    if (waQrPollInterval) clearInterval(waQrPollInterval);
    updateWaBotStatusUI();
  };
}

async function disconnectWaBot() {
  const cfg = getWaBotConfig();
  if (!cfg.url) return;
  if (!confirm('¿Seguro que deseás desvincular el celular de WhatsApp? Los envíos automáticos se pausarán.')) return;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/api/disconnect`, { method: 'POST', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast('WhatsApp desvinculado con éxito');
  } catch (err) {
    toast(`Error al desvincular: ${err.message}`, true);
  } finally {
    updateWaBotStatusUI();
  }
}

async function sendWaBotMessage(phone, message) {
  const cfg = getWaBotConfig();
  if (!phone) return null;

  const defaultBotUrl = 'https://tutaller-app-production.up.railway.app';
  const normalizedUrl = (cfg.url || '').replace(/\/+$/, '');
  const useServerProxy = !cfg.apiKey && (!normalizedUrl || normalizedUrl === defaultBotUrl);

  try {
    if (useServerProxy) {
      return await api(`/api/workshop/${currentSlug}/bot/send`, {
        method: 'POST',
        body: JSON.stringify({ phone, message })
      });
    }

    if (!normalizedUrl) return null;
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const res = await fetch(`${normalizedUrl}/api/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone, message })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn('No se pudo enviar WhatsApp bot:', err);
    return { success: false, error: err?.message || 'Error al enviar WhatsApp' };
  }
}

async function triggerAutoWhatsApp(order, type) {
  const cfg = getWaBotConfig();

  if (type === 'intake' && !cfg.autoIntake) return;
  if (type === 'ready' && !cfg.autoReady) return;
  if (type === 'delivered' && !cfg.autoDelivered) return;

  const phone = order.client_phone || '';
  if (!phone) return;

  const clientName = order.client_name || 'Estimado/a cliente';
  const workshopName = currentWorkshop?.name || 'Tu Taller';
  const trackingUrl = `${location.origin}/seguimiento/${order.intake_key || order.id}`;

  let text = '';
  if (type === 'intake') {
    text = `Hola ${clientName}! 👋 Te confirmamos el ingreso de tu *${order.brand || ''} ${order.model || 'equipo'}* a *${workshopName}*.\n\n📋 *Orden de servicio:* #${order.order_number}\n🔍 *Seguimiento en vivo y presupuesto:*\n${trackingUrl}\n\n¡Muchas gracias por confiar en nuestro servicio!`;
  } else if (type === 'ready') {
    text = `Hola ${clientName}! 🔔 Te avisamos de *${workshopName}* que tu *${order.brand || ''} ${order.model || 'equipo'}* (Orden #${order.order_number}) ya está *LISTO PARA RETIRAR*.\n\n📍 Podés pasar a retirarlo por nuestro local.\n🔍 Ver comprobante de entrega:\n${trackingUrl}`;
  } else if (type === 'delivered') {
    text = `Hola ${clientName}! ✅ Tu *${order.brand || ''} ${order.model || 'equipo'}* (Orden #${order.order_number}) fue retirado con éxito de *${workshopName}*.\n\n🛡️ Muchas gracias por confiar en nosotros. ¡Cualquier consulta estamos a disposición!`;
  }

  if (!text) return;

  const result = await sendWaBotMessage(phone, text);
  if (result && result.success) {
    toast(`📲 Aviso automático enviado por WhatsApp a ${clientName}`);
  } else if (result && result.error) {
    toast(`No se pudo enviar el WhatsApp automático: ${result.error}`, true);
  }
}

// Carga inicial del taller
async function loadWorkshop() {
  currentSlug = getSlug();
  try {
    // 1. Cargar info básica pública (nombre, logo, país para la cabecera o login)
    const infoRes = await fetch(`/api/workshop/${currentSlug}/info`).then(r => r.json()).catch(() => null);
    if (infoRes && infoRes.workshop) {
      currentWorkshop = infoRes.workshop;
      setText('#login-workshop-name', currentWorkshop.name);
      if (currentWorkshop.logo_url) {
        const logoEl = document.querySelector('#login-workshop-logo');
        if (logoEl) logoEl.src = currentWorkshop.logo_url;
      }
    }

    // 2. Verificar si hay token de sesión válido
    const token = getWorkshopToken();
    if (!token) {
      showWorkshopLogin();
      return;
    }

    const meRes = await api(`/api/workshop/${currentSlug}/auth/me`).catch(() => null);
    if (!meRes || !meRes.authenticated) {
      clearWorkshopToken();
      showWorkshopLogin();
      return;
    }

    // Sesión autorizada: mostrar el panel
    showWorkshopApp();

    const dataRes = await api(`/api/workshop/${currentSlug}/data`);
    currentWorkshop = dataRes.workshop || currentWorkshop || {};
    currentSettings = dataRes.settings || {};
    workshopData = {
      orders: dataRes.orders || [],
      clients: dataRes.clients || [],
      stock: dataRes.stock || [],
      cash_totals: dataRes.cash_totals,
      cash_entries: dataRes.cash_entries || []
    };

    updateBrandUI();
    updateHeaderUI();

    // Si aún no completó onboarding de país y métodos de pago
    if (currentWorkshop && !currentWorkshop.onboarding_completed) {
      document.querySelector('#onboarding-modal')?.showModal?.();
    }

    renderCurrentSection();
  } catch (err) {
    console.error('Error al cargar taller:', err);
    if (err.message.includes('PIN') || err.message.includes('Sesión') || err.message.includes('autorizado')) {
      showWorkshopLogin();
    } else {
      toast(`Error al cargar taller: ${err.message}`, true);
    }
  }
}

function updateBrandUI() {
  if (!currentWorkshop) return;
  const name = currentWorkshop.name || 'Mi Taller';
  document.title = `${name} · Tu Taller`;
  const isLifetime = currentWorkshop.is_lifetime || (Date.parse(currentWorkshop.expires_at || '') > Date.parse('2090-01-01')) || (currentWorkshop.days_remaining && currentWorkshop.days_remaining >= 30000);
  const planLabel = currentWorkshop.plan === 'pro' ? 'Plan Pro ⭐' : 'Plan Básico 🥉';
  const vigenciaLabel = isLifetime ? 'Vitalicio 👑' : `${currentWorkshop.days_remaining || 0} días restantes`;
  setText('#sidebar-plan-label', `${planLabel} · ${vigenciaLabel}`);

  const logoImg = document.querySelector('#sidebar-logo');
  const mobLogo = document.querySelector('#mobile-logo');
  const url = currentSettings?.logo_url || '/logo.png';
  if (logoImg) logoImg.src = url;
  if (mobLogo) mobLogo.src = url;
}

function updateHeaderUI() {
  if (!currentWorkshop) return;
  const country = (currentWorkshop.country || 'AR').toUpperCase();
  setText('#header-country-pill', COUNTRY_FLAGS[country] || `🌍 ${country}`);

  const pms = (currentWorkshop.payment_methods || 'efectivo,mercadopago,transferencia').split(',');
  const badgesContainer = document.querySelector('#header-payment-badges');
  if (badgesContainer) {
    let badgesHtml = '';
    if (pms.includes('mercadopago')) {
      badgesHtml += `<span class="badge-mp">⚡ MP</span>`;
    }
    if (pms.includes('efectivo')) {
      badgesHtml += `<span class="badge-cash">💵 Efvo</span>`;
    }
    if (pms.includes('transferencia')) {
      badgesHtml += `<span class="badge-transfer">🏦 Transf</span>`;
    }
    badgesContainer.innerHTML = badgesHtml;
  }
}

// Control de secciones
let ordersRefreshSequence = 0;

function setSection(sectionName) {
  activeSection = sectionName;
  const refreshSequence = ++ordersRefreshSequence;
  document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
  const target = document.querySelector(`#section-${sectionName}`);
  if (target) target.style.display = 'block';

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionName);
  });

  renderCurrentSection();

  // Refrescar desde D1 al abrir Reparaciones para mostrar siempre las órdenes guardadas.
  if (sectionName === 'orders' && currentSlug && getWorkshopToken()) {
    api(`/api/workshop/${currentSlug}/data`)
      .then(dataRes => {
        if (activeSection !== 'orders' || refreshSequence !== ordersRefreshSequence) return;
        workshopData = {
          orders: dataRes.orders || [],
          clients: dataRes.clients || [],
          stock: dataRes.stock || [],
          cash_totals: dataRes.cash_totals,
      cash_entries: dataRes.cash_entries || []
        };
        renderOrders();
      })
      .catch(err => {
        if (activeSection === 'orders' && refreshSequence === ordersRefreshSequence) {
          toast(`No se pudieron actualizar las reparaciones: ${err.message}`, true);
        }
      });
  }
}

function renderCurrentSection() {
  renderHome();
  if (activeSection === 'orders') renderOrders();
  if (activeSection === 'clients') renderClients();
  if (activeSection === 'stock') renderStock();
  if (activeSection === 'cash') renderCash();
  if (activeSection === 'settings') renderSettings();
}

// 1. Render Dashboard (Inicio)
function renderHome() {
  const orders = workshopData.orders || [];
  const clients = workshopData.clients || [];

  const activeCount = orders.filter(o => ['received', 'in_progress'].includes(o.status)).length;
  const readyCount = orders.filter(o => o.status === 'ready').length;
  const partsCount = orders.filter(o => o.status === 'waiting_parts').length;
  const debtCount = orders.filter(o => Number(o.balance_cents || 0) > 0 && o.status !== 'cancelled').length;

  setText('#kpi-active-count', activeCount);
  setText('#kpi-ready-count', readyCount);
  setText('#kpi-parts-count', partsCount);
  setText('#kpi-clients-count', clients.length);

  setText('#rev-active-count', activeCount);
  setText('#rev-active-text', activeCount > 0 ? `${activeCount} en banco de trabajo` : '✓ Estás al día');

  setText('#rev-ready-count', readyCount);
  setText('#rev-ready-text', readyCount > 0 ? `${readyCount} por avisar / retirar` : '✓ Estás al día');

  setText('#rev-parts-count', partsCount);
  setText('#rev-parts-text', partsCount > 0 ? `${partsCount} pendientes de compra` : '✓ Estás al día');

  setText('#rev-debt-count', debtCount);
  setText('#rev-debt-text', debtCount > 0 ? `${debtCount} con saldo pendiente` : '✓ Estás al día');

  const homeContainer = document.querySelector('#home-orders-container');
  if (!homeContainer) return;

  const ongoing = orders.filter(o => !['delivered', 'cancelled'].includes(o.status));

  if (ongoing.length === 0) {
    homeContainer.innerHTML = `
      <div class="empty" style="padding:32px 16px;text-align:center;">
        <div class="icon-classic" style="font-size:36px;margin-bottom:8px;">🚀</div>
        <div class="icon-pro empty-pro-badge" style="margin:0 auto 14px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        </div>
        <h3 style="margin-bottom:6px;">¡Tu taller está listo para arrancar!</h3>
        <p class="muted" style="max-width:440px;margin:0 auto 18px;font-size:13.5px;line-height:1.45;">
          Ingresá el primer equipo que entra a tu taller para registrar la falla, emitir el comprobante y activar la línea de progreso en tiempo real con QR.
        </p>
        <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
          <button type="button" class="primary" id="btn-home-first-order">＋ Ingresar primer equipo</button>
        </div>
      </div>
    `;
    document.querySelector('#btn-home-first-order')?.addEventListener('click', openNewOrderModal);
  } else {
    homeContainer.innerHTML = ongoing.slice(0, 6).map(orderCardHtml).join('');
    bindOrderCardClicks(homeContainer);
  }
}

// 2. Render Órdenes
function renderOrders() {
  const container = document.querySelector('#orders-full-container');
  if (!container) return;
  let list = workshopData.orders || [];

  if (orderStatusFilter) {
    list = list.filter(o => o.status === orderStatusFilter);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(o => {
      return (o.brand && o.brand.toLowerCase().includes(q)) ||
             (o.model && o.model.toLowerCase().includes(q)) ||
             (o.fault && o.fault.toLowerCase().includes(q)) ||
             (o.client_name && o.client_name.toLowerCase().includes(q)) ||
             (o.client_phone && o.client_phone.includes(q)) ||
             String(o.order_number).includes(q);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <span class="icon-classic">▯</span>
        <div class="icon-pro empty-pro-badge" style="margin:0 auto 12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        </div>
        <h3>No se encontraron reparaciones</h3>
        <p>Probá con otro término de búsqueda o cambiá el filtro de estado.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(orderCardHtml).join('');
  bindOrderCardClicks(container);
}

function clientInitials(name) {
  const clean = String(name || 'Cliente').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function renderOrderStepper(status) {
  if (status === 'cancelled') {
    return `
      <div class="order-stepper">
        <span class="step-pill step-cancelled">✕ Cancelado</span>
      </div>
    `;
  }

  let s1Class = 'upcoming';
  let s2Class = 'upcoming';
  let s3Class = 'upcoming';
  let s1Icon = '1.';
  let s2Label = 'En Reparación';
  let s3Label = status === 'delivered' ? 'Entregado' : 'Listo para Retiro';

  if (status === 'received') {
    s1Class = 'active-cyan';
    s1Icon = '<span class="step-dot"></span>';
  } else if (status === 'in_progress') {
    s1Class = 'done';
    s1Icon = '✓';
    s2Class = 'active-cyan';
  } else if (status === 'waiting_parts') {
    s1Class = 'done';
    s1Icon = '✓';
    s2Class = 'active-amber';
    s2Label = 'Esp. Repuesto';
  } else if (status === 'ready' || status === 'delivered') {
    s1Class = 'done';
    s1Icon = '✓';
    s2Class = 'done';
    s3Class = 'active-emerald';
  }

  const s2Prefix = s2Class === 'done' ? '✓ ' : (s2Class.startsWith('active') ? '<span class="step-dot"></span>' : '2. ');
  const s3Prefix = s3Class === 'active-emerald' ? '✓ ' : '3. ';

  return `
    <div class="order-stepper" aria-label="Progreso de reparación">
      <span class="step-pill ${s1Class}">${s1Icon} Diagnóstico</span>
      <span class="step-arrow">➔</span>
      <span class="step-pill ${s2Class}">${s2Prefix}${s2Label}</span>
      <span class="step-arrow">➔</span>
      <span class="step-pill ${s3Class}">${s3Prefix}${s3Label}</span>
    </div>
  `;
}

function orderCardHtml(order) {
  const st = STATUS_CONFIG[order.status] || { label: order.status, class: 'repairing' };
  const clientName = order.client_name || 'Cliente sin asignar';
  const clientPhone = order.client_phone ? ` · ${esc(order.client_phone)}` : '';
  const trackingUrl = `/seguimiento/${order.intake_key || order.id}`;
  const total = Number(order.total_cost || 0);
  const saldo = Number(order.balance_cents || 0) / 100;
  const initials = clientInitials(clientName);
  const financeBadgeHtml = saldo > 0
    ? `<span class="order-finance-badge has-debt">Saldo: ${formatMoney(saldo)}</span>`
    : (total > 0 ? `<span class="order-finance-badge paid">✓ Pagado</span>` : '');

  return `
    <div class="order-card-enhanced" data-order-id="${order.id}">
      <span class="order-id-pro">#${order.order_number}</span>
      ${brandBadge(order.brand)}
      <div class="order-meta">
        <span class="device-text">${esc(order.brand)} ${esc(order.model)}</span>
        <span class="fault-text">${esc(order.fault || 'Revisión técnica')}</span>
      </div>
      <div class="order-client-pro">
        <span class="client-avatar-pro">${esc(initials)}</span>
        <div class="client-info-pro">
          <strong>${esc(clientName)}</strong>
          <span>${esc(order.client_phone || 'Sin teléfono')}</span>
        </div>
      </div>
      <div class="order-actions-btns" onclick="event.stopPropagation();">
        ${order.client_phone ? `
          <a class="order-action-icon btn-wa-action" href="https://wa.me/${order.client_phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hola ${clientName}, te escribimos de ${currentWorkshop?.name || 'el taller'} sobre tu orden #${order.order_number} (${order.brand} ${order.model}): estado actual: ${st.label}.`)}" target="_blank" rel="noopener noreferrer" title="Enviar WhatsApp al cliente">
            <span class="wa-pro-content">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              <span>WhatsApp</span>
            </span>
          </a>
        ` : ''}
        <a class="order-action-icon btn-qr-action" href="${trackingUrl}" target="_blank" rel="noopener noreferrer" title="Ver comprobante y QR de seguimiento">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        </a>
      </div>
      <div class="order-stepper-wrap">
        ${renderOrderStepper(order.status)}
        <div class="order-stepper-right">
          <span class="badge ${st.class}"><span class="dot"></span>${st.label}</span>
          ${financeBadgeHtml}
        </div>
      </div>
    </div>
  `;
}

function bindOrderCardClicks(parent) {
  parent.querySelectorAll('[data-order-id]').forEach(el => {
    el.addEventListener('click', () => {
      const oid = el.dataset.orderId;
      const order = workshopData.orders.find(o => o.id === oid);
      if (order) openOrderDetailModal(order);
    });
  });
}

// Modal de detalle de orden
function openOrderDetailModal(order) {
  const st = STATUS_CONFIG[order.status] || { label: order.status };
  const clientName = order.client_name || 'Sin nombre';
  const clientPhone = order.client_phone || 'Sin teléfono';
  const trackingUrl = `/seguimiento/${order.intake_key || order.id}`;

  const d = modal(`Orden #${order.order_number} · ${esc(order.brand)} ${esc(order.model)}`, `
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        <div>
          <strong style="font-size:16px;color:#fff;">${esc(clientName)}</strong>
          <p class="muted" style="margin:2px 0 0;font-size:13px;">${esc(clientPhone)}</p>
        </div>
        <a href="${trackingUrl}" target="_blank" class="secondary compact" style="text-decoration:none;">📲 Abrir seguimiento QR</a>
      </div>

      <dl>
        <dt>Falla</dt><dd>${esc(order.fault || 'Sin especificar')}</dd>
        <dt>Estado físico</dt><dd>${esc(order.condition || 'Sin observaciones')}</dd>
        <dt>Accesorios</dt><dd>${esc(order.accessories || 'Solo el equipo')}</dd>
        <dt>IMEI / Serie</dt><dd>${esc(order.identifier || 'No especificado')}</dd>
      </dl>

      <section style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
        <label for="order-photo-input">Fotos del equipo</label>
        <p class="muted" style="margin:4px 0 10px;font-size:12px;">Agregá imágenes al recibirlo o durante la reparación.</p>
        <input id="order-photo-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple>
        <small class="muted">Hasta 6 imágenes por carga, máx. 8 MB cada una.</small>
        <button id="retry-photos" type="button" hidden>Reintentar fotos pendientes</button>
        <div id="order-photo-gallery" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;"></div>
      </section>

      <form id="order-status-form" style="margin-top:16px;">
        <label>Informe visible en el QR del cliente
          <textarea id="public-diagnosis" maxlength="2000">${esc(order.public_diagnosis || '')}</textarea>
        </label>
        <label>Cambiar estado de reparación
          <select id="edit-order-status" style="margin-top:6px;">
            <option value="received" ${order.status==='received'?'selected':''}>Recibido</option>
            <option value="in_progress" ${order.status==='in_progress'?'selected':''}>En reparación</option>
            <option value="waiting_parts" ${order.status==='waiting_parts'?'selected':''}>Esperando repuesto</option>
            <option value="ready" ${order.status==='ready'?'selected':''}>Listo para retirar</option>
            <option value="delivered" ${order.status==='delivered'?'selected':''}>Entregado</option>
            <option value="cancelled" ${order.status==='cancelled'?'selected':''}>Cancelado</option>
          </select>
        </label>
        <div class="form-actions" style="margin-top:10px;">
          <button type="submit" class="primary">Actualizar estado</button>
        </div>
      </form>

      ${order.client_phone ? `
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border);">
          <label>Aviso rápido por WhatsApp</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button type="button" class="primary compact" id="btn-modal-send-wa-bot" style="display:flex;align-items:center;gap:6px;">
              🤖 Enviar aviso automático (Bot QR)
            </button>
            <a class="secondary compact" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;" href="https://wa.me/${order.client_phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hola ${clientName}! Te escribimos de ${currentWorkshop?.name || 'el taller'} para contarte que tu ${order.brand} ${order.model} ya se encuentra ${st.label}. Podés ver los detalles en tu enlace de seguimiento: ${location.origin}${trackingUrl}`)}" target="_blank" rel="noopener noreferrer">
              💬 Abrir chat manual (wa.me)
            </a>
          </div>
        </div>
      ` : ''}
    </div>
  `);

  if (!d) return;

  const photoGallery = d.querySelector('#order-photo-gallery');
  renderOrderPhotoGallery(order.id, photoGallery);
  const retry = d.querySelector('#retry-photos');
  const updatePending = () => {
    const files = pendingPhotos.get(order.id) || [];
    retry.hidden = !files.length;
    retry.textContent = 'Reintentar pendientes: ' + files.map(f => f.name).join(', ');
  };
  updatePending();
  retry.onclick = async () => {
    retry.disabled = true;
    try { await savePendingPhotos(order.id, []); }
    catch (err) { toast(err.message,true); }
    finally { retry.disabled=false; updatePending(); await renderOrderPhotoGallery(order.id, photoGallery); }
  };
  d.querySelector('#order-photo-input')?.addEventListener('change', async event => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.target.disabled = true;
    try {
      await savePendingPhotos(order.id, files);
      toast(`${files.length} foto(s) guardada(s) en la orden #${order.order_number}`);
      await renderOrderPhotoGallery(order.id, photoGallery);
    } catch (err) {
      toast(err.message, true);
    } finally {
      event.target.value = '';
      event.target.disabled = false;
      updatePending();
    }
  });

  d.querySelector('#btn-modal-send-wa-bot')?.addEventListener('click', async () => {
    const currentSt = d.querySelector('#edit-order-status')?.value || order.status;
    toast('Enviando aviso por WhatsApp... ⏳');
    const msg = `Hola ${clientName}! 👋 Te escribimos de *${currentWorkshop?.name || 'el taller'}* para contarte que tu *${order.brand || ''} ${order.model || 'equipo'}* (Orden #${order.order_number}) ya se encuentra *${STATUS_CONFIG[currentSt]?.label || currentSt}*.\n\n🔍 Podés seguir el estado en vivo acá:\n${location.origin}${trackingUrl}`;
    const res = await sendWaBotMessage(order.client_phone, msg);
    if (res && res.success) {
      toast('✅ ¡Mensaje enviado con éxito al cliente!');
    } else {
      toast('⚠️ Bot no disponible. Podés usar "Abrir chat manual".', true);
    }
  });

  d.querySelector('#order-status-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const newStatus = d.querySelector('#edit-order-status').value;
    try {
      await api(`/api/workshop/${currentSlug}/orders/${order.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus, public_diagnosis: d.querySelector('#public-diagnosis').value })
      });
      order.public_diagnosis = d.querySelector('#public-diagnosis').value;
      order.status = newStatus;
      toast(`Orden #${order.order_number} actualizada a "${STATUS_CONFIG[newStatus]?.label || newStatus}"`);
      d.close();
      renderCurrentSection();

      if (newStatus === 'ready') {
        triggerAutoWhatsApp(order, 'ready');
      } else if (newStatus === 'delivered') {
        triggerAutoWhatsApp(order, 'delivered');
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// 3. Render Clientes
function renderClients() {
  const container = document.querySelector('#clients-container');
  if (!container) return;
  let list = workshopData.clients || [];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(c => (c.name && c.name.toLowerCase().includes(q)) || (c.phone && c.phone.includes(q)));
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <span class="icon-classic">👥</span>
        <div class="icon-pro empty-pro-badge" style="margin:0 auto 12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h3>Sin clientes cargados</h3>
        <p>Agregá tu primer cliente con el botón de arriba.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(c => `
    <div class="client-row">
      <div class="avatar">${esc(clientInitials(c.name))}</div>
      <div>
        <strong>${esc(c.name)}</strong>
        <p class="muted">${esc(c.phone || 'Sin teléfono')}${c.email ? ` · ${esc(c.email)}` : ''}</p>
      </div>
      <button type="button" class="secondary compact" data-client-phone="${esc(c.phone || '')}">
        ${c.order_count ? `${c.order_count} reparaciones` : 'Ficha'}
      </button>
    </div>
  `).join('');
}

// 4. Render Stock
function renderStock() {
  const container = document.querySelector('#stock-container');
  if (!container) return;
  const items = workshopData.stock || [];

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <span class="icon-classic">📦</span>
        <div class="icon-pro empty-pro-badge" style="margin:0 auto 12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>
        </div>
        <h3>Inventario vacío</h3>
        <p>Cargá pantallas, baterías, pines de carga y accesorios para controlar tu stock.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(s => `
    <div class="stock-card">
      <div>
        <strong>${esc(s.name)}</strong>
        <p class="muted">${esc(s.category || 'General')}${s.sku ? ` · SKU: ${esc(s.sku)}` : ''}</p>
      </div>
      <div class="stock-numbers">
        <strong>${s.quantity || 0} u.</strong>
        <span class="muted">${formatMoney(s.price || 0)}</span>
      </div>
    </div>
  `).join('');
}

// 5. Render Caja
function renderCash() {
  const entries = workshopData.cash_entries || [];

  const {income=0, expense=0, mp:mpTotal=0} = workshopData.cash_totals || {};

  setText('#cash-income-total', formatMoney(income));
  setText('#cash-expense-total', formatMoney(expense));
  setText('#cash-mp-total', formatMoney(mpTotal));
  setText('#cash-net-total', formatMoney(income - expense));

  const more = document.querySelector('#cash-more');
  more.hidden = entries.length === 0 || entries.length % 50 !== 0;
  more.onclick = async () => {
    more.disabled = true;
    try {
      const page = await api(`/api/workshop/${currentSlug}/cash/history?offset=${entries.length}`);
      entries.push(...page.entries);
      renderCash();
      more.hidden = page.entries.length < 50;
    } catch(err) { toast(err.message,true); }
    finally { more.disabled = false; }
  };
  const container = document.querySelector('#cash-container');
  if (!container) return;

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <span>💵</span>
        <h3>Sin movimientos de caja</h3>
        <p>Registrá los cobros y egresos diarios de tu mostrador.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = entries.map(e => `
    <div class="cash-row">
      <div>
        <strong>${esc(e.concept || 'Movimiento')}</strong>
        <p class="muted">
          ${new Date(e.created_at).toLocaleDateString('es-AR')} &bull; 
          <span style="text-transform:capitalize;">${esc(e.payment_method || 'Efectivo')}</span> &bull; 
          ${e.type === 'income' ? 'Ingreso' : 'Egreso'}
        </p>
      </div>
      <div class="cash-row-amount">
        <strong style="color:${e.type === 'income' ? '#34d399' : '#f87171'};">
          ${e.type === 'income' ? '+' : '-'}${formatMoney(e.amount)}
        </strong>
      </div>
    </div>
  `).join('');
}

// 6. Render Configuración
function renderSettings() {
  const setVal = (sel, v) => {
    const el = document.querySelector(sel);
    if (el) el.value = v || '';
  };
  setVal('#set-workshop-name', currentWorkshop?.name);
  setVal('#set-workshop-phone', currentWorkshop?.phone);
  setVal('#set-workshop-address', currentWorkshop?.address);
  setVal('#set-workshop-logo-url', currentSettings?.logo_url);

  const country = (currentWorkshop?.country || 'AR').toUpperCase();
  setVal('#set-workshop-country', country);
  setVal('#set-workshop-currency', COUNTRY_CURRENCY[country] || 'ARS');

  const pms = (currentWorkshop?.payment_methods || 'efectivo,mercadopago,transferencia').split(',');
  const setChk = (sel, chk) => {
    const el = document.querySelector(sel);
    if (el) el.checked = chk;
  };
  setChk('#pm-mercadopago', pms.includes('mercadopago'));
  setChk('#pm-efectivo', pms.includes('efectivo'));
  setChk('#pm-transferencia', pms.includes('transferencia'));
  setChk('#pm-tarjeta', pms.includes('tarjeta'));
}

// Modal nuevo equipo
function openNewOrderModal() {
  const clients = workshopData.clients || [];
  const clientOptions = clients.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.phone || 'S/N')})</option>`).join('');

  const d = modal('＋ Ingresar nuevo equipo', `
    <form id="new-intake-form" class="form-grid">
      <label class="wide">Cliente
        <select name="client_id" id="intake-client-select" required>
          <option value="NEW">＋ Crear cliente nuevo en el momento</option>
          ${clientOptions}
        </select>
      </label>

      <div id="new-client-inputs" class="wide" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <label>Nombre y apellido del cliente
          <input name="client_name" required placeholder="Ej: Carlos Gómez">
        </label>
        <label>Teléfono o WhatsApp
          <input name="client_phone" required type="tel" placeholder="Ej: +54 9 11 1234-5678">
        </label>
      </div>

      <label>Marca del celular
        <input name="brand" required placeholder="Samsung, Motorola, Apple, Xiaomi...">
      </label>
      <label>Modelo
        <input name="model" required placeholder="A52, Moto G84, iPhone 11...">
      </label>
      <label class="wide">Falla manifestada por el cliente
        <textarea name="fault" required rows="2" placeholder="Ej: No enciende, cambio de módulo pantalla..."></textarea>
      </label>
      <label class="wide">Estado físico al recibir
        <input name="condition" placeholder="Ej: Rayones en tapa, vidrio astillado...">
      </label>
      <label class="wide">Fotos del equipo al recibir
        <input id="intake-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple>
        <small class="muted">Podés cargar hasta 6 imágenes (máx. 8 MB cada una).</small>
      </label>
      <label class="wide">Accesorios entregados
        <input name="accessories" placeholder="Ej: Con funda y chip, sin cargador">
      </label>
      <label>IMEI o N° de Serie (opcional)
        <input name="identifier" placeholder="15 dígitos">
      </label>
      <label>Medio de cobro preferido
        <select name="payment_method">
          <option value="efectivo">Efectivo</option>
          <option value="mercadopago">Mercado Pago</option>
          <option value="transferencia">Transferencia bancaria</option>
          <option value="tarjeta">Tarjeta</option>
        </select>
      </label>

      <div class="form-actions">
        <button type="submit" class="primary" id="btn-submit-order">Registrar ingreso</button>
      </div>
    </form>
  `);

  if (!d) return;

  const clientSel = d.querySelector('#intake-client-select');
  const newClientBlock = d.querySelector('#new-client-inputs');
  if (clientSel && newClientBlock) {
    clientSel.onchange = () => {
      const isNew = clientSel.value === 'NEW';
      newClientBlock.style.display = isNew ? 'grid' : 'none';
      newClientBlock.querySelectorAll('input').forEach(inp => inp.required = isNew);
    };
  }

  const requestId = crypto.randomUUID();
  d.querySelector('#new-intake-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = d.querySelector('#btn-submit-order');
    if (btn) btn.disabled = true;
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd);
    const intakePhotos = fd.getAll('photos').filter(file => file instanceof File && file.size > 0);
    delete payload.photos;
    payload.request_id = requestId;

    try {
      const res = await api(`/api/workshop/${currentSlug}/orders`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast(`¡Orden #${res.order_number} ingresada con éxito!`);
      if (intakePhotos.length) {
        try {
          await savePendingPhotos(res.id, intakePhotos);
          toast(`Fotos guardadas en la orden #${res.order_number}`);
        } catch (photoErr) {
          toast(`La orden se creó, pero no se pudieron guardar las fotos: ${photoErr.message}`, true);
        }
      }
      d.close();

      let clientPhone = payload.client_phone || '';
      let clientName = payload.client_name || '';
      if (payload.client_id && payload.client_id !== 'NEW') {
        const found = (workshopData.clients || []).find(c => String(c.id) === String(payload.client_id));
        if (found) {
          clientPhone = found.phone || clientPhone;
          clientName = found.name || clientName;
        }
      }

      triggerAutoWhatsApp({
        id: res.id,
        order_number: res.order_number,
        intake_key: res.intake_key,
        brand: payload.brand,
        model: payload.model,
        client_phone: clientPhone,
        client_name: clientName
      }, 'intake');

      await loadWorkshop();
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// Modal nuevo cliente
function openNewClientModal() {
  const d = modal('＋ Registrar nuevo cliente', `
    <form id="new-client-form" class="form-grid">
      <label class="wide">Nombre y apellido
        <input name="name" required placeholder="Ej: Juan Pérez">
      </label>
      <label>Teléfono / WhatsApp
        <input name="phone" required type="tel" placeholder="Ej: +54 9 11 9876-5432">
      </label>
      <label>Correo electrónico (opcional)
        <input name="email" type="email" placeholder="cliente@gmail.com">
      </label>
      <label class="wide">Observaciones / Notas
        <textarea name="notes" rows="2" placeholder="Cliente recomendado, prefiere retiro tarde..."></textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="primary">Guardar cliente</button>
      </div>
    </form>
  `);

  if (!d) return;

  d.querySelector('#new-client-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/api/workshop/${currentSlug}/clients`, {
        method: 'POST', body: JSON.stringify(Object.fromEntries(fd))
      });
      toast('Cliente guardado con éxito');
      d.close();
      await loadWorkshop();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// Modal nuevo movimiento de caja
function openNewCashModal() {
  const d = modal('＋ Nuevo movimiento de caja', `
    <form id="new-cash-form" class="form-grid">
      <label>Tipo de movimiento
        <select name="type">
          <option value="income">Ingreso (Cobro / Seña / Venta)</option>
          <option value="expense">Egreso (Gasto / Pago repuesto)</option>
        </select>
      </label>
      <label>Importe ($)
        <input name="amount" type="number" step="0.01" min="1" required placeholder="Ej: 15000">
      </label>
      <label>Medio de pago
        <select name="payment_method">
          <option value="efectivo">💵 Efectivo</option>
          <option value="mercadopago">⚡ Mercado Pago</option>
          <option value="transferencia">🏦 Transferencia</option>
          <option value="tarjeta">💳 Tarjeta</option>
        </select>
      </label>
      <label>Concepto o descripción
        <input name="concept" required placeholder="Ej: Cobro pantalla Motorola G84">
      </label>
      <div class="form-actions wide">
        <button type="submit" class="primary">Registrar movimiento</button>
      </div>
    </form>
  `);

  if (!d) return;

  d.querySelector('#new-cash-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/api/workshop/${currentSlug}/cash`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(fd))
      });
      toast('Movimiento registrado');
      d.close();
      await loadWorkshop();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// Modal de soporte y reporte
function openSupportModal() {
  const appName = currentWorkshop?.name || 'Tu Taller Soft';
  const text = `Hola Matías! Me comunico desde el taller "${appName}" (${location.origin}/t/${currentSlug}) para hacer una consulta técnica: `;
  const wa = `https://wa.me/5491178200237?text=${encodeURIComponent(text)}`;
  const mail = `mailto:soporte@tutallersoft.com?subject=${encodeURIComponent('Soporte · ' + appName)}&body=${encodeURIComponent(text)}`;

  modal('Reportar un problema o pedir soporte', `
    <p class="muted">Estamos a tu disposición para ayudarte con cualquier duda técnica o mejora que necesites en tu sistema.</p>
    <div class="support-actions">
      <a class="primary support-btn" href="${wa}" target="_blank" rel="noopener noreferrer">💬 Enviar WhatsApp a Matías</a>
      <a class="secondary support-btn" href="${mail}">✉ Enviar correo electrónico</a>
    </div>
  `);
}

// Inicialización de eventos del shell
function initEvents() {
  // Navegación Sidebar y Mobile Bottom Nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => setSection(btn.dataset.section));
  });

  // Buscador
  const searchInput = document.querySelector('#search-input');
  searchInput?.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    if (activeSection === 'home') setSection('orders');
    else renderCurrentSection();
  });

  // Filtro de órdenes
  document.querySelector('#filter-order-status')?.addEventListener('change', e => {
    orderStatusFilter = e.target.value;
    renderOrders();
  });

  // Botones de acción rápida con optional chaining
  document.querySelector('#btn-quick-new-order')?.addEventListener('click', openNewOrderModal);
  document.querySelector('#btn-orders-new-order')?.addEventListener('click', openNewOrderModal);
  document.querySelector('#btn-quick-client')?.addEventListener('click', openNewClientModal);
  document.querySelector('#btn-clients-new')?.addEventListener('click', openNewClientModal);
  document.querySelector('#btn-quick-orders')?.addEventListener('click', () => setSection('orders'));
  document.querySelector('#link-goto-orders')?.addEventListener('click', () => setSection('orders'));

  // Tarjetas KPI como filtros directos
  document.querySelector('#kpi-active-btn')?.addEventListener('click', () => { orderStatusFilter = 'in_progress'; setSection('orders'); });
  document.querySelector('#kpi-ready-btn')?.addEventListener('click', () => { orderStatusFilter = 'ready'; setSection('orders'); });
  document.querySelector('#kpi-parts-btn')?.addEventListener('click', () => { orderStatusFilter = 'waiting_parts'; setSection('orders'); });
  document.querySelector('#kpi-clients-btn')?.addEventListener('click', () => setSection('clients'));

  // Tarjetas "Para revisar hoy"
  document.querySelector('#card-pending-repairs')?.addEventListener('click', () => { orderStatusFilter = 'in_progress'; setSection('orders'); });
  document.querySelector('#card-pending-ready')?.addEventListener('click', () => { orderStatusFilter = 'ready'; setSection('orders'); });
  document.querySelector('#card-pending-parts')?.addEventListener('click', () => { orderStatusFilter = 'waiting_parts'; setSection('orders'); });
  document.querySelector('#card-pending-debts')?.addEventListener('click', () => setSection('cash'));

  // Recargar y Ajustes
  document.querySelector('#btn-reload')?.addEventListener('click', () => { toast('Actualizando datos...'); loadWorkshop(); });
  document.querySelector('#btn-settings-header')?.addEventListener('click', () => setSection('settings'));
  document.querySelector('#brand-box')?.addEventListener('click', () => setSection('settings'));
  document.querySelector('#btn-report-issue')?.addEventListener('click', openSupportModal);
  document.querySelector('#btn-cash-new')?.addEventListener('click', openNewCashModal);

  // Onboarding Form (País y Pagos)
  const onbForm = document.querySelector('#onboarding-form');
  const onbModal = document.querySelector('#onboarding-modal');
  document.querySelector('#close-onboarding-btn')?.addEventListener('click', () => onbModal?.close?.());

  onbForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const country = document.querySelector('#onb-country')?.value || 'AR';
    const pms = Array.from(document.querySelectorAll('input[name="pm_onb"]:checked')).map(cb => cb.value).join(',');

    try {
      await api(`/api/workshop/${currentSlug}/onboarding`, {
        method: 'POST',
        body: JSON.stringify({ country, payment_methods: pms })
      });
      toast('¡Configuración de país y medios de pago guardada!');
      onbModal?.close?.();
      await loadWorkshop();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Guardar datos de marca
  document.querySelector('#form-settings-brand')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api(`/api/workshop/${currentSlug}/brand`, {method:'PUT', body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
      await loadWorkshop();
      toast('Datos de marca guardados');
    } catch (err) { toast(err.message, true); }
  });

  // Guardar medios de pago desde Configuración
  document.querySelector('#form-settings-payments')?.addEventListener('submit', async e => {
    e.preventDefault();
    const country = document.querySelector('#set-workshop-country')?.value || 'AR';
    const pms = Array.from(document.querySelectorAll('input[name="pm"]:checked')).map(cb => cb.value).join(',');

    try {
      await api(`/api/workshop/${currentSlug}/onboarding`, {
        method: 'POST',
        body: JSON.stringify({ country, payment_methods: pms })
      });
      toast('Medios de pago y país actualizados');
      await loadWorkshop();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Importar Demo JSON
  const importInput = document.querySelector('#import-json-file');
  document.querySelector('#btn-import-demo-modal')?.addEventListener('click', () => {
    if (importInput) {
      importInput.value = '';
      importInput.click();
    }
  });

  importInput?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const orders = parsed.repair_orders || parsed.orders || [];
      const clients = parsed.clients || [];

      if (!orders.length && !clients.length) {
        throw new Error('El archivo no contiene clientes ni órdenes válidas.');
      }

      const res = await api(`/api/workshop/${currentSlug}/import-demo`, {
        method: 'POST',
        body: JSON.stringify({ clients, orders })
      });

      toast(`¡Importación exitosa! Se cargaron ${res.imported_orders} órdenes y ${res.imported_clients} clientes.`);
      await loadWorkshop();
      setSection('home');
    } catch (err) {
      toast(`Error al importar copia: ${err.message}`, true);
    }
  });
}

let pendingAuthEmail = '';

function setupWorkshopAuthListeners() {
  const formRequestPin = document.querySelector('#form-request-pin');
  const formVerifyPin = document.querySelector('#form-verify-pin');
  const btnBackToEmail = document.querySelector('#btn-back-to-email');
  const btnResendPin = document.querySelector('#btn-resend-pin');
  const logoutSidebar = document.querySelector('#btn-logout-sidebar');
  const logoutHeader = document.querySelector('#btn-logout-header');

  if (formRequestPin) {
    formRequestPin.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.querySelector('#btn-request-pin');
      const errEl = document.querySelector('#login-email-error');
      const emailInput = document.querySelector('#input-login-email');
      
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Enviando código... ⏳';

      const email = emailInput.value.trim().toLowerCase();
      try {
        const res = await fetch(`/api/workshop/${currentSlug}/auth/request-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No pudimos enviar el código');

        pendingAuthEmail = email;
        setText('#login-target-email-display', email);
        document.querySelector('#login-step-email').style.display = 'none';
        document.querySelector('#login-step-pin').style.display = 'block';

        const devBanner = document.querySelector('#login-dev-banner');
        if (data.dev_pin && devBanner) {
          devBanner.innerHTML = `<strong>Modo de prueba (sin Resend):</strong> Tu código es <strong style="font-size:16px;color:#10b981;">${data.dev_pin}</strong>`;
          devBanner.style.display = 'block';
        } else if (devBanner) {
          devBanner.style.display = 'none';
        }

        const pinInput = document.querySelector('#input-login-pin');
        if (pinInput) {
          pinInput.value = '';
          pinInput.focus();
        }
        toast('¡Código enviado a tu casilla de correo!');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar Código de Acceso ✉';
      }
    });
  }

  if (formVerifyPin) {
    formVerifyPin.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.querySelector('#btn-verify-pin');
      const errEl = document.querySelector('#login-pin-error');
      const pinInput = document.querySelector('#input-login-pin');

      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Verificando... ⏳';

      const code = pinInput.value.trim();
      try {
        const res = await fetch(`/api/workshop/${currentSlug}/auth/verify-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: pendingAuthEmail, code })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Código incorrecto');

        setWorkshopToken(data.token);
        toast(`¡Bienvenido al taller!`);
        showWorkshopApp();
        await loadWorkshop();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Ingresar al Taller 🚀';
      }
    });

    const pinInput = document.querySelector('#input-login-pin');
    pinInput?.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      if (e.target.value.length === 6) {
        formVerifyPin.requestSubmit();
      }
    });
  }

  btnBackToEmail?.addEventListener('click', () => {
    document.querySelector('#login-step-pin').style.display = 'none';
    document.querySelector('#login-step-email').style.display = 'block';
  });

  btnResendPin?.addEventListener('click', async () => {
    if (!pendingAuthEmail) return;
    toast('Reenviando código...');
    try {
      const res = await fetch(`/api/workshop/${currentSlug}/auth/request-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingAuthEmail })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('¡Nuevo código enviado!');
        const devBanner = document.querySelector('#login-dev-banner');
        if (data.dev_pin && devBanner) {
          devBanner.innerHTML = `<strong>Modo de prueba (sin Resend):</strong> Tu código es <strong style="font-size:16px;color:#10b981;">${data.dev_pin}</strong>`;
        }
      } else {
        toast(data.error || 'Error al reenviar', true);
      }
    } catch {
      toast('Error de conexión', true);
    }
  });

  async function handleLogout() {
    try {
      await api(`/api/workshop/${currentSlug}/auth/logout`, { method: 'POST' }).catch(() => {});
    } finally {
      clearWorkshopToken();
      showWorkshopLogin();
      toast('Sesión cerrada.');
    }
  }

  logoutSidebar?.addEventListener('click', handleLogout);
  logoutHeader?.addEventListener('click', handleLogout);
}

// Conmutador de Interfaz (Clásica vs Moderna Pro)
function setupUISwitcher() {
  const btn = document.querySelector('#btn-toggle-ui');
  const iconEl = document.querySelector('#ui-switch-icon');
  const labelEl = document.querySelector('#ui-switch-label');

  function applyUIMode(mode) {
    if (mode === 'pro') {
      document.documentElement.setAttribute('data-ui', 'pro');
      if (iconEl) iconEl.textContent = '✨';
      if (labelEl) labelEl.textContent = 'Vista: Pro';
    } else {
      document.documentElement.removeAttribute('data-ui');
      if (iconEl) iconEl.textContent = '🎨';
      if (labelEl) labelEl.textContent = 'Vista: Clásica';
    }
  }

  // Cargar preferencia guardada (por defecto 'pro' o 'classic' según elección)
  const savedMode = localStorage.getItem('tutaller_ui_mode') || 'classic';
  applyUIMode(savedMode);

  btn?.addEventListener('click', () => {
    const isPro = document.documentElement.getAttribute('data-ui') === 'pro';
    const nextMode = isPro ? 'classic' : 'pro';
    localStorage.setItem('tutaller_ui_mode', nextMode);
    applyUIMode(nextMode);
    toast(nextMode === 'pro' ? '✨ Interfaz Moderna Pro activada' : '🎨 Interfaz Clásica activada');
  });
}

// Iniciar aplicación al cargar el DOM con soporte para carga diferida o asíncrona
function bootApp() {
  setupUISwitcher();
  initEvents();
  setupWorkshopAuthListeners();
  loadWorkshop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}

