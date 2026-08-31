FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends supervisor curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install a pinned Foundry release (anvil) — reproducibility for a competition
# image matters more than tracking latest. Extract binaries onto PATH.
ARG FOUNDRY_VERSION=v1.3.5
RUN curl -L "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C /usr/local/bin \
    && anvil --version

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

ENV NODE_ENV=production PORT=8080
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
