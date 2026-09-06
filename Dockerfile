FROM node:20-slim

WORKDIR /app

# Copy only package files first for layer caching
COPY packages/backend/package.json packages/backend/package-lock.json* ./
COPY package.json package-lock.json* tsconfig.base.json* ./

# Install all dependencies at root level (monorepo)
RUN npm install

# Copy backend source
COPY packages/backend/ ./packages/backend/

# Generate Prisma client
RUN cd packages/backend && npx prisma generate

# Build TypeScript
RUN cd packages/backend && npm run build

# Expose port
EXPOSE 5000

# Start
CMD ["sh", "-c", "cd packages/backend && npx prisma migrate deploy && node dist/src/server.js"]
