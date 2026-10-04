import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentMarketApi, DEFAULT_API_URL, DEFAULT_USER_ID } from './api-client.js';
import { createAgentMarketServer } from './server.js';

const api = new AgentMarketApi({
  baseUrl: process.env.AGENT_MARKET_API_URL || DEFAULT_API_URL,
  userId: process.env.AGENT_MARKET_USER_ID || DEFAULT_USER_ID,
});

const server = createAgentMarketServer({ api, webUrl: process.env.AGENT_MARKET_WEB_URL || '' });
await server.connect(new StdioServerTransport());
// stdout은 MCP 프로토콜 전용이다. 로그는 stderr로만 보낸다.
console.error(`[agent-market-mcp] connected. api=${api.baseUrl} user=${api.userId}`);
