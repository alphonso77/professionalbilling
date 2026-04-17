# ---- Stage 1: production dependencies ----
FROM node:20-alpine AS deps
RUN apk add --no-cache tini
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- Stage 2: build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Stage 3: runtime ----
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./

COPY --from=build /app/dist ./dist

COPY datastore/ ./datastore/
COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

COPY .env.example ./

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh", "api"]
