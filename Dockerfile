FROM node:20-slim

WORKDIR /app

# Copy the entire backend directory
COPY packages/backend/ ./packages/backend/

# Copy root package.json for workspaces
COPY package.json package-lock.json* ./

# Install dependencies
WORKDIR /app/packages/backend
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy full monorepo source needed for build
WORKDIR /app
COPY packages/web/package.json* ./packages/web/ 2>/dev/null || true

# Build TypeScript
WORKDIR /app/packages/backend
RUN npm run build

# Expose port
EXPOSE 5000

# Start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
