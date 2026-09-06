FROM node:22-slim

WORKDIR /app

COPY packages/backend/ ./packages/backend/

WORKDIR /app/packages/backend

RUN npm install --legacy-peer-deps

RUN npx prisma generate
RUN npm run build

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
