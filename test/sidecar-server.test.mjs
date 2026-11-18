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

  await t.test('10. POST /api/message handles requestFootnote extraction', async () => {
    const res = await fetch(`${serverUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'requestFootnote',
        href: 'notes.xhtml#fn1',
        requestId: 'req-123'
      })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.received, true);
    assert.ok(json.lastFootnote);
    assert.equal(json.lastFootnote.requestId, 'req-123');
    assert.match(json.lastFootnote.html, /Catatan ini diekstrak langsung dari berkas terpisah/);
  });

  await t.test('11. POST /api/message handles openLink navigation', async () => {
    const res = await fetch(`${serverUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'openLink',
        href: 'ch_1.xhtml'
      })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.received, true);
    assert.equal(json.chapterChanged, true);

    const statusRes = await fetch(`${serverUrl}/api/status`);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.book.currentSpineIndex, 0);
  });

  await t.test('12. GET /api/workspace-files lists available XHTML and EPUB files', async () => {
    const res = await fetch(`${serverUrl}/api/workspace-files`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.files));
    assert.ok(json.files.length > 0);
    const foundCh1 = json.files.find((f) => f.name === 'ch_1.xhtml');
    assert.ok(foundCh1, 'Should find ch_1.xhtml in workspace');
  });

  await t.test('13. POST /api/message handles closeBook returning to empty state', async () => {
    const res = await fetch(`${serverUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'closeBook' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.received, true);
    assert.equal(json.chapterChanged, true);

    const statusRes = await fetch(`${serverUrl}/api/status`);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.loaded, false);
    assert.equal(statusJson.book, null);
  });

  await t.test('14. POST /api/upload accepts and opens uploaded publication file', async () => {
    const sampleContent = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Uploaded File Test</title></head>
  <body><p>Hello from uploaded book!</p></body>
</html>`;
    const res = await fetch(`${serverUrl}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent('test-upload.xhtml')
      },
      body: Buffer.from(sampleContent, 'utf-8')
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.title, 'test-upload.xhtml');

    const statusRes = await fetch(`${serverUrl}/api/status`);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.loaded, true);
    assert.equal(statusJson.book.title, 'test-upload.xhtml');
  });

  await t.test('15. Multi-workspace isolation guarantees independent file listing and book sessions', async () => {
    const os = await import('node:os');
    const fsp = (await import('node:fs/promises')).default;
    const tempWsA = await fsp.mkdtemp(path.join(os.tmpdir(), 'xhtml-ws-a-'));
    const tempWsB = await fsp.mkdtemp(path.join(os.tmpdir(), 'xhtml-ws-b-'));

    try {
      await fsp.writeFile(path.join(tempWsA, 'book-a.xhtml'), '<html xmlns="http://www.w3.org/1999/xhtml"><body>Book A</body></html>');
      await fsp.writeFile(path.join(tempWsB, 'book-b.xhtml'), '<html xmlns="http://www.w3.org/1999/xhtml"><body>Book B</body></html>');

      // 1. Scan Workspace A
      const resA = await fetch(`${serverUrl}/api/workspace-files?workspace=${encodeURIComponent(tempWsA)}`);
      const dataA = await resA.json();
      assert.equal(dataA.files.length, 1);
      assert.equal(dataA.files[0].name, 'book-a.xhtml');

      // 2. Scan Workspace B
      const resB = await fetch(`${serverUrl}/api/workspace-files?workspace=${encodeURIComponent(tempWsB)}`);
      const dataB = await resB.json();
      assert.equal(dataB.files.length, 1);
      assert.equal(dataB.files[0].name, 'book-b.xhtml');

      // 3. Open book in Workspace A
      await fetch(`${serverUrl}/api/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: path.join(tempWsA, 'book-a.xhtml'), workspace: tempWsA })
      });

      // Status for A is loaded
      const statusA = await (await fetch(`${serverUrl}/api/status?workspace=${encodeURIComponent(tempWsA)}`)).json();
      assert.equal(statusA.loaded, true);
      assert.equal(statusA.book.title, 'book-a.xhtml');

      // Status for B is NOT loaded
      const statusB = await (await fetch(`${serverUrl}/api/status?workspace=${encodeURIComponent(tempWsB)}`)).json();
      assert.equal(statusB.loaded, false);
      assert.equal(statusB.book, null);

      // 4. set-workspace switches cleanly without merging
      const setRes = await fetch(`${serverUrl}/api/set-workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceUris: [tempWsB] })
      });
      const setData = await setRes.json();
      assert.equal(setData.files.length, 1);
      assert.equal(setData.files[0].name, 'book-b.xhtml');
    } finally {
      await fsp.rm(tempWsA, { recursive: true, force: true });
      await fsp.rm(tempWsB, { recursive: true, force: true });
    }
  });

  await t.test('16. Stop server cleans up smoothly', async () => {
    await server.stop();
    // Verify server is closed
    await assert.rejects(async () => {
      await fetch(`${serverUrl}/api/status`);
    });
  });
});
