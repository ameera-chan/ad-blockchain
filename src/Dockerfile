FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends supervisor curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG FOUNDRY_VERSION=v1.3.5
RUN curl -L "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C /usr/local/bin \
    && anvil --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY contracts ./contracts
COPY lib ./lib
RUN node -e "require('./lib/compiler').writePrecompiledArtifacts()"
COPY gateway ./gateway
COPY scripts ./scripts
COPY player/dist-ameera-ad-dao/ /challenge/
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /challenge/tools/daoctl.sh \
    && chown -R node:node /challenge

ENV NODE_ENV=production PORT=8080 ANVIL_HOST=127.0.0.1 ANVIL_PORT=8545 ANVIL_STATE=/data/anvil-state.json
VOLUME /data
EXPOSE 8080
WORKDIR /challenge
ENTRYPOINT ["/entrypoint.sh"]
