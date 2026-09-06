FROM node:22-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY packages/backend/ ./packages/backend/

WORKDIR /app/packages/backend

RUN npm install --legacy-peer-deps

RUN npx prisma generate
RUN npm run build

EXPOSE 5000

CMD ["node", "dist/src/server.js"]
