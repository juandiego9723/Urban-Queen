# ── STAGE 1: Build & Install dependencies ──────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# ── STAGE 2: Production Image ─────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Crear usuario no privilegiado para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Asignar permisos al usuario no root
USER nodejs

EXPOSE 8080

CMD ["node", "server.js"]
