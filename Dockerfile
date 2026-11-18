# Builds the client, then runs the API server which also serves the built client.
FROM node:22-alpine AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
COPY server/prisma ./server/prisma
COPY server/prisma.config.ts ./server/
RUN cd server && npm ci
COPY server ./server
COPY --from=client /app/dist ./dist
WORKDIR /app/server
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
