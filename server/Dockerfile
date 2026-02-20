FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/relay.ts ./server/relay.ts
COPY tsconfig.json ./
RUN npx tsx --version
EXPOSE 3001
CMD ["npx", "tsx", "server/relay.ts"]
