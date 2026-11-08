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

function getAdminEmail(request, env) {
  const cfEmail = request.headers.get('cf-access-authenticated-user-email');
  if (cfEmail) return cfEmail.toLowerCase();
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim().toLowerCase();
  }
  const url = new URL(request.url);
  const adminKey = url.searchParams.get('admin_key') || request.headers.get('X-Admin-Key');
  if (adminKey && adminKey === (env.ADMIN_SECRET_KEY || 'tutaller-admin-2026')) {
    return (env.SUPER_ADMIN_EMAIL || SUPER_ADMIN_DEFAULT).toLowerCase();
  }
  return null;
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

      const email = getAdminEmail(request, env);
      const superAdminEmail = (env.SUPER_ADMIN_EMAIL || SUPER_ADMIN_DEFAULT).toLowerCase();

      // Permitir si coincide con el correo del super admin o si está en la tabla super_admins
      let isSuperAdmin = email && email === superAdminEmail;
      if (!isSuperAdmin && email) {
        try {
          const row = await db.prepare('SELECT email FROM super_admins WHERE email = ?').bind(email).first();
          if (row) isSuperAdmin = true;
        } catch {}
      }

      // Si no es super admin y no viene clave de administración
      if (!isSuperAdmin) {
        return json({ error: 'Acceso no autorizado al panel Super-Admin' }, 401);
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

        const id = crypto.randomUUID();
        const now = new Date();
        const nowIso = now.toISOString();
        const expiresAt = new Date(now.getTime() + durationDays * 86400000).toISOString();

        await db.batch([
          db.prepare(`
            INSERT INTO workshops (id, name, slug, owner_email, phone, address, plan, status, expires_at, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
          `).bind(id, name, slug, ownerEmail, phone, address, plan, expiresAt, notes, nowIso, nowIso),

          db.prepare(`
            INSERT INTO workshop_users (id, workshop_id, email, name, role, created_at)
            VALUES (?, ?, ?, ?, 'owner', ?)
          `).bind(crypto.randomUUID(), id, ownerEmail, name, nowIso),

          db.prepare(`
            INSERT INTO workshop_settings (workshop_id, name, phone, address, email, estimate_valid_days, warranty_days, warranty_terms, reception_terms, version, updated_at)
            VALUES (?, ?, ?, ?, ?, 7, 30, ?, ?, 1, ?)
          `).bind(id, name, phone, address, ownerEmail, `Garantía de 30 días de ${name} sobre la mano de obra y repuestos colocados.`, `Constancia de recepción de ${name} (Tel: ${phone || 'Contacto'}).`, nowIso)
        ]);

        return json({
          success: true,
          workshop: { id, name, slug, owner_email: ownerEmail, plan, expires_at: expiresAt, status: 'active' }
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
