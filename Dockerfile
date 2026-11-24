FROM node:24.12-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The checked-in lock currently lacks transitive entries; reconcile it in the build stage.
# Restore npm ci after a reviewed, regenerated package-lock.json is committed.
RUN npm install --include=dev --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24.12-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/server ./server
COPY --from=build /app/scripts/backup-sqlite.mjs ./scripts/backup-sqlite.mjs
COPY --from=build /app/dist/client ./dist/client
USER node
EXPOSE 8080
CMD ["node", "server.ts"]
