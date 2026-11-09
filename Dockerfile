# Spaghetti on workerd, without a Cloudflare account: the built Worker and
# client run under `wrangler dev` (local mode), with D1 and R2 state kept in
# the /data volume.
#
#   docker build -t spaghetti .
#   docker run -d --name spaghetti -p 8787:8787 -v spaghetti-data:/data spaghetti
#   docker exec -it spaghetti node scripts/user-add.ts

FROM node:26-trixie-slim AS build
ENV CI=1
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:26-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
  SPAGHETTI_STATE_DIR=/data \
  HOST=0.0.0.0 \
  PORT=8787 \
  WRANGLER_SEND_METRICS=false
COPY --from=build /app /app
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "scripts/start.ts"]
