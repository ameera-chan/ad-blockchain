FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends supervisor curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Foundry (anvil) for per-session ephemeral chains. Install as root,
# then place the binary on PATH for the `node` user (supervisord drops privs).
RUN curl -L https://foundry.paradigm.xyz | bash \
    && /root/.foundry/bin/foundryup \
    && cp /root/.foundry/bin/anvil /usr/local/bin/anvil

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY contracts ./contracts
COPY lib ./lib
COPY gateway ./gateway
COPY scripts ./scripts
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production PORT=8080 SESSION_TTL_MS=300000
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
