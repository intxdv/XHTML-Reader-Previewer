import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { SidecarServer } from '../dist/sidecar-server.cjs';

test('SidecarServer lifecycle and REST API test suite', async (t) => {
  const tempCacheDir = path.join(os.tmpdir(), `test-sidecar-cache-${Date.now()}`);
  const tempStorageDir = path.join(os.tmpdir(), `test-sidecar-storage-${Date.now()}`);
  const server = new SidecarServer({
    port: 5892,
    host: '127.0.0.1',
    cacheDir: tempCacheDir,
    storageDir: tempStorageDir
  });

  let serverUrl = '';

  await t.test('1. Start server successfully', async () => {
    serverUrl = await server.start();
    assert.match(serverUrl, /http:\/\/127\.0\.0\.1:5892/);
  });

  await t.test('2. GET / returns initial empty state HTML', async () => {
    const res = await fetch(`${serverUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /XHTML & EPUB Reader/);
    assert.match(html, /Belum ada buku atau berkas XHTML yang dimuat/);
  });

  await t.test('3. GET /api/status returns not loaded initially', async () => {
    const res = await fetch(`${serverUrl}/api/status`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');
    assert.equal(json.loaded, false);
    assert.equal(json.book, null);
  });

  await t.test('4. POST /api/open opens sample-book/OEBPS/ch_1.xhtml', async () => {
    const epubPath = path.resolve('sample-book/OEBPS/ch_1.xhtml');
    const res = await fetch(`${serverUrl}/api/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: epubPath })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.isEpub, true);
    assert.match(json.title, /Sample EPUB/i);
    assert.ok(json.totalChapters > 0);
  });

  await t.test('5. GET /api/status returns loaded book details', async () => {
    const res = await fetch(`${serverUrl}/api/status`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');
    assert.equal(json.loaded, true);
    assert.ok(json.book);
    assert.match(json.book.title, /Sample EPUB/i);
    assert.equal(json.book.currentSpineIndex, 0);
  });

  await t.test('6. GET / renders active reader shell with book content', async () => {
    const res = await fetch(`${serverUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id=["']toolbar["']/);
    assert.match(html, /id=["']content["']/);
    assert.match(html, /Sample EPUB/i);
  });

  await t.test('7. Path Traversal Guard blocks outside file access', async () => {
    const http = await import('node:http');
    const statusCode = await new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: 5892,
          path: '/assets/../../package.json'
        },
        (res) => {
          resolve(res.statusCode);
        }
      );
      req.on('error', reject);
    });
    assert.equal(statusCode, 403);
  });

  await t.test('8. POST /api/message handles nextChapter navigation', async () => {
    const res = await fetch(`${serverUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'nextChapter' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.received, true);

    const statusRes = await fetch(`${serverUrl}/api/status`);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.book.currentSpineIndex, 1);
  });

  await t.test('9. POST /api/message saves preferences', async () => {
    const res = await fetch(`${serverUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'savePreferences',
        preferences: { theme: 'sepia', fontSize: 22 }
      })
    });
    assert.equal(res.status, 200);
  });

  await t.test('10. Stop server cleans up smoothly', async () => {
    await server.stop();
    // Verify server is closed
    await assert.rejects(async () => {
      await fetch(`${serverUrl}/api/status`);
    });
  });
});
