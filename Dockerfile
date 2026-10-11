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
#
# The deploy is retried with a short backoff because the first connection to
# the managed Postgres can time out transiently (Prisma P1002) while the
# database is still waking up, which previously failed an otherwise-good
# deploy and left the previous container serving old code. Migrations must
# still succeed before the server starts; after the retries the boot exits
# non-zero, so a genuinely broken migration never serves traffic.
CMD ["sh", "-c", "i=0; until npx prisma migrate deploy; do i=$((i+1)); echo \"prisma migrate deploy failed (attempt $i)\"; if [ $i -ge 5 ]; then echo 'migrations did not apply after 5 attempts'; exit 1; fi; sleep 10; done; node dist/src/server.js"]
