import { createRemoteJWKSet, jwtVerify } from 'jose';

const accessKeys = new Map();
async function verifiedAccessEmail(request, env) {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion || !env.CF_ACCESS_ISSUER || !env.CF_ACCESS_AUD) return null;
  const issuer = env.CF_ACCESS_ISSUER.replace(/\/$/, '');
  try {
    if (!accessKeys.has(issuer)) accessKeys.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')));
    const { payload } = await jwtVerify(assertion, accessKeys.get(issuer), {
      issuer, audience: env.CF_ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'email']
    });
    return typeof payload.email === 'string' ? payload.email : null;
  } catch { return null; }
}

// Worker para Tu Taller Soft (app.tutallersoft.com)
// Manejo de Multi-Tenant, API Super-Admin y Seguridad

const SUPER_ADMIN_DEFAULT = 'barriosmatiasivan@gmail.com';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Admin-Key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    }
  });
}

const PWD_SALT = 'tutaller-salt-2026';

async function hashPassword(password) {
  const enc = new TextEncoder();
  const data = enc.encode(PWD_SALT + ':' + password);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getAdminFromSession(request, env) {
  const db = env.DB;
  if (!db) return null;

  // 1. Cloudflare Access header
  const cfEmail = await verifiedAccessEmail(request, env);
  if (cfEmail) {
    const row = await db.prepare('SELECT email, name FROM super_admins WHERE email = ?').bind(cfEmail.toLowerCase()).first();
    if (row) return row;
  }

  // 2. Token de Sesión en Header Authorization: Bearer <session_token>
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const nowIso = new Date().toISOString();
      const admin = await db.prepare(`
        SELECT email, name FROM super_admins 
        WHERE session_token = ? AND (session_expires_at IS NULL OR session_expires_at > ?)
      `).bind(token, nowIso).first();
      if (admin) return admin;
    }
  }

  // 3. Clave de administración para scripts autorizados (solo si está configurada en variables de entorno)
  const adminKey = request.headers.get('X-Admin-Key');
  if (adminKey && env.ADMIN_SECRET_KEY && adminKey === env.ADMIN_SECRET_KEY) {
    return { email: (env.SUPER_ADMIN_EMAIL || SUPER_ADMIN_DEFAULT).toLowerCase(), name: 'Matías Barrios' };
  }

  return null;
}

let authSchemaReady = false;
async function ensureAuthSchema(db) {
  if (authSchemaReady || !db) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS workshop_login_codes (
        id TEXT PRIMARY KEY,
        workshop_id TEXT NOT NULL,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS workshop_sessions (
        id TEXT PRIMARY KEY,
        workshop_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `).run();
    authSchemaReady = true;
  } catch (err) {
    console.warn('ensureAuthSchema note:', err.message);
  }
}

let orderPhotosSchemaReady = false;
async function ensureOrderPhotosSchema(db) {
  if (orderPhotosSchemaReady || !db) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS repair_order_photos (
      id TEXT PRIMARY KEY,
      workshop_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_repair_order_photos_order ON repair_order_photos(workshop_id, order_id, created_at)').run();
  orderPhotosSchemaReady = true;
}

async function sendResendPinEmail(toEmail, pinCode, workshopName, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { success: false };

  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b1110; color: #f1f5f9; padding: 40px 20px; text-align: center;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #101613; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 36px 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
        <div style="display: inline-block; padding: 6px 14px; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 9999px; font-size: 12px; font-weight: 700; color: #10b981; letter-spacing: 1px; margin-bottom: 20px;">
          CÓDIGO DE SEGURIDAD
        </div>
        <h2 style="color: #ffffff; font-size: 24px; margin: 0 0 8px 0; font-weight: 800;">${workshopName}</h2>
        <p style="color: #94a3b8; font-size: 14px; margin: 0 0 28px 0; line-height: 1.5;">
          Ingresá este código de 6 dígitos en tu pantalla para acceder al panel del taller:
        </p>
        
        <div style="background: #131e18; border: 2px solid #10b981; border-radius: 12px; padding: 18px 24px; margin-bottom: 28px; font-size: 38px; font-weight: 900; letter-spacing: 8px; color: #10b981; font-family: monospace;">
          ${pinCode}
        </div>
        
        <p style="color: #64748b; font-size: 12px; margin: 0; line-height: 1.5;">
          Este código expira en 15 minutos por seguridad.<br>
          Si no solicitaste este acceso, podés ignorar este mensaje con total tranquilidad.
        </p>
      </div>
      <p style="margin-top: 24px; font-size: 11px; color: #475569;">
        Tu Taller Soft · Sistema de Gestión y Trazabilidad Técnica
      </p>
    </div>
  `;

  async function postResend(fromAddress) {
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject: `${pinCode} es tu código de acceso · ${workshopName}`,
        html: emailHtml
      })
    });
  }

  try {
    const primaryFrom = env.EMAIL_FROM || 'Tu Taller Soft <acceso@tutallersoft.com>';
    let res = await postResend(primaryFrom);
    let data = await res.json().catch(() => ({}));

    // Fallback automático a onboarding@resend.dev si tutallersoft.com aún no terminó de verificar DNS
    if (!res.ok && data.message && data.message.includes('not verified')) {
      console.log('Dominio tutallersoft.com aún no verificado en Resend. Usando remitente seguro onboarding@resend.dev...');
      res = await postResend('Tu Taller Soft <onboarding@resend.dev>');
      data = await res.json().catch(() => ({}));
    }

    if (!res.ok) {
      console.error('Error enviando con Resend:', data);
      return { success: false, error: data.message || 'Error en Resend' };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('Excepción al conectar con Resend:', err);
    return { success: false, error: err.message };
  }
}

async function workshopLoginRole(db, workshop, email, env) {
  const adminEmail = (env.SUPER_ADMIN_EMAIL || SUPER_ADMIN_DEFAULT).trim().toLowerCase();
  if (email === adminEmail) return 'super_admin';
  if (email === workshop.owner_email?.trim().toLowerCase()) return 'owner';
  const user = await db.prepare('SELECT role FROM workshop_users WHERE workshop_id = ? AND LOWER(email) = ?')
    .bind(workshop.id, email).first();
  return user ? (user.role || 'technician') : null;
}

async function getWorkshopSession(request, env, workshopId) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const nowIso = new Date().toISOString();
  // Permitir token de Super-Admin si aplica
  const superAdmin = await env.DB.prepare(`
    SELECT email, name FROM super_admins WHERE session_token = ? AND (session_expires_at IS NULL OR session_expires_at > ?)
  `).bind(token, nowIso).first();
  if (superAdmin) {
    return { email: superAdmin.email, name: superAdmin.name, role: 'super_admin' };
  }

  // Sesión del taller
  const session = await env.DB.prepare(`
    SELECT email, role FROM workshop_sessions 
    WHERE workshop_id = ? AND token = ? AND expires_at > ?
  `).bind(workshopId, token, nowIso).first();
  return session;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Admin-Key',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
        }
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return json({ status: 'ok', time: new Date().toISOString() });
    }

    // Rutas de Super-Admin (/api/admin/*)
    if (url.pathname.startsWith('/api/admin/')) {
      const db = env.DB;
      if (!db) return json({ error: 'Database binding missing' }, 500);

      // Endpoint de Login (Público)
      if (url.pathname === '/api/admin/auth/login' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const email = (body.email || '').trim().toLowerCase();
        const rawPassword = body.password || '';
        const password = rawPassword.trim();

        if (!email || !password) {
          return json({ error: 'Ingresá tu correo y contraseña.' }, 400);
        }

        const admin = await db.prepare('SELECT email, name, password_hash FROM super_admins WHERE email = ?').bind(email).first();
        if (!admin) {
          return json({ error: 'Credenciales inválidas. Verificá tu correo.' }, 401);
        }

        const inputHash = await hashPassword(rawPassword);
        const trimmedHash = await hashPassword(password);
        if (!admin.password_hash || (admin.password_hash !== inputHash && admin.password_hash !== trimmedHash)) {
          return json({ error: 'Contraseña incorrecta.' }, 401);
        }

        // Generar sesión segura de 30 días
        const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
        const sessionExpiresAt = new Date(Date.now() + 30 * 86400000).toISOString();

        await db.prepare('UPDATE super_admins SET session_token = ?, session_expires_at = ? WHERE email = ?')
          .bind(sessionToken, sessionExpiresAt, email).run();

        return json({
          success: true,
          token: sessionToken,
          admin: { email: admin.email, name: admin.name }
        });
      }

      // Verificación de autenticación para todas las demás rutas de Super Admin
      const currentAdmin = await getAdminFromSession(request, env);
      if (!currentAdmin) {
        return json({ error: 'Acceso no autorizado al panel Super-Admin. Iniciá sesión.' }, 401);
      }

      // Endpoint: Info del Administrador logueado
      if (url.pathname === '/api/admin/auth/me' && request.method === 'GET') {
        return json({ admin: currentAdmin });
      }

      // Endpoint: Cerrar Sesión
      if (url.pathname === '/api/admin/auth/logout' && request.method === 'POST') {
        await db.prepare('UPDATE super_admins SET session_token = NULL, session_expires_at = NULL WHERE email = ?')
          .bind(currentAdmin.email).run();
        return json({ success: true });
      }

      // Endpoint: Cambiar Contraseña
      if (url.pathname === '/api/admin/auth/change-password' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const currentPassword = body.current_password || '';
        const newPassword = (body.new_password || '').trim();

        if (newPassword.length < 8) {
          return json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' }, 400);
        }

        const admin = await db.prepare('SELECT password_hash FROM super_admins WHERE email = ?').bind(currentAdmin.email).first();
        const currentHash = await hashPassword(currentPassword);
        if (admin.password_hash && admin.password_hash !== currentHash) {
          return json({ error: 'La contraseña actual ingresada es incorrecta.' }, 400);
        }

        const newHash = await hashPassword(newPassword);
        await db.prepare('UPDATE super_admins SET password_hash = ? WHERE email = ?').bind(newHash, currentAdmin.email).run();
        return json({ success: true });
      }

      const botRoute = url.pathname.match(/^\/api\/admin\/bot\/(qr|disconnect)$/);
      if (botRoute) {
        if (!env.BOT_ADMIN_KEY || !env.BOT_URL) return json({error:'Configurá el bot de administración.'},503);
        const action = botRoute[1];
        if (request.method !== (action === 'qr' ? 'GET' : 'POST')) return json({error:'Método inválido'},405);
        let upstream;
        try {
          upstream = new URL('/api/' + action, env.BOT_URL);
        } catch {
          return json({error:'BOT_URL inválida en el servidor.'},503);
        }
        if (upstream.protocol !== 'https:') return json({error:'El bot requiere HTTPS'},503);
        upstream.searchParams.set('format','json');
        try {
          const response = await fetch(upstream.toString(), {
            method: request.method,
            redirect: 'manual',
            headers: {
              Authorization: 'Bearer ' + env.BOT_ADMIN_KEY.trim(),
              Accept: 'application/json',
              'User-Agent': 'TuTaller-Worker/1.0'
            }
          });
          if (response.status >= 300 && response.status < 400) {
            return json({ error: `El bot devolvió una redirección inesperada (HTTP ${response.status})` }, 500);
          }
          const rawText = await response.text();
          let parsed = null;
          try { parsed = JSON.parse(rawText); } catch {}
          if (!response.ok) {
            const msg = parsed?.error || `El bot respondió HTTP ${response.status}`;
            const status = (response.status === 401 || response.status === 502) ? 500 : response.status;
            return json({ error: msg }, status);
          }
          return new Response(parsed ? JSON.stringify(parsed) : rawText, {
            status: response.status,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          });
        } catch (err) {
          return json({ error: `No se pudo conectar al bot (${err?.message || 'error de red'})` }, 500);
        }
      }

      // 1. Métricas generales
      if (url.pathname === '/api/admin/metrics' && request.method === 'GET') {
        const nowIso = new Date().toISOString();
        const in7Days = new Date(Date.now() + 7 * 86400000).toISOString();
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

        const [totalRes, activeRes, expiringRes, suspendedRes, weekOrdersRes] = await Promise.all([
          db.prepare('SELECT COUNT(*) as count FROM workshops').first(),
          db.prepare('SELECT COUNT(*) as count FROM workshops WHERE status = ? AND expires_at > ?').bind('active', nowIso).first(),
          db.prepare('SELECT COUNT(*) as count FROM workshops WHERE status = ? AND expires_at BETWEEN ? AND ?').bind('active', nowIso, in7Days).first(),
          db.prepare('SELECT COUNT(*) as count FROM workshops WHERE status = ? OR expires_at <= ?').bind('suspended', nowIso).first(),
          db.prepare('SELECT COUNT(*) as count FROM repair_orders WHERE created_at >= ?').bind(sevenDaysAgo).first()
        ]);

        // Talleres con alerta de abandono (talleres activos con caída de órdenes en última semana)
        const workshops = (await db.prepare('SELECT id, name FROM workshops WHERE status = ? AND expires_at > ?').bind('active', nowIso).all()).results || [];
        let churnRiskCount = 0;

        for (const w of workshops) {
          const [thisWeek, lastWeek] = await Promise.all([
            db.prepare('SELECT COUNT(*) as count FROM repair_orders WHERE workshop_id = ? AND created_at >= ?').bind(w.id, sevenDaysAgo).first(),
            db.prepare('SELECT COUNT(*) as count FROM repair_orders WHERE workshop_id = ? AND created_at BETWEEN ? AND ?').bind(w.id, fourteenDaysAgo, sevenDaysAgo).first()
          ]);
          const tw = thisWeek?.count || 0;
          const lw = lastWeek?.count || 0;
          if (lw >= 3 && tw <= 1) churnRiskCount++;
        }

        return json({
          total_workshops: totalRes?.count || 0,
          active_workshops: activeRes?.count || 0,
          expiring_soon: expiringRes?.count || 0,
          suspended_or_expired: suspendedRes?.count || 0,
          orders_this_week: weekOrdersRes?.count || 0,
          churn_risk_workshops: churnRiskCount
        });
      }

      // 2. Listado de talleres con estado y métricas
      if (url.pathname === '/api/admin/workshops' && request.method === 'GET') {
        const query = await db.prepare(`
          SELECT 
            w.*,
            (SELECT COUNT(*) FROM clients c WHERE c.workshop_id = w.id) as client_count,
            (SELECT COUNT(*) FROM repair_orders ro WHERE ro.workshop_id = w.id) as total_orders
          FROM workshops w 
          ORDER BY w.created_at DESC
        `).all();

        const workshops = query.results || [];
        const now = Date.now();
        const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
        const fourteenDaysAgo = new Date(now - 14 * 86400000).toISOString();

        const enriched = await Promise.all(workshops.map(async w => {
          const expiresMs = Date.parse(w.expires_at) || 0;
          const isLifetime = w.plan === 'lifetime' || (expiresMs && expiresMs > Date.parse('2090-01-01'));
          const remainingMs = expiresMs - now;
          const daysRemaining = isLifetime ? null : Math.ceil(remainingMs / (86400000));
          const isExpired = isLifetime ? false : remainingMs <= 0;

          const [thisWeekRes, lastWeekRes] = await Promise.all([
            db.prepare('SELECT COUNT(*) as count FROM repair_orders WHERE workshop_id = ? AND created_at >= ?').bind(w.id, sevenDaysAgo).first(),
            db.prepare('SELECT COUNT(*) as count FROM repair_orders WHERE workshop_id = ? AND created_at BETWEEN ? AND ?').bind(w.id, fourteenDaysAgo, sevenDaysAgo).first()
          ]);

          const ordersThisWeek = thisWeekRes?.count || 0;
          const ordersLastWeek = lastWeekRes?.count || 0;

          let activityStatus = 'healthy';
          if (w.status !== 'active' || isExpired) {
            activityStatus = 'inactive';
          } else if (ordersLastWeek >= 3 && ordersThisWeek <= 1) {
            activityStatus = 'churn_risk';
          } else if (ordersThisWeek === 0 && w.total_orders > 0) {
            activityStatus = 'moderate';
          }

          return {
            ...w,
            is_lifetime: isLifetime,
            days_remaining: daysRemaining,
            is_expired: isExpired,
            orders_this_week: ordersThisWeek,
            orders_last_week: ordersLastWeek,
            activity_status: activityStatus
          };
        }));

        return json({ workshops: enriched });
      }

      // 3. Crear nuevo taller
      if (url.pathname === '/api/admin/workshops' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const name = (body.name || '').trim();
        const rawSlug = (body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        const slug = rawSlug || name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
        const ownerEmail = (body.owner_email || '').trim().toLowerCase();
        const phone = (body.phone || '').trim();
        const address = (body.address || '').trim();
        const plan = body.plan === 'pro' ? 'pro' : 'basic';
        const isLifetime = body.duration_days === 'lifetime' || parseInt(body.duration_days, 10) >= 36500;
        const durationDays = parseInt(body.duration_days, 10) || 30;
        const notes = (body.notes || '').trim();

        if (!name || name.length < 2) return json({ error: 'El nombre del taller es obligatorio (mínimo 2 caracteres).' }, 400);
        if (!slug || slug.length < 2) return json({ error: 'El identificador (slug) es inválido.' }, 400);
        if (!ownerEmail || !ownerEmail.includes('@')) return json({ error: 'El correo del dueño es inválido.' }, 400);

        // Verificar si ya existe slug
        const existing = await db.prepare('SELECT id FROM workshops WHERE slug = ?').bind(slug).first();
        if (existing) return json({ error: `El identificador "${slug}" ya está en uso. Elegí otro slug.` }, 400);

        const country = (body.country || 'AR').trim().toUpperCase();
        const countryConfig = {
          AR: { currency: 'ARS', payments: 'efectivo,mercadopago,transferencia,tarjeta' },
          MX: { currency: 'MXN', payments: 'efectivo,mercadopago,transferencia,tarjeta' },
          CO: { currency: 'COP', payments: 'efectivo,nequi,daviplata,transferencia,tarjeta' },
          CL: { currency: 'CLP', payments: 'efectivo,webpay,transferencia,tarjeta' },
          PE: { currency: 'PEN', payments: 'efectivo,yape,plin,transferencia,tarjeta' },
          UY: { currency: 'UYU', payments: 'efectivo,prex,transferencia,tarjeta' },
          ES: { currency: 'EUR', payments: 'efectivo,bizum,transferencia,tarjeta' },
          US: { currency: 'USD', payments: 'efectivo,transferencia,tarjeta,stripe' }
        };
        const cfg = countryConfig[country] || countryConfig.AR;
        const currency = cfg.currency;
        const paymentMethods = cfg.payments;

        const id = crypto.randomUUID();
        const now = new Date();
        const nowIso = now.toISOString();
        const expiresAt = isLifetime ? '2099-12-31T23:59:59.000Z' : new Date(now.getTime() + durationDays * 86400000).toISOString();

        await db.batch([
          db.prepare(`
            INSERT INTO workshops (id, name, slug, owner_email, phone, address, plan, status, expires_at, notes, country, currency, payment_methods, onboarding_completed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 0, ?, ?)
          `).bind(id, name, slug, ownerEmail, phone, address, plan, expiresAt, notes, country, currency, paymentMethods, nowIso, nowIso),

          db.prepare(`
            INSERT INTO workshop_users (id, workshop_id, email, name, role, created_at)
            VALUES (?, ?, ?, ?, 'owner', ?)
          `).bind(crypto.randomUUID(), id, ownerEmail, name, nowIso),

          db.prepare(`
            INSERT INTO workshop_settings (workshop_id, name, phone, address, email, estimate_valid_days, warranty_days, warranty_terms, reception_terms, country, currency, payment_methods, version, updated_at)
            VALUES (?, ?, ?, ?, ?, 7, 30, ?, ?, ?, ?, ?, 1, ?)
          `).bind(id, name, phone, address, ownerEmail, `Garantía de 30 días de ${name} sobre la mano de obra y repuestos colocados.`, `Constancia de recepción de ${name} (Tel: ${phone || 'Contacto'}).`, country, currency, paymentMethods, nowIso)
        ]);

        return json({
          success: true,
          workshop: { id, name, slug, owner_email: ownerEmail, plan, country, currency, payment_methods: paymentMethods, expires_at: expiresAt, status: 'active' }
        }, 201);
      }

      // 4. Cambiar estado (suspender / reactivar)
      if (url.pathname.match(/^\/api\/admin\/workshops\/[^/]+\/status$/) && request.method === 'POST') {
        const id = url.pathname.split('/')[4];
        const body = await request.json().catch(() => ({}));
        const newStatus = body.status === 'suspended' ? 'suspended' : 'active';
        await db.prepare('UPDATE workshops SET status = ?, updated_at = ? WHERE id = ?')
          .bind(newStatus, new Date().toISOString(), id).run();
        return json({ success: true, status: newStatus });
      }

      // 5. Renovar suscripción (tiempo / vigencia)
      if (url.pathname.match(/^\/api\/admin\/workshops\/[^/]+\/renew$/) && request.method === 'POST') {
        const id = url.pathname.split('/')[4];
        const body = await request.json().catch(() => ({}));
        const rawDays = body.days;

        let newExpiresAt;
        if (rawDays === 'lifetime' || parseInt(rawDays, 10) >= 36500) {
          newExpiresAt = '2099-12-31T23:59:59.000Z';
        } else {
          const addDays = parseInt(rawDays, 10) || 30;
          const current = await db.prepare('SELECT expires_at FROM workshops WHERE id = ?').bind(id).first();
          if (!current) return json({ error: 'Taller no encontrado' }, 404);

          const currentMs = Date.parse(current.expires_at) || 0;
          const isCurLifetime = currentMs > Date.parse('2090-01-01');
          const baseMs = isCurLifetime ? Date.now() : Math.max(Date.now(), currentMs);
          newExpiresAt = new Date(baseMs + addDays * 86400000).toISOString();
        }

        // Renovar actualiza expires_at y activa el taller, sin alterar el plan
        await db.prepare('UPDATE workshops SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(newExpiresAt, 'active', new Date().toISOString(), id).run();

        return json({ success: true, expires_at: newExpiresAt });
      }

      // 6. Cambiar nivel de plan (basic / pro)
      if (url.pathname.match(/^\/api\/admin\/workshops\/[^/]+\/plan$/) && request.method === 'POST') {
        const id = url.pathname.split('/')[4];
        const body = await request.json().catch(() => ({}));
        const newPlan = body.plan === 'pro' ? 'pro' : 'basic';

        // Solo cambia el plan de software, sin tocar jamás expires_at
        await db.prepare('UPDATE workshops SET plan = ?, updated_at = ? WHERE id = ?')
          .bind(newPlan, new Date().toISOString(), id).run();

        return json({ success: true, plan: newPlan });
      }

      // 7. Eliminar taller
      if (url.pathname.match(/^\/api\/admin\/workshops\/[^/]+$/) && request.method === 'DELETE') {
        const id = url.pathname.split('/')[4];
        await db.prepare('DELETE FROM workshops WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      // 8. Estado del almacenamiento y fotos candidatas a purga
      if (url.pathname === '/api/admin/maintenance/storage' && request.method === 'GET') {
        const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();
        
        const pendingOrdersRes = await db.prepare(`
          SELECT COUNT(*) as count 
          FROM repair_orders 
          WHERE status = 'delivered' 
            AND updated_at <= ? 
            AND (photos_purged_at IS NULL OR photos_purged_at = '')
        `).bind(sixMonthsAgo).first();

        const historyRes = await db.prepare(`
          SELECT 
            COALESCE(SUM(photos_deleted), 0) as total_photos_deleted,
            COALESCE(SUM(bytes_freed), 0) as total_bytes_freed,
            COUNT(*) as total_runs
          FROM storage_maintenance_logs
        `).first();

        const lastLog = await db.prepare(`
          SELECT * FROM storage_maintenance_logs 
          ORDER BY executed_at DESC 
          LIMIT 1
        `).first();

        return json({
          pending_purge_orders: pendingOrdersRes?.count || 0,
          total_photos_purged: historyRes?.total_photos_deleted || 0,
          total_bytes_freed: historyRes?.total_bytes_freed || 0,
          total_runs: historyRes?.total_runs || 0,
          last_run: lastLog || null
        });
      }

      // 9. Ejecutar purga manual de fotos (+180 días)
      if (url.pathname === '/api/admin/maintenance/purge-photos' && request.method === 'POST') {
        const result = await purgeOldOrderPhotos(env, 'manual');
        return json({ success: true, ...result });
      }
    }

    // Ruta de seguimiento público: /api/tracking/:token
    if (url.pathname.startsWith('/api/tracking/')) {
      const token = decodeURIComponent(url.pathname.replace('/api/tracking/', '')).trim();
      const db = env.DB;
      const order = await db.prepare(`
        SELECT o.order_number, o.brand, o.model, o.status, o.fault, o.created_at, o.public_diagnosis AS diagnosis, w.name as workshop_name, w.phone as workshop_phone
        FROM repair_orders o
        JOIN workshops w ON o.workshop_id = w.id
        WHERE o.id = ? OR o.intake_key = ?
      `).bind(token, token).first();

      if (!order) return json({ error: 'Orden no encontrada' }, 404);
      return json({
        order,
        workshop: { name: order.workshop_name, phone: order.workshop_phone }
      });
    }

    // APIs Multi-Tenant para el Taller (/api/workshop/:slug/*)
    if (url.pathname.startsWith('/api/workshop/')) {
      const db = env.DB;
      if (!db) return json({ error: 'Database binding missing' }, 500);

      const parts = url.pathname.split('/');
      const slug = parts[3];
      const subRoute = parts.slice(4).join('/');

      const workshop = await db.prepare('SELECT * FROM workshops WHERE slug = ?').bind(slug).first();
      if (!workshop) return json({ error: 'Taller no encontrado' }, 404);

      const now = Date.now();
      const expiresMs = Date.parse(workshop.expires_at) || 0;
      const isLifetime = (expiresMs && expiresMs > Date.parse('2090-01-01')) || workshop.plan === 'lifetime';
      const daysRemaining = isLifetime ? null : Math.max(0, Math.ceil((expiresMs - now) / 86400000));
      const isExpired = isLifetime ? false : expiresMs <= now;
      const effectivePlan = workshop.plan === 'lifetime' ? 'pro' : workshop.plan;

      await ensureAuthSchema(db);

      // 1. Info básica pública (nombre, logo y estado para la pantalla de login/panel)
      if (subRoute === 'info' && request.method === 'GET') {
        let logoUrl = null;
        try {
          const settings = await db.prepare('SELECT * FROM workshop_settings WHERE workshop_id = ?').bind(workshop.id).first();
          logoUrl = settings?.logo_url || null;
        } catch (e) {
          console.warn('Settings read note:', e.message);
        }

        return json({
          workshop: {
            id: workshop.id,
            name: workshop.name,
            slug: workshop.slug,
            plan: effectivePlan,
            is_lifetime: isLifetime,
            country: workshop.country,
            currency: workshop.currency,
            payment_methods: workshop.payment_methods,
            logo_url: logoUrl,
            days_remaining: daysRemaining,
            is_expired: isExpired
          }
        });
      }

      // 1b. Servir logo subido a R2 (público para pantalla de login y seguimiento)
      if (subRoute === 'logo' && request.method === 'GET') {
        if (!env.FILES) return json({ error: 'Almacenamiento no disponible' }, 503);
        const object = await env.FILES.get(`logos/${workshop.id}`);
        if (!object) return json({ error: 'Logo no encontrado' }, 404);
        return new Response(object.body, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType || 'image/png',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 2. Auth: Solicitar PIN de acceso
      if (subRoute === 'auth/request-pin' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const email = (body.email || '').trim().toLowerCase();

        if (!email || !email.includes('@')) {
          return json({ error: 'Ingresá un correo electrónico válido.' }, 400);
        }

        if (!await workshopLoginRole(db, workshop, email, env)) {
          return json({ error: 'Este correo no está registrado en este taller. Consultá con el administrador.' }, 403);
        }

        // Generar PIN de 6 dígitos
        if (!env.RESEND_API_KEY) return json({ error: 'Correo de acceso no disponible.' }, 503);
        const since = new Date(Date.now() - 15 * 60000).toISOString();
        const recent = await db.prepare('SELECT COUNT(*) AS n FROM workshop_login_codes WHERE workshop_id=? AND email=? AND created_at>?').bind(workshop.id, email, since).first();
        if (recent.n >= 3) return json({ error: 'Esperá antes de pedir otro código.' }, 429);
        const pinCode = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
        const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
        const codeId = crypto.randomUUID();
        const nowIso = new Date().toISOString();

        await db.prepare(`
          INSERT INTO workshop_login_codes (id, workshop_id, email, code, expires_at, used, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `).bind(codeId, workshop.id, email, pinCode, expiresAt, nowIso).run();

        const sent = await sendResendPinEmail(email, pinCode, workshop.name, env);
        if (!sent.success) {
          await db.prepare('DELETE FROM workshop_login_codes WHERE id=?').bind(codeId).run();
          return json({ error: 'No se pudo enviar el código. Intentá nuevamente.' }, 503);
        }
        return json({ success: true, message: 'Código de acceso enviado a tu correo.' });
      }

      // 3. Auth: Validar PIN de acceso
      if (subRoute === 'auth/verify-pin' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const email = (body.email || '').trim().toLowerCase();
        const code = String(body.code || '').replace(/\D/g, '');

        if (!email || !code || code.length !== 6) {
          return json({ error: 'Ingresá el código de 6 dígitos completo.' }, 400);
        }

        const nowIso = new Date().toISOString();
        const validCode = await db.prepare(`
          UPDATE workshop_login_codes SET attempts=attempts+1, used=CASE WHEN code=? THEN 1 ELSE used END
          WHERE id=(SELECT id FROM workshop_login_codes WHERE workshop_id=? AND email=? ORDER BY created_at DESC LIMIT 1)
            AND expires_at>? AND used=0 AND attempts<5 RETURNING used
        `).bind(code, workshop.id, email, nowIso).first();
        if (!validCode?.used) {
          return json({ error: 'Código inválido o expirado. Solicitá uno nuevo.' }, 400);
        }

        const userRole = await workshopLoginRole(db, workshop, email, env);
        if (!userRole) {
          return json({ error: 'Este correo no está registrado en este taller.' }, 403);
        }

        const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
        const sessionExpiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
        const sessionId = crypto.randomUUID();

        await db.prepare(`
          INSERT INTO workshop_sessions (id, workshop_id, email, role, token, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(sessionId, workshop.id, email, userRole, sessionToken, sessionExpiresAt, nowIso).run();

        return json({
          success: true,
          token: sessionToken,
          user: { email, workshop_name: workshop.name }
        });
      }

      // 4. Auth: Estado de sesión del usuario
      if (subRoute === 'auth/me' && request.method === 'GET') {
        const session = await getWorkshopSession(request, env, workshop.id);
        if (!session) return json({ authenticated: false }, 401);
        return json({ authenticated: true, user: session });
      }

      // 5. Auth: Cerrar Sesión
      if (subRoute === 'auth/logout' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token) {
          await db.prepare('DELETE FROM workshop_sessions WHERE workshop_id = ? AND token = ?').bind(workshop.id, token).run();
        }
        return json({ success: true });
      }

      // Verificación de autenticación para todas las siguientes acciones del taller
      const sessionUser = await getWorkshopSession(request, env, workshop.id);
      if (!sessionUser) {
        return json({ error: 'Acceso no autorizado al taller. Por favor ingresá con tu PIN.' }, 401);
      }

      // Envío de WhatsApp automático usando el bot central configurado en el servidor
      if (subRoute === 'bot/send' && request.method === 'POST') {
        if (!env.BOT_URL || !env.BOT_API_KEY) {
          return json({ error: 'Bot de WhatsApp no configurado en el servidor.' }, 503);
        }
        const body = await request.json().catch(() => ({}));
        const phone = String(body.phone || '').trim();
        const message = String(body.message || '').trim();
        if (!phone || !message) {
          return json({ error: 'Faltan parámetros requeridos: phone y message.' }, 400);
        }
        let upstream;
        try {
          upstream = new URL('/api/send', env.BOT_URL);
        } catch {
          return json({ error: 'BOT_URL inválida en el servidor.' }, 503);
        }
        if (upstream.protocol !== 'https:') return json({ error: 'El bot requiere HTTPS' }, 503);
        try {
          const response = await fetch(upstream.toString(), {
            method: 'POST',
            redirect: 'manual',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + env.BOT_API_KEY.trim(),
              Accept: 'application/json',
              'User-Agent': 'TuTaller-Worker/1.0'
            },
            body: JSON.stringify({ phone, message })
          });
          if (response.status >= 300 && response.status < 400) {
            return json({ error: `El bot devolvió una redirección inesperada (HTTP ${response.status})` }, 500);
          }
          const rawText = await response.text();
          let parsed = null;
          try { parsed = JSON.parse(rawText); } catch {}
          if (!response.ok) {
            const msg = parsed?.error || `El bot respondió HTTP ${response.status}`;
            const status = (response.status === 401 || response.status === 502) ? 500 : response.status;
            return json({ error: msg }, status);
          }
          return new Response(parsed ? JSON.stringify(parsed) : rawText, {
            status: response.status,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          });
        } catch (err) {
          return json({ error: `No se pudo conectar al bot (${err?.message || 'error de red'})` }, 500);
        }
      }

      // Fotos de orden: almacenamiento privado por taller y acceso autenticado.
      const photoRoute = subRoute.match(/^orders\/([^/]+)\/photos(?:\/([^/]+))?$/);
      if (photoRoute) {
        await ensureOrderPhotosSchema(db);
        const orderId = decodeURIComponent(photoRoute[1]);
        const photoId = photoRoute[2] ? decodeURIComponent(photoRoute[2]) : null;
        const order = await db.prepare('SELECT id FROM repair_orders WHERE id = ? AND workshop_id = ?')
          .bind(orderId, workshop.id).first();
        if (!order) return json({ error: 'Orden no encontrada' }, 404);

        if (request.method === 'GET' && photoId) {
          const photo = await db.prepare('SELECT * FROM repair_order_photos WHERE id = ? AND order_id = ? AND workshop_id = ?')
            .bind(photoId, orderId, workshop.id).first();
          if (!photo) return json({ error: 'Foto no encontrada' }, 404);
          if (!env.FILES) return json({ error: 'Almacenamiento de fotos no disponible' }, 503);
          const object = await env.FILES.get(photo.object_key);
          if (!object) return json({ error: 'La imagen ya no está disponible' }, 404);
          return new Response(object.body, {
            headers: {
              'Content-Type': photo.content_type,
              'Cache-Control': 'private, no-store',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            }
          });
        }

        if (request.method === 'GET') {
          const photos = await db.prepare('SELECT id, file_name, content_type, size_bytes, created_at FROM repair_order_photos WHERE order_id = ? AND workshop_id = ? ORDER BY created_at DESC')
            .bind(orderId, workshop.id).all();
          return json({ photos: photos?.results || [] });
        }

        if (request.method === 'POST' && !photoId) {
          if (!env.FILES) return json({ error: 'Almacenamiento de fotos no disponible' }, 503);
          let form;
          try {
            form = await request.formData();
          } catch (err) {
            return json({ error: 'Formato de carga de imágenes inválido' }, 400);
          }
          const files = form.getAll('photos').filter(file => file && typeof file.arrayBuffer === 'function' && file.size > 0);
          if (!files.length) return json({ error: 'Seleccioná al menos una imagen' }, 400);
          if (files.length > 6) return json({ error: 'Podés subir hasta 6 imágenes por carga' }, 400);
          const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
          if (files.some(file => !allowedTypes.has(file.type))) {
            return json({ error: 'Formato no permitido. Usá JPG, PNG, WEBP o HEIC' }, 415);
          }
          if (files.some(file => file.size > 8 * 1024 * 1024)) {
            return json({ error: 'Cada imagen debe pesar como máximo 8 MB' }, 413);
          }
          const currentCount = await db.prepare('SELECT COUNT(*) as count FROM repair_order_photos WHERE order_id = ? AND workshop_id = ?')
            .bind(orderId, workshop.id).first();
          const uploadId = form.get('upload_id');
          if (uploadId && (files.length !== 1 || !/^[a-f0-9-]{36}$/i.test(uploadId))) return json({error:'Carga inválida'},400);
          const savedPhoto = () => db.prepare('SELECT id, file_name FROM repair_order_photos WHERE workshop_id=? AND order_id=? AND id=?').bind(workshop.id,orderId,uploadId).first();
          const previous = uploadId && await savedPhoto();
          if (previous) return json({uploaded:1, photos:[previous]});
          if ((currentCount?.count || 0) + files.length > 24) {
            return json({ error: 'La orden admite hasta 24 imágenes en total' }, 400);
          }

          const extensionByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
          const createdAt = new Date().toISOString();
          const saved = [];
          for (const file of files) {
            const id = crypto.randomUUID();
            const key = `${orderId}/${id}.${extensionByType[file.type]}`;
            try {
              await env.FILES.put(key, file.stream(), {
                httpMetadata: { contentType: file.type }
              });
              await db.prepare('INSERT INTO repair_order_photos (id, workshop_id, order_id, object_key, file_name, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(uploadId || id, workshop.id, orderId, key, String(file.name || 'foto').slice(0, 255), file.type, file.size, createdAt).run();
              saved.push({ id: uploadId || id, file_name: String(file.name || 'foto').slice(0, 255), content_type: file.type, size_bytes: file.size, created_at: createdAt });
            } catch (err) {
              await env.FILES.delete(key).catch(() => {});
              const previous = uploadId && await savedPhoto();
              if (previous) return json({uploaded:1, photos:[previous]});
              return json({ error: 'No se pudieron guardar todas las imágenes' }, 500);
            }
          }
          return json({ uploaded: saved.length, photos: saved }, 201);
        }

        return json({ error: 'Método no permitido' }, 405);
      }

      if (subRoute === 'cash/history' && request.method === 'GET') {
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) return json({error:'Página inválida'},400);
        const rows = await db.prepare(`
          SELECT ce.id, ce.amount_cents/100.0 AS amount, ce.kind AS type, ce.payment_method, ce.notes AS concept, ce.order_id,
                 ro.order_number, ro.brand AS order_brand, ro.model AS order_model, ce.created_at
          FROM cash_entries ce
          LEFT JOIN repair_orders ro ON ce.order_id = ro.id AND ro.workshop_id = ce.workshop_id
          WHERE ce.workshop_id=? ORDER BY ce.created_at DESC, ce.id DESC LIMIT 50 OFFSET ?
        `).bind(workshop.id,offset).all();
        return json({entries:rows.results});
      }

      // 6. Datos completos para el panel
      if (subRoute === 'data' && request.method === 'GET') {
        const [settings, clientsRes, ordersRes, stockRes, cashTotals, cashRes] = await Promise.all([
          db.prepare('SELECT * FROM workshop_settings WHERE workshop_id = ?').bind(workshop.id).first(),
          db.prepare(`
            SELECT c.*, (SELECT COUNT(*) FROM repair_orders ro WHERE ro.client_id = c.id AND ro.workshop_id=c.workshop_id) as order_count
            FROM clients c WHERE c.workshop_id = ? ORDER BY c.created_at DESC
          `).bind(workshop.id).all(),
          db.prepare(`
            SELECT ro.*, c.name as client_name, c.phone as client_phone 
            FROM repair_orders ro 
            LEFT JOIN clients c ON ro.client_id = c.id AND c.workshop_id = ro.workshop_id
            WHERE ro.workshop_id = ? ORDER BY ro.order_number DESC
          `).bind(workshop.id).all(),
          db.prepare('SELECT * FROM stock_products WHERE workshop_id = ? ORDER BY name ASC').bind(workshop.id).all(),
          db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount_cents ELSE 0 END),0)/100.0 AS income,
            COALESCE(SUM(CASE WHEN kind='expense' THEN amount_cents ELSE 0 END),0)/100.0 AS expense,
            COALESCE(SUM(CASE WHEN kind='income' AND payment_method='mercadopago' THEN amount_cents ELSE 0 END),0)/100.0 AS mp
            FROM cash_entries WHERE workshop_id=?`).bind(workshop.id).first(),
          db.prepare(`
            SELECT ce.id, ce.workshop_id, (CAST(ce.amount_cents AS REAL) / 100) as amount, ce.kind as type, ce.payment_method, ce.notes as concept, ce.order_id,
                   ro.order_number, ro.brand as order_brand, ro.model as order_model, ce.created_at 
            FROM cash_entries ce
            LEFT JOIN repair_orders ro ON ce.order_id = ro.id AND ro.workshop_id = ce.workshop_id
            WHERE ce.workshop_id = ? ORDER BY ce.created_at DESC, ce.id DESC LIMIT 50
          `).bind(workshop.id).all()
        ]);

        return json({
          workshop: { ...workshop, plan: effectivePlan, is_lifetime: isLifetime, days_remaining: daysRemaining, is_expired: isExpired },
          settings: settings || {},
          clients: clientsRes?.results || [],
          orders: ordersRes?.results || [],
          stock: stockRes?.results || [],
          cash_totals: cashTotals,
          cash_entries: cashRes?.results || []
        });
      }

      // 3. Onboarding inicial
      if (subRoute === 'onboarding' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const country = (body.country || 'AR').trim().toUpperCase();
        const countryConfig = {
          AR: 'ARS', MX: 'MXN', CO: 'COP', CL: 'CLP', PE: 'PEN', UY: 'UYU', ES: 'EUR', US: 'USD'
        };
        const currency = countryConfig[country] || 'ARS';
        const paymentMethods = body.payment_methods || 'efectivo,mercadopago,transferencia,tarjeta';
        const nowIso = new Date().toISOString();

        await db.batch([
          db.prepare(`
            UPDATE workshops 
            SET country = ?, currency = ?, payment_methods = ?, onboarding_completed = 1, updated_at = ? 
            WHERE id = ?
          `).bind(country, currency, paymentMethods, nowIso, workshop.id),
          db.prepare(`
            UPDATE workshop_settings 
            SET country = ?, currency = ?, payment_methods = ?, updated_at = ? 
            WHERE workshop_id = ?
          `).bind(country, currency, paymentMethods, nowIso, workshop.id)
        ]);

        return json({ success: true });
      }

      // 4. Importar datos de la demo de 48hs
      if (subRoute === 'import-demo' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const demoClients = Array.isArray(body.clients) ? body.clients : [];
        const demoOrders = Array.isArray(body.orders) ? body.orders : [];
        const nowIso = new Date().toISOString();

        let importedClients = 0;
        let importedOrders = 0;
        const clientMap = {};

        for (const dc of demoClients) {
          if (!dc.name) continue;
          const cid = crypto.randomUUID();
          clientMap[dc.id || dc.name] = cid;
          await db.prepare(`
            INSERT INTO clients (id, workshop_id, name, phone, email, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(cid, workshop.id, dc.name, dc.phone || '', dc.email || '', dc.notes || '', nowIso, nowIso).run();
          importedClients++;
        }


        for (const d of demoOrders) {
          const oid = crypto.randomUUID();
          const cid = clientMap[d.client_id || d.client_name] || null;
          await db.prepare(`
            INSERT INTO repair_orders (id, workshop_id, client_id, order_number, brand, model, identifier, fault, condition, accessories, status, diagnosis, intake_key, version, created_at, updated_at)
            VALUES (?, ?, ?, (SELECT COALESCE(MAX(order_number),0)+1 FROM repair_orders WHERE workshop_id=?), ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).bind(
            oid, workshop.id, cid, workshop.id,
            d.brand || 'Celular', d.model || 'Modelo', d.identifier || '',
            d.fault || 'Revisión técnica', d.condition || '', d.accessories || '',
            d.status || 'received', d.diagnosis || '', crypto.randomUUID().slice(0, 12),
            nowIso, nowIso
          ).run();
          importedOrders++;
        }

        return json({ success: true, imported_clients: importedClients, imported_orders: importedOrders });
      }

      if (subRoute === 'clients' && request.method === 'POST') {
        const body = await request.json();
        if (!body.name?.trim() || !body.phone?.trim()) return json({error:'Completá nombre y teléfono.'}, 400);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.prepare('INSERT INTO clients (id, workshop_id, name, phone, email, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(id, workshop.id, body.name.trim(), body.phone.trim(), body.email || '', body.notes || '', now, now).run();
        return json({id}, 201);
      }

      if (subRoute === 'brand' && request.method === 'PUT') {
        const {name, phone, address='', logo_url=''} = await request.json();
        const validLogo = !logo_url || /^https:\/\//i.test(logo_url) || logo_url.startsWith('/api/workshop/');
        if (!name?.trim() || !phone?.trim() || !validLogo) return json({error:'Revisá nombre, teléfono y logo.'},400);
        const now = new Date().toISOString();
        await db.batch([
          db.prepare('UPDATE workshops SET name=?, phone=?, address=?, updated_at=? WHERE id=?').bind(name,phone,address,now,workshop.id),
          db.prepare('UPDATE workshop_settings SET name=?, phone=?, address=?, logo_url=?, updated_at=? WHERE workshop_id=?').bind(name,phone,address,logo_url,now,workshop.id)
        ]);
        return json({success:true});
      }

      if (subRoute === 'logo' && request.method === 'POST') {
        if (!env.FILES) return json({ error: 'Almacenamiento de archivos no disponible.' }, 503);
        let form;
        try {
          form = await request.formData();
        } catch {
          return json({ error: 'Formato de carga inválido.' }, 400);
        }
        const file = form.get('logo');
        if (!file || typeof file.arrayBuffer !== 'function' || file.size <= 0) {
          return json({ error: 'Seleccioná una imagen para el logo.' }, 400);
        }
        const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
        if (!allowedTypes.has(file.type)) {
          return json({ error: 'Formato no permitido. Usá PNG, JPG, WEBP o GIF.' }, 415);
        }
        if (file.size > 4 * 1024 * 1024) {
          return json({ error: 'El logo debe pesar como máximo 4 MB.' }, 413);
        }
        await env.FILES.put(`logos/${workshop.id}`, file.stream(), {
          httpMetadata: { contentType: file.type }
        });
        const logoUrl = `/api/workshop/${encodeURIComponent(workshop.slug)}/logo?v=${Date.now()}`;
        const now = new Date().toISOString();
        await db.prepare('UPDATE workshop_settings SET logo_url=?, updated_at=? WHERE workshop_id=?')
          .bind(logoUrl, now, workshop.id).run();
        return json({ success: true, logo_url: logoUrl });
      }

      // 5. Crear orden
      if (subRoute === 'orders' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        let clientId = body.client_id;
        const nowIso = new Date().toISOString();

        const orderId = body.request_id || crypto.randomUUID();
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({error:'Identificador inválido'},400);
        const existing = () => db.prepare('SELECT id, order_number, intake_key FROM repair_orders WHERE id=? AND workshop_id=?').bind(orderId,workshop.id).first();
        const previous = await existing();
        if (previous) return json({success:true,...previous});
        const statements = [];
        if (clientId && clientId !== 'NEW' && !await db.prepare('SELECT id FROM clients WHERE id=? AND workshop_id=?').bind(clientId, workshop.id).first()) return json({error:'Cliente no encontrado.'},404);
        if (clientId === 'NEW' || !clientId) {
          if (body.client_name) {
            clientId = crypto.randomUUID();
            statements.push(db.prepare(`
              INSERT INTO clients (id, workshop_id, name, phone, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).bind(clientId, workshop.id, body.client_name, body.client_phone || '', nowIso, nowIso));
          } else {
            return json({error:'Elegí un cliente o ingresá su nombre.'},400);
          }
        }


        const rawCost = body.total_cost === '' || body.total_cost == null ? 0 : Number(body.total_cost);
        if (!Number.isFinite(rawCost) || rawCost < 0 || rawCost > 1000000000) {
          return json({ error: 'Importe inválido.' }, 400);
        }

        const intakeKey = crypto.randomUUID().slice(0, 12);

        statements.push(db.prepare(`
          INSERT INTO repair_orders (id, workshop_id, client_id, order_number, brand, model, identifier, fault, condition, accessories, total_cost, status, intake_key, version, created_at, updated_at)
          VALUES (?, ?, ?, (SELECT COALESCE(MAX(order_number),0)+1 FROM repair_orders WHERE workshop_id=?), ?, ?, ?, ?, ?, ?, ?, 'received', ?, 1, ?, ?) RETURNING order_number
        `).bind(
          orderId, workshop.id, clientId, workshop.id,
          body.brand || '', body.model || '', body.identifier || '',
          body.fault || '', body.condition || '', body.accessories || '',
          rawCost, intakeKey, nowIso, nowIso
        ));
        let inserted;
        try {
          const batch = await db.batch(statements);
          inserted = batch.at(-1).results[0];
        } catch (err) {
          const saved = await existing();
          if (saved) return json({success:true,...saved});
          throw err;
        }

        return json({ success: true, id: orderId, order_number: inserted.order_number, intake_key: intakeKey }, 201);
      }

      // 6. Actualizar estado de orden
      if (subRoute.startsWith('orders/') && subRoute.endsWith('/status') && request.method === 'PUT') {
        const orderId = subRoute.split('/')[1];
        const body = await request.json().catch(() => ({}));
        const newStatus = body.status || 'received';
        await db.prepare('UPDATE repair_orders SET status = ?, public_diagnosis = COALESCE(?,public_diagnosis), updated_at = ? WHERE id = ? AND workshop_id = ?')
          .bind(newStatus, typeof body.public_diagnosis === 'string' ? body.public_diagnosis.slice(0,2000) : null, new Date().toISOString(), orderId, workshop.id).run();
        return json({ success: true, status: newStatus });
      }

      // 6b. Guardar importe y detalle del presupuesto en la orden
      if (subRoute.startsWith('orders/') && subRoute.endsWith('/quote') && request.method === 'PUT') {
        const orderId = subRoute.split('/')[1];
        const body = await request.json().catch(() => ({}));
        const rawCost = Number(body.total_cost || 0);
        if (!Number.isFinite(rawCost) || rawCost < 0 || rawCost > 1000000000) {
          return json({ error: 'Importe inválido.' }, 400);
        }
        const quoteDetail = typeof body.quote_detail === 'string' ? body.quote_detail.trim().slice(0, 2000) : '';
        const quoteEta = typeof body.quote_eta === 'string' ? body.quote_eta.trim().slice(0, 120) : '';
        const quoteWarranty = typeof body.quote_warranty === 'string' ? body.quote_warranty.trim().slice(0, 120) : '';
        const nowIso = new Date().toISOString();
        await db.prepare(`
          UPDATE repair_orders
          SET total_cost = ?, quote_detail = ?, quote_eta = ?, quote_warranty = ?, updated_at = ?
          WHERE id = ? AND workshop_id = ?
        `).bind(rawCost, quoteDetail, quoteEta, quoteWarranty, nowIso, orderId, workshop.id).run();
        return json({ success: true, total_cost: rawCost, quote_detail: quoteDetail, quote_eta: quoteEta, quote_warranty: quoteWarranty });
      }

      // 7. Registrar caja
      if (subRoute === 'cash' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const amountCents = Math.round(Number(body.amount || 0) * 100);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          return json({ error: 'Ingresá un importe mayor a 0.' }, 400);
        }
        const kind = body.type === 'out' || body.type === 'expense' ? 'expense' : 'income';
        const method = body.payment_method || 'efectivo';
        const orderId = typeof body.order_id === 'string' && body.order_id.trim() ? body.order_id.trim() : null;
        let linkedOrder = null;
        if (orderId) {
          linkedOrder = await db.prepare('SELECT id, order_number, brand, model FROM repair_orders WHERE id = ? AND workshop_id = ?').bind(orderId, workshop.id).first();
          if (!linkedOrder) return json({ error: 'Orden no encontrada en este taller.' }, 404);
        }
        const defaultNote = linkedOrder
          ? `${kind === 'income' ? 'Cobro' : 'Egreso'} Orden #${linkedOrder.order_number} (${linkedOrder.brand} ${linkedOrder.model})`
          : 'Movimiento de caja';
        const notes = (typeof body.concept === 'string' && body.concept.trim()) ? body.concept.trim().slice(0, 300) : defaultNote;
        const nowIso = new Date().toISOString();
        const entryId = crypto.randomUUID();
        const accountId = `acc-${workshop.id}`;

        const statements = [
          db.prepare(`
            INSERT OR IGNORE INTO finance_accounts (id, workshop_id, direction, total_cents, cost_cents, created_at)
            VALUES (?, ?, 'receivable', ?, 0, ?)
          `).bind(accountId, workshop.id, amountCents, nowIso),

          db.prepare(`
            INSERT INTO cash_entries (id, workshop_id, account_id, amount_cents, kind, payment_method, notes, order_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(entryId, workshop.id, accountId, amountCents, kind, method, notes, orderId, nowIso)
        ];

        if (orderId && kind === 'income') {
          statements.push(
            db.prepare(`
              UPDATE repair_orders
              SET paid_cents = COALESCE(paid_cents, 0) + ?, updated_at = ?
              WHERE id = ? AND workshop_id = ?
            `).bind(amountCents, nowIso, orderId, workshop.id)
          );
        }

        await db.batch(statements);

        return json({ success: true, id: entryId, order_id: orderId }, 201);
      }
    }

    // Ruta de seguimiento público: /seguimiento/:token
    if (url.pathname.startsWith('/seguimiento/')) {
      const parts = url.pathname.split('/');
      const token = parts[2] || '';
      const trackingReq = new Request(new URL('/seguimiento/?token=' + encodeURIComponent(token), request.url), request);
      return env.ASSETS.fetch(trackingReq);
    }

    // Ruta de acceso al taller del cliente: /t/:slug
    const tMatch = url.pathname.match(/^\/t\/([a-zA-Z0-9-]+)\/?$/);
    if (tMatch) {
      const slug = tMatch[1];
      const db = env.DB;
      if (db) {
        const w = await db.prepare('SELECT id, name, status, expires_at FROM workshops WHERE slug = ?').bind(slug).first();
        if (!w) {
          return new Response(`<!DOCTYPE html><html><body style="background:#0b1110;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;"><div style="max-width:440px;margin:auto;background:#141f1c;padding:32px;border-radius:12px;border:1px solid #243b34;"><h2>Taller no encontrado</h2><p style="color:#9fb5a8;margin:12px 0 20px;">El taller "${slug}" no existe o fue dado de baja.</p><a href="https://tutallersoft.com" style="background:#10b981;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">Ir a Tu Taller Soft</a></div></body></html>`, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        const isExpired = Date.parse(w.expires_at) <= Date.now();
        if (w.status === 'suspended' || isExpired) {
          return new Response(`<!DOCTYPE html><html><body style="background:#0b1110;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;"><div style="max-width:440px;margin:auto;background:#141f1c;padding:32px;border-radius:12px;border:1px solid #ef4444;"><h2 style="color:#ef4444;margin-bottom:8px;">Taller Suspendido</h2><p style="color:#9fb5a8;line-height:1.5;">El acceso al taller <strong>${w.name}</strong> está pausado por vencimiento de suscripción.</p><p style="margin-top:18px;"><a href="https://wa.me/5491178200237?text=Hola!%20Quiero%20renovar%20la%20suscripci%C3%B3n%20de%20mi%20taller%20${w.name}" style="background:#10b981;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">📲 Contactar para Reactivar</a></p></div></body></html>`, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      }
      const tallerReq = new Request(new URL('/taller/?slug=' + encodeURIComponent(slug), request.url), request);
      const tRes = await env.ASSETS.fetch(tallerReq);
      const tHeaders = new Headers(tRes.headers);
      tHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      tHeaders.set('Pragma', 'no-cache');
      return new Response(tRes.body, { status: tRes.status, headers: tHeaders });
    }

    // Servir archivos estáticos del frontend (sin cache para /admin y /taller)
    const assetRes = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/taller') || url.pathname === '/admin.js') {
      const resHeaders = new Headers(assetRes.headers);
      resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      resHeaders.set('Pragma', 'no-cache');
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers: resHeaders
      });
    }
    return assetRes;
  },

  // Disparador programado (Cron Job mensual)
  async scheduled(event, env, ctx) {
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(purgeOldOrderPhotos(env, 'cron'));
    } else {
      await purgeOldOrderPhotos(env, 'cron');
    }
  }
};

async function purgeOldOrderPhotos(env, triggerType = 'manual') {
  const db = env.DB;
  const files = env.FILES;
  if (!db) throw new Error('Database binding missing');
  await ensureOrderPhotosSchema(db);

  // 180 días atrás (6 meses)
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();

  // Buscar órdenes entregadas hace más de 180 días que no hayan sido purgadas
  const query = await db.prepare(`
    SELECT id, workshop_id, order_number, status, updated_at 
    FROM repair_orders 
    WHERE status = 'delivered' 
      AND updated_at <= ? 
      AND (photos_purged_at IS NULL OR photos_purged_at = '')
    LIMIT 200
  `).bind(sixMonthsAgo).all();

  const candidates = query.results || [];
  let ordersProcessed = 0;
  let photosDeleted = 0;
  let bytesFreed = 0;
  const nowIso = new Date().toISOString();

  for (const order of candidates) {
    if (files) {
      const prefixes = [`${order.id}/`, `${order.workshop_id}/${order.id}/`];
      for (const prefix of prefixes) {
        try {
          const listRes = await files.list({ prefix, limit: 30 });
          if (listRes && listRes.objects) {
            for (const obj of listRes.objects) {
              await files.delete(obj.key);
              photosDeleted++;
              bytesFreed += (obj.size || 0);
            }
          }
        } catch (err) {
          console.error('Error al listar/borrar fotos en R2 para orden:', order.id, err);
        }
      }
    }

    // Marcar orden como purgada
    await db.prepare('DELETE FROM repair_order_photos WHERE order_id = ? AND workshop_id = ?')
      .bind(order.id, order.workshop_id).run();
    await db.prepare('UPDATE repair_orders SET photos_purged_at = ? WHERE id = ?')
      .bind(nowIso, order.id).run();
    ordersProcessed++;
  }

  // Registrar auditoría de mantenimiento
  const logId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO storage_maintenance_logs (id, trigger_type, orders_count, photos_deleted, bytes_freed, executed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(logId, triggerType, ordersProcessed, photosDeleted, bytesFreed, nowIso).run();

  return {
    orders_processed: ordersProcessed,
    photos_deleted: photosDeleted,
    bytes_freed: bytesFreed,
    executed_at: nowIso
  };
}
