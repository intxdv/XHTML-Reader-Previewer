import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { McpServer, MCP_TOOLS } from '../dist/mcp-server.cjs';
import { SidecarServer } from '../dist/sidecar-server.cjs';
import os from 'node:os';

test('MCP Server test suite', async (t) => {
  const sampleFilePath = path.resolve('sample-book/OEBPS/ch_1.xhtml');
  const server = new McpServer();

  await t.test('1. Tool definitions are valid and complete', () => {
    assert.equal(MCP_TOOLS.length, 3);
    const names = MCP_TOOLS.map((tool) => tool.name);
    assert.deepEqual(names, ['xhtml_open_preview', 'xhtml_get_toc', 'xhtml_get_metadata']);

    for (const tool of MCP_TOOLS) {
      assert.ok(tool.description);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(Array.isArray(tool.inputSchema.required));
      assert.ok(tool.inputSchema.required.includes('filePath'));
    }
  });

  await t.test('2. Protocol Handshake: initialize & ping', async () => {
    const initResRaw = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-agent', version: '1.0' }
        }
      })
    );
    assert.ok(initResRaw);
    const initRes = JSON.parse(initResRaw);
    assert.equal(initRes.id, 1);
    assert.equal(initRes.result.serverInfo.name, 'xhtml-reader-previewer-mcp');
    assert.ok(initRes.result.capabilities.tools);

    const pingResRaw = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping'
      })
    );
    assert.ok(pingResRaw);
    const pingRes = JSON.parse(pingResRaw);
    assert.equal(pingRes.id, 2);
    assert.deepEqual(pingRes.result, {});
  });

  await t.test('3. tools/list returns all registered tools', async () => {
    const resRaw = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list'
      })
    );
    assert.ok(resRaw);
    const res = JSON.parse(resRaw);
    assert.equal(res.id, 3);
    assert.equal(res.result.tools.length, 3);
  });

  await t.test('4. tools/call: xhtml_get_metadata', async () => {
    const resRaw = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'xhtml_get_metadata',
          arguments: {
            filePath: sampleFilePath
          }
        }
      })
    );
    assert.ok(resRaw);
    const res = JSON.parse(resRaw);
    assert.equal(res.id, 4);
    assert.equal(res.result.isError, false);
    assert.match(res.result.content[0].text, /Sample EPUB - Cross-File Footnotes Demo/i);
    assert.match(res.result.content[0].text, /XHTML Reader Previewer/i);
    assert.match(res.result.content[0].text, /Spine Chapters/);
    assert.match(res.result.content[0].text, /Manifest Resources/);
  });

  await t.test('5. tools/call: xhtml_get_toc', async () => {
    const resRaw = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'xhtml_get_toc',
          arguments: {
            filePath: sampleFilePath
          }
        }
      })
    );
    assert.ok(resRaw);
    const res = JSON.parse(resRaw);
    assert.equal(res.id, 5);
    assert.equal(res.result.isError, false);
    assert.match(res.result.content[0].text, /Table of Contents/i);
    assert.match(res.result.content[0].text, /Chapter 1/i);
    assert.match(res.result.content[0].text, /ch_1\.xhtml/i);
    assert.match(res.result.content[0].text, /notes\.xhtml/i);
  });

  await t.test('6. tools/call: xhtml_open_preview with live sidecar server', async () => {
    const testPort = 5898;
    process.env.ANTIGRAVITY_SIDECAR_WEB_PORT = String(testPort);

    const tempCacheDir = path.join(os.tmpdir(), `test-mcp-sidecar-cache-${Date.now()}`);
    const tempStorageDir = path.join(os.tmpdir(), `test-mcp-sidecar-storage-${Date.now()}`);
    const sidecar = new SidecarServer({
      port: testPort,
      host: '127.0.0.1',
      cacheDir: tempCacheDir,
      storageDir: tempStorageDir
    });

    await sidecar.start();

    try {
      const resRaw = await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'xhtml_open_preview',
            arguments: {
              filePath: sampleFilePath,
              spineIndex: 0
            }
          }
        })
      );
      assert.ok(resRaw);
      const res = JSON.parse(resRaw);
      assert.equal(res.id, 6);
      assert.equal(res.result.isError, false);
      assert.match(res.result.content[0].text, /Document successfully loaded/i);
      assert.match(res.result.content[0].text, /sidecar:\/\/xhtml-reader-plugin\/xhtml-previewer\//);
      assert.match(res.result.content[0].text, /http:\/\/127\.0\.0\.1:5898\//);
    } finally {
      await sidecar.stop();
      delete process.env.ANTIGRAVITY_SIDECAR_WEB_PORT;
    }
  });

  await t.test('7. Error Handling: Missing file and unknown method', async () => {
    // Missing file
    const fileResRaw = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'xhtml_get_metadata',
          arguments: {
            filePath: 'file-that-does-not-exist.epub'
          }
        }
      })
    );
    assert.ok(fileResRaw);
    const fileRes = JSON.parse(fileResRaw);
    assert.equal(fileRes.result.isError, true);
    assert.match(fileRes.result.content[0].text, /File not found/i);

    // Unknown method
    const methodResRaw = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'unknown/method'
      })
    );
    assert.ok(methodResRaw);
    const methodRes = JSON.parse(methodResRaw);
    assert.equal(methodRes.error.code, -32601);
  });

  await t.test('8. Child Process STDIO execution of dist/mcp-server.cjs', async () => {
    const mcpBin = path.resolve('dist/mcp-server.cjs');
    const child = spawn(process.execPath, [mcpBin], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutBuffer = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf-8');
    });

    const sendRequest = (obj) => {
      child.stdin.write(JSON.stringify(obj) + '\n');
    };

    const waitForLine = async (timeoutMs = 3000) => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const newlineIdx = stdoutBuffer.indexOf('\n');
        if (newlineIdx !== -1) {
          const line = stdoutBuffer.slice(0, newlineIdx).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
          if (line) return line;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('Timeout waiting for MCP stdout response');
    };

    // 8a. initialize
    sendRequest({
      jsonrpc: '2.0',
      id: 101,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} }
    });
    const initLine = await waitForLine();
    const initObj = JSON.parse(initLine);
    assert.equal(initObj.id, 101);
    assert.equal(initObj.result.serverInfo.name, 'xhtml-reader-previewer-mcp');

    // 8b. tools/list
    sendRequest({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/list'
    });
    const toolsLine = await waitForLine();
    const toolsObj = JSON.parse(toolsLine);
    assert.equal(toolsObj.id, 102);
    assert.equal(toolsObj.result.tools.length, 3);

    // 8c. tools/call xhtml_get_metadata
    sendRequest({
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'xhtml_get_metadata',
        arguments: { filePath: sampleFilePath }
      }
    });
    const metaLine = await waitForLine();
    const metaObj = JSON.parse(metaLine);
    assert.equal(metaObj.id, 103);
    assert.equal(metaObj.result.isError, false);
    assert.match(metaObj.result.content[0].text, /Sample EPUB/i);

    // Close stdin and verify child exits smoothly
    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
    assert.equal(child.exitCode, 0);
  });
});
