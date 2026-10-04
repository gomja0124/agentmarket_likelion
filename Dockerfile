# Agent Market — API 서버와 MCP 서버를 같은 이미지로 빌드하고, 실행 커맨드로 역할을 고른다.
FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY mcp ./mcp
COPY schemas ./schemas
RUN mkdir -p /data && chown -R node:node /data /app
USER node

# API: 데이터는 /data 볼륨에 둔다.
ENV HOST=0.0.0.0 PORT=8080 AGENT_MARKET_DB_PATH=/data/agent-market.sqlite
EXPOSE 8080 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch(process.env.HEALTH_URL||'http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
