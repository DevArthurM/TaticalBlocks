# TaticalBlocks — imagem de produção: um único contêiner com o servidor NestJS
# (API em /api, WebSocket do online em /server) servindo o jogo compilado em /.

# ───── build: instala tudo e compila cliente (Vite) e servidor (Nest) ─────
FROM node:22-alpine AS build
WORKDIR /app

# dependências primeiro (cache das camadas enquanto só o código muda)
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY shared shared
COPY client client
COPY server server
RUN npm run build -w server && npm run build -w client

# ───── runtime: só dependências de produção + arquivos compilados ─────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    CLIENT_DIR=/app/client/dist

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --include-workspace-root \
    && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/api/health > /dev/null || exit 1

CMD ["node", "server/dist/server/src/main.js"]
