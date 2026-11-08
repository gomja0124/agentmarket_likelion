FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
WORKDIR /app
COPY backend/server ./backend/server
COPY backend/web ./backend/web
COPY backend/mcp ./backend/mcp
COPY backend/schemas ./backend/schemas
COPY backend/scripts ./backend/scripts
COPY backend/deploy ./backend/deploy
COPY frontend ./frontend
RUN mkdir -p /data && chmod +x /app/backend/deploy/entrypoint.sh
ENV AGENT_MARKET_DB_PATH=/data/agent-market.sqlite
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8080) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/backend/deploy/entrypoint.sh"]
