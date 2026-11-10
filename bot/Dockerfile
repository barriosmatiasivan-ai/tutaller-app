FROM node:20-slim

WORKDIR /app

# Instalar dependencias esenciales
COPY package.json ./
RUN npm install --omit=dev

# Copiar el código fuente
COPY . .

# Directorio para almacenar la sesión persistente de WhatsApp
ENV SESSION_DIR=/data/session_auth
ENV PORT=3000
RUN mkdir -p /data/session_auth

EXPOSE 3000

CMD ["node", "src/server.js"]
