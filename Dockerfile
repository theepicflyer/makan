FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-slim AS server
# Warren is installed from its git repository, which npm clones and builds.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app/server
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY server/package.json ./
COPY server/migrations ./migrations
COPY data/reference /app/data/reference
COPY --from=web /web/build /app/web/build
# The release this image is (build-push.yml passes it), recorded on each assistant turn.
ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION \
    NODE_ENV=production \
    DATA_DIR=/data \
    REFERENCE_DIR=/app/data/reference \
    STATIC_DIR=/app/web/build
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
