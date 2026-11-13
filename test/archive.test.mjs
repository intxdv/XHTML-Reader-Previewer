import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ArchiveReader, ArchiveSecurityError, ArchiveCorruptError, EpubCacheManager, validateEntryPath } from '../dist/archive.js';

// Helper to construct a minimal ZIP buffer in-memory
function createZipBuffer(files) {
  const localHeaders = [];
  const cdHeaders = [];
  let offset = 0;

  for (const file of files) {
    const fnBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || '', 'utf8');
    const compData = file.method === 8 ? zlib.deflateRawSync(dataBuf) : dataBuf;
    const method = file.method ?? 0;

    // Local Header
    const local = Buffer.alloc(30 + fnBuf.length + compData.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8); // method
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(0, 14); // crc32
    local.writeUInt32LE(compData.length, 18); // compSize
    local.writeUInt32LE(dataBuf.length, 22); // uncompSize
    local.writeUInt16LE(fnBuf.length, 26); // fnLen
    local.writeUInt16LE(0, 28); // extraLen
    fnBuf.copy(local, 30);
    compData.copy(local, 30 + fnBuf.length);

    localHeaders.push(local);

    // Central Directory Header
    const cd = Buffer.alloc(46 + fnBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10); // method
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0, 14); // date
    cd.writeUInt32LE(0, 16); // crc32
    cd.writeUInt32LE(compData.length, 20); // compSize
    cd.writeUInt32LE(dataBuf.length, 24); // uncompSize
    cd.writeUInt16LE(fnBuf.length, 28); // fnLen
    cd.writeUInt16LE(0, 30); // extraLen
    cd.writeUInt16LE(0, 32); // commentLen
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attr
    cd.writeUInt32LE(0, 38); // external attr
    cd.writeUInt32LE(offset, 42); // localHeaderOffset
    fnBuf.copy(cd, 46);

    cdHeaders.push(cd);
    offset += local.length;
  }

  const cdStart = offset;
  const cdTotalSize = cdHeaders.reduce((sum, h) => sum + h.length, 0);

  // EOCD
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk cd
  eocd.writeUInt16LE(files.length, 8); // total disk entries
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdTotalSize, 12); // cd size
  eocd.writeUInt32LE(cdStart, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

test('ArchiveReader extracts stored and deflated entries accurately', () => {
  const zipBuf = createZipBuffer([
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: '<container><rootfile full-path="OEBPS/content.opf"/></container>', method: 8 },
    { name: 'OEBPS/content.opf', data: '<package><metadata><title>Test Book</title></metadata></package>', method: 8 }
  ]);

  const reader = new ArchiveReader(zipBuf);
  assert.equal(reader.entries.size, 3);
  assert.equal(reader.hasEntry('mimetype'), true);
  assert.equal(reader.hasEntry('META-INF/container.xml'), true);
  assert.equal(reader.hasEntry('OEBPS/content.opf'), true);

  const container = reader.readEntry('META-INF/container.xml').toString('utf8');
  assert.match(container, /OEBPS\/content\.opf/);
});

test('validateEntryPath blocks path traversal, absolute paths, and null bytes', () => {
  assert.throws(() => validateEntryPath('../etc/passwd'), ArchiveSecurityError);
  assert.throws(() => validateEntryPath('foo/../../bar'), ArchiveSecurityError);
  assert.throws(() => validateEntryPath('/root/file.txt'), ArchiveSecurityError);
  assert.throws(() => validateEntryPath('C:/malicious.exe'), ArchiveSecurityError);
  assert.throws(() => validateEntryPath('file\0.txt'), ArchiveSecurityError);

  assert.equal(validateEntryPath('OEBPS/chapter1.xhtml'), 'OEBPS/chapter1.xhtml');
  assert.equal(validateEntryPath('OEBPS\\images\\cover.jpg'), 'OEBPS/images/cover.jpg');
});

test('ArchiveReader enforces security limits (ZIP bomb guard)', () => {
  const maliciousBuf = createZipBuffer([
    { name: 'payload.txt', data: 'large content', method: 0 }
  ]);

  // Max entries limit
  assert.throws(() => new ArchiveReader(maliciousBuf, { maxEntries: 0 }), ArchiveSecurityError);

  // Max total bytes limit
  assert.throws(() => new ArchiveReader(maliciousBuf, { maxTotalBytes: 5 }), ArchiveSecurityError);

  // Max single file bytes limit
  assert.throws(() => new ArchiveReader(maliciousBuf, { maxFileBytes: 5 }), ArchiveSecurityError);
});

test('ArchiveReader throws ArchiveCorruptError on truncated or invalid buffer', () => {
  assert.throws(() => new ArchiveReader(Buffer.from('not a zip archive')), ArchiveCorruptError);
});

test('EpubCacheManager extracts archive to isolated directory and cleans up', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-cache-test-'));
  const cacheManager = new EpubCacheManager(tmpBase);

  const zipBuf = createZipBuffer([
    { name: 'mimetype', data: 'application/epub+zip', method: 0 },
    { name: 'META-INF/container.xml', data: '<container/>', method: 8 },
    { name: 'OEBPS/chapter.xhtml', data: '<html/>', method: 8 }
  ]);

  const fakeEpubPath = '/path/to/my-book.epub';
  const cacheDir = cacheManager.extractEpubToCache(fakeEpubPath, zipBuf);

  assert.ok(fs.existsSync(cacheDir));
  assert.ok(fs.existsSync(path.join(cacheDir, 'META-INF', 'container.xml')));
  assert.ok(fs.existsSync(path.join(cacheDir, 'OEBPS', 'chapter.xhtml')));

  cacheManager.cleanupCache(cacheDir);
  assert.equal(fs.existsSync(cacheDir), false);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('extension bundle contains .epub handling, progress notification, and cache cleanup', () => {
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify .epub is in supported extensions
  assert.match(extensionBundle, /\.epub/);

  // Verify progress notification
  assert.match(extensionBundle, /withProgress/);
  assert.match(extensionBundle, /Opening EPUB\.\.\./);

  // Verify error handling
  assert.match(extensionBundle, /Failed to open EPUB archive/);

  // Verify cache cleanup on dispose
  assert.match(extensionBundle, /cleanupCache/);
});
