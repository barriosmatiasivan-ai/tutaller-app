# TuTaller Soft — Bot de WhatsApp con Código QR (Baileys)

Microservicio ligero y autónomo para conectar el WhatsApp oficial de cualquier taller técnico a **TuTaller Soft** mediante el escaneo de un código QR multi-dispositivo.

## 🚀 Despliegue en 2 minutos en Railway (Recomendado)

1. En [Railway.app](https://railway.app), tocá **"New Project"** → **"Deploy from GitHub repo"**.
2. Seleccioná el repositorio **`tutaller-bot`**.
3. En la configuración del servicio en Railway:
   - Andá a la pestaña **Volumes** y agregá un volumen con el path de montaje: `/data`. *(Esto asegura que la sesión de WhatsApp no se desloguee cuando el servidor se reinicie)*.
   - En **Networking**, generá un dominio público (ej: `tutaller-bot-production.up.railway.app`).
4. ¡Listo! Abrí esa URL en tu navegador o copiala para vincularla en TuTaller Soft.

---

## 📱 Cómo Vincular tu Celular

1. Abrí la URL de tu bot (ej: `https://tu-bot.up.railway.app/api/qr`).
2. Abrí WhatsApp en el teléfono del taller:
   - Tocá **Menú (tres puntos)** en Android o **Configuración** en iPhone.
   - Tocá **Dispositivos vinculados**.
   - Tocá **Vincular un dispositivo**.
   - Apuntá la cámara a la pantalla para escanear el código QR.
3. En 3 segundos la pantalla se pondrá en verde: **"🟢 Conectado con éxito: +54 9..."**.

---

## 🛠️ Endpoints de la API

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/health` | Chequeo de salud y uptime del bot |
| `GET` | `/api/status` | Estado actual (`connected`, `qr_ready`, `connecting`, `disconnected`) |
| `GET` | `/api/qr` | Devuelve el código QR (HTML para escanear o JSON si se pide con `Accept: application/json`) |
| `POST` | `/api/send` | Envía un mensaje. Body: `{ "phone": "1123456789", "message": "Hola..." }` |
| `POST` | `/api/disconnect` | Cierra la sesión y borra las credenciales para vincular otro número |

### Ejemplo de envío desde cualquier sistema:
```bash
curl -X POST https://tu-bot.up.railway.app/api/send \
  -H "Content-Type: application/json" \
  -d '{"phone": "5491178200237", "message": "Tu equipo Motorola G54 está listo para retirar!"}'
```
