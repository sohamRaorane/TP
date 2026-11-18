# Full app image: builds the client, then runs the API + collaboration server,
# which also serves the built client (NODE_ENV=production).
#   docker compose up --build   ->  http://localhost:4000

FROM node:22-alpine AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY shared ./shared
COPY src ./src
RUN npx vite build

FROM node:22-alpine
WORKDIR /app/server
# postinstall runs scripts/generate.mjs (prisma generate), so these must exist before npm ci
COPY server/package.json server/package-lock.json server/prisma.config.ts ./
COPY server/prisma ./prisma
COPY server/scripts ./scripts
RUN npm ci --include=dev && npm cache clean --force
COPY shared /app/shared
COPY server/src ./src
COPY server/tsconfig.json ./
# shared/*.ts imports zod; resolve it from the server's node_modules
RUN ln -s /app/server/node_modules /app/node_modules
COPY --from=client /app/dist /app/dist
ENV NODE_ENV=production PORT=4000 CLIENT_DIST=/app/dist
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
