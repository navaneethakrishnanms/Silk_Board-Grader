# Build from the repo root: docker build -f backend/api/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY backend/api/package.json backend/api/
COPY frontend/package.json frontend/
RUN npm install --no-audit --no-fund --workspace @silkgrade/shared --workspace @silkgrade/api --include-workspace-root
COPY packages/shared packages/shared
COPY backend/api backend/api
RUN npm run build -w @silkgrade/shared && cd backend/api && npx prisma generate && npx tsc -p tsconfig.build.json

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/backend/api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
