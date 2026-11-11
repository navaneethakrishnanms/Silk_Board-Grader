# Build from the repo root: docker build -f frontend/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY backend/api/package.json backend/api/
COPY frontend/package.json frontend/
RUN npm install --no-audit --no-fund --ignore-scripts --workspace @silkgrade/web --workspace @silkgrade/shared --include-workspace-root
COPY packages/shared packages/shared
COPY frontend frontend
RUN cd frontend && npx vite build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
