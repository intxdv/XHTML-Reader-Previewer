import * as http from 'node:http';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { sanitizeXhtml, extractElementById } from '../core/xhtml';
import { readerShell, ReaderNavInfo, ReaderSpineNavInfo, ReaderTocItem } from '../core/reader-shell';
import {
  parseContainerXml,
  parseOpfXml,
  loadEpubToc,
  locateEpubContainer,
  parentUri,
  createResourceUri,
  EpubPackage,
  ResourceUri
} from '../core/epub';
import {
  StateManager,
  JsonFileStorageAdapter,
  InMemoryStorageAdapter,
  ReadingLocation,
  NavigationHistory
} from '../core/state-manager';
import { EpubCacheManager } from '../core/archive';

export interface SidecarServerOptions {
  port?: number;
  host?: string;
  storageDir?: string;
  cacheDir?: string;
}

export interface LoadedBookState {
  filePath: string;
  fileName: string;
  isEpub: boolean;
  title: string;
  cacheDir?: string;
  bookRootDir: string;
  epubPackage?: EpubPackage;
  currentSpineIndex: number;
  currentChapterPath: string;
  currentFragment?: string;
  resetToTop?: boolean;
  startAtBottom?: boolean;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

const resourceAttributes = /(<(?:img|source|video|audio|link)\b[^>]*?\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi;

export class SidecarServer {
  private server: http.Server | undefined;
  private sseClients = new Set<http.ServerResponse>();
  private cacheManager: EpubCacheManager;
  private cacheDir: string;
  private stateManager: StateManager;
  private navigationHistory = new NavigationHistory();
  private loadedBook: LoadedBookState | undefined;
  private lastFootnoteResponse: { requestId: string; html?: string; error?: string } | undefined;

  public readonly port: number;
  public readonly host: string;

  constructor(options: SidecarServerOptions = {}) {
    const envPort = process.env.ANTIGRAVITY_SIDECAR_WEB_PORT;
    this.port = options.port ?? (envPort ? parseInt(envPort, 10) : 5890);
    this.host = options.host ?? '127.0.0.1';

    const cacheBase = options.cacheDir ?? path.join(os.tmpdir(), 'xhtml-reader-sidecar');
    this.cacheDir = cacheBase;
    this.cacheManager = new EpubCacheManager(cacheBase);

    const storagePath = options.storageDir
      ? path.join(options.storageDir, 'state.json')
      : path.join(os.homedir(), '.xhtml-reader', 'sidecar-state.json');

    try {
      this.stateManager = new StateManager(new JsonFileStorageAdapter(storagePath));
    } catch {
      this.stateManager = new StateManager(new InMemoryStorageAdapter());
    }
  }

  public getLoadedBook(): LoadedBookState | undefined {
    return this.loadedBook;
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}`;
        resolve(url);
      });
    });
  }

  public async stop(): Promise<void> {
    // Notify and close SSE clients
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();

    // Clean up temporary extracted archives
    try {
      this.cacheManager.cleanupAll();
    } catch {
      // ignore
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = undefined;
    }
  }

  private isSafePath(baseDir: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
  }

  private broadcastEvent(eventType: string, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  public async openBook(filePath: string, spineIndex = 0, targetId?: string): Promise<LoadedBookState> {
    const absolutePath = path.resolve(filePath);
    await fsp.access(absolutePath, fs.constants.R_OK);

    const ext = path.extname(absolutePath).toLowerCase();
    const fileName = path.basename(absolutePath);
    const stat = await fsp.stat(absolutePath);
    let containerRootPath: string | undefined;

    if (ext === '.epub') {
      const buffer = await fsp.readFile(absolutePath);
      containerRootPath = this.cacheManager.extractEpubToCache(absolutePath, buffer);
    } else if (stat.isDirectory()) {
      const containerFile = path.join(absolutePath, 'META-INF', 'container.xml');
      try {
        await fsp.access(containerFile, fs.constants.R_OK);
        containerRootPath = absolutePath;
      } catch {
        // Not a container
      }
    } else {
      const foundContainer = await locateEpubContainer(createResourceUri(absolutePath));
      if (foundContainer) {
        containerRootPath = foundContainer.fsPath || foundContainer.path;
      }
    }

    if (containerRootPath) {
      const containerUri = createResourceUri(path.join(containerRootPath, 'META-INF', 'container.xml'));
      const containerXml = await fsp.readFile(containerUri.fsPath!, 'utf-8');
      const opfRelPath = parseContainerXml(containerXml);

      if (!opfRelPath) {
        throw new Error('Invalid EPUB: META-INF/container.xml has no valid rootfile full-path');
      }

      const opfPath = path.join(containerRootPath, ...opfRelPath.split('/').filter(Boolean));
      const opfUri = createResourceUri(opfPath);
      const containerRootUri = createResourceUri(containerRootPath);
      const opfXml = await fsp.readFile(opfPath, 'utf-8');
      const epubPackage = parseOpfXml(opfXml, opfUri, containerRootUri);

      epubPackage.toc = await loadEpubToc(epubPackage, async (uri) => {
        return fsp.readFile(uri.fsPath || uri.path, 'utf-8');
      });

      // Find spine index if opening a specific chapter file
      let safeSpineIndex = Math.max(0, Math.min(spineIndex, epubPackage.spine.length - 1));
      if (!stat.isDirectory() && ext !== '.epub') {
        const foundIdx = epubPackage.spine.findIndex(
          (item) => path.resolve(item.uri.fsPath || item.uri.path) === absolutePath
        );
        if (foundIdx >= 0) {
          safeSpineIndex = foundIdx;
        }
      }

      const initialChapter = epubPackage.spine[safeSpineIndex];
      const currentChapterPath = initialChapter ? (initialChapter.uri.fsPath || initialChapter.uri.path) : '';

      this.loadedBook = {
        filePath: absolutePath,
        fileName,
        isEpub: true,
        title: epubPackage.title,
        cacheDir: ext === '.epub' ? containerRootPath : undefined,
        bookRootDir: containerRootPath,
        epubPackage,
        currentSpineIndex: safeSpineIndex,
        currentChapterPath,
        currentFragment: targetId
      };
    } else {
      // Standalone XHTML / HTML file
      const bookRootDir = path.dirname(absolutePath);
      this.loadedBook = {
        filePath: absolutePath,
        fileName,
        isEpub: false,
        title: fileName,
        bookRootDir,
        currentSpineIndex: 0,
        currentChapterPath: absolutePath,
        currentFragment: targetId
      };
    }

    this.broadcastEvent('bookLoaded', {
      title: this.loadedBook.title,
      fileName: this.loadedBook.fileName,
      currentSpineIndex: this.loadedBook.currentSpineIndex,
      isEpub: this.loadedBook.isEpub
    });

    return this.loadedBook;
  }

  private async rewriteAssets(markup: string, chapterDir: string, bookRootDir: string): Promise<string> {
    const resources = new Map<string, string>();
    const matches = [...markup.matchAll(resourceAttributes)];

    for (const match of matches) {
      const raw = match[3];
      if (resources.has(raw)) continue;

      const cleanPath = raw.split(/[?#]/, 1)[0];
      if (!cleanPath || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(cleanPath)) {
        continue;
      }

      const decoded = decodeURIComponent(cleanPath);
      const candidatePath = path.resolve(chapterDir, decoded);

      if (this.isSafePath(bookRootDir, candidatePath)) {
        try {
          await fsp.access(candidatePath, fs.constants.R_OK);
          const relToRoot = path.relative(bookRootDir, candidatePath).replace(/\\/g, '/');
          resources.set(raw, `/assets/${relToRoot}`);
        } catch {
          // ignore missing asset
        }
      }
    }

    return markup.replace(resourceAttributes, (full, prefix: string, quote: string, raw: string) => {
      const replacement = resources.get(raw);
      return replacement ? `${prefix}${quote}${replacement}${quote}` : full;
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Add CORS headers for local host interactions
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = parsedUrl.pathname;

    // 1. Root: Serves Reader Shell UI
    if (pathname === '/' && req.method === 'GET') {
      await this.serveReaderUi(req, res);
      return;
    }

    // 2. Status API
    if (pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          loaded: Boolean(this.loadedBook),
          port: this.port,
          book: this.loadedBook
            ? {
                filePath: this.loadedBook.filePath,
                title: this.loadedBook.title,
                fileName: this.loadedBook.fileName,
                isEpub: this.loadedBook.isEpub,
                currentSpineIndex: this.loadedBook.currentSpineIndex,
                totalChapters: this.loadedBook.epubPackage?.spine.length ?? 1,
                currentChapterPath: this.loadedBook.currentChapterPath,
                currentFragment: this.loadedBook.currentFragment
              }
            : null
        })
      );
      return;
    }

    // 3. Open Book API
    if (pathname === '/api/open' && req.method === 'POST') {
      await this.handleOpenApi(req, res);
      return;
    }

    // 3b. Upload and Open File API
    if (pathname === '/api/upload' && req.method === 'POST') {
      await this.handleUploadApi(req, res);
      return;
    }

    // 3c. Workspace Files API
    if (pathname === '/api/workspace-files' && req.method === 'GET') {
      const files = await this.scanWorkspaceFiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
      return;
    }

    // 4. Server-Sent Events (SSE) Stream
    if (pathname === '/api/events' && req.method === 'GET') {
      this.handleSseStream(req, res);
      return;
    }

    // 5. Message Dispatch API (from client reader-shell)
    if (pathname === '/api/message' && req.method === 'POST') {
      await this.handleMessageApi(req, res);
      return;
    }

    // 6. Static Asset Serving: /assets/*
    const rawUrl = req.url || '/';
    if ((rawUrl.startsWith('/assets') || pathname.startsWith('/assets')) && req.method === 'GET') {
      if (rawUrl.includes('..') || pathname.includes('..') || rawUrl.toLowerCase().includes('%2e%2e')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Path traversal detected');
        return;
      }
      const assetRelPath = rawUrl.replace(/^\/assets\/?/, '').split('?')[0];
      await this.serveAsset(assetRelPath, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private handleSseStream(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    res.write(': connected\n\n');
    this.sseClients.add(res);

    _req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private async handleOpenApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsed = JSON.parse(body || '{}');

      if (!parsed.filePath || typeof parsed.filePath !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid "filePath" property' }));
        return;
      }

      const book = await this.openBook(parsed.filePath, parsed.spineIndex, parsed.targetId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          title: book.title,
          isEpub: book.isEpub,
          totalChapters: book.epubPackage?.spine.length ?? 1
        })
      );
    } catch (err) {
      console.error('[Sidecar] openBook error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }

  private async handleMessageApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const msg = JSON.parse(body || '{}');

      if (!this.loadedBook) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No book loaded' }));
        return;
      }

      let chapterChanged = false;

      if (msg.type === 'prevChapter') {
        if (this.loadedBook.isEpub && this.loadedBook.epubPackage && this.loadedBook.currentSpineIndex > 0) {
          this.loadedBook.currentSpineIndex -= 1;
          const chapter = this.loadedBook.epubPackage.spine[this.loadedBook.currentSpineIndex];
          this.loadedBook.currentChapterPath = chapter.uri.fsPath || chapter.uri.path;
          this.loadedBook.currentFragment = undefined;
          this.loadedBook.startAtBottom = Boolean(msg.startAtBottom);
          this.loadedBook.resetToTop = !msg.startAtBottom;
          chapterChanged = true;
          this.broadcastEvent('chapterChanged', {
            spineIndex: this.loadedBook.currentSpineIndex,
            chapterPath: this.loadedBook.currentChapterPath
          });
        }
      } else if (msg.type === 'nextChapter') {
        if (
          this.loadedBook.isEpub &&
          this.loadedBook.epubPackage &&
          this.loadedBook.currentSpineIndex < this.loadedBook.epubPackage.spine.length - 1
        ) {
          this.loadedBook.currentSpineIndex += 1;
          const chapter = this.loadedBook.epubPackage.spine[this.loadedBook.currentSpineIndex];
          this.loadedBook.currentChapterPath = chapter.uri.fsPath || chapter.uri.path;
          this.loadedBook.currentFragment = undefined;
          this.loadedBook.resetToTop = true;
          this.loadedBook.startAtBottom = false;
          chapterChanged = true;
          this.broadcastEvent('chapterChanged', {
            spineIndex: this.loadedBook.currentSpineIndex,
            chapterPath: this.loadedBook.currentChapterPath
          });
        }
      } else if (msg.type === 'openLink' && msg.href) {
        if (msg.currentPosition) {
          await this.stateManager.saveReadingLocation(this.loadedBook.currentChapterPath, {
            scrollRatio: msg.currentPosition.scrollRatio,
            scrollY: msg.currentPosition.scrollY,
            anchorId: msg.currentPosition.anchorId
          });
        }

        const [filePart, fragment] = msg.href.split('#');
        let targetPath = this.loadedBook.currentChapterPath;
        if (filePart) {
          const decoded = decodeURIComponent(filePart);
          targetPath = path.resolve(path.dirname(this.loadedBook.currentChapterPath), decoded);
        }

        if (this.isSafePath(this.loadedBook.bookRootDir, targetPath)) {
          if (this.loadedBook.isEpub && this.loadedBook.epubPackage) {
            const foundIdx = this.loadedBook.epubPackage.spine.findIndex(
              (item) => path.resolve(item.uri.fsPath || item.uri.path) === path.resolve(targetPath)
            );
            if (foundIdx >= 0) {
              this.loadedBook.currentSpineIndex = foundIdx;
            }
          }
          this.loadedBook.currentChapterPath = targetPath;
          this.loadedBook.currentFragment = fragment;
          this.loadedBook.resetToTop = !fragment;
          this.loadedBook.startAtBottom = false;
          chapterChanged = true;
          this.broadcastEvent('chapterChanged', {
            spineIndex: this.loadedBook.currentSpineIndex,
            chapterPath: this.loadedBook.currentChapterPath,
            fragment: this.loadedBook.currentFragment
          });
        }
      } else if (msg.type === 'savePreferences') {
        if (msg.preferences) {
          await this.stateManager.savePreferences(msg.preferences);
        }
      } else if (msg.type === 'saveReadingPosition') {
        await this.stateManager.saveReadingLocation(this.loadedBook.currentChapterPath, {
          scrollRatio: msg.scrollRatio,
          scrollY: msg.scrollY,
          anchorId: msg.anchorId
        });
      } else if (msg.type === 'requestFootnote') {
        await this.handleFootnoteRequest(msg);
      } else if (msg.type === 'closeBook') {
        this.loadedBook = undefined;
        this.broadcastEvent('bookLoaded', null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, chapterChanged: true }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, chapterChanged, lastFootnote: this.lastFootnoteResponse }));
    } catch (err) {
      console.error('[Sidecar] message error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }

  private async handleFootnoteRequest(msg: { href: string; requestId: string }): Promise<void> {
    if (!this.loadedBook) return;

    try {
      const parts = msg.href.split('#');
      const filePart = parts[0];
      const fragment = parts[1];

      if (!fragment) {
        this.lastFootnoteResponse = { requestId: msg.requestId, error: 'Missing fragment' };
        return;
      }

      let targetPath = this.loadedBook.currentChapterPath;
      if (filePart) {
        const decoded = decodeURIComponent(filePart);
        targetPath = path.resolve(path.dirname(this.loadedBook.currentChapterPath), decoded);
      }

      if (!this.isSafePath(this.loadedBook.bookRootDir, targetPath)) {
        this.lastFootnoteResponse = { requestId: msg.requestId, error: 'Path traversal blocked' };
        return;
      }

      const raw = await fsp.readFile(targetPath, 'utf-8');
      const extracted = extractElementById(raw, fragment);

      if (!extracted) {
        this.lastFootnoteResponse = { requestId: msg.requestId, error: 'Footnote element not found' };
        return;
      }

      const rewritten = await this.rewriteAssets(extracted, path.dirname(targetPath), this.loadedBook.bookRootDir);
      this.lastFootnoteResponse = { requestId: msg.requestId, html: rewritten };
    } catch (err) {
      this.lastFootnoteResponse = { requestId: msg.requestId, error: String(err) };
    }
  }

  private async serveAsset(assetRelPath: string, res: http.ServerResponse): Promise<void> {
    if (!this.loadedBook) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No book loaded');
      return;
    }

    const decoded = decodeURIComponent(assetRelPath);
    const fullPath = path.resolve(this.loadedBook.bookRootDir, decoded);

    // Strict Path Traversal Guard
    if (!this.isSafePath(this.loadedBook.bookRootDir, fullPath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Access outside book directory is blocked');
      return;
    }

    try {
      const stat = await fsp.stat(fullPath);
      if (!stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(fullPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=3600'
      });

      fs.createReadStream(fullPath).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Asset Not Found');
    }
  }

  private async handleUploadApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const fileNameHeader = req.headers['x-file-name'];
      let fileName = 'uploaded.epub';
      if (typeof fileNameHeader === 'string' && fileNameHeader.trim()) {
        fileName = path.basename(decodeURIComponent(fileNameHeader));
      }

      const uploadDir = path.join(this.cacheDir, 'uploads');
      await fsp.mkdir(uploadDir, { recursive: true });
      const targetPath = path.join(uploadDir, fileName);

      const writeStream = fs.createWriteStream(targetPath);
      await new Promise<void>((resolve, reject) => {
        req.pipe(writeStream);
        req.on('error', reject);
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
      });

      const book = await this.openBook(targetPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          title: book.title,
          totalChapters: book.epubPackage?.spine.length ?? 1
        })
      );
    } catch (err: any) {
      console.error('[Sidecar] Upload error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
    }
  }

  private async scanWorkspaceFiles(
    dir = process.cwd(),
    depth = 0,
    maxDepth = 3
  ): Promise<Array<{ fullPath: string; relPath: string; name: string; isEpub: boolean }>> {
    if (depth > maxDepth) return [];
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const results: Array<{ fullPath: string; relPath: string; name: string; isEpub: boolean }> = [];

      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'tasks' ||
          entry.name === 'coverage'
        ) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.scanWorkspaceFiles(fullPath, depth + 1, maxDepth);
          results.push(...sub);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.epub', '.xhtml', '.html', '.htm'].includes(ext)) {
            const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
            results.push({
              fullPath,
              relPath,
              name: entry.name,
              isEpub: ext === '.epub' || fullPath.includes('OEBPS') || fullPath.includes('EPUB')
            });
          }
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  private escapeText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private async serveReaderUi(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const preferences = this.stateManager.getPreferences();

    if (!this.loadedBook) {
      const workspaceFiles = await this.scanWorkspaceFiles();
      let filesListHtml = '';

      if (workspaceFiles.length > 0) {
        filesListHtml = `
      <div class="workspace-section">
        <div class="section-title">📂 Berkas Ditemukan di Workspace</div>
        <div class="file-list">
          ${workspaceFiles
            .map(
              (f) => `
          <div class="file-item">
            <div class="file-info">
              <span class="file-name">${this.escapeText(f.name)}</span>
              <span class="file-path" title="${this.escapeText(f.relPath)}">${this.escapeText(f.relPath)}</span>
            </div>
            <button type="button" class="btn-open" onclick="openFile('${this.escapeText(f.relPath).replace(/'/g, "\\'")}')">Buka</button>
          </div>`
            )
            .join('')}
        </div>
      </div>`;
      } else {
        filesListHtml = `
      <div class="empty-tip">
        <p style="margin: 0; color: #94a3b8; font-size: 0.8rem;">Tidak ada berkas .epub atau .xhtml di root workspace saat ini.</p>
      </div>`;
      }

      // Empty state
      const emptyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>XHTML Reader Previewer</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 1.5rem 1rem;
      background: #0f172a; color: #f8fafc;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
      min-height: 100vh;
    }
    .card {
      background: #1e293b; border: 1px solid #334155; border-radius: 12px;
      padding: 1.75rem 1.25rem; width: 100%; max-width: 480px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      display: flex; flex-direction: column; align-items: stretch;
    }
    .card-header { text-align: center; margin-bottom: 1.25rem; }
    .card-icon { font-size: 2.2rem; margin-bottom: 0.35rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.35rem; color: #60a5fa; font-weight: 600; }
    p { font-size: 0.85rem; color: #94a3b8; line-height: 1.4; margin: 0; }
    .section-title {
      font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
      color: #94a3b8; font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;
    }
    .file-list {
      display: flex; flex-direction: column; gap: 0.4rem; max-height: 180px; overflow-y: auto;
      margin-bottom: 0.5rem; padding-right: 0.2rem;
    }
    .file-item {
      display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
      background: #0f172a; border: 1px solid #334155; border-radius: 8px;
      padding: 0.5rem 0.65rem; transition: border-color 0.15s, background 0.15s;
    }
    .file-item:hover { border-color: #60a5fa; background: #131d33; }
    .file-info { display: flex; flex-direction: column; min-width: 0; text-align: left; }
    .file-name { font-size: 0.85rem; font-weight: 500; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-path { font-size: 0.7rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn-open {
      background: #2563eb; color: #ffffff; border: none; border-radius: 6px;
      padding: 0.35rem 0.65rem; font-size: 0.75rem; font-weight: 500; cursor: pointer; flex-shrink: 0;
      transition: background 0.15s;
    }
    .btn-open:hover { background: #1d4ed8; }
    .btn-primary {
      background: #2563eb; color: #ffffff; border: none; border-radius: 8px;
      padding: 0.65rem 1rem; font-size: 0.85rem; font-weight: 500; cursor: pointer; width: 100%;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      transition: background 0.15s; margin-bottom: 0.75rem;
    }
    .btn-primary:hover { background: #1d4ed8; }
    .divider {
      display: flex; align-items: center; text-align: center; color: #64748b;
      font-size: 0.75rem; margin: 0.85rem 0;
    }
    .divider::before, .divider::after { content: ''; flex: 1; border-bottom: 1px solid #334155; }
    .divider span { padding: 0 0.5rem; }
    .path-form { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
    .path-input {
      flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 6px;
      padding: 0.45rem 0.65rem; color: #f8fafc; font-size: 0.8rem; outline: none;
    }
    .path-input:focus { border-color: #60a5fa; }
    .btn-submit {
      background: #334155; color: #f8fafc; border: none; border-radius: 6px;
      padding: 0.45rem 0.75rem; font-size: 0.8rem; cursor: pointer; font-weight: 500;
      transition: background 0.15s;
    }
    .btn-submit:hover { background: #475569; }
    .badge {
      background: #0f172a; border: 1px solid #334155; color: #94a3b8;
      padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.75rem; text-align: center; margin-top: 0.75rem;
    }
    .badge code { color: #93c5fd; }
  </style>
  <script>
    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('bookLoaded', () => { location.reload(); });

    async function openFile(filePath) {
      try {
        const res = await fetch('/api/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath })
        });
        const data = await res.json();
        if (data.success) {
          location.reload();
        } else {
          alert(data.error || 'Gagal membuka berkas');
        }
      } catch (err) {
        alert('Gagal menghubungi server: ' + err.message);
      }
    }

    async function handleManualOpen(e) {
      e.preventDefault();
      const input = document.getElementById('manual-path-input');
      const val = input.value.trim();
      if (val) {
        await openFile(val);
      }
    }

    async function handleFileUpload(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      const btn = document.getElementById('btn-upload');
      if (btn) btn.textContent = 'Memuat berkas...';

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name)
          },
          body: file
        });
        const data = await res.json();
        if (data.success) {
          location.reload();
        } else {
          alert(data.error || 'Gagal mengunggah berkas');
          if (btn) btn.textContent = '📁 Pilih Berkas (.epub, .xhtml) dari Komputer...';
        }
      } catch (err) {
        alert('Upload gagal: ' + err.message);
        if (btn) btn.textContent = '📁 Pilih Berkas (.epub, .xhtml) dari Komputer...';
      }
    }
  </script>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="card-icon">📖</div>
      <h1>XHTML & EPUB Reader</h1>
      <p>Belum ada buku atau berkas XHTML yang dimuat ke dalam Auxiliary Pane.</p>
    </div>

    ${filesListHtml}

    <div class="divider"><span>atau pilih berkas</span></div>

    <!-- Pilih Berkas dari Komputer -->
    <div class="upload-section">
      <input type="file" id="file-picker" accept=".epub,.xhtml,.html,.htm" style="display:none" onchange="handleFileUpload(this)">
      <button type="button" class="btn-primary" id="btn-upload" onclick="document.getElementById('file-picker').click()">
        📁 Pilih Berkas (.epub, .xhtml) dari Komputer...
      </button>
    </div>

    <!-- Manual Path Input Form -->
    <div class="manual-section">
      <form onsubmit="handleManualOpen(event)" class="path-form">
        <input type="text" id="manual-path-input" class="path-input" placeholder="Ketik atau tempel path berkas..." required />
        <button type="submit" class="btn-submit">Buka</button>
      </form>
    </div>

    <div class="badge">
      Gunakan perintah Agent atau panggil <code>/api/open</code>
    </div>
  </div>
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(emptyHtml);
      return;
    }

    try {
      const chapterContentRaw = await fsp.readFile(this.loadedBook.currentChapterPath, 'utf-8');
      const sanitized = sanitizeXhtml(chapterContentRaw);
      const chapterDir = path.dirname(this.loadedBook.currentChapterPath);
      const rewrittenContent = await this.rewriteAssets(sanitized, chapterDir, this.loadedBook.bookRootDir);

      const tocItems: ReaderTocItem[] | undefined = this.loadedBook.epubPackage?.toc.map((t) => ({
        label: t.label,
        href: t.href,
        active: t.href.includes(path.basename(this.loadedBook!.currentChapterPath))
      }));

      const navInfo: ReaderNavInfo = {
        hasPrev: this.loadedBook.isEpub ? this.loadedBook.currentSpineIndex > 0 : false,
        hasNext: this.loadedBook.isEpub
          ? this.loadedBook.currentSpineIndex < (this.loadedBook.epubPackage?.spine.length ?? 1) - 1
          : false,
        bookTitle: this.loadedBook.title,
        chapterIndex: this.loadedBook.currentSpineIndex + 1,
        totalChapters: this.loadedBook.epubPackage?.spine.length ?? 1,
        currentFileName: path.basename(this.loadedBook.currentChapterPath),
        isLinear: true,
        toc: tocItems
      };

      if (this.loadedBook.epubPackage) {
        navInfo.spineItems = this.loadedBook.epubPackage.spine.map((sp, idx) => ({
          index: idx + 1,
          idref: sp.idref,
          href: sp.href,
          fileName: path.basename(sp.href),
          linear: sp.linear !== false,
          active: idx === this.loadedBook!.currentSpineIndex
        }));
      }

      const initialLocation = this.stateManager.getReadingLocation(this.loadedBook.currentChapterPath);

      const resetToTop = Boolean(this.loadedBook.resetToTop);
      const startAtBottom = Boolean(this.loadedBook.startAtBottom);
      this.loadedBook.resetToTop = false;
      this.loadedBook.startAtBottom = false;

      const html = readerShell(
        rewrittenContent,
        this.loadedBook.currentChapterPath,
        this.loadedBook.currentFragment,
        { cspSource: `http://${this.host}:*` },
        navInfo,
        preferences,
        initialLocation,
        resetToTop,
        startAtBottom
      );

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error rendering reader UI: ${String(err)}`);
    }
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) {
          reject(new Error('Request body too large'));
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', (err) => reject(err));
    });
  }
}

// CLI Launcher entry point
if (require.main === module) {
  const server = new SidecarServer();
  server
    .start()
    .then((url) => {
      console.log(`[XHTML Sidecar] Server listening at ${url}`);
      console.log(`[XHTML Sidecar] Auxiliary Pane Ready (PID: ${process.pid})`);

      const shutdown = async () => {
        console.log('[XHTML Sidecar] Shutting down...');
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    })
    .catch((err) => {
      console.error('[XHTML Sidecar] Failed to start:', err);
      process.exit(1);
    });
}
