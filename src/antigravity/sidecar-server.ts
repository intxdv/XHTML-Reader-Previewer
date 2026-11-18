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

    // 1b. Brand Logo Asset
    if (pathname === '/logo.png' && req.method === 'GET') {
      await this.serveLogo(res);
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

  private async serveLogo(res: http.ServerResponse): Promise<void> {
    const candidatePaths = [
      path.resolve(__dirname, '../assets/logo.png'),
      path.resolve(__dirname, '../plugin/assets/logo.png'),
      path.resolve(__dirname, '../media/icon.png'),
      path.resolve(process.cwd(), 'plugin/assets/logo.png'),
      path.resolve(process.cwd(), 'media/icon.png')
    ];

    for (const p of candidatePaths) {
      try {
        await fsp.access(p, fs.constants.R_OK);
        const stat = await fsp.stat(p);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(p).pipe(res);
        return;
      } catch {
        // try next candidate path
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Logo Not Found');
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
        <div class="section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>Berkas di Workspace</span>
          <span class="counter-chip">${workspaceFiles.length}</span>
        </div>
        <div class="file-list">
          ${workspaceFiles
            .map(
              (f) => `
          <div class="file-item">
            <span class="file-badge ${f.isEpub ? 'badge-epub' : 'badge-xhtml'}">
              ${f.isEpub ? 'EPUB' : 'XHTML'}
            </span>
            <div class="file-info">
              <span class="file-name">${this.escapeText(f.name)}</span>
              <span class="file-path" title="${this.escapeText(f.relPath)}">${this.escapeText(f.relPath)}</span>
            </div>
            <button type="button" class="btn-open" onclick="openFile('${this.escapeText(f.relPath).replace(/'/g, "\\'")}')">
              <span>Buka</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </button>
          </div>`
            )
            .join('')}
        </div>
      </div>`;
      } else {
        filesListHtml = `
      <div class="empty-tip">
        <p>Tidak ada berkas .epub atau .xhtml di workspace saat ini.</p>
      </div>`;
      }

      // Empty state
      const emptyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XHTML & EPUB Reader</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    ::selection { background: rgba(56, 189, 248, 0.25); color: #f8fafc; }

    :root {
      --bg-canvas: #090d16;
      --bg-surface: rgba(15, 23, 42, 0.7);
      --bg-card: rgba(30, 41, 59, 0.5);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(56, 189, 248, 0.35);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-cyan: #38bdf8;
      --accent-blue: #2563eb;
    }

    body {
      margin: 0;
      padding: 1.5rem 1rem;
      background: var(--bg-canvas);
      background-image: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56, 189, 248, 0.07), transparent 70%);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      -webkit-font-smoothing: antialiased;
    }

    .shell {
      width: 100%;
      max-width: 440px;
    }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 1.75rem 1.35rem;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(16px);
      display: flex;
      flex-direction: column;
      align-items: stretch;
    }

    /* Branded Header */
    .card-header {
      text-align: center;
      margin-bottom: 1.35rem;
    }

    .brand-logo-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.75rem;
    }

    .brand-logo {
      width: 56px;
      height: 56px;
      object-fit: contain;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4));
    }

    .brand-fallback-icon {
      color: var(--accent-cyan);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    h1 {
      font-size: 1.15rem;
      margin: 0 0 0.35rem;
      color: #f1f5f9;
      font-weight: 600;
      letter-spacing: -0.025em;
    }

    .brand-lead {
      font-size: 0.82rem;
      color: var(--text-secondary);
      line-height: 1.45;
      margin: 0;
    }

    .brand-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin: 0.25rem 0 0;
    }

    /* Workspace Section */
    .workspace-section {
      margin-bottom: 0.75rem;
    }

    .section-title {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      font-weight: 600;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .counter-chip {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--text-secondary);
      font-size: 0.65rem;
      padding: 0.1rem 0.4rem;
      border-radius: 9999px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }

    .file-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      max-height: 200px;
      overflow-y: auto;
      padding-right: 0.2rem;
    }

    .file-list::-webkit-scrollbar {
      width: 5px;
    }
    .file-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.12);
      border-radius: 9999px;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      padding: 0.5rem 0.65rem;
      transition: all 0.15s ease;
    }

    .file-item:hover {
      border-color: var(--border-hover);
      background: rgba(56, 189, 248, 0.03);
      transform: translateY(-1px);
    }

    .file-badge {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 0.2rem 0.45rem;
      border-radius: 6px;
      flex-shrink: 0;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }

    .badge-epub {
      background: rgba(14, 165, 233, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(14, 165, 233, 0.25);
    }

    .badge-xhtml {
      background: rgba(168, 85, 247, 0.12);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.25);
    }

    .file-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
      text-align: left;
    }

    .file-name {
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .file-path {
      font-size: 0.68rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }

    .btn-open {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-secondary);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 0.35rem 0.65rem;
      font-size: 0.72rem;
      font-weight: 500;
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      transition: all 0.15s ease;
    }

    .btn-open:hover {
      background: rgba(56, 189, 248, 0.1);
      color: var(--accent-cyan);
      border-color: rgba(56, 189, 248, 0.3);
    }

    .empty-tip {
      padding: 0.75rem;
      text-align: center;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px dashed rgba(255, 255, 255, 0.08);
      margin-bottom: 0.75rem;
    }
    .empty-tip p {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.78rem;
    }

    /* Divider */
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.7rem;
      margin: 0.85rem 0;
    }

    .divider-line {
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.06);
    }

    .divider-text {
      padding: 0 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Dropzone Upload Button */
    .dropzone {
      border: 1px dashed rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      padding: 0.85rem 1rem;
      background: rgba(255, 255, 255, 0.015);
      display: flex;
      align-items: center;
      gap: 0.85rem;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-bottom: 0.75rem;
    }

    .dropzone:hover, .dropzone.dragover {
      border-color: var(--accent-cyan);
      background: rgba(56, 189, 248, 0.04);
      box-shadow: 0 0 16px -4px rgba(56, 189, 248, 0.15);
    }

    .dropzone-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-cyan);
      flex-shrink: 0;
      transition: transform 0.2s ease;
    }

    .dropzone:hover .dropzone-icon {
      transform: translateY(-1px);
    }

    .dropzone-meta {
      display: flex;
      flex-direction: column;
      text-align: left;
      min-width: 0;
    }

    .dropzone-primary {
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text-primary);
    }

    .dropzone-secondary {
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.15rem;
    }

    /* Manual Path Input Bar */
    .path-bar {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 0.25rem 0.35rem 0.25rem 0.65rem;
      gap: 0.45rem;
      transition: border-color 0.15s ease;
      margin-bottom: 0.75rem;
    }

    .path-bar:focus-within {
      border-color: var(--accent-cyan);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.12);
    }

    .path-bar-icon {
      color: var(--text-muted);
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .path-input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 0.78rem;
      outline: none;
      min-width: 0;
    }

    .path-input::placeholder {
      color: var(--text-muted);
    }

    .path-submit-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--text-secondary);
      border-radius: 6px;
      padding: 0.35rem 0.55rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .path-submit-btn:hover {
      background: var(--accent-cyan);
      color: #090d16;
      border-color: var(--accent-cyan);
    }

    /* Footnote Badge */
    .badge {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      padding: 0.45rem 0.65rem;
      border-radius: 8px;
      font-size: 0.72rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      text-align: center;
    }

    .badge code {
      color: var(--accent-cyan);
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.7rem;
    }
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

    async function uploadFile(file) {
      if (!file) return;
      const label = document.getElementById('dropzone-label');
      if (label) label.textContent = 'Memuat ' + file.name + '...';

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
          if (label) label.textContent = 'Pilih Berkas dari Komputer';
        }
      } catch (err) {
        alert('Upload gagal: ' + err.message);
        if (label) label.textContent = 'Pilih Berkas dari Komputer';
      }
    }

    function handleFileUpload(input) {
      if (!input.files || !input.files[0]) return;
      uploadFile(input.files[0]);
    }

    // Drag and Drop support
    window.addEventListener('DOMContentLoaded', () => {
      const dropzone = document.getElementById('dropzone');
      if (!dropzone) return;

      ['dragenter', 'dragover'].forEach(name => {
        window.addEventListener(name, (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'dragend'].forEach(name => {
        window.addEventListener(name, (e) => {
          if (!e.relatedTarget) {
            dropzone.classList.remove('dragover');
          }
        });
      });

      window.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          uploadFile(e.dataTransfer.files[0]);
        }
      });
    });
  </script>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="card-header">
        <div class="brand-logo-wrap">
          <img src="/logo.png" alt="XHTML Reader Logo" class="brand-logo" onerror="this.style.display='none'; document.getElementById('fallback-logo-icon').style.display='inline-flex';" />
          <div id="fallback-logo-icon" class="brand-fallback-icon" style="display: none;">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path>
              <path d="M6 6h10"></path>
              <path d="M6 10h7"></path>
            </svg>
          </div>
        </div>
        <h1>XHTML & EPUB Reader</h1>
        <p class="brand-lead">Belum ada buku atau berkas XHTML yang dimuat ke dalam Auxiliary Pane.</p>
        <p class="brand-sub">Pilih naskah di workspace atau pilih berkas untuk mulai membaca.</p>
      </div>

      ${filesListHtml}

      <div class="divider">
        <span class="divider-line"></span>
        <span class="divider-text">atau</span>
        <span class="divider-line"></span>
      </div>

      <!-- Pilih Berkas dari Komputer / Dropzone -->
      <div class="dropzone" id="dropzone" onclick="document.getElementById('file-picker').click()">
        <input type="file" id="file-picker" accept=".epub,.xhtml,.html,.htm" style="display:none" onchange="handleFileUpload(this)">
        <div class="dropzone-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </div>
        <div class="dropzone-meta">
          <span class="dropzone-primary" id="dropzone-label">Pilih Berkas dari Komputer</span>
          <span class="dropzone-secondary">atau seret dan lepas (.epub, .xhtml) ke panel ini</span>
        </div>
      </div>

      <!-- Manual Path Input Form -->
      <form onsubmit="handleManualOpen(event)" class="path-bar">
        <div class="path-bar-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <input type="text" id="manual-path-input" class="path-input" placeholder="Ketik atau tempel path berkas..." required autocomplete="off" spellcheck="false" />
        <button type="submit" class="path-submit-btn" title="Buka berkas">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </button>
      </form>

      <div class="badge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
        <span>Gunakan perintah Agent atau panggil <code>/api/open</code></span>
      </div>
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
