import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { apiForStdio, configFromEnv, resolveIdentity } from './config.js';
import { createAgentMarketServer } from './server.js';

// stdio 모드: Claude Desktop 등 로컬 Agent 앱이 이 프로세스를 직접 띄운다.
// 인증은 AGENT_MARKET_TOKEN(배포) 또는 AGENT_MARKET_USER_ID(demo 모드 백엔드) 중 하나.
const { webUrl } = configFromEnv();
const api = apiForStdio();

let identity;
try {
  identity = await resolveIdentity(api);
} catch (error) {
  console.error(`[agent-market-mcp] 백엔드 인증 실패 (${api.baseUrl}, ${api.identity}): ${error.message}`);
  process.exit(1);
}

const server = createAgentMarketServer({ api, webUrl, scopes: identity.scopes });
await server.connect(new StdioServerTransport());
// stdout은 MCP 프로토콜 전용. 로그는 stderr로만.
console.error(`[agent-market-mcp] connected api=${api.baseUrl} user=${identity.userId} scopes=${identity.scopes?.join(',') ?? 'all(demo)'}`);
