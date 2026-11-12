# Tu Taller Soft — SaaS Multi-Tenant & Super-Admin

Infraestructura Cloudflare Pages Advanced Mode para la gestión y aprovisionamiento de talleres técnicos en **Tu Taller Soft** (`app.tutallersoft.com`).

## Características
- **Aprovisionamiento en 1 Clic:** Creación instantánea de talleres con cálculo de fecha de vencimiento (30, 90, 365 días), aislamiento por `workshop_id`, y configuración por defecto.
- **Detección de Churn / Abandono Temprano:** Algoritmo que monitorea órdenes activas semanales (`orders_this_week` vs `orders_last_week`) para alertar caídas drásticas de actividad.
- **Acciones Rápidas:**
  - Suspender / Reactivar taller en caso de falta de pago.
  - Renovar suscripción (+30, +90, +180 días) con 1 clic.
  - Contacto por WhatsApp directo con mensaje pre-armado de renovación o alerta de soporte.
- **Seguridad Multi-Tenant:** Base de datos D1 (`tutallersoft-d1`) con aislamiento estricto por taller y almacenamiento de archivos R2 (`tutallersoft-r2`).

## Despliegue
```bash
npm ci
npm run preview
# Una vez comprobada la vista previa del commit subido a GitHub
npm run deploy
```

El worker publicado se mantiene en `public/_worker.js`. Aplicar las migraciones D1 pendientes antes de publicar con `npx wrangler d1 migrations apply DB --config wrangler.migrations.json --remote`. Verificar el portal, administración, una ruta de taller, el JavaScript y una orden con foto en el taller de prueba.

Cloudflare Access utiliza `CF_ACCESS_ISSUER` (URL del equipo) y `CF_ACCESS_AUD` (audiencia de la aplicación). El login de administrador por sesión sigue disponible. Para el bot, configurar `BOT_URL` en Pages y el mismo secreto `BOT_ADMIN_KEY` en Pages y Railway. Reservar `BOT_API_KEY` para envío. Los secretos se configuran en los proveedores.
