FROM node:22-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY packages/backend/ ./packages/backend/

WORKDIR /app/packages/backend

RUN npm install --legacy-peer-deps

RUN npx prisma generate
RUN npm run build

EXPOSE 5000

# Apply pending migrations before serving. This service runs as a Docker
# service, so render.yaml's startCommand is ignored -- this CMD is what
# actually starts the process, and it used to be a bare "node dist/src/
# server.js". That is how 20260927_drop_user_phone_verified shipped
# unapplied: the code that stopped reading User.phoneVerified went live while
# the column stayed, and nothing failed. The prisma/migrations directory is
# already copied in above. When nothing is pending this is a fast no-op, and a
# migration that cannot apply fails the boot loudly rather than drifting.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
