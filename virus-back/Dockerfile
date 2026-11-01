# Servidor de Roña (Express + Socket.IO). Contexto de build: la raíz del repo,
# porque el servidor importa el motor desde ../../shared.
#   docker build -f virus-back/Dockerfile -t rona-server .
# Node ≥ 22.13: trae node:sqlite sin bandera (cuentas y amigos). Versión fija para no heredar una imagen vieja en caché
FROM node:22.15-alpine

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
WORKDIR /app

# Primero sólo las dependencias, para que la capa se reutilice si no cambia el lock
COPY virus-back/package.json virus-back/package-lock.json ./virus-back/
RUN cd virus-back && npm ci --omit=dev && npm cache clean --force

COPY shared/ ./shared/
COPY virus-back/src/ ./virus-back/src/

# Base SQLite de cuentas y amigos: en compose se monta ahí un volumen con nombre (hereda este dueño)
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
WORKDIR /app/virus-back
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "src/index.js"]
