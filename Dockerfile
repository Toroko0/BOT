# Multi-stage Dockerfile for Discord Bot

# Build stage
FROM node:18 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build || true

# Production stage
FROM node:18-slim
WORKDIR /app

# Copy app files and node_modules from builder
COPY --from=builder /app /app
COPY --from=builder /app/node_modules /app/node_modules

RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "index.js"]
