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

function enableDialogBackdropClose(dlg) {
  if (!dlg || dlg.dataset.backdropCloseBound) return;
  dlg.dataset.backdropCloseBound = '1';
  const isOutsideDialog = e => {
    if (e.target !== dlg) return false;
    const rect = dlg.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };
  let startedOutside = false;
  dlg.addEventListener('pointerdown', e => {
    startedOutside = isOutsideDialog(e);
  });
  dlg.addEventListener('click', e => {
    if (startedOutside && isOutsideDialog(e)) {
      dlg.close();
    }
    startedOutside = false;
  });
}

function modal(title, content) {
  const d = document.querySelector('#app-modal');
  if (!d) return null;
  enableDialogBackdropClose(d);
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

  enableDialogBackdropClose(dlg);
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

function isBotEnabledForWorkshop() {
  return currentSlug === 'repara-tu-celu';
}

async function sendWaBotMessage(phone, message) {
  if (!isBotEnabledForWorkshop()) return null;
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
  if (!isBotEnabledForWorkshop()) return;
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
    const total = Number(order.total_cost || 0);
    const paid = Number(order.paid_cents || 0) / 100;
    const saldo = Math.max(0, total - paid);
    let financeLine = '';
    if (total > 0 && paid > 0 && saldo > 0) {
      financeLine = `\n💰 *Total:* ${formatMoney(total)}\n💵 *Seña / abonado:* ${formatMoney(paid)}\n📌 *Saldo restante al retirar:* ${formatMoney(saldo)}`;
    } else if (total > 0 && paid >= total) {
      financeLine = `\n💰 *Total:* ${formatMoney(total)} (Ya abonado)`;
    } else if (total > 0) {
      financeLine = `\n💰 *Total a abonar al retirar:* ${formatMoney(total)}`;
    } else if (paid > 0) {
      financeLine = `\n💵 *Seña / abonado:* ${formatMoney(paid)}`;
    }
    text = `Hola ${clientName}! 🔔 Te avisamos de *${workshopName}* que tu *${order.brand || ''} ${order.model || 'equipo'}* (Orden #${order.order_number}) ya está *LISTO PARA RETIRAR*.${financeLine}\n\n📍 Podés pasar a retirarlo por nuestro local.\n🔍 Ver comprobante de entrega:\n${trackingUrl}`;
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
      cash_entries: dataRes.cash_entries || [],
      purchase_needs: dataRes.purchase_needs || []
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
          cash_entries: dataRes.cash_entries || [],
          purchase_needs: dataRes.purchase_needs || []
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

function formatWaMePhone(phone) {
  let clean = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!clean) return '';
  if (clean.length === 10) clean = '549' + clean;
  else if (clean.length === 11 && clean.startsWith('9')) clean = '54' + clean;
  else if (clean.startsWith('54') && !clean.startsWith('549') && clean.length === 12) clean = '549' + clean.slice(2);
  return clean;
}

function orderCardHtml(order) {
  const st = STATUS_CONFIG[order.status] || { label: order.status, class: 'repairing' };
  const clientName = order.client_name || 'Cliente sin asignar';
  const clientPhone = order.client_phone ? ` · ${esc(order.client_phone)}` : '';
  const trackingUrl = `/seguimiento/${order.intake_key || order.id}`;
  const fullTrackingUrl = `${location.origin}${trackingUrl}`;
  const waPhone = formatWaMePhone(order.client_phone);
  const waTrackingHref = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hola ${clientName}! Te compartimos el enlace de seguimiento de tu ${order.brand || ''} ${order.model || 'equipo'} (Orden #${order.order_number}) en ${currentWorkshop?.name || 'el taller'} (estado: ${st.label}):\n${fullTrackingUrl}`)}`
    : trackingUrl;
  const total = Number(order.total_cost || 0);
  const paid = Number(order.paid_cents || 0) / 100;
  const saldo = Math.max(0, total - paid);
  const initials = clientInitials(clientName);
  let financeBadgeHtml = '';
  if (total > 0 && paid >= total) {
    financeBadgeHtml = `<span class="order-finance-badge" style="background:rgba(16,185,129,0.16);color:#34d399;border:1px solid rgba(16,185,129,0.35);">✓ Pagado (${formatMoney(total)})</span>`;
  } else if (paid > 0 && saldo > 0) {
    financeBadgeHtml = `<span class="order-finance-badge has-debt">Saldo: ${formatMoney(saldo)}</span>`;
  } else if (total > 0) {
    financeBadgeHtml = `<span class="order-finance-badge" style="background:rgba(16,185,129,0.12);color:#34d399;border:1px solid rgba(16,185,129,0.28);">Presup.: ${formatMoney(total)}</span>`;
  } else if (paid > 0) {
    financeBadgeHtml = `<span class="order-finance-badge" style="background:rgba(16,185,129,0.14);color:#34d399;border:1px solid rgba(16,185,129,0.3);">Abonado: ${formatMoney(paid)}</span>`;
  }

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
        ${waPhone ? `
          <a class="order-action-icon btn-wa-action" href="https://wa.me/${waPhone}?text=${encodeURIComponent(`Hola ${clientName}, te escribimos de ${currentWorkshop?.name || 'el taller'} sobre tu orden #${order.order_number} (${order.brand} ${order.model}): estado actual: ${st.label}.`)}" target="_blank" rel="noopener noreferrer" title="Enviar WhatsApp al cliente">
            <span class="wa-pro-content">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              <span>WhatsApp</span>
            </span>
          </a>
        ` : ''}
        <a class="order-action-icon btn-qr-action" href="${waTrackingHref}" target="_blank" rel="noopener noreferrer" title="${waPhone ? 'Enviar enlace de seguimiento por WhatsApp' : 'Ver comprobante y QR de seguimiento'}">
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

      <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <label style="margin:0;">Presupuesto e importe</label>
          ${(Number(order.total_cost || 0) > 0 || Number(order.paid_cents || 0) > 0) ? `
            <span class="muted" style="font-size:12.5px;">
              Abonado: <strong style="color:#34d399;">${formatMoney(Number(order.paid_cents || 0) / 100)}</strong>
              ${Number(order.total_cost || 0) > 0 ? ` · Saldo: <strong style="color:${Math.max(0, Number(order.total_cost || 0) - Number(order.paid_cents || 0) / 100) > 0 ? '#fbbf24' : '#34d399'};">${formatMoney(Math.max(0, Number(order.total_cost || 0) - Number(order.paid_cents || 0) / 100))}</strong>` : ''}
            </span>
          ` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <input type="text" id="quote-detail" placeholder="Trabajo / repuesto (ej: Cambio de módulo)" value="${esc(order.quote_detail || order.public_diagnosis || order.fault || '')}" style="grid-column:1 / -1;">
          <input type="number" id="quote-amount" min="0" step="any" placeholder="Importe total ($)" value="${Number(order.total_cost || 0) > 0 ? Number(order.total_cost) : ''}">
          <input type="text" id="quote-eta" placeholder="Demora (ej: En el día)" value="${esc(order.quote_eta || '')}">
          <input type="text" id="quote-warranty" placeholder="Garantía (ej: 30 días)" value="${esc(order.quote_warranty || '')}" style="grid-column:1 / -1;">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button type="button" class="primary compact" id="btn-save-quote">💾 Guardar importe</button>
          <button type="button" class="primary compact" id="btn-order-charge" style="background:#059669;">💵 Cobrar</button>
          <button type="button" class="secondary compact" id="btn-order-need-part">🛒 Faltante</button>
          <button type="button" class="secondary compact" id="btn-order-use-stock">📦 Usar stock</button>
          ${order.client_phone ? `
            <button type="button" class="secondary compact" id="btn-send-quote-wa">💬 Enviar (wa.me)</button>
            ${isBotEnabledForWorkshop() ? `<button type="button" class="secondary compact" id="btn-send-quote-bot">🤖 Enviar con Bot QR</button>` : ''}
          ` : ''}
          <button type="button" class="secondary compact" id="btn-quote-png">🖼 Imagen (PNG)</button>
          <button type="button" class="secondary compact" id="btn-quote-pdf">📄 PDF / Imprimir</button>
        </div>
      </div>

      ${order.client_phone ? `
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
          <label>Aviso rápido por WhatsApp</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            ${isBotEnabledForWorkshop() ? `
              <button type="button" class="primary compact" id="btn-modal-send-wa-bot" style="display:flex;align-items:center;gap:6px;">
                🤖 Enviar aviso automático (Bot QR)
              </button>
            ` : ''}
            <a class="${isBotEnabledForWorkshop() ? 'secondary' : 'primary'} compact" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;" href="https://wa.me/${formatWaMePhone(order.client_phone)}?text=${encodeURIComponent(`Hola ${clientName}! Te escribimos de ${currentWorkshop?.name || 'el taller'} para contarte que tu ${order.brand} ${order.model} ya se encuentra ${st.label}. Podés ver los detalles en tu enlace de seguimiento: ${location.origin}${trackingUrl}`)}" target="_blank" rel="noopener noreferrer">
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

  const getQuoteData = () => {
    const detail = (d.querySelector('#quote-detail')?.value || '').trim();
    const rawAmount = d.querySelector('#quote-amount')?.value;
    const amountNum = Number(rawAmount);
    const eta = (d.querySelector('#quote-eta')?.value || '').trim();
    const warranty = (d.querySelector('#quote-warranty')?.value || '').trim();
    if (!detail && !(amountNum > 0)) {
      toast('Ingresá al menos el trabajo o el importe del presupuesto', true);
      return null;
    }
    return {
      detail,
      amountNum,
      amountText: amountNum > 0 ? formatMoney(amountNum) : 'A confirmar',
      eta,
      warranty,
      workshopName: currentWorkshop?.name || 'Tu Taller',
      workshopPhone: currentWorkshop?.phone || '',
      workshopAddress: currentWorkshop?.address || '',
      logoUrl: currentSettings?.logo_url || currentWorkshop?.logo_url || '/logo.png',
      clientName,
      clientPhone: order.client_phone || '',
      device: `${order.brand || ''} ${order.model || ''}`.trim() || 'Equipo',
      orderNumber: order.order_number,
      fullTrackingUrl: `${location.origin}${trackingUrl}`
    };
  };

  const buildQuoteMessage = () => {
    const q = getQuoteData();
    if (!q) return null;
    const lines = [
      `Hola ${q.clientName}! Te pasamos el presupuesto para tu ${q.device} (Orden #${q.orderNumber}) en ${q.workshopName}:`,
      ''
    ];
    if (q.detail) lines.push(`*Trabajo:* ${q.detail}`);
    if (q.amountNum > 0) lines.push(`*Total:* ${q.amountText}`);
    if (q.eta) lines.push(`*Demora estimada:* ${q.eta}`);
    if (q.warranty) lines.push(`*Garantía:* ${q.warranty}`);
    lines.push('', `Seguimiento de tu orden:\n${q.fullTrackingUrl}`, '', '¿Confirmás para avanzar con la reparación?');
    return lines.join('\n');
  };

  const saveOrderQuote = async (silent = false) => {
    const detail = (d.querySelector('#quote-detail')?.value || '').trim();
    const rawAmount = d.querySelector('#quote-amount')?.value;
    const amountNum = rawAmount === '' || rawAmount == null ? 0 : Number(rawAmount);
    const eta = (d.querySelector('#quote-eta')?.value || '').trim();
    const warranty = (d.querySelector('#quote-warranty')?.value || '').trim();

    if (!Number.isFinite(amountNum) || amountNum < 0) {
      if (!silent) toast('Ingresá un importe válido', true);
      return false;
    }

    const res = await api(`/api/workshop/${currentSlug}/orders/${order.id}/quote`, {
      method: 'PUT',
      body: JSON.stringify({
        total_cost: amountNum,
        quote_detail: detail,
        quote_eta: eta,
        quote_warranty: warranty
      })
    });

    order.total_cost = res.total_cost ?? amountNum;
    order.quote_detail = res.quote_detail ?? detail;
    order.quote_eta = res.quote_eta ?? eta;
    order.quote_warranty = res.quote_warranty ?? warranty;
    renderCurrentSection();
    if (!silent) toast('Importe y presupuesto guardados');
    return true;
  };

  const saveQuoteBtn = d.querySelector('#btn-save-quote');
  saveQuoteBtn?.addEventListener('click', async () => {
    saveQuoteBtn.disabled = true;
    try {
      await saveOrderQuote(false);
    } catch (err) {
      toast(err.message || 'No se pudo guardar el importe', true);
    } finally {
      saveQuoteBtn.disabled = false;
    }
  });

  d.querySelector('#btn-order-charge')?.addEventListener('click', async () => {
    const rawAmt = Number(d.querySelector('#quote-amount')?.value || 0);
    if (rawAmt > 0 && rawAmt !== Number(order.total_cost || 0)) {
      try { await saveOrderQuote(true); } catch (e) {}
    }
    openNewCashModal(order);
  });

  d.querySelector('#btn-order-need-part')?.addEventListener('click', () => {
    openNewStockModal({ presetOrder: order, forceMode: 'purchase' });
  });

  d.querySelector('#btn-order-use-stock')?.addEventListener('click', () => {
    openNewStockModal({ presetOrder: order, forceMode: 'stock' });
  });

  d.querySelector('#btn-send-quote-wa')?.addEventListener('click', () => {
    const msg = buildQuoteMessage();
    if (!msg) return;
    saveOrderQuote(true).catch(() => {});
    const waPhone = formatWaMePhone(order.client_phone);
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  });

  d.querySelector('#btn-send-quote-bot')?.addEventListener('click', async () => {
    const msg = buildQuoteMessage();
    if (!msg) return;
    saveOrderQuote(true).catch(() => {});
    toast('Enviando presupuesto por WhatsApp... ⏳');
    const res = await sendWaBotMessage(order.client_phone, msg);
    if (res && res.success) {
      toast('✅ ¡Presupuesto enviado al cliente!');
    } else {
      toast('⚠️ Bot no disponible. Usá "Enviar presupuesto (wa.me)".', true);
    }
  });

  d.querySelector('#btn-quote-png')?.addEventListener('click', async () => {
    const q = getQuoteData();
    if (!q) return;
    saveOrderQuote(true).catch(() => {});
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 980;
      const ctx = canvas.getContext('2d');

      const rrect = (x, y, w, h, r) => {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
      };

      // Fondo general suave
      ctx.fillStyle = '#eef2f6';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Tarjeta principal
      ctx.fillStyle = '#ffffff';
      rrect(36, 32, 888, 916, 20);
      ctx.fill();
      ctx.strokeStyle = '#dbe3ec';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Header con degradado verde esmeralda
      ctx.save();
      rrect(36, 32, 888, 164, [20, 20, 0, 0]);
      ctx.clip();
      const grad = ctx.createLinearGradient(36, 32, 924, 196);
      grad.addColorStop(0, '#047857');
      grad.addColorStop(1, '#064e3b');
      ctx.fillStyle = grad;
      ctx.fillRect(36, 32, 888, 164);
      ctx.restore();

      // Logo en header
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = q.logoUrl;
        });
        ctx.save();
        rrect(68, 66, 96, 96, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
        ctx.clip();
        ctx.drawImage(img, 68, 66, 96, 96);
        ctx.restore();
      } catch {}

      // Datos del taller (izquierda)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
      ctx.fillText(q.workshopName, 184, 102);
      ctx.fillStyle = '#a7f3d0';
      ctx.font = '19px system-ui, -apple-system, sans-serif';
      ctx.fillText([q.workshopPhone, q.workshopAddress].filter(Boolean).join('  ·  ') || 'Servicio Técnico Especializado', 184, 136);

      // Badge Orden y Fecha (derecha)
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      rrect(666, 62, 226, 104, 14);
      ctx.fill();
      ctx.textAlign = 'right';
      ctx.fillStyle = '#a7f3d0';
      ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
      ctx.fillText('PRESUPUESTO', 872, 90);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(`Orden #${q.orderNumber}`, 872, 124);
      ctx.fillStyle = '#d1fae5';
      ctx.font = '15px system-ui, -apple-system, sans-serif';
      ctx.fillText(new Date().toLocaleDateString('es-AR'), 872, 150);
      ctx.textAlign = 'left';

      // Tarjetas Cliente y Equipo (2 columnas)
      const drawInfoCard = (x, y, w, h, label, title, sub = '') => {
        ctx.fillStyle = '#f8fafc';
        rrect(x, y, w, h, 14);
        ctx.fill();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
        ctx.fillText(label, x + 22, y + 30);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 23px system-ui, -apple-system, sans-serif';
        ctx.fillText(title, x + 22, y + 62);
        if (sub) {
          ctx.fillStyle = '#475569';
          ctx.font = '18px system-ui, -apple-system, sans-serif';
          ctx.fillText(sub, x + 22, y + 90);
        }
      };

      drawInfoCard(68, 228, 400, 112, 'CLIENTE', q.clientName, q.clientPhone || 'Sin teléfono');
      drawInfoCard(492, 228, 400, 112, 'EQUIPO', q.device, `Orden #${q.orderNumber}`);

      // Bloque Trabajo / Detalle
      ctx.fillStyle = '#f8fafc';
      rrect(68, 364, 824, 176, 14);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.stroke();
      ctx.fillStyle = '#10b981';
      rrect(68, 364, 6, 176, [14, 0, 0, 14]);
      ctx.fill();

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
      ctx.fillText('TRABAJO / DETALLE DEL PRESUPUESTO', 94, 396);
      ctx.fillStyle = '#0f172a';
      ctx.font = '22px system-ui, -apple-system, sans-serif';
      const words = String(q.detail || 'Diagnóstico y reparación').split(' ');
      let line = '';
      let ly = 434;
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > 770) {
          ctx.fillText(line, 94, ly);
          ly += 32;
          line = w;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, 94, ly);

      // Demora y Garantía (2 columnas)
      let nextY = 564;
      if (q.eta || q.warranty) {
        if (q.eta && q.warranty) {
          drawInfoCard(68, nextY, 400, 88, 'DEMORA ESTIMADA', q.eta);
          drawInfoCard(492, nextY, 400, 88, 'GARANTÍA', q.warranty);
        } else if (q.eta) {
          drawInfoCard(68, nextY, 824, 88, 'DEMORA ESTIMADA', q.eta);
        } else {
          drawInfoCard(68, nextY, 824, 88, 'GARANTÍA', q.warranty);
        }
        nextY += 112;
      }

      // Barra Total destacada
      const totalY = Math.max(nextY + 8, 692);
      ctx.fillStyle = '#ecfdf5';
      rrect(68, totalY, 824, 112, 16);
      ctx.fill();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#065f46';
      ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
      ctx.fillText('TOTAL PRESUPUESTADO', 98, totalY + 44);
      ctx.fillStyle = '#047857';
      ctx.font = '16px system-ui, -apple-system, sans-serif';
      ctx.fillText('Confirmar para iniciar la reparación', 98, totalY + 74);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#064e3b';
      ctx.font = 'bold 46px system-ui, -apple-system, sans-serif';
      ctx.fillText(q.amountText, 862, totalY + 72);
      ctx.textAlign = 'left';

      // Pie
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(68, 860);
      ctx.lineTo(892, 860);
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.font = '16px system-ui, -apple-system, sans-serif';
      ctx.fillText(`Seguimiento online: ${q.fullTrackingUrl}`, 68, 898);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
      ctx.fillText('TuTaller Soft', 892, 898);
      ctx.textAlign = 'left';

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('No se pudo generar la imagen');
      const fileName = `presupuesto-orden-${q.orderNumber}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Presupuesto Orden #${q.orderNumber}` });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('🖼 Imagen del presupuesto descargada');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') toast(`Error generando imagen: ${err.message}`, true);
    }
  });

  d.querySelector('#btn-quote-pdf')?.addEventListener('click', () => {
    const q = getQuoteData();
    if (!q) return;
    saveOrderQuote(true).catch(() => {});
    const win = window.open('', '_blank', 'width=860,height=920');
    if (!win) {
      toast('Habilitá las ventanas emergentes para generar el PDF', true);
      return;
    }
    const todayStr = new Date().toLocaleDateString('es-AR');
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Presupuesto Orden #${q.orderNumber}</title>
      <style>
        *{box-sizing:border-box;}
        body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#eef2f6;color:#0f172a;padding:28px 18px;}
        .sheet{max-width:740px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #dbe3ec;box-shadow:0 18px 40px rgba(15,23,42,0.08);}
        .hdr{background:linear-gradient(135deg,#047857 0%,#064e3b 100%);color:#fff;padding:26px 30px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;}
        .hdr-left{display:flex;align-items:center;gap:16px;}
        .hdr img{width:64px;height:64px;object-fit:contain;border-radius:14px;background:rgba(255,255,255,0.14);padding:5px;}
        .hdr h1{margin:0;font-size:23px;letter-spacing:-0.01em;}
        .hdr p{margin:4px 0 0;color:#a7f3d0;font-size:13.5px;}
        .hdr-badge{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.22);border-radius:12px;padding:10px 16px;text-align:right;}
        .hdr-badge .tag{font-size:11px;font-weight:700;letter-spacing:1px;color:#a7f3d0;text-transform:uppercase;}
        .hdr-badge .ord{font-size:20px;font-weight:800;margin-top:2px;}
        .hdr-badge .dt{font-size:12px;color:#d1fae5;margin-top:2px;}
        .body{padding:26px 30px;}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
        .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;}
        .card.accent{border-left:4px solid #10b981;margin-bottom:14px;}
        .lbl{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;}
        .val{font-size:16px;font-weight:700;color:#0f172a;margin-top:4px;line-height:1.4;}
        .sub{font-size:13.5px;color:#475569;margin-top:2px;}
        .total{background:#ecfdf5;border:1.5px solid #10b981;border-radius:14px;padding:18px 22px;margin-top:18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
        .total .t-lbl{font-size:12px;font-weight:800;color:#065f46;text-transform:uppercase;letter-spacing:.6px;}
        .total .t-sub{font-size:13px;color:#047857;margin-top:3px;}
        .total strong{font-size:32px;font-weight:900;color:#064e3b;letter-spacing:-0.02em;}
        .ftr{margin-top:22px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12.5px;color:#64748b;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;}
        @media (max-width:560px){.grid-2{grid-template-columns:1fr;}.hdr-badge{text-align:left;}}
        @media print{body{background:#fff;padding:0;}.sheet{border:none;box-shadow:none;}}
      </style></head><body>
      <div class="sheet">
        <div class="hdr">
          <div class="hdr-left">
            <img src="${esc(q.logoUrl)}" alt="Logo">
            <div>
              <h1>${esc(q.workshopName)}</h1>
              <p>${esc([q.workshopPhone, q.workshopAddress].filter(Boolean).join(' · ') || 'Servicio Técnico Especializado')}</p>
            </div>
          </div>
          <div class="hdr-badge">
            <div class="tag">Presupuesto</div>
            <div class="ord">Orden #${q.orderNumber}</div>
            <div class="dt">${todayStr}</div>
          </div>
        </div>
        <div class="body">
          <div class="grid-2">
            <div class="card">
              <div class="lbl">Cliente</div>
              <div class="val">${esc(q.clientName)}</div>
              <div class="sub">${esc(q.clientPhone || 'Sin teléfono')}</div>
            </div>
            <div class="card">
              <div class="lbl">Equipo</div>
              <div class="val">${esc(q.device)}</div>
              <div class="sub">Orden #${q.orderNumber}</div>
            </div>
          </div>
          <div class="card accent">
            <div class="lbl">Trabajo / Detalle del presupuesto</div>
            <div class="val" style="font-weight:500;">${esc(q.detail || 'Diagnóstico y reparación')}</div>
          </div>
          ${(q.eta || q.warranty) ? `
            <div class="grid-2">
              ${q.eta ? `<div class="card"><div class="lbl">Demora estimada</div><div class="val">${esc(q.eta)}</div></div>` : ''}
              ${q.warranty ? `<div class="card"><div class="lbl">Garantía</div><div class="val">${esc(q.warranty)}</div></div>` : ''}
            </div>
          ` : ''}
          <div class="total">
            <div>
              <div class="t-lbl">Total presupuestado</div>
              <div class="t-sub">Confirmar para iniciar la reparación</div>
            </div>
            <strong>${esc(q.amountText)}</strong>
          </div>
          <div class="ftr">
            <span>Seguimiento online: ${esc(q.fullTrackingUrl)}</span>
            <strong style="color:#94a3b8;">TuTaller Soft</strong>
          </div>
        </div>
      </div>
      <script>window.onload=()=>{setTimeout(()=>window.print(),250);};</script></body></html>`);
    win.document.close();
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
        const latestOrder = (workshopData.orders || []).find(o => String(o.id) === String(order.id)) || order;
        const typedAmount = Number(d.querySelector('#quote-amount')?.value || 0);
        const total = typedAmount > 0 ? typedAmount : Number(latestOrder.total_cost || 0);
        const paid = Number(latestOrder.paid_cents || 0) / 100;
        const saldo = Math.max(0, total - paid);

        if (isBotEnabledForWorkshop()) {
          triggerAutoWhatsApp({ ...latestOrder, total_cost: total }, 'ready');
        } else if (latestOrder.client_phone) {
          const waPhone = formatWaMePhone(latestOrder.client_phone);
          let financeLine = '';
          let summaryBadge = '';
          if (total > 0 && paid > 0 && saldo > 0) {
            financeLine = `\nTotal de la reparación: ${formatMoney(total)}\nSeña / abonado: ${formatMoney(paid)}\nSaldo restante al retirar: ${formatMoney(saldo)}`;
            summaryBadge = `<p class="muted" style="font-size:13px;">Total: <strong>${formatMoney(total)}</strong> · Seña/Abonado: <strong style="color:#34d399;">${formatMoney(paid)}</strong> · Saldo a cobrar: <strong style="color:#fbbf24;">${formatMoney(saldo)}</strong></p>`;
          } else if (total > 0 && paid >= total) {
            financeLine = `\nTotal de la reparación: ${formatMoney(total)} (Ya abonado en su totalidad)`;
            summaryBadge = `<p class="muted" style="font-size:13px;">Total: <strong>${formatMoney(total)}</strong> · <strong style="color:#34d399;">✓ Ya abonado</strong></p>`;
          } else if (total > 0) {
            financeLine = `\nTotal a abonar al retirar: ${formatMoney(total)}`;
            summaryBadge = `<p class="muted" style="font-size:13px;">Total a abonar: <strong>${formatMoney(total)}</strong> (sin seña registrada)</p>`;
          } else if (paid > 0) {
            financeLine = `\nSeña / abonado: ${formatMoney(paid)}`;
            summaryBadge = `<p class="muted" style="font-size:13px;">Seña/Abonado: <strong style="color:#34d399;">${formatMoney(paid)}</strong></p>`;
          }

          const readyMsg = `Hola ${clientName}! Te avisamos de ${currentWorkshop?.name || 'el taller'} que tu ${latestOrder.brand || ''} ${latestOrder.model || 'equipo'} (Orden #${latestOrder.order_number}) ya está LISTO PARA RETIRAR.${financeLine}\n\nPodés ver el detalle en tu enlace de seguimiento:\n${location.origin}${trackingUrl}`;
          const promptDlg = modal('✅ Equipo listo para retirar', `
            <p style="margin-top:0;">¿Querés avisarle ahora por WhatsApp a <strong>${esc(clientName)}</strong> que su <strong>${esc(latestOrder.brand || '')} ${esc(latestOrder.model || 'equipo')}</strong> (Orden #${latestOrder.order_number}) ya está listo para retirar?</p>
            ${summaryBadge}
            <div class="form-actions" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
              <button type="button" class="secondary" id="btn-ready-skip">Ahora no</button>
              <a class="primary" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;" id="btn-ready-send-wa" href="https://wa.me/${waPhone}?text=${encodeURIComponent(readyMsg)}" target="_blank" rel="noopener noreferrer">
                💬 Avisar por WhatsApp
              </a>
            </div>
          `);
          promptDlg?.querySelector('#btn-ready-skip')?.addEventListener('click', () => promptDlg.close());
          promptDlg?.querySelector('#btn-ready-send-wa')?.addEventListener('click', () => promptDlg.close());
        }
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

async function promptPurchaseCostAndUpdate(item, nextStatus, onDone) {
  if (!item) return;
  if (nextStatus === 'pending' || item.cash_entry_id) {
    await api(`/api/workshop/${currentSlug}/purchases/${item.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus })
    });
    toast(
      nextStatus === 'ordered' ? '📦 Marcado como pedido realizado'
        : nextStatus === 'resolved' ? '✅ Ingreso al taller confirmado'
        : '↩ Devuelto a Pendientes'
    );
    await loadWorkshop();
    if (typeof onDone === 'function') onDone();
    return;
  }

  const est = Number(item.estimated_cost_cents || 0) / 100;
  const title = nextStatus === 'ordered' ? '📦 Confirmar pedido realizado' : '✅ Confirmar ingreso al taller';
  const d = modal(title, `
    <p style="margin-top:0;"><strong>${esc(item.name)} × ${Number(item.quantity || 1)}</strong></p>
    <p class="muted" style="font-size:13px;">Ingresá el costo real pagado para registrarlo automáticamente como egreso en Caja.</p>
    <form id="purchase-cost-form" class="form-grid">
      <label>Costo pagado ($)
        <input name="cost" id="purchase-confirm-cost" type="number" min="0" step="any" required value="${est > 0 ? est : ''}" placeholder="Ej: 28000">
      </label>
      <label>Medio de pago
        <select name="payment_method">
          <option value="efectivo">💵 Efectivo</option>
          <option value="mercadopago">⚡ Mercado Pago</option>
          <option value="transferencia">🏦 Transferencia</option>
          <option value="tarjeta">💳 Tarjeta</option>
        </select>
      </label>
      <div class="form-actions wide" style="display:flex;gap:10px;justify-content:flex-end;">
        <button type="button" class="secondary" id="btn-cancel-purchase-cost">Cancelar</button>
        <button type="submit" class="primary">${nextStatus === 'ordered' ? 'Confirmar pedido y registrar gasto' : 'Confirmar ingreso y registrar gasto'}</button>
      </div>
    </form>
  `);
  if (!d) return;
  d.querySelector('#btn-cancel-purchase-cost')?.addEventListener('click', () => {
    d.close();
    if (typeof onDone === 'function') onDone();
  });
  d.querySelector('#purchase-cost-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const cost = Number(fd.get('cost') || 0);
    const payment_method = String(fd.get('payment_method') || 'efectivo');
    try {
      await api(`/api/workshop/${currentSlug}/purchases/${item.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus, cost, payment_method })
      });
      toast(
        (nextStatus === 'ordered' ? '📦 Pedido realizado' : '✅ Ingreso al taller confirmado') +
        (cost > 0 ? ` · Gasto ${formatMoney(cost)} registrado en Caja` : '')
      );
      d.close();
      await loadWorkshop();
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// 4. Render Stock
function renderStock() {
  const container = document.querySelector('#stock-container');
  if (!container) return;
  let items = workshopData.stock || [];
  let needs = workshopData.purchase_needs || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.category && s.category.toLowerCase().includes(q)) ||
      (s.sku && s.sku.toLowerCase().includes(q)) ||
      (s.compatible_models && s.compatible_models.toLowerCase().includes(q))
    );
    needs = needs.filter(n =>
      [n.name, n.note, n.order_brand, n.order_model, n.order_number ? `#${n.order_number}` : '']
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }

  const needsHtml = needs.length ? `
    <div style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <h3 style="margin:0;font-size:15px;">🛒 Repuestos pendientes / En camino (${needs.length})</h3>
        <button type="button" class="secondary compact" id="btn-stock-open-purchasing">Abrir lista completa</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${needs.map(n => {
          const isOrdered = n.status === 'ordered';
          const badge = isOrdered
            ? `<span class="badge" style="background:rgba(59,130,246,0.16);color:#60a5fa;border:1px solid rgba(59,130,246,0.35);">🚚 Pedido realizado</span>`
            : `<span class="badge" style="background:rgba(245,158,11,0.16);color:#fbbf24;border:1px solid rgba(245,158,11,0.35);">⏳ Pendiente de compra</span>`;
          const modelStr = n.order_number ? ` · 📱 Orden #${n.order_number} (${esc(n.order_brand || '')} ${esc(n.order_model || '')})` : '';
          const costStr = Number(n.estimated_cost_cents || 0) > 0 ? ` · Costo: ${formatMoney(Number(n.estimated_cost_cents) / 100)}` : '';
          return `
            <div class="stock-card" style="align-items:center;gap:12px;flex-wrap:wrap;">
              <div style="flex:1;min-width:200px;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <strong>${esc(n.name)} × ${Number(n.quantity || 1)}</strong>
                  ${badge}
                </div>
                <p class="muted" style="margin:4px 0 0;">${n.priority === 'high' ? '🔴 Prioridad Alta' : n.priority === 'low' ? '⚪ Prioridad Baja' : '🟡 Prioridad Normal'}${modelStr}${costStr}${n.note ? ` · ${esc(n.note)}` : ''}</p>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${!isOrdered
                  ? `<button type="button" class="secondary compact btn-stock-need-status" data-id="${n.id}" data-status="ordered">📦 Pedido realizado</button>`
                  : `<button type="button" class="primary compact btn-stock-need-status" data-id="${n.id}" data-status="resolved">✅ Ingresó al taller</button>`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  const inventoryHtml = items.length === 0 ? `
    <div class="empty">
      <span class="icon-classic">📦</span>
      <div class="icon-pro empty-pro-badge" style="margin:0 auto 12px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>
      </div>
      <h3>${needs.length ? 'Sin productos propios cargados en stock' : 'Inventario vacío'}</h3>
      <p>Cargá pantallas, baterías, pines de carga y accesorios para controlar tu stock.</p>
    </div>
  ` : items.map(s => `
    <div class="stock-card" data-stock-id="${s.id}" style="cursor:pointer;">
      <div>
        <strong>${esc(s.name)}</strong>
        <p class="muted">${esc(s.category || 'General')}${s.sku ? ` · SKU: ${esc(s.sku)}` : ''}${s.compatible_models ? ` · ${esc(s.compatible_models)}` : ''}</p>
      </div>
      <div class="stock-numbers">
        <strong>${s.quantity || 0} u.</strong>
        <span class="muted">${formatMoney(s.price ?? (Number(s.sale_price_cents || 0) / 100))}</span>
      </div>
    </div>
  `).join('');

  container.innerHTML = needsHtml + inventoryHtml;

  container.querySelector('#btn-stock-open-purchasing')?.addEventListener('click', () => openPurchasingModal());
  container.querySelectorAll('.btn-stock-need-status').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const need = (workshopData.purchase_needs || []).find(n => String(n.id) === String(btn.dataset.id));
      if (!need) return;
      try {
        await promptPurchaseCostAndUpdate(need, btn.dataset.status);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  container.querySelectorAll('.stock-card[data-stock-id]').forEach(el => {
    el.addEventListener('click', () => {
      const item = (workshopData.stock || []).find(s => String(s.id) === String(el.dataset.stockId));
      if (item) openNewStockModal(item);
    });
  });
}

// 5. Render Caja
function renderCash() {
  const entries = workshopData.cash_entries || [];

  const {income=0, expense=0, mp:mpTotal=0} = workshopData.cash_totals || {};

  setText('#cash-income-total', formatMoney(income));
  setText('#cash-expense-total', formatMoney(expense));
  setText('#cash-mp-total', formatMoney(mpTotal));
  setText('#cash-net-total', formatMoney(income - expense));

  const searchInp = document.querySelector('#cash-filter-search');
  const typeSel = document.querySelector('#cash-filter-type');
  const fromInp = document.querySelector('#cash-filter-from');
  const toInp = document.querySelector('#cash-filter-to');
  const clearBtn = document.querySelector('#cash-filter-clear');

  [searchInp, typeSel, fromInp, toInp].forEach(el => {
    if (el && !el.dataset.cashFilterBound) {
      el.dataset.cashFilterBound = '1';
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', renderCash);
    }
  });
  if (clearBtn && !clearBtn.dataset.cashFilterBound) {
    clearBtn.dataset.cashFilterBound = '1';
    clearBtn.addEventListener('click', () => {
      if (searchInp) searchInp.value = '';
      if (typeSel) typeSel.value = 'all';
      if (fromInp) fromInp.value = '';
      if (toInp) toInp.value = '';
      renderCash();
    });
  }

  const q = (searchInp?.value || '').trim().toLowerCase();
  const typeFilter = typeSel?.value || 'all';
  const fromDate = fromInp?.value || '';
  const toDate = toInp?.value || '';
  const hasFilters = Boolean(q || typeFilter !== 'all' || fromDate || toDate);
  if (clearBtn) clearBtn.hidden = !hasFilters;

  const filtered = entries.filter(e => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (fromDate || toDate) {
      const dStr = new Date(e.created_at).toLocaleDateString('en-CA'); // YYYY-MM-DD local
      if (fromDate && dStr < fromDate) return false;
      if (toDate && dStr > toDate) return false;
    }
    if (q) {
      const hay = [
        e.concept,
        e.payment_method,
        e.order_number ? `#${e.order_number}` : '',
        e.order_brand,
        e.order_model
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

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

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <span>💵</span>
        <h3>${hasFilters ? 'Sin movimientos con esos filtros' : 'Sin movimientos de caja'}</h3>
        <p>${hasFilters ? 'Probá limpiando los filtros de fecha, tipo o búsqueda.' : 'Registrá los cobros y egresos diarios de tu mostrador.'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(e => `
    <div class="cash-row">
      <div>
        <strong>${esc(e.concept || 'Movimiento')}</strong>
        <p class="muted">
          ${new Date(e.created_at).toLocaleDateString('es-AR')} &bull; 
          <span style="text-transform:capitalize;">${esc(e.payment_method || 'Efectivo')}</span> &bull; 
          ${e.type === 'income' ? 'Ingreso' : 'Egreso'}${e.order_number ? ` &bull; <span style="color:#34d399;">📱 Orden #${e.order_number} (${esc(e.order_brand || '')} ${esc(e.order_model || '')})</span>` : ''}
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
  const logoUrl = currentSettings?.logo_url || '';
  setVal('#set-workshop-logo-url', logoUrl);
  const logoPreview = document.querySelector('#set-workshop-logo-preview');
  if (logoPreview) logoPreview.src = logoUrl || '/logo.png';
  const btnRemoveLogo = document.querySelector('#btn-remove-workshop-logo');
  if (btnRemoveLogo) btnRemoveLogo.style.display = logoUrl ? 'inline-block' : 'none';

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
      <label>Importe / Presupuesto (opcional)
        <input name="total_cost" type="number" min="0" step="any" placeholder="Ej: 45000">
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
function openNewCashModal(presetOrder = null) {
  const preset = presetOrder && presetOrder.id ? presetOrder : null;
  const orders = workshopData.orders || [];
  const orderOptions = orders.map(o => {
    const total = Number(o.total_cost || 0);
    const paid = Number(o.paid_cents || 0) / 100;
    const saldo = Math.max(0, total - paid);
    const extra = total > 0
      ? (saldo > 0 ? ` · Saldo ${formatMoney(saldo)}` : ' · Pagado')
      : '';
    return `<option value="${o.id}" ${preset && String(preset.id) === String(o.id) ? 'selected' : ''}>#${o.order_number} · ${esc(o.brand)} ${esc(o.model)} (${esc(o.client_name || 'Sin cliente')})${extra}</option>`;
  }).join('');

  const modalTitle = preset ? `💵 Cobrar Orden #${preset.order_number}` : '＋ Nuevo movimiento de caja';
  const d = modal(modalTitle, `
    <form id="new-cash-form" class="form-grid">
      <label class="wide">Equipo / Orden vinculada (opcional)
        <select name="order_id" id="cash-order-select">
          <option value="">Sin equipo vinculado (movimiento general)</option>
          ${orderOptions}
        </select>
        <small class="muted" id="cash-order-summary" style="display:none;margin-top:4px;"></small>
      </label>
      <label>Tipo de movimiento
        <select name="type" id="cash-type-select">
          <option value="income">Ingreso (Cobro / Seña / Venta)</option>
          <option value="expense">Egreso (Gasto / Pago repuesto)</option>
        </select>
      </label>
      <label>Importe ($)
        <input name="amount" id="cash-amount-input" type="number" step="0.01" min="1" required placeholder="Ej: 15000">
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
        <input name="concept" id="cash-concept-input" required placeholder="Ej: Cobro pantalla Motorola G84">
      </label>
      <div class="form-actions wide">
        <button type="submit" class="primary">Registrar movimiento</button>
      </div>
    </form>
  `);

  if (!d) return;

  const orderSel = d.querySelector('#cash-order-select');
  const summaryEl = d.querySelector('#cash-order-summary');
  const amountInp = d.querySelector('#cash-amount-input');
  const conceptInp = d.querySelector('#cash-concept-input');
  const typeSel = d.querySelector('#cash-type-select');

  const syncOrderSelection = (forceFill = false) => {
    const selectedId = orderSel?.value;
    const ord = orders.find(o => String(o.id) === String(selectedId));
    if (!ord) {
      if (summaryEl) summaryEl.style.display = 'none';
      return;
    }
    const total = Number(ord.total_cost || 0);
    const paid = Number(ord.paid_cents || 0) / 100;
    const saldo = Math.max(0, total - paid);
    if (summaryEl) {
      summaryEl.style.display = 'block';
      summaryEl.innerHTML = total > 0
        ? `Presupuesto: <strong>${formatMoney(total)}</strong> · Abonado: <strong style="color:#34d399;">${formatMoney(paid)}</strong> · Saldo pendiente: <strong style="color:${saldo > 0 ? '#fbbf24' : '#34d399'};">${formatMoney(saldo)}</strong> (podés cobrar parcial o total)`
        : `Orden sin presupuesto cargado · Abonado hasta ahora: <strong style="color:#34d399;">${formatMoney(paid)}</strong>`;
    }
    if (typeSel?.value === 'income') {
      if ((forceFill || !amountInp.value) && saldo > 0) {
        amountInp.value = saldo;
      }
      if (forceFill || !conceptInp.value) {
        conceptInp.value = `Cobro Orden #${ord.order_number} (${ord.brand} ${ord.model})`;
      }
    }
  };

  orderSel?.addEventListener('change', () => syncOrderSelection(true));
  if (preset) syncOrderSelection(true);

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

const COMMON_REPAIR_PARTS = [
  '1 - Pantalla / Módulo completo',
  '2 - Batería',
  '3 - Pin de carga / Subplaca de carga',
  '4 - Tapa trasera / Carcasa',
  '5 - Glass / Vidrio frontal (remanufactura)',
  '6 - Flex de encendido / Volumen',
  '7 - Flex main / Interconexión',
  '8 - Cámara trasera (módulo)',
  '9 - Cámara frontal',
  '10 - Lente / Vidrio de cámara',
  '11 - Parlante / Buzzer (altavoz)',
  '12 - Auricular superior',
  '13 - Micrófono',
  '14 - Sensor de huella / Biometría',
  '15 - Lector de SIM / Bandeja SIM',
  '16 - Antena / Cable coaxial de señal',
  '17 - Vibrador',
  '18 - Chasis / Marco intermedio',
  '19 - Bisagra / Flex de bisagra',
  '20 - IC de carga / Circuito integrado / PMIC',
  '21 - Conector FPC / Zócalo en placa',
  '22 - Adhesivo / Pegamento / Cinta doble faz',
  '23 - Funda / Vidrio templado / Hidrogel',
  '24 - Cargador / Cable USB-C / Lightning'
];

// Modal nuevo / editar producto en stock (o cargar faltante a lista de compras)
function openNewStockModal(editOrOpts = null) {
  const isEdit = Boolean(editOrOpts && editOrOpts.id && !editOrOpts.presetOrder);
  const item = isEdit ? editOrOpts : null;
  const presetOrder = editOrOpts && editOrOpts.presetOrder ? editOrOpts.presetOrder : null;
  const forceMode = editOrOpts && editOrOpts.forceMode ? editOrOpts.forceMode : null;
  const categories = ['Pantallas / Módulos', 'Baterías', 'Pines de carga', 'Fundas / Vidrios', 'Cargadores / Cables', 'Herramientas', 'General'];

  if (isEdit) {
    const priceVal = item.price ?? (Number(item.sale_price_cents || 0) / 100);
    const costVal = item.cost ?? (Number(item.unit_cost_cents || 0) / 100);
    const currentCat = item.category || 'General';
    const catOptions = categories.map(c => `<option value="${esc(c)}" ${currentCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('');

    const d = modal('✏️ Editar producto', `
      <form id="new-stock-form" class="form-grid">
        <label class="wide">Nombre del producto o repuesto
          <input name="name" required value="${esc(item.name || '')}" placeholder="Ej: Módulo Samsung A52 OLED">
        </label>
        <label>Categoría
          <select name="category">${catOptions}</select>
        </label>
        <label>Cantidad en stock
          <input name="quantity" type="number" min="0" step="1" required value="${Number(item.quantity || 0)}">
        </label>
        <label>Precio de venta ($)
          <input name="price" type="number" min="0" step="any" value="${priceVal > 0 ? priceVal : ''}" placeholder="Ej: 45000">
        </label>
        <label>Costo ($) (opcional)
          <input name="cost" type="number" min="0" step="any" value="${costVal > 0 ? costVal : ''}" placeholder="Ej: 28000">
        </label>
        <label>SKU / Código (opcional)
          <input name="sku" value="${esc(item.sku || '')}" placeholder="Ej: MOD-A52">
        </label>
        <label>Modelos compatibles (opcional)
          <input name="compatible_models" value="${esc(item.compatible_models || '')}" placeholder="Ej: A52, A52s">
        </label>
        <div class="form-actions wide">
          <button type="submit" class="primary">Guardar cambios</button>
        </div>
      </form>
    `);
    if (!d) return;
    d.querySelector('#new-stock-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/api/workshop/${currentSlug}/stock/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify(Object.fromEntries(fd))
        });
        toast('Producto actualizado');
        d.close();
        await loadWorkshop();
      } catch (err) {
        toast(err.message, true);
      }
    });
    return;
  }

  const orders = workshopData.orders || [];
  const orderOptions = orders.map(o =>
    `<option value="${o.id}" ${presetOrder && String(presetOrder.id) === String(o.id) ? 'selected' : ''}>#${o.order_number} · ${esc(o.brand)} ${esc(o.model)} (${esc(o.client_name || 'Sin cliente')})</option>`
  ).join('');
  const defaultDest = forceMode || (presetOrder ? 'purchase' : 'stock');
  const availableStock = (workshopData.stock || []).filter(s => Number(s.quantity || 0) > 0);
  const existingStockOptions = availableStock.length
    ? availableStock.map(s => `<option value="${s.id}" data-qty="${Number(s.quantity || 0)}">${esc(s.name)} — Disp: ${Number(s.quantity || 0)}${s.compatible_models ? ` (${esc(s.compatible_models)})` : ''}</option>`).join('')
    : '<option value="">No hay repuestos disponibles en stock (cantidad > 0)</option>';

  const modalTitle = presetOrder
    ? (defaultDest === 'stock'
      ? `📦 Usar repuesto en stock · Orden #${presetOrder.order_number}`
      : `🛒 Anotar faltante · Orden #${presetOrder.order_number}`)
    : '＋ Nuevo producto / repuesto';

  const d = modal(modalTitle, `
    <form id="new-stock-form" class="form-grid">
      ${forceMode
        ? `<input type="hidden" name="dest" id="stock-dest-select" value="${defaultDest}">`
        : `<label class="wide">¿Dónde querés cargarlo?
            <select name="dest" id="stock-dest-select">
              <option value="stock" ${defaultDest === 'stock' ? 'selected' : ''}>📦 Stock disponible en el taller</option>
              <option value="purchase" ${defaultDest === 'purchase' ? 'selected' : ''}>🛒 Lista de compras (Faltante / Para pedir)</option>
            </select>
          </label>`}

      <label class="wide" id="order-existing-stock-wrap" style="display:none;">Repuesto en stock disponible
        <select name="existing_stock_id" id="order-existing-stock-select">
          ${existingStockOptions}
        </select>
      </label>

      <label class="wide" id="stock-part-wrap">Repuesto o producto (por prioridad)
        <select name="part_type" id="stock-part-select">
          ${COMMON_REPAIR_PARTS.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
          <option value="__OTHER__">Otro repuesto / producto (escribir manualmente)</option>
        </select>
      </label>

      <label class="wide" id="stock-custom-wrap" style="display:none;">Especificar repuesto o producto
        <input name="custom_name" id="stock-custom-input" placeholder="Ej: Sensor de proximidad / Cable flex NFC">
      </label>

      <label>Cantidad
        <input name="quantity" type="number" min="${defaultDest === 'purchase' ? 1 : 0}" step="1" required value="1" id="stock-qty-input">
      </label>

      <label id="stock-cat-wrap" style="display:${!presetOrder && defaultDest === 'stock' ? 'block' : 'none'};">Categoría
        <select name="category" id="stock-cat-select">
          ${categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </label>

      <label id="purchase-priority-wrap" style="display:${defaultDest === 'purchase' ? 'block' : 'none'};">Prioridad
        <select name="priority">
          <option value="high">Alta (urgente)</option>
          <option value="normal" selected>Normal</option>
          <option value="low">Baja</option>
        </select>
      </label>

      <div id="stock-only-fields" class="wide" style="display:${!presetOrder && defaultDest === 'stock' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:12px;">
        <label>Modelos compatibles (opcional)
          <input name="compatible_models" id="stock-models-input" placeholder="Ej: Samsung A52, Moto G84">
        </label>
        <label>Precio de venta ($)
          <input name="price" type="number" min="0" step="any" placeholder="Ej: 45000">
        </label>
        <label>Costo unitario ($) (opcional)
          <input name="cost" type="number" min="0" step="any" placeholder="Ej: 28000">
        </label>
        <label>Medio de pago (si tuvo costo)
          <select name="payment_method">
            <option value="efectivo">💵 Efectivo</option>
            <option value="mercadopago">⚡ Mercado Pago</option>
            <option value="transferencia">🏦 Transferencia</option>
            <option value="tarjeta">💳 Tarjeta</option>
          </select>
        </label>
        <label>SKU / Código (opcional)
          <input name="sku" placeholder="Ej: MOD-A52">
        </label>
        <label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:18px;font-size:13px;">
          <input type="checkbox" name="record_cash" value="1" checked style="width:auto;margin:0;">
          <span>Registrar costo en Caja (egreso)</span>
        </label>
      </div>

      <div id="purchase-only-fields" class="wide" style="display:${defaultDest === 'purchase' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:12px;">
        <label class="wide">Orden / Equipo vinculado (opcional)
          <select name="order_id" id="stock-order-select">
            <option value="">Reposición general / stock</option>
            ${orderOptions}
          </select>
        </label>
        <label>Costo estimado ($) (opcional)
          <input name="purchase_cost" type="number" min="0" step="any" placeholder="Ej: 28000">
        </label>
        <label>Nota / Proveedor / Calidad (opcional)
          <input name="note" placeholder="Ej: Calidad OLED / Mercado Libre / Proveedor local">
        </label>
      </div>

      <div class="form-actions wide">
        <button type="submit" class="primary" id="btn-submit-stock-form">${defaultDest === 'purchase' ? '＋ Agregar a lista de compras' : 'Guardar producto'}</button>
      </div>
    </form>
  `);

  if (!d) return;

  const destSel = d.querySelector('#stock-dest-select');
  const existingWrap = d.querySelector('#order-existing-stock-wrap');
  const existingSel = d.querySelector('#order-existing-stock-select');
  const partWrap = d.querySelector('#stock-part-wrap');
  const partSel = d.querySelector('#stock-part-select');
  const customWrap = d.querySelector('#stock-custom-wrap');
  const customInp = d.querySelector('#stock-custom-input');
  const catWrap = d.querySelector('#stock-cat-wrap');
  const prioWrap = d.querySelector('#purchase-priority-wrap');
  const stockFields = d.querySelector('#stock-only-fields');
  const purchaseFields = d.querySelector('#purchase-only-fields');
  const qtyInp = d.querySelector('#stock-qty-input');
  const submitBtn = d.querySelector('#btn-submit-stock-form');

  const syncDestUI = () => {
    const isPurchase = destSel?.value === 'purchase';
    const isOrderStockUse = Boolean(presetOrder && !isPurchase);

    if (existingWrap) existingWrap.style.display = isOrderStockUse ? 'block' : 'none';
    if (partWrap) partWrap.style.display = isOrderStockUse ? 'none' : 'block';
    if (customWrap) customWrap.style.display = (!isOrderStockUse && partSel?.value === '__OTHER__') ? 'block' : 'none';
    if (customInp) customInp.required = Boolean(!isOrderStockUse && partSel?.value === '__OTHER__');

    if (catWrap) catWrap.style.display = (!isPurchase && !presetOrder) ? 'block' : 'none';
    if (prioWrap) prioWrap.style.display = isPurchase ? 'block' : 'none';
    if (stockFields) stockFields.style.display = (!isPurchase && !presetOrder) ? 'grid' : 'none';
    if (purchaseFields) purchaseFields.style.display = isPurchase ? 'grid' : 'none';

    if (qtyInp) {
      qtyInp.min = (isPurchase || isOrderStockUse) ? '1' : '0';
      if (isOrderStockUse && existingSel?.value) {
        const opt = existingSel.selectedOptions?.[0];
        const maxQ = Number(opt?.dataset?.qty || 0);
        if (maxQ > 0) qtyInp.max = String(maxQ);
        else qtyInp.removeAttribute('max');
      } else {
        qtyInp.removeAttribute('max');
      }
    }

    if (submitBtn) {
      submitBtn.disabled = Boolean(isOrderStockUse && !availableStock.length);
      submitBtn.textContent = isPurchase
        ? '＋ Agregar a lista de compras'
        : isOrderStockUse
          ? '✓ Usar del stock y descontar'
          : 'Guardar producto';
    }
  };

  syncDestUI();
  destSel?.addEventListener('change', syncDestUI);
  existingSel?.addEventListener('change', syncDestUI);
  partSel?.addEventListener('change', () => {
    const isOther = partSel.value === '__OTHER__';
    if (customWrap) customWrap.style.display = isOther ? 'block' : 'none';
    if (customInp) {
      customInp.required = isOther;
      if (isOther) customInp.focus();
    }
  });

  d.querySelector('#new-stock-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dest = String(fd.get('dest') || 'stock');

    try {
      if (presetOrder && dest === 'stock') {
        const stockId = String(fd.get('existing_stock_id') || '').trim();
        const stockItem = availableStock.find(s => String(s.id) === stockId);
        if (!stockItem) {
          toast('Seleccioná un repuesto disponible en stock', true);
          return;
        }
        const usedQty = Math.max(1, Math.round(Number(fd.get('quantity') || 1)));
        const currentQty = Number(stockItem.quantity || 0);
        if (usedQty > currentQty) {
          toast(`Solo hay ${currentQty} unidad(es) disponible(s) en stock`, true);
          return;
        }
        await api(`/api/workshop/${currentSlug}/stock/${stockItem.id}`, {
          method: 'PUT',
          body: JSON.stringify({ quantity: Math.max(0, currentQty - usedQty) })
        });
        toast(`✓ Se descontó ${usedQty} × ${stockItem.name} del stock para la Orden #${presetOrder.order_number}`);
        d.close();
        await loadWorkshop();
        return;
      }

      const rawPart = fd.get('part_type') === '__OTHER__'
        ? String(fd.get('custom_name') || '').trim()
        : String(fd.get('part_type') || '').replace(/^\d+\s*-\s*/, '').trim();

      if (!rawPart) {
        toast('Indicá el nombre del producto o repuesto', true);
        return;
      }

      if (dest === 'purchase') {
        const orderId = String(fd.get('order_id') || '').trim();
        const linkedOrder = orderId ? orders.find(o => String(o.id) === orderId) : null;
        const modelSuffix = linkedOrder ? `${linkedOrder.brand || ''} ${linkedOrder.model || ''}`.trim() : '';
        const fullName = modelSuffix && !rawPart.toLowerCase().includes(modelSuffix.toLowerCase())
          ? `${rawPart} — ${modelSuffix}`
          : rawPart;

        await api(`/api/workshop/${currentSlug}/purchases`, {
          method: 'POST',
          body: JSON.stringify({
            name: fullName,
            quantity: Number(fd.get('quantity') || 1),
            priority: String(fd.get('priority') || 'normal'),
            order_id: orderId || null,
            note: String(fd.get('note') || '').trim(),
            cost: Number(fd.get('purchase_cost') || 0)
          })
        });
        toast('Agregado a la lista de compras');
      } else {
        const models = String(fd.get('compatible_models') || '').trim();
        const fullName = models && !rawPart.toLowerCase().includes(models.toLowerCase())
          ? `${rawPart} — ${models}`
          : rawPart;
        const qtyNum = Number(fd.get('quantity') || 0);
        const costNum = Number(fd.get('cost') || 0);
        const recordCash = fd.get('record_cash') === '1';

        const res = await api(`/api/workshop/${currentSlug}/stock`, {
          method: 'POST',
          body: JSON.stringify({
            name: fullName,
            category: String(fd.get('category') || 'General'),
            quantity: qtyNum,
            price: Number(fd.get('price') || 0),
            cost: costNum,
            sku: String(fd.get('sku') || '').trim(),
            compatible_models: models,
            payment_method: String(fd.get('payment_method') || 'efectivo'),
            record_cash: recordCash
          })
        });
        toast(res?.cash_entry_id
          ? `Producto agregado al stock · Egreso ${formatMoney(costNum * qtyNum)} registrado en Caja`
          : 'Producto agregado al stock');
      }
      d.close();
      await loadWorkshop();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// Modal Lista de compras (solo visualización, gestión de estados y exportación)
function openPurchasingModal() {
  const d = modal('🛒 Lista de compras', `
    <p class="muted" style="margin-top:0;">Acá ves los repuestos <strong>Pendientes de compra</strong> y los <strong>Pedidos realizados</strong> por internet. Para agregar nuevos ítems usá el botón <strong>＋ Nuevo producto / repuesto</strong>.</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <input type="search" id="purchasing-search" placeholder="Buscar por repuesto, modelo o proveedor..." style="flex:1;min-width:180px;">
      <button type="button" class="primary compact" id="purchasing-resolve-checked" disabled>✓ Marcar ingreso / comprados</button>
      <button type="button" class="secondary compact" id="purchasing-export">⬇ Exportar CSV</button>
    </div>
    <div id="purchasing-results"></div>
  `);

  if (!d) return;

  const searchInp = d.querySelector('#purchasing-search');
  const resultsEl = d.querySelector('#purchasing-results');
  const resolveBtn = d.querySelector('#purchasing-resolve-checked');
  const exportBtn = d.querySelector('#purchasing-export');
  const checkedIds = new Set();

  const priorityLabel = { high: '🔴 Alta', normal: '🟡 Normal', low: '⚪ Baja' };

  const updateItemStatus = async (id, nextStatus) => {
    await api(`/api/workshop/${currentSlug}/purchases/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus })
    });
    checkedIds.delete(id);
    if (nextStatus === 'ordered') toast('📦 Movido a Pedidos realizados');
    else if (nextStatus === 'resolved') toast('✅ Ingreso al taller confirmado');
    else toast('↩ Devuelto a Pendientes');
    await loadWorkshop();
    renderList();
  };

  const renderRow = (item, isOrdered) => {
    const isChecked = checkedIds.has(item.id);
    const modelLabel = item.order_number
      ? `${esc(item.order_brand || '')} ${esc(item.order_model || '')}`.trim()
      : '';
    const estCost = Number(item.estimated_cost_cents || 0) / 100;
    return `
      <div class="purchase-row ${isChecked ? 'is-checked' : ''}" data-purchase-id="${item.id}" style="${isOrdered ? 'border-left:3px solid #60a5fa;' : ''}">
        <label class="purchase-check">
          <input type="checkbox" value="${item.id}" ${isChecked ? 'checked' : ''}>
          <span>${isOrdered ? 'Ingresó' : 'Comprado'}</span>
        </label>
        <div class="purchase-main">
          <strong>${esc(item.name)} × ${Number(item.quantity || 1)}</strong>
          <p class="muted">
            ${priorityLabel[item.priority] || 'Normal'}
            ${item.order_number ? ` · 📱 Orden #${item.order_number}${modelLabel ? ` (${modelLabel})` : ''}` : ' · Reposición general'}
            ${estCost > 0 ? ` · Costo: ${formatMoney(estCost)}` : ''}
            ${item.cash_entry_id ? ' · 💸 En caja' : ''}
          </p>
          ${item.note ? `<small class="muted">${esc(item.note)}</small>` : ''}
        </div>
        <div class="purchase-meta" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          <small class="muted">${new Date(item.created_at).toLocaleDateString('es-AR')}</small>
          ${!isOrdered
            ? `<button type="button" class="secondary compact btn-purchase-status" data-id="${item.id}" data-status="ordered">📦 Pedido realizado</button>`
            : `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                 <button type="button" class="primary compact btn-purchase-status" data-id="${item.id}" data-status="resolved">✅ Ingresó al taller</button>
                 <button type="button" class="secondary compact btn-purchase-status" data-id="${item.id}" data-status="pending" title="Volver a pendientes">↩</button>
               </div>`}
        </div>
      </div>
    `;
  };

  const renderList = () => {
    const q = (searchInp?.value || '').trim().toLowerCase();
    const list = (workshopData.purchase_needs || []).filter(item => {
      if (!q) return true;
      return [item.name, item.note, item.order_brand, item.order_model, item.order_number ? `#${item.order_number}` : '']
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    const pendingItems = list.filter(i => i.status !== 'ordered');
    const orderedItems = list.filter(i => i.status === 'ordered');

    if (!list.length) {
      resultsEl.innerHTML = `<p class="muted" style="text-align:center;padding:18px 8px;">No hay repuestos pendientes ni pedidos en camino.</p>`;
      resolveBtn.disabled = true;
      return;
    }

    resultsEl.innerHTML = `
      <div style="margin-bottom:16px;">
        <h3 style="margin:0 0 8px;font-size:14px;color:#fbbf24;">⏳ Pendientes de compra (${pendingItems.length})</h3>
        ${pendingItems.length
          ? pendingItems.map(i => renderRow(i, false)).join('')
          : `<p class="muted" style="font-size:13px;padding:8px 0;">Sin repuestos pendientes de compra.</p>`}
      </div>
      <div>
        <h3 style="margin:0 0 8px;font-size:14px;color:#60a5fa;">🚚 Pedidos realizados · En camino (${orderedItems.length})</h3>
        ${orderedItems.length
          ? orderedItems.map(i => renderRow(i, true)).join('')
          : `<p class="muted" style="font-size:13px;padding:8px 0;">Todavía no marcaste pedidos realizados por internet/proveedor.</p>`}
      </div>
    `;

    resultsEl.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) checkedIds.add(chk.value);
        else checkedIds.delete(chk.value);
        chk.closest('.purchase-row')?.classList.toggle('is-checked', chk.checked);
        resolveBtn.disabled = checkedIds.size === 0;
      });
    });

    resultsEl.querySelectorAll('.btn-purchase-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = (workshopData.purchase_needs || []).find(i => i.id === btn.dataset.id);
        if (!item) return;
        btn.disabled = true;
        try {
          checkedIds.delete(item.id);
          await promptPurchaseCostAndUpdate(item, btn.dataset.status, () => openPurchasingModal());
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
        }
      });
    });

    resolveBtn.disabled = checkedIds.size === 0;
  };

  renderList();
  searchInp?.addEventListener('input', renderList);

  resolveBtn?.addEventListener('click', async () => {
    const ids = Array.from(checkedIds);
    if (!ids.length) return;
    resolveBtn.disabled = true;
    try {
      await api(`/api/workshop/${currentSlug}/purchases/resolve`, {
        method: 'POST',
        body: JSON.stringify({ ids, reason: 'Ingreso al taller confirmado' })
      });
      checkedIds.clear();
      toast(`✓ ${ids.length} repuesto(s) marcado(s) como ingresado(s)`);
      await loadWorkshop();
      renderList();
    } catch (err) {
      toast(err.message, true);
      resolveBtn.disabled = false;
    }
  });

  exportBtn?.addEventListener('click', () => {
    const list = workshopData.purchase_needs || [];
    if (!list.length) {
      toast('No hay ítems para exportar', true);
      return;
    }
    const rows = [['Estado', 'Repuesto y Modelo', 'Cantidad', 'Prioridad', 'Orden', 'Nota', 'Fecha']];
    list.forEach(item => {
      rows.push([
        item.status === 'ordered' ? 'Pedido realizado' : 'Pendiente',
        item.name || '',
        String(item.quantity || 1),
        item.priority || 'normal',
        item.order_number ? `#${item.order_number} ${item.order_brand || ''} ${item.order_model || ''}`.trim() : 'General',
        item.note || '',
        new Date(item.created_at).toLocaleDateString('es-AR')
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lista-de-compras-${currentSlug}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
  document.querySelector('#btn-stock-new')?.addEventListener('click', openNewStockModal);
  document.querySelector('#btn-purchasing-list')?.addEventListener('click', openPurchasingModal);

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

  // Subir o quitar logo desde el dispositivo
  const logoFileInput = document.querySelector('#set-workshop-logo-file');
  const btnUploadLogo = document.querySelector('#btn-upload-workshop-logo');
  const btnRemoveLogo = document.querySelector('#btn-remove-workshop-logo');

  btnUploadLogo?.addEventListener('click', () => {
    if (logoFileInput) {
      logoFileInput.value = '';
      logoFileInput.click();
    }
  });

  logoFileInput?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const prevText = btnUploadLogo.textContent;
    btnUploadLogo.disabled = true;
    btnUploadLogo.textContent = 'Subiendo...';
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const token = getWorkshopToken();
      const res = await fetch(`/api/workshop/${currentSlug}/logo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo subir el logo');
      if (currentSettings) currentSettings.logo_url = data.logo_url;
      if (currentWorkshop) currentWorkshop.logo_url = data.logo_url;
      await loadWorkshop();
      toast('¡Logo actualizado con éxito!');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btnUploadLogo.disabled = false;
      btnUploadLogo.textContent = prevText;
    }
  });

  btnRemoveLogo?.addEventListener('click', async () => {
    const hiddenInput = document.querySelector('#set-workshop-logo-url');
    if (hiddenInput) hiddenInput.value = '';
    const form = document.querySelector('#form-settings-brand');
    if (!form) return;
    try {
      await api(`/api/workshop/${currentSlug}/brand`, {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      await loadWorkshop();
      toast('Logo restablecido al predeterminado');
    } catch (err) {
      toast(err.message, true);
    }
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

