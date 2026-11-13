import * as zlib from 'node:zlib';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

export interface ZipEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipSecurityLimits {
  maxEntries?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

export class ArchiveSecurityError extends Error {
  constructor(message: string) {
    super(`Security Alert: ${message}`);
    this.name = 'ArchiveSecurityError';
  }
}

export class ArchiveCorruptError extends Error {
  constructor(message: string) {
    super(`Corrupt Archive: ${message}`);
    this.name = 'ArchiveCorruptError';
  }
}

export function validateEntryPath(rawPath: string): string {
  if (rawPath.includes('\0')) {
    throw new ArchiveSecurityError(`Null byte detected in entry name: "${rawPath}"`);
  }

  const normalized = rawPath.replace(/\\/g, '/');

  if (path.isAbsolute(normalized) || /^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('/')) {
    throw new ArchiveSecurityError(`Absolute path detected in entry: "${rawPath}"`);
  }

  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new ArchiveSecurityError(`Path traversal ("..") detected in entry: "${rawPath}"`);
    }
  }

  return normalized;
}

export class ArchiveReader {
  private readonly buffer: Buffer;
  public readonly entries: Map<string, ZipEntry> = new Map();
  public totalUncompressedSize = 0;

  constructor(buffer: Buffer, limits?: ZipSecurityLimits) {
    this.buffer = buffer;
    this.parseCentralDirectory(limits);
  }

  private parseCentralDirectory(limits?: ZipSecurityLimits) {
    const maxEntries = limits?.maxEntries ?? 10000;
    const maxTotalBytes = limits?.maxTotalBytes ?? 500 * 1024 * 1024;
    const maxFileBytes = limits?.maxFileBytes ?? 50 * 1024 * 1024;

    const buf = this.buffer;
    if (buf.length < 22) {
      throw new ArchiveCorruptError('File is too small to be a valid ZIP archive');
    }

    let eocdOffset = -1;
    const maxSearch = Math.min(buf.length, 65557);
    for (let i = buf.length - 22; i >= buf.length - maxSearch; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new ArchiveCorruptError('End of Central Directory (EOCD) signature not found');
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    if (totalEntries > maxEntries) {
      throw new ArchiveSecurityError(`Archive contains ${totalEntries} entries, exceeding maximum limit of ${maxEntries}`);
    }

    if (cdOffset + cdSize > eocdOffset || cdOffset >= buf.length) {
      throw new ArchiveCorruptError('Central directory bounds are invalid');
    }

    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (pos + 46 > buf.length) {
        throw new ArchiveCorruptError('Unexpected EOF while reading central directory header');
      }

      const sig = buf.readUInt32LE(pos);
      if (sig !== 0x02014b50) {
        throw new ArchiveCorruptError(`Invalid Central Directory Header signature at offset ${pos}`);
      }

      const compressionMethod = buf.readUInt16LE(pos + 10);
      const compressedSize = buf.readUInt32LE(pos + 20);
      const uncompressedSize = buf.readUInt32LE(pos + 24);
      const fileNameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localHeaderOffset = buf.readUInt32LE(pos + 42);

      const rawFileName = buf.toString('utf8', pos + 46, pos + 46 + fileNameLen);
      const fileName = validateEntryPath(rawFileName);

      if (uncompressedSize > maxFileBytes) {
        throw new ArchiveSecurityError(`File "${fileName}" uncompressed size (${uncompressedSize} bytes) exceeds limit of ${maxFileBytes} bytes`);
      }

      this.totalUncompressedSize += uncompressedSize;
      if (this.totalUncompressedSize > maxTotalBytes) {
        throw new ArchiveSecurityError(`Total uncompressed archive size exceeds limit of ${maxTotalBytes} bytes`);
      }

      this.entries.set(fileName, {
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });

      pos += 46 + fileNameLen + extraLen + commentLen;
    }
  }

  hasEntry(fileName: string): boolean {
    try {
      return this.entries.has(validateEntryPath(fileName));
    } catch {
      return false;
    }
  }

  readEntry(fileName: string): Buffer {
    const cleanName = validateEntryPath(fileName);
    const entry = this.entries.get(cleanName);
    if (!entry) {
      throw new Error(`Entry not found in archive: "${cleanName}"`);
    }

    const buf = this.buffer;
    const localOffset = entry.localHeaderOffset;
    if (localOffset + 30 > buf.length) {
      throw new ArchiveCorruptError(`Local file header out of bounds for "${cleanName}"`);
    }

    const localSig = buf.readUInt32LE(localOffset);
    if (localSig !== 0x04034b50) {
      throw new ArchiveCorruptError(`Invalid local file header signature for "${cleanName}"`);
    }

    const fnLen = buf.readUInt16LE(localOffset + 26);
    const exLen = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + fnLen + exLen;

    if (dataOffset + entry.compressedSize > buf.length) {
      throw new ArchiveCorruptError(`Compressed data truncated for "${cleanName}"`);
    }

    const compressedData = buf.subarray(dataOffset, dataOffset + entry.compressedSize);

    if (entry.compressionMethod === 0) {
      return Buffer.from(compressedData);
    } else if (entry.compressionMethod === 8) {
      return zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported compression method ${entry.compressionMethod} in "${cleanName}"`);
    }
  }

  extractAll(targetDir: string): void {
    fs.mkdirSync(targetDir, { recursive: true });

    for (const [entryPath] of this.entries.entries()) {
      if (entryPath.endsWith('/')) {
        const dirPath = path.join(targetDir, entryPath);
        fs.mkdirSync(dirPath, { recursive: true });
        continue;
      }

      const fullPath = path.join(targetDir, entryPath);
      const rel = path.relative(targetDir, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new ArchiveSecurityError(`Path traversal escaping target directory: "${entryPath}"`);
      }

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const data = this.readEntry(entryPath);
      fs.writeFileSync(fullPath, data);
    }
  }
}

export class EpubCacheManager {
  private readonly activeCaches: Set<string> = new Set();

  constructor(private readonly baseStorageDir: string) {}

  getCacheDirForFile(sourcePath: string): string {
    const hash = createHash('sha256').update(sourcePath.toLowerCase()).digest('hex').slice(0, 16);
    return path.join(this.baseStorageDir, 'epub-cache', hash);
  }

  extractEpubToCache(sourcePath: string, buffer: Buffer): string {
    const cacheDir = this.getCacheDirForFile(sourcePath);
    const containerPath = path.join(cacheDir, 'META-INF', 'container.xml');
    if (fs.existsSync(containerPath)) {
      this.activeCaches.add(cacheDir);
      return cacheDir;
    }

    const archive = new ArchiveReader(buffer);
    archive.extractAll(cacheDir);
    this.activeCaches.add(cacheDir);
    return cacheDir;
  }

  cleanupCache(cacheDir: string): void {
    try {
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
      this.activeCaches.delete(cacheDir);
    } catch (err) {
      console.warn('Failed to cleanup EPUB cache:', err);
    }
  }

  cleanupAll(): void {
    for (const cacheDir of this.activeCaches) {
      this.cleanupCache(cacheDir);
    }
  }
}
