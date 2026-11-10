# The printer bridge, for a Raspberry Pi, a NAS or any always-on computer on the home network. Multi-arch:
#
#   docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 -f bridge/Dockerfile -t spaghetti-bridge .
#
# Run it with bridge/compose.example.yaml. Read docs/bridge.md first.

FROM node:26-trixie-slim AS deps
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Only what runs: the bridge needs mqtt, basic-ftp and fflate.
RUN pnpm install --frozen-lockfile --prod

FROM node:26-trixie-slim
# ffmpeg takes the camera frame; without it prints just get no photo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production BRIDGE_DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY bridge ./bridge
COPY src/shared ./src/shared
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "bridge/index.ts"]
