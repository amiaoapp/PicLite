FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS mcp-assets

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run desktop:renderer

FROM rust:1-bookworm AS mcp-builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential curl file libayatana-appindicator3-dev libssl-dev \
      libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev patchelf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
COPY --from=mcp-assets /app/desktop-dist ./desktop-dist
RUN cargo build --locked --release --manifest-path src-tauri/Cargo.toml --bin piclite

FROM node:24-bookworm-slim AS mcp-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS mcp

WORKDIR /app
ENV NODE_ENV=production \
    PICLITE_MCP_HOST=0.0.0.0 \
    PICLITE_MCP_PORT=3210 \
    PICLITE_MCP_WORKSPACE=/workspace \
    PICLITE_BINARY=/usr/local/bin/piclite

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libayatana-appindicator3-1 libgtk-3-0 librsvg2-2 libssl3 \
      libwebkit2gtk-4.1-0 libxdo3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 piclite \
    && useradd --system --uid 10001 --gid piclite --home-dir /app piclite \
    && mkdir -p /workspace/input /workspace/output \
    && chown -R piclite:piclite /workspace

COPY --from=mcp-dependencies --chown=piclite:piclite /app/node_modules ./node_modules
COPY --chown=piclite:piclite package.json ./package.json
COPY --chown=piclite:piclite scripts/mcp-docker.mjs ./scripts/mcp-docker.mjs
COPY --from=mcp-builder --chown=piclite:piclite /src/src-tauri/target/release/piclite /usr/local/bin/piclite

USER piclite
EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3210/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "scripts/mcp-docker.mjs"]

FROM node:24-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3456

RUN groupadd --system piclite \
    && useradd --system --gid piclite --home-dir /app piclite

COPY --from=builder --chown=piclite:piclite /app/dist/standalone ./

USER piclite
EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3456/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
