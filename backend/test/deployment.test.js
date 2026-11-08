import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startDeployment } from '../deploy/app.js';
import { provisionWebUser } from '../web/auth.js';

test('single public deployment routes Web, strict API and token-authenticated MCP to one database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-market-deploy-'));
  const deployment = await startDeployment({ host: '127.0.0.1', port: 0,
    dbPath: join(dir, 'market.sqlite'), webSecret: 'deployment-test-web-secret-12345', seed: false });
  const origin = deployment.origin;
  try {
    const user = await provisionWebUser(deployment.web.store, {
      loginName: 'buyer-deploy', nickname: '배포 구매자', password: 'deployment-password-strong',
    });
    const health = await (await fetch(`${origin}/healthz`)).json();
    assert.deepEqual(health.services, ['web', 'api', 'mcp']);
    assert.equal((await fetch(`${origin}/api/me`)).status, 401);
    assert.equal((await fetch(`${origin}/mcp`, { method: 'POST' })).status, 401);

    const login = await fetch(`${origin}/web/login`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: 'buyer-deploy', password: 'deployment-password-strong' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const session = await login.json();
    assert.equal((await (await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } })).json()).userId, user.id);

    const issued = await fetch(`${origin}/api/agent-tokens`, { method: 'POST', headers: {
      Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken,
    }, body: JSON.stringify({ name: '배포 Agent', scopes: ['read', 'purchase:write'] }) });
    assert.equal(issued.status, 201);
    const { token } = await issued.json();
    const client = new Client({ name: 'deployment-e2e-test', version: '0.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === 'create_purchase_request_draft'));
    } finally { await client.close(); }
  } finally { await deployment.close(); rmSync(dir, { recursive: true, force: true }); }
});
