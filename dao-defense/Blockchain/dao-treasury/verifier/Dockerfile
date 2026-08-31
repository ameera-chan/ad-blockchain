FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js checks.js register.js ./
COPY abi ./abi

ENV NODE_ENV=production PORT=9090
EXPOSE 9090
CMD ["node", "server.js"]
