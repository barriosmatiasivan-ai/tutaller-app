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
  const cfEmail = request.headers.get('cf-access-authenticated-user-email');
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

async function sendResendPinEmail(toEmail, pinCode, workshopName, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[AUTH PIN] Resend API key pendiente en env. Código para ${toEmail} (${workshopName}): ${pinCode}`);
    return { success: true, simulated: true };
  }

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
        const password = body.password || '';

        if (!email || !password) {
          return json({ error: 'Ingresá tu correo y contraseña.' }, 400);
        }

        const admin = await db.prepare('SELECT email, name, password_hash FROM super_admins WHERE email = ?').bind(email).first();
        if (!admin) {
          return json({ error: 'Credenciales inválidas. Verificá tu correo.' }, 401);
        }

        const inputHash = await hashPassword(password);
        if (!admin.password_hash || admin.password_hash !== inputHash) {
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

      // 1. Métricas generales
      if (url.pathname === '/api/admin/metrics' && request.method === 'GET') {
        const nowIso = new Date().toISOString();
        const in7Days = new Date(Date.now() + 7 * 86400000).toISOString();
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

        const [totalRes, activeRes, expiringRes, suspendedRes, weekOrdersRes] = await Promise.all([
          db.prepare('SELECT COUNT(*) as count FROM workshops').first(),
          db.prepare('SELECT COUNT(*) as count FROM workshops WHERE status = "active" AND expires_at > ?').bind(nowIso).first(),
          db.prepare('SELECT COUNT(*) as count FROM workshops WHERE status = "active" AND expires_at BETWEEN ? AND ?').bind(nowIso, in7Days).first(),
          db.prepare('SELECT COUNT(*) as count FROM workshops WHERE status = "suspended" OR expires_at <= ?').bind(nowIso).first(),
          db.prepare('SELECT COUNT(*) as count FROM repair_orders WHERE created_at >= ?').bind(sevenDaysAgo).first()
        ]);

        // Talleres con alerta de abandono (talleres activos con caída de órdenes en última semana)
        const workshops = (await db.prepare('SELECT id, name FROM workshops WHERE status = "active" AND expires_at > ?').bind(nowIso).all()).results || [];
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
          const remainingMs = expiresMs - now;
          const daysRemaining = Math.ceil(remainingMs / (86400000));
          const isExpired = remainingMs <= 0;

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
        const expiresAt = new Date(now.getTime() + durationDays * 86400000).toISOString();

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

      // 5. Renovar suscripción (+días)
      if (url.pathname.match(/^\/api\/admin\/workshops\/[^/]+\/renew$/) && request.method === 'POST') {
        const id = url.pathname.split('/')[4];
        const body = await request.json().catch(() => ({}));
        const addDays = parseInt(body.days, 10) || 30;

        const current = await db.prepare('SELECT expires_at FROM workshops WHERE id = ?').bind(id).first();
        if (!current) return json({ error: 'Taller no encontrado' }, 404);

        const currentMs = Date.parse(current.expires_at) || 0;
        const baseMs = Math.max(Date.now(), currentMs);
        const newExpiresAt = new Date(baseMs + addDays * 86400000).toISOString();

        await db.prepare('UPDATE workshops SET expires_at = ?, status = "active", updated_at = ? WHERE id = ?')
          .bind(newExpiresAt, new Date().toISOString(), id).run();

        return json({ success: true, expires_at: newExpiresAt });
      }

      // 6. Cambiar plan (basic / pro)
      if (url.pathname.match(/^\/api\/admin\/workshops\/[^/]+\/plan$/) && request.method === 'POST') {
        const id = url.pathname.split('/')[4];
        const body = await request.json().catch(() => ({}));
        const newPlan = body.plan === 'pro' ? 'pro' : 'basic';
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
        SELECT o.*, w.name as workshop_name, w.phone as workshop_phone
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
      const daysRemaining = Math.max(0, Math.ceil((expiresMs - now) / 86400000));
      const isExpired = expiresMs <= now;

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
            country: workshop.country,
            currency: workshop.currency,
            payment_methods: workshop.payment_methods,
            logo_url: logoUrl,
            days_remaining: daysRemaining,
            is_expired: isExpired
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

        // Verificar si el correo pertenece al taller o es el Super-Admin
        const isOwner = workshop.owner_email && workshop.owner_email.toLowerCase() === email;
        const isSuperAdmin = email === SUPER_ADMIN_DEFAULT.toLowerCase();
        let registeredUser = null;

        if (!isOwner && !isSuperAdmin) {
          registeredUser = await db.prepare('SELECT id, name, role FROM workshop_users WHERE workshop_id = ? AND LOWER(email) = ?')
            .bind(workshop.id, email).first();
        }

        if (!isOwner && !isSuperAdmin && !registeredUser) {
          return json({ error: 'Este correo no está registrado en este taller. Consultá con el administrador.' }, 403);
        }

        // Generar PIN de 6 dígitos
        const pinCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
        const codeId = crypto.randomUUID();
        const nowIso = new Date().toISOString();

        await db.prepare(`
          INSERT INTO workshop_login_codes (id, workshop_id, email, code, expires_at, used, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `).bind(codeId, workshop.id, email, pinCode, expiresAt, nowIso).run();

        await sendResendPinEmail(email, pinCode, workshop.name, env);

        return json({
          success: true,
          message: 'Código de acceso enviado a tu correo.',
          ...(env.RESEND_API_KEY ? {} : { dev_pin: pinCode })
        });
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
          SELECT id FROM workshop_login_codes 
          WHERE workshop_id = ? AND email = ? AND code = ? AND used = 0 AND expires_at > ?
          ORDER BY created_at DESC
        `).bind(workshop.id, email, code, nowIso).first();

        if (!validCode) {
          return json({ error: 'Código inválido o expirado. Solicitá uno nuevo.' }, 400);
        }

        // Marcar como usado
        await db.prepare('UPDATE workshop_login_codes SET used = 1 WHERE id = ?').bind(validCode.id).run();

        // Crear sesión de 30 días
        const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
        const sessionExpiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
        const sessionId = crypto.randomUUID();

        await db.prepare(`
          INSERT INTO workshop_sessions (id, workshop_id, email, role, token, expires_at, created_at)
          VALUES (?, ?, ?, 'technician', ?, ?, ?)
        `).bind(sessionId, workshop.id, email, sessionToken, sessionExpiresAt, nowIso).run();

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

      // 6. Datos completos para el panel
      if (subRoute === 'data' && request.method === 'GET') {
        const [settings, clientsRes, ordersRes, stockRes, cashRes] = await Promise.all([
          db.prepare('SELECT * FROM workshop_settings WHERE workshop_id = ?').bind(workshop.id).first(),
          db.prepare(`
            SELECT c.*, (SELECT COUNT(*) FROM repair_orders ro WHERE ro.client_id = c.id) as order_count 
            FROM clients c WHERE c.workshop_id = ? ORDER BY c.created_at DESC
          `).bind(workshop.id).all(),
          db.prepare(`
            SELECT ro.*, c.name as client_name, c.phone as client_phone 
            FROM repair_orders ro 
            LEFT JOIN clients c ON ro.client_id = c.id 
            WHERE ro.workshop_id = ? ORDER BY ro.order_number DESC
          `).bind(workshop.id).all(),
          db.prepare('SELECT * FROM stock_products WHERE workshop_id = ? ORDER BY name ASC').bind(workshop.id).all(),
          db.prepare(`
            SELECT id, workshop_id, (CAST(amount_cents AS REAL) / 100) as amount, kind as type, payment_method, notes as concept, created_at 
            FROM cash_entries WHERE workshop_id = ? ORDER BY created_at DESC LIMIT 50
          `).bind(workshop.id).all()
        ]);

        return json({
          workshop: { ...workshop, days_remaining: daysRemaining, is_expired: isExpired },
          settings: settings || {},
          clients: clientsRes?.results || [],
          orders: ordersRes?.results || [],
          stock: stockRes?.results || [],
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

        const maxRow = await db.prepare('SELECT MAX(order_number) as max_num FROM repair_orders WHERE workshop_id = ?').bind(workshop.id).first();
        let nextNum = (maxRow?.max_num || 0) + 1;

        for (const d of demoOrders) {
          const oid = crypto.randomUUID();
          const cid = clientMap[d.client_id || d.client_name] || null;
          await db.prepare(`
            INSERT INTO repair_orders (id, workshop_id, client_id, order_number, brand, model, identifier, fault, condition, accessories, status, diagnosis, intake_key, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).bind(
            oid, workshop.id, cid, nextNum++,
            d.brand || 'Celular', d.model || 'Modelo', d.identifier || '',
            d.fault || 'Revisión técnica', d.condition || '', d.accessories || '',
            d.status || 'received', d.diagnosis || '', crypto.randomUUID().slice(0, 12),
            nowIso, nowIso
          ).run();
          importedOrders++;
        }

        return json({ success: true, imported_clients: importedClients, imported_orders: importedOrders });
      }

      // 5. Crear orden
      if (subRoute === 'orders' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        let clientId = body.client_id;
        const nowIso = new Date().toISOString();

        if (clientId === 'NEW' || !clientId) {
          if (body.client_name) {
            clientId = crypto.randomUUID();
            await db.prepare(`
              INSERT INTO clients (id, workshop_id, name, phone, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).bind(clientId, workshop.id, body.client_name, body.client_phone || '', nowIso, nowIso).run();
          } else {
            clientId = null;
          }
        }

        const maxRow = await db.prepare('SELECT MAX(order_number) as max_num FROM repair_orders WHERE workshop_id = ?').bind(workshop.id).first();
        const orderNumber = (maxRow?.max_num || 0) + 1;
        const orderId = crypto.randomUUID();
        const intakeKey = crypto.randomUUID().slice(0, 12);

        await db.prepare(`
          INSERT INTO repair_orders (id, workshop_id, client_id, order_number, brand, model, identifier, fault, condition, accessories, status, intake_key, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, 1, ?, ?)
        `).bind(
          orderId, workshop.id, clientId, orderNumber,
          body.brand || '', body.model || '', body.identifier || '',
          body.fault || '', body.condition || '', body.accessories || '',
          intakeKey, nowIso, nowIso
        ).run();

        return json({ success: true, id: orderId, order_number: orderNumber, intake_key: intakeKey }, 201);
      }

      // 6. Actualizar estado de orden
      if (subRoute.startsWith('orders/') && subRoute.endsWith('/status') && request.method === 'PUT') {
        const orderId = subRoute.split('/')[1];
        const body = await request.json().catch(() => ({}));
        const newStatus = body.status || 'received';
        await db.prepare('UPDATE repair_orders SET status = ?, updated_at = ? WHERE id = ? AND workshop_id = ?')
          .bind(newStatus, new Date().toISOString(), orderId, workshop.id).run();
        return json({ success: true, status: newStatus });
      }

      // 7. Registrar caja
      if (subRoute === 'cash' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const amountCents = Math.round(Number(body.amount || 0) * 100);
        const kind = body.type === 'out' || body.type === 'expense' ? 'expense' : 'income';
        const method = body.payment_method || 'efectivo';
        const notes = body.concept || 'Movimiento de caja';
        const nowIso = new Date().toISOString();
        const entryId = crypto.randomUUID();
        const accountId = `acc-${workshop.id}`;

        await db.batch([
          db.prepare(`
            INSERT OR IGNORE INTO finance_accounts (id, workshop_id, direction, total_cents, cost_cents, created_at)
            VALUES (?, ?, 'receivable', ?, 0, ?)
          `).bind(accountId, workshop.id, amountCents, nowIso),

          db.prepare(`
            INSERT INTO cash_entries (id, workshop_id, account_id, amount_cents, kind, payment_method, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(entryId, workshop.id, accountId, amountCents, kind, method, notes, nowIso)
        ]);

        return json({ success: true, id: entryId }, 201);
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
          return new Response(`<!DOCTYPE html><html><body style="background:#0b1110;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;"><div style="max-width:440px;margin:auto;background:#141f1c;padding:32px;border-radius:12px;border:1px solid #ef4444;"><h2 style="color:#ef4444;margin-bottom:8px;">Taller Suspendido</h2><p style="color:#9fb5a8;line-height:1.5;">El acceso al taller <strong>${w.name}</strong> está pausado por vencimiento de suscripción.</p><p style="margin-top:18px;"><a href="https://wa.me/5491123456789?text=Hola!%20Quiero%20renovar%20la%20suscripci%C3%B3n%20de%20mi%20taller%20${w.name}" style="background:#10b981;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">📲 Contactar para Reactivar</a></p></div></body></html>`, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      }
      const tallerReq = new Request(new URL('/taller/?slug=' + encodeURIComponent(slug), request.url), request);
      return env.ASSETS.fetch(tallerReq);
    }

    // Servir archivos estáticos del frontend
    return env.ASSETS.fetch(request);
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
