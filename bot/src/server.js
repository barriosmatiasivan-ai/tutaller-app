import express from 'express';
import cors from 'cors';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, '../session_auth');
const API_KEY = process.env.BOT_API_KEY || '';

// Asegurar que exista la carpeta de sesión persistente
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Estado en memoria
let sock = null;
let currentQr = null;
let connectionState = 'disconnected'; // 'disconnected' | 'qr_ready' | 'connecting' | 'connected'
let connectedPhone = null;
let retryCount = 0;

// Import dinámico de Baileys
async function initWhatsApp() {
  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await import('@whiskeysockets/baileys');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    logger.info({ version }, 'Iniciando conexión con WhatsApp Baileys...');
    connectionState = 'connecting';

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }), // Silenciar logs internos de Baileys
      auth: state,
      printQRInTerminal: true,
      browser: ['TuTaller Soft', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('Nuevo código QR generado para escaneo');
        try {
          currentQr = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
          connectionState = 'qr_ready';
        } catch (err) {
          logger.error({ err }, 'Error convirtiendo QR a imagen');
        }
      }

      if (connection === 'open') {
        connectionState = 'connected';
        currentQr = null;
        retryCount = 0;
        const rawId = sock?.user?.id || '';
        connectedPhone = rawId.split(':')[0] || rawId.split('@')[0] || 'Conectado';
        logger.info({ phone: connectedPhone }, '✅ Sesión de WhatsApp iniciada exitosamente');
      }

      if (connection === 'close') {
        currentQr = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn({ statusCode, shouldReconnect }, 'Conexión cerrada con WhatsApp');

        if (statusCode === DisconnectReason.loggedOut) {
          connectionState = 'disconnected';
          connectedPhone = null;
          logger.info('Dispositivo desvinculado por el usuario. Limpiando credenciales...');
          try {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            fs.mkdirSync(SESSION_DIR, { recursive: true });
          } catch (e) {
            logger.error({ e }, 'Error al limpiar sesión');
          }
        } else if (shouldReconnect) {
          connectionState = 'connecting';
          retryCount++;
          const delay = Math.min(retryCount * 2000, 10000);
          logger.info(`Reintentando conexión en ${delay / 1000}s (intento ${retryCount})...`);
          setTimeout(initWhatsApp, delay);
        } else {
          connectionState = 'disconnected';
          connectedPhone = null;
        }
      }
    });

    // -------------------------------------------------------------
    // Auto-Respondedor y Chatbot para Mensajes Entrantes de Clientes
    // -------------------------------------------------------------
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try {
        if (type !== 'notify') return;

        for (const m of messages) {
          if (!m.message) continue;
          const jid = m.key.remoteJid;
          if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

          // Si el mensaje lo envió el dueño (desde el celular o WhatsApp Web):
          if (m.key.fromMe) {
            // Pausa el bot para este contacto durante 2 horas para no interrumpir la atención humana
            chatStates.set(jid, { ...(chatStates.get(jid) || {}), pausedUntil: Date.now() + 2 * 3600 * 1000 });
            logger.info({ jid }, 'El dueño respondió en el chat. Bot pausado por 2 horas para este contacto.');
            continue;
          }

          // Verificar si el chat está pausado por atención humana
          const chatState = chatStates.get(jid) || {};
          const now = Date.now();
          if (chatState.pausedUntil && chatState.pausedUntil > now) {
            continue;
          }

          // Extraer texto del mensaje
          const text = (
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            m.message.imageMessage?.caption ||
            ''
          ).trim();

          // Evitar responder spam repetitivo en menos de 6 minutos salvo comandos directos
          const isCommand = /^(1|2|3|precio|precios|demo|sistema|orden|#|horario|ubicacion|humano)/i.test(text);
          if (chatState.lastReplied && (now - chatState.lastReplied < 6 * 60 * 1000) && !isCommand) {
            continue;
          }

          const rawReply = generateBotReply(text, m);
          if (rawReply) {
            const isHandoff = rawReply.includes('[[HUMANO]]');
            const cleanReply = rawReply.replace(/\[\[HUMANO\]\]/g, '').trim();

            try {
              await sock.sendPresenceUpdate('composing', jid).catch(() => {});
              await new Promise(r => setTimeout(r, 1200));
              await sock.sendMessage(jid, { text: cleanReply });
              await sock.sendPresenceUpdate('paused', jid).catch(() => {});

              chatStates.set(jid, {
                ...chatState,
                lastReplied: now,
                pausedUntil: isHandoff ? (now + 2 * 3600 * 1000) : 0
              });
              logger.info({ jid, preview: cleanReply.slice(0, 35) }, '✅ Respuesta automática enviada');
            } catch (sendErr) {
              logger.error({ sendErr, jid }, 'Error enviando respuesta automática por WhatsApp');
            }
          }
        }
      } catch (upsertErr) {
        logger.error({ upsertErr }, 'Error en listener messages.upsert');
      }
    });
  } catch (err) {
    logger.error({ err }, 'Error crítico inicializando WhatsApp Baileys');
    connectionState = 'disconnected';
  }
}

// Estado en memoria para conversaciones y cooldown
const chatStates = new Map();

function generateBotReply(rawText, messageObj) {
  const t = (rawText || '').toLowerCase().trim();

  // Si mandó solo un audio o una imagen sin texto
  if (!t && (messageObj?.message?.audioMessage || messageObj?.message?.imageMessage)) {
    return `¡Hola! 👋 Recibimos tu mensaje. En breve Matías o el equipo técnico te responde por este mismo chat en cuanto se desocupe del banco de trabajo. [[HUMANO]]`;
  }

  // 1. Consultas sobre el software TuTaller / Demo / Precios del sistema
  if (
    t.includes('tutaller') ||
    t.includes('sistema') ||
    t.includes('software') ||
    t.includes('programa') ||
    t.includes('demo') ||
    t.includes('probar') ||
    t === '1'
  ) {
    if (t.includes('precio') || t.includes('cuanto') || t.includes('sale') || t.includes('costo') || t.includes('plan')) {
      return `¡Hola! 🔧 Los planes de *TuTaller Soft* son fijos y sin sorpresas:\n\n⭐ *Plan Mensual:* $15.000 / mes (sin contrato de permanencia).\n👑 *Pase Vitalicio Fundador:* $110.000 (único pago de por vida, cupos limitados).\n\nAmbos incluyen módulo de WhatsApp, órdenes con fotos y control de caja/stock.\n\n👉 Podés probar la *Demo gratuita de 48hs* acá:\nhttps://demo.tutallersoft.com\n\n¿Querés que te activemos tu taller de prueba?`;
    }
    return `¡Hola! 👋 *TuTaller Soft* es el sistema en la nube diseñado para talleres de celulares y electrónica:\n\n✅ Órdenes de reparación con fotos y seguimiento en vivo por QR.\n✅ Avisos automáticos de WhatsApp cuando el equipo está listo.\n✅ Control de caja, deudas de clientes, repuestos y compras.\n\n👉 Probá la *Demo interactiva de 48hs* gratis (sin tarjeta):\nhttps://demo.tutallersoft.com\n\nSi querés activar tu taller de prueba o conocer los planes, avisanos por acá.`;
  }

  // 2. Precios generales
  if (t === 'precio' || t === 'precios' || t.includes('cuanto cuesta el sistema') || t.includes('cuanto sale el sistema')) {
    return `Planes disponibles de *TuTaller Soft*:\n\n⭐ *Plan Mensual:* $15.000 / mes (sin contratos ni permanencia).\n👑 *Pase Vitalicio:* $110.000 (un solo pago de por vida).\n\n👉 Para probar cómo funciona en vivo:\nhttps://demo.tutallersoft.com`;
  }

  // 3. Consultas sobre reparación de celular / presupuesto técnico
  if (
    t.includes('repar') ||
    t.includes('pantalla') ||
    t.includes('modulo') ||
    t.includes('módulo') ||
    t.includes('bateria') ||
    t.includes('batería') ||
    t.includes('tapa') ||
    t.includes('pin de carga') ||
    t.includes('no prende') ||
    t.includes('presupuesto') ||
    t.includes('arregl') ||
    t.includes('vidrio') ||
    t.includes('camara') ||
    t.includes('cámara') ||
    t.includes('celular') ||
    t.includes('telefono') ||
    t.includes('teléfono') ||
    t === '2'
  ) {
    return `¡Hola! 📱 Para pasarte el presupuesto exacto de la reparación, por favor indicanos:\n\n1️⃣ *Marca y modelo exacto* (ej: Samsung A32, iPhone 11, Moto G22)\n2️⃣ *Qué problema tiene* (pantalla rota, no carga, no da imagen, etc.)\n\nEn breve te confirmamos costo de repuesto y tiempo estimado de entrega. [[HUMANO]]`;
  }

  // 4. Consulta de estado de orden / reparación en curso
  if (
    t.includes('orden') ||
    t.includes('#') ||
    t.includes('seguimiento') ||
    t.includes('estado') ||
    t.includes('como va') ||
    t.includes('como viene') ||
    t.includes('esta listo') ||
    t.includes('está listo') ||
    t.includes('retiro') ||
    t === '3'
  ) {
    return `¡Hola! 🔍 Podés consultar el estado de tu equipo en tiempo real desde tu enlace de seguimiento:\nhttps://app.tutallersoft.com/seguimiento/\n\nO pasanos por acá tu *número de orden* o nombre con el que ingresó el celular y te decimos cómo va.`;
  }

  // 5. Horarios y atención
  if (t.includes('horario') || t.includes('horarios') || t.includes('abierto') || t.includes('cuando abren') || t.includes('direccion') || t.includes('dirección') || t.includes('ubicacion') || t.includes('ubicación')) {
    return `📍 *Horarios de atención:*\nLunes a viernes de 9:00 a 18:00 hs.\n\n¿En qué podemos ayudarte hoy?`;
  }

  // 6. Pedido de atención humana directa
  if (t.includes('humano') || t.includes('persona') || t.includes('asesor') || t.includes('matias') || t.includes('matías') || t.includes('hablar con')) {
    return `¡Perfecto! 👋 Le dejamos aviso a Matías para que te responda directamente por este chat en cuanto se desocupe del banco de trabajo. [[HUMANO]]`;
  }

  // 7. Saludo por defecto / Menú inicial
  return `¡Hola! 👋 Te damos la bienvenida a *Tu Taller*.\n\n¿En qué podemos ayudarte hoy?\n\n1️⃣ *Software TuTaller Soft:* si sos técnico o dueño de taller y querés ver el sistema de gestión.\n2️⃣ *Reparación de celulares:* si necesitás presupuesto para arreglar un equipo.\n3️⃣ *Estado de orden:* si ya dejaste un equipo en el taller y querés consultar el estado.\n\nEscribinos tu consulta y te respondemos a la brevedad.`;
}

// Normalizador de teléfono argentino e internacional
function formatWhatsAppJid(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/\D/g, '');
  if (!clean) return null;

  // Si es un número argentino que empieza con 0, quitarlo
  clean = clean.replace(/^0+/, '');

  // Si es argentino local (ej: 1123456789 o 91123456789)
  if (clean.length === 10) {
    clean = '549' + clean;
  } else if (clean.length === 11 && clean.startsWith('9')) {
    clean = '54' + clean;
  } else if (clean.startsWith('54') && !clean.startsWith('549') && clean.length === 12) {
    // Formato 5411... -> 54911...
    clean = '549' + clean.slice(2);
  }

  return `${clean}@s.whatsapp.net`;
}

// Middleware de autenticación opcional por API Key
function adminMiddleware(req, res, next) {
  const key = process.env.BOT_ADMIN_KEY;
  if (!key) return res.status(503).json({error:'Administración no configurada'});
  if (req.get('Authorization') !== 'Bearer ' + key) return res.sendStatus(401);
  next();
}

function authMiddleware(req, res, next) {
  if (!API_KEY) return res.status(503).json({error:'Bot no configurado'});
  const bearer = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  const provided = req.headers['x-api-key'] || bearer;
  if (!provided || provided !== API_KEY) {
    return res.status(401).json({ error: 'No autorizado. Clave de acceso inválida.' });
  }
  next();
}

// --- RUTAS DE LA API ---

// 1. Estado de salud básico
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// 2. Estado de conexión del Bot
app.get('/api/status', (req, res) => {
  res.json({
    state: connectionState,
    connected: connectionState === 'connected',
    phone: connectedPhone,
    hasQr: !!currentQr,
    timestamp: new Date().toISOString(),
  });
});

// 3. Obtener el código QR en Base64 o vista web para escanear
app.get('/api/qr', adminMiddleware, (req, res) => {
  const wantsJson = req.headers.accept?.includes('application/json') || req.query.format === 'json';

  if (wantsJson) {
    return res.json({
      state: connectionState,
      connected: connectionState === 'connected',
      phone: connectedPhone,
      qr: currentQr,
    });
  }

  // Vista HTML amigable para escanear directamente con el celular desde cualquier navegador
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Vincular WhatsApp · TuTaller Soft</title>
      <meta http-equiv="refresh" content="${connectionState === 'connected' ? '15' : '4'}">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1110; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: #131e18; border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 18px; padding: 32px 28px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
        .qr-box { background: #ffffff; padding: 14px; border-radius: 14px; display: inline-block; margin: 20px auto; }
        .qr-box img { display: block; max-width: 280px; width: 100%; height: auto; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 13px; }
        .badge.connected { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; }
        .badge.waiting { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
        .badge.connecting { background: rgba(6, 182, 212, 0.2); color: #22d3ee; border: 1px solid #06b6d4; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 10px 0; }
        ol { text-align: left; font-size: 13.5px; color: #cbd5e1; line-height: 1.6; padding-left: 20px; }
        .btn { display: inline-block; background: #ef4444; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 13px; margin-top: 16px; border: 0; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2 style="margin: 0 0 10px; color: #fff;">WhatsApp del Taller</h2>
        
        ${
          connectionState === 'connected'
            ? `
          <div class="badge connected">🟢 Conectado con éxito</div>
          <p style="margin-top: 18px; font-size: 16px; color: #fff;">Número vinculado: <strong>+${connectedPhone}</strong></p>
          <p>Tu bot está listo y enviando notificaciones automáticas desde TuTaller Soft.</p>
          <form method="POST" action="/api/disconnect">
            <button type="submit" class="btn">Desvincular celular</button>
          </form>
        `
            : connectionState === 'qr_ready' && currentQr
            ? `
          <div class="badge waiting">🟡 Esperando escaneo</div>
          <div class="qr-box">
            <img src="${currentQr}" alt="Escanear código QR de WhatsApp">
          </div>
          <ol>
            <li>Abrí WhatsApp en tu celular</li>
            <li>Tocá <strong>Menú (⋮)</strong> o <strong>Configuración</strong></li>
            <li>Elegí <strong>Dispositivos vinculados</strong></li>
            <li>Tocá <strong>Vincular un dispositivo</strong> y apuntá la cámara aquí</li>
          </ol>
          <p style="font-size: 12px; color: #64748b;">El código se actualiza automáticamente.</p>
        `
            : `
          <div class="badge connecting">🔵 Generando código QR...</div>
          <p style="margin-top: 20px;">Iniciando conexión con WhatsApp. Esperá unos segundos, la página se recargará automáticamente.</p>
        `
        }
      </div>
    </body>
    </html>
  `);
});

// 4. Enviar mensaje de WhatsApp (llamado por TuTaller Soft)
app.post('/api/send', authMiddleware, async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos: phone y message.' });
    }

    if (connectionState !== 'connected' || !sock) {
      return res.status(503).json({
        error: 'El bot de WhatsApp no está conectado. Escaneá el código QR primero.',
        state: connectionState,
      });
    }

    const jid = formatWhatsAppJid(phone);
    if (!jid) {
      return res.status(400).json({ error: 'Formato de número telefónico inválido.' });
    }

    logger.info({ jid, length: message.length }, 'Enviando mensaje de WhatsApp...');
    const result = await sock.sendMessage(jid, { text: message });

    res.json({
      success: true,
      messageId: result.key?.id,
      to: jid,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Error enviando mensaje de WhatsApp');
    res.status(500).json({ error: err.message || 'Error al enviar el mensaje por WhatsApp.' });
  }
});

// 5. Desvincular / Cerrar sesión
app.post('/api/disconnect', adminMiddleware, async (req, res) => {
  try {
    logger.info('Desconectando WhatsApp a petición del usuario...');
    if (sock) {
      await sock.logout().catch(() => {});
    }
    connectionState = 'disconnected';
    connectedPhone = null;
    currentQr = null;

    try {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    } catch {}

    setTimeout(initWhatsApp, 1500);

    const isHtml = req.headers.accept?.includes('text/html');
    if (isHtml) {
      return res.redirect('/api/qr');
    }
    res.json({ success: true, message: 'Sesión cerrada y credenciales eliminadas.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Iniciar servidor HTTP y conexión Baileys
app.listen(PORT, () => {
  logger.info(`🚀 Servidor WhatsApp QR Bot escuchando en el puerto ${PORT}`);
  logger.info(`📱 Panel de escaneo QR disponible en http://localhost:${PORT}/api/qr`);
  initWhatsApp();
});
