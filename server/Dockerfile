# Sketchboard backend. Build from the repository root (the server imports ../shared):
#   docker build -f server/Dockerfile -t sketchboard-server .
FROM node:22-alpine

WORKDIR /app/server

# Dependencies first for layer caching. postinstall runs `prisma generate`,
# so the schema and prisma.config.ts must be present before `npm ci`.
COPY server/package.json server/package-lock.json server/prisma.config.ts ./
COPY server/prisma ./prisma
# tsx runs the TypeScript sources directly, so dev dependencies are needed.
RUN npm ci --include=dev && npx prisma generate && npm cache clean --force

COPY shared /app/shared
COPY server/src ./src
COPY server/tsconfig.json ./
# shared/*.ts imports `zod`; resolve it from the server's node_modules.
RUN ln -s /app/server/node_modules /app/node_modules

ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE=auto \
    DATA_DIR=/app/server/data
# Optional: copy a built client to /app/dist (or set CLIENT_DIST) to serve it with SPA fallback.

EXPOSE 4000
VOLUME ["/app/server/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

# node (not npx) as PID 1 receives SIGTERM and flushes collaboration rooms.
CMD ["node", "--import", "tsx", "src/index.ts"]
