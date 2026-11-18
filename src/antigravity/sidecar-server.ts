import * as http from 'node:http';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
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
  workspaceDirs?: string[];
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
  private workspaceDirs: string[] = [];
  private stateManager: StateManager;
  private navigationHistory = new NavigationHistory();
  private loadedBooks = new Map<string, LoadedBookState>();
  private lastActiveWorkspace?: string;
  private lastFootnoteResponse: { requestId: string; html?: string; error?: string } | undefined;

  public readonly port: number;
  public readonly host: string;

  constructor(options: SidecarServerOptions = {}) {
    const envPort = process.env.ANTIGRAVITY_SIDECAR_WEB_PORT;
    this.port = options.port ?? (envPort ? parseInt(envPort, 10) : 5890);
    this.host = options.host ?? '127.0.0.1';

    if (options.workspaceDirs && options.workspaceDirs.length > 0) {
      this.workspaceDirs = [...options.workspaceDirs];
    }

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

  public getLoadedBook(workspace?: string): LoadedBookState | undefined {
    if (workspace) {
      const key = this.normalizeWorkspaceKey(workspace);
      return this.loadedBooks.get(key);
    }
    if (this.lastActiveWorkspace) {
      const book = this.loadedBooks.get(this.lastActiveWorkspace);
      if (book) return book;
    }
    return this.loadedBooks.values().next().value;
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

  public async openBook(
    filePath: string,
    spineIndex = 0,
    targetId?: string,
    workspaceHint?: string
  ): Promise<LoadedBookState> {
    let absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      const targetRoot = this.resolveTargetWorkspace(workspaceHint);
      const candidate = path.resolve(targetRoot, filePath);
      if (fs.existsSync(candidate)) {
        absolutePath = candidate;
      } else {
        const roots = this.resolveWorkspaceDirs();
        for (const r of roots) {
          const c = path.resolve(r, filePath);
          if (fs.existsSync(c)) {
            absolutePath = c;
            break;
          }
        }
      }
    }
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

    let epubPackage: EpubPackage | undefined;
    let safeSpineIndex = 0;
    let currentChapterPath = absolutePath;

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
      epubPackage = parseOpfXml(opfXml, opfUri, containerRootUri);

      epubPackage.toc = await loadEpubToc(epubPackage, async (uri) => {
        return fsp.readFile(uri.fsPath || uri.path, 'utf-8');
      });

      // Find spine index if opening a specific chapter file
      safeSpineIndex = Math.max(0, Math.min(spineIndex, epubPackage.spine.length - 1));
      if (!stat.isDirectory() && ext !== '.epub') {
        const foundIdx = epubPackage.spine.findIndex(
          (item) => path.resolve(item.uri.fsPath || item.uri.path) === absolutePath
        );
        if (foundIdx >= 0) {
          safeSpineIndex = foundIdx;
        }
      }

      const initialChapter = epubPackage.spine[safeSpineIndex];
      currentChapterPath = initialChapter ? (initialChapter.uri.fsPath || initialChapter.uri.path) : '';
    }

    const targetWs = this.resolveTargetWorkspace(workspaceHint || absolutePath);
    const wsKey = this.normalizeWorkspaceKey(targetWs);

    const loadedBook: LoadedBookState = {
      filePath: absolutePath,
      fileName,
      isEpub: Boolean(containerRootPath),
      title: containerRootPath && epubPackage ? epubPackage.title : fileName,
      cacheDir: ext === '.epub' ? containerRootPath : undefined,
      bookRootDir: containerRootPath || path.dirname(absolutePath),
      epubPackage,
      currentSpineIndex: safeSpineIndex,
      currentChapterPath,
      currentFragment: targetId
    };

    this.loadedBooks.set(wsKey, loadedBook);
    this.lastActiveWorkspace = wsKey;

    this.broadcastEvent('bookLoaded', {
      workspace: targetWs,
      title: loadedBook.title,
      fileName: loadedBook.fileName,
      currentSpineIndex: loadedBook.currentSpineIndex,
      isEpub: loadedBook.isEpub
    });

    return loadedBook;
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
      const wsParam = parsedUrl.searchParams.get('workspace') || undefined;
      const book = this.getLoadedBook(wsParam);
      const wsPath = this.resolveTargetWorkspace(wsParam);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          loaded: Boolean(book),
          workspace: wsPath,
          port: this.port,
          book: book
            ? {
                filePath: book.filePath,
                title: book.title,
                fileName: book.fileName,
                isEpub: book.isEpub,
                currentSpineIndex: book.currentSpineIndex,
                totalChapters: book.epubPackage?.spine.length ?? 1,
                currentChapterPath: book.currentChapterPath,
                currentFragment: book.currentFragment
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
      const wsParam = parsedUrl.searchParams.get('workspace');
      const wsPath = this.resolveTargetWorkspace(wsParam || undefined);
      const files = await this.scanWorkspaceDir(wsPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workspace: wsPath, files }));
      return;
    }

    // 3d. Set Workspace API
    if (pathname === '/api/set-workspace' && req.method === 'POST') {
      try {
        const body = await this.readRequestBody(req);
        const parsed = JSON.parse(body || '{}');
        const uris = parsed.workspaceUris || parsed.workspacePaths || [];
        const firstUri = uris[0];
        const wsPath = this.resolveTargetWorkspace(firstUri);
        const files = await this.scanWorkspaceDir(wsPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, workspace: wsPath, files }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
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
      await this.serveAsset(assetRelPath, res, req);
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

      const book = await this.openBook(parsed.filePath, parsed.spineIndex, parsed.targetId, parsed.workspace);
      const targetWs = this.resolveTargetWorkspace(parsed.workspace || parsed.filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          workspace: targetWs,
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

      const wsParam = msg.workspace || undefined;
      const loadedBook = this.getLoadedBook(wsParam);

      if (!loadedBook) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No book loaded' }));
        return;
      }

      const wsPath = this.resolveTargetWorkspace(wsParam || loadedBook.filePath);
      const wsKey = this.normalizeWorkspaceKey(wsPath);

      let chapterChanged = false;

      if (msg.type === 'prevChapter') {
        if (loadedBook.isEpub && loadedBook.epubPackage && loadedBook.currentSpineIndex > 0) {
          loadedBook.currentSpineIndex -= 1;
          const chapter = loadedBook.epubPackage.spine[loadedBook.currentSpineIndex];
          loadedBook.currentChapterPath = chapter.uri.fsPath || chapter.uri.path;
          loadedBook.currentFragment = undefined;
          loadedBook.startAtBottom = Boolean(msg.startAtBottom);
          loadedBook.resetToTop = !msg.startAtBottom;
          chapterChanged = true;
          this.broadcastEvent('chapterChanged', {
            workspace: wsPath,
            spineIndex: loadedBook.currentSpineIndex,
            chapterPath: loadedBook.currentChapterPath
          });
        }
      } else if (msg.type === 'nextChapter') {
        if (
          loadedBook.isEpub &&
          loadedBook.epubPackage &&
          loadedBook.currentSpineIndex < loadedBook.epubPackage.spine.length - 1
        ) {
          loadedBook.currentSpineIndex += 1;
          const chapter = loadedBook.epubPackage.spine[loadedBook.currentSpineIndex];
          loadedBook.currentChapterPath = chapter.uri.fsPath || chapter.uri.path;
          loadedBook.currentFragment = undefined;
          loadedBook.resetToTop = true;
          loadedBook.startAtBottom = false;
          chapterChanged = true;
          this.broadcastEvent('chapterChanged', {
            workspace: wsPath,
            spineIndex: loadedBook.currentSpineIndex,
            chapterPath: loadedBook.currentChapterPath
          });
        }
      } else if (msg.type === 'openLink' && msg.href) {
        if (msg.currentPosition) {
          await this.stateManager.saveReadingLocation(loadedBook.currentChapterPath, {
            scrollRatio: msg.currentPosition.scrollRatio,
            scrollY: msg.currentPosition.scrollY,
            anchorId: msg.currentPosition.anchorId
          });
        }

        const [filePart, fragment] = msg.href.split('#');
        let targetPath = loadedBook.currentChapterPath;
        if (filePart) {
          const decoded = decodeURIComponent(filePart);
          targetPath = path.resolve(path.dirname(loadedBook.currentChapterPath), decoded);
        }

        if (this.isSafePath(loadedBook.bookRootDir, targetPath)) {
          if (loadedBook.isEpub && loadedBook.epubPackage) {
            const foundIdx = loadedBook.epubPackage.spine.findIndex(
              (item) => path.resolve(item.uri.fsPath || item.uri.path) === path.resolve(targetPath)
            );
            if (foundIdx >= 0) {
              loadedBook.currentSpineIndex = foundIdx;
            }
          }
          loadedBook.currentChapterPath = targetPath;
          loadedBook.currentFragment = fragment;
          loadedBook.resetToTop = !fragment;
          loadedBook.startAtBottom = false;
          chapterChanged = true;
          this.broadcastEvent('chapterChanged', {
            workspace: wsPath,
            spineIndex: loadedBook.currentSpineIndex,
            chapterPath: loadedBook.currentChapterPath,
            fragment: loadedBook.currentFragment
          });
        }
      } else if (msg.type === 'savePreferences') {
        if (msg.preferences) {
          await this.stateManager.savePreferences(msg.preferences);
        }
      } else if (msg.type === 'saveReadingPosition') {
        await this.stateManager.saveReadingLocation(loadedBook.currentChapterPath, {
          scrollRatio: msg.scrollRatio,
          scrollY: msg.scrollY,
          anchorId: msg.anchorId
        });
      } else if (msg.type === 'requestFootnote') {
        await this.handleFootnoteRequest(msg, loadedBook);
      } else if (msg.type === 'closeBook') {
        this.loadedBooks.delete(wsKey);
        if (this.lastActiveWorkspace === wsKey) {
          this.lastActiveWorkspace = undefined;
        }
        this.broadcastEvent('bookLoaded', { workspace: wsPath, book: null });
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

  private async handleFootnoteRequest(msg: { href: string; requestId: string }, book: LoadedBookState): Promise<void> {
    try {
      const parts = msg.href.split('#');
      const filePart = parts[0];
      const fragment = parts[1];

      if (!fragment) {
        this.lastFootnoteResponse = { requestId: msg.requestId, error: 'Missing fragment' };
        return;
      }

      let targetPath = book.currentChapterPath;
      if (filePart) {
        const decoded = decodeURIComponent(filePart);
        targetPath = path.resolve(path.dirname(book.currentChapterPath), decoded);
      }

      if (!this.isSafePath(book.bookRootDir, targetPath)) {
        this.lastFootnoteResponse = { requestId: msg.requestId, error: 'Path traversal blocked' };
        return;
      }

      const raw = await fsp.readFile(targetPath, 'utf-8');
      const extracted = extractElementById(raw, fragment);

      if (!extracted) {
        this.lastFootnoteResponse = { requestId: msg.requestId, error: 'Footnote element not found' };
        return;
      }

      const rewritten = await this.rewriteAssets(extracted, path.dirname(targetPath), book.bookRootDir);
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

  private async serveAsset(assetRelPath: string, res: http.ServerResponse, req?: http.IncomingMessage): Promise<void> {
    const rawUrl = req?.url || '';
    const parsed = new URL(rawUrl, `http://${this.host}:${this.port}`);
    const wsHint = parsed.searchParams.get('workspace') || undefined;
    let book = this.getLoadedBook(wsHint);

    if (!book) {
      const decodedRel = decodeURIComponent(assetRelPath);
      for (const b of this.loadedBooks.values()) {
        const fullCandidate = path.resolve(b.bookRootDir, decodedRel);
        if (fs.existsSync(fullCandidate)) {
          book = b;
          break;
        }
      }
    }

    if (!book) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No book loaded');
      return;
    }

    const decoded = decodeURIComponent(assetRelPath);
    const fullPath = path.resolve(book.bookRootDir, decoded);

    // Strict Path Traversal Guard
    if (!this.isSafePath(book.bookRootDir, fullPath)) {
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

  public uriToFsPath(uri: string): string {
    if (!uri) return '';
    try {
      if (uri.startsWith('file://') || uri.startsWith('file:')) {
        return fileURLToPath(uri);
      }
    } catch {
      // fallback
    }
    return uri;
  }

  public normalizeWorkspaceKey(dirPath?: string): string {
    if (!dirPath) {
      const roots = this.resolveWorkspaceDirs();
      if (roots.length > 0) {
        return path.resolve(roots[0]).toLowerCase().replace(/\\/g, '/');
      }
      return 'default';
    }
    const fsPath = this.uriToFsPath(dirPath);
    return path.resolve(fsPath).toLowerCase().replace(/\\/g, '/');
  }

  public findWorkspaceForPath(targetPath: string): string | undefined {
    const normTarget = path.resolve(this.uriToFsPath(targetPath)).toLowerCase().replace(/\\/g, '/');
    const knownRoots = this.resolveWorkspaceDirs();
    for (const r of knownRoots) {
      const normRoot = path.resolve(r).toLowerCase().replace(/\\/g, '/');
      if (normTarget === normRoot || normTarget.startsWith(normRoot + '/')) {
        return path.resolve(r);
      }
    }
    return undefined;
  }

  public resolveTargetWorkspace(hint?: string): string {
    if (hint) {
      const fsPath = this.uriToFsPath(hint);
      const found = this.findWorkspaceForPath(fsPath);
      if (found) return found;
      if (fs.existsSync(fsPath)) {
        try {
          const stat = fs.statSync(fsPath);
          return stat.isDirectory() ? fsPath : path.dirname(fsPath);
        } catch {
          // ignore
        }
      }
    }
    const roots = this.resolveWorkspaceDirs();
    return roots.length > 0 ? roots[0] : process.cwd();
  }

  public async scanWorkspaceDir(
    workspaceDir: string
  ): Promise<Array<{ fullPath: string; relPath: string; name: string; isEpub: boolean }>> {
    const root = path.resolve(workspaceDir);
    if (!fs.existsSync(root)) return [];
    return this.scanWorkspaceFiles(root, 0, 3, root);
  }

  public resolveWorkspaceDirs(): string[] {
    const dirs: string[] = [];
    const seen = new Set<string>();

    const addDir = (dirPath: string | undefined | null) => {
      if (!dirPath) return;
      try {
        const resolved = path.resolve(dirPath);
        if (fs.existsSync(resolved) && !seen.has(resolved)) {
          seen.add(resolved);
          dirs.push(resolved);
        }
      } catch {
        // ignore invalid paths
      }
    };

    // 1. Explicitly configured or dynamically pushed workspaceDirs
    for (const d of this.workspaceDirs) {
      addDir(d);
    }

    // 2. Discover from active Antigravity Project (~/.gemini/config/projects/<id>.json)
    try {
      const projectsDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
      if (fs.existsSync(projectsDir)) {
        const activeProjectId = process.env.ANTIGRAVITY_PROJECT_ID;
        let targetFiles: string[] = [];

        if (activeProjectId) {
          const directFile = path.join(projectsDir, `${activeProjectId}.json`);
          if (fs.existsSync(directFile)) {
            targetFiles.push(directFile);
          }
        }

        // If no active project ID or file not found, check the most recently modified project
        if (targetFiles.length === 0 && dirs.length === 0) {
          const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
          const sorted = entries
            .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'outside-of-project.json')
            .map((e) => {
              const fullPath = path.join(projectsDir, e.name);
              const mtime = fs.statSync(fullPath).mtimeMs;
              return { fullPath, mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);

          if (sorted.length > 0) {
            targetFiles.push(sorted[0].fullPath);
          }
        }

        for (const filePath of targetFiles) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            const resources = data.projectResources?.resources;
            if (Array.isArray(resources)) {
              for (const r of resources) {
                const folderUri = r.gitFolder?.folderUri || r.folder?.folderUri || r.folderUri;
                if (typeof folderUri === 'string') {
                  const localPath = this.uriToFsPath(folderUri);
                  addDir(localPath);
                }
              }
            }
          } catch {
            // ignore bad project json
          }
        }
      }
    } catch {
      // ignore discovery error
    }

    // 3. Fallback to process.cwd() if nothing else found
    if (dirs.length === 0) {
      addDir(process.cwd());
    }

    return dirs;
  }

  public async scanAllWorkspaceFiles(): Promise<
    Array<{ fullPath: string; relPath: string; name: string; isEpub: boolean }>
  > {
    const root = this.resolveTargetWorkspace();
    return this.scanWorkspaceDir(root);
  }

  private async scanWorkspaceFiles(
    dir = process.cwd(),
    depth = 0,
    maxDepth = 3,
    rootDir?: string
  ): Promise<Array<{ fullPath: string; relPath: string; name: string; isEpub: boolean }>> {
    if (depth > maxDepth) return [];
    const effectiveRoot = rootDir ?? dir;
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
          const sub = await this.scanWorkspaceFiles(fullPath, depth + 1, maxDepth, effectiveRoot);
          results.push(...sub);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.epub', '.xhtml', '.html', '.htm'].includes(ext)) {
            const relPath = path.relative(effectiveRoot, fullPath).replace(/\\/g, '/');
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

  private renderFilesHtml(
    workspaceFiles: Array<{ fullPath: string; relPath: string; name: string; isEpub: boolean }>
  ): string {
    if (workspaceFiles.length > 0) {
      return `
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
    }
    return `
      <div class="empty-tip">
        <p>Tidak ada berkas .epub atau .xhtml di workspace saat ini.</p>
      </div>`;
  }

  private escapeText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private async serveReaderUi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const preferences = this.stateManager.getPreferences();
    const parsedUrl = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const wsParam = parsedUrl.searchParams.get('workspace');
    const wsPath = this.resolveTargetWorkspace(wsParam || undefined);
    const wsKey = this.normalizeWorkspaceKey(wsPath);
    const loadedBook =
      this.loadedBooks.get(wsKey) ||
      (this.loadedBooks.size === 1 && !wsParam ? this.loadedBooks.values().next().value : undefined);

    if (!loadedBook) {
      const workspaceFiles = await this.scanWorkspaceDir(wsPath);
      const filesListHtml = this.renderFilesHtml(workspaceFiles);

      // Empty state
      const emptyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XHTML & EPUB Reader</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    ::selection { background: #1f6feb; color: #ffffff; }

    :root {
      --bg-canvas: #0d1117;
      --bg-surface: #161b22;
      --bg-inset: #0d1117;
      --border-subtle: #30363d;
      --border-muted: #21262d;
      --border-hover: #58a6ff;
      --text-primary: #f0f6fc;
      --text-secondary: #c9d1d9;
      --text-muted: #8b949e;
      --accent-blue: #58a6ff;
      --btn-bg: #21262d;
      --btn-hover: #30363d;
    }

    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-canvas);
      color: var(--text-secondary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem 1rem;
      box-sizing: border-box;
      overflow-y: auto;
      -webkit-font-smoothing: antialiased;
    }

    .shell {
      width: 100%;
      max-width: 440px;
      margin: auto;
    }

    .card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 1.75rem 1.35rem;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
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

    .brand-logo-svg {
      width: 48px;
      height: 48px;
    }

    h1 {
      font-size: 1.15rem;
      margin: 0 0 0.35rem;
      color: var(--text-primary);
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
      background-color: var(--btn-bg);
      border: 1px solid var(--border-subtle);
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
      background-color: var(--border-subtle);
      border-radius: 9999px;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      background-color: var(--bg-inset);
      border: 1px solid var(--border-muted);
      border-radius: 8px;
      padding: 0.5rem 0.65rem;
      transition: background-color 0.15s, border-color 0.15s;
    }

    .file-item:hover {
      border-color: var(--border-hover);
      background-color: #1c2128;
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
      background-color: var(--bg-canvas);
      color: #58a6ff;
      border: 1px solid #1f6feb;
    }

    .badge-xhtml {
      background-color: var(--bg-canvas);
      color: #bc8cff;
      border: 1px solid #8957e5;
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
      background-color: var(--btn-bg);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 0.35rem 0.65rem;
      font-size: 0.72rem;
      font-weight: 500;
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      transition: background-color 0.15s, border-color 0.15s, color 0.15s;
    }

    .btn-open:hover {
      background-color: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
    }

    .empty-tip {
      padding: 0.75rem;
      text-align: center;
      border-radius: 8px;
      background-color: var(--bg-inset);
      border: 1px dashed var(--border-subtle);
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
      background-color: var(--border-subtle);
    }

    .divider-text {
      padding: 0 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Dropzone Upload Button */
    .dropzone {
      border: 1px dashed var(--border-subtle);
      border-radius: 10px;
      padding: 0.85rem 1rem;
      background-color: var(--bg-inset);
      display: flex;
      align-items: center;
      gap: 0.85rem;
      cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s;
      margin-bottom: 0.75rem;
    }

    .dropzone:hover, .dropzone.dragover {
      border-color: var(--border-hover);
      background-color: #1c2128;
    }

    .dropzone-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-blue);
      flex-shrink: 0;
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
      background-color: var(--bg-inset);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 0.25rem 0.35rem 0.25rem 0.65rem;
      gap: 0.45rem;
      margin-bottom: 0.75rem;
      transition: border-color 0.15s;
    }

    .path-bar:focus-within {
      border-color: var(--border-hover);
    }

    .path-bar-icon {
      color: var(--text-muted);
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .path-input {
      flex: 1;
      background-color: transparent;
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
      background-color: var(--btn-bg);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      border-radius: 6px;
      padding: 0.35rem 0.55rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.15s, border-color 0.15s, color 0.15s;
    }

    .path-submit-btn:hover {
      background-color: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
    }

    /* Footnote Badge */
    .badge {
      background-color: var(--bg-inset);
      border: 1px solid var(--border-muted);
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
      color: var(--accent-blue);
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.7rem;
    }
  </style>
  <script>
    let currentWorkspace = ${JSON.stringify(wsPath)};

    const urlParams = new URLSearchParams(window.location.search);
    const queryWs = urlParams.get('workspace');
    if (queryWs) {
      currentWorkspace = queryWs;
      sessionStorage.setItem('xhtml_reader_workspace', currentWorkspace);
    } else {
      const stored = sessionStorage.getItem('xhtml_reader_workspace');
      if (stored) {
        currentWorkspace = stored;
      }
    }

    const sseWsUrl = currentWorkspace ? '/api/events?workspace=' + encodeURIComponent(currentWorkspace) : '/api/events';
    const evtSource = new EventSource(sseWsUrl);
    evtSource.addEventListener('bookLoaded', (e) => {
      try {
        const d = JSON.parse(e.data || '{}');
        if (!d.workspace || !currentWorkspace || d.workspace.toLowerCase() === currentWorkspace.toLowerCase()) {
          location.reload();
        }
      } catch {
        location.reload();
      }
    });

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    async function openFile(filePath) {
      try {
        const res = await fetch('/api/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, workspace: currentWorkspace })
        });
        const data = await res.json();
        if (data.success) {
          const ws = data.workspace || currentWorkspace;
          if (ws) {
            sessionStorage.setItem('xhtml_reader_workspace', ws);
            location.href = '/?workspace=' + encodeURIComponent(ws);
          } else {
            location.reload();
          }
        } else {
          alert(data.error || 'Gagal membuka berkas');
        }
      } catch (err) {
        alert('Gagal menghubungi server: ' + err.message);
      }
    }

    function renderWorkspaceFiles(files) {
      const container = document.getElementById('workspace-files-container');
      if (!container) return;
      if (!files || files.length === 0) {
        container.innerHTML = '<div class="empty-tip"><p>Tidak ada berkas .epub atau .xhtml di workspace saat ini.</p></div>';
        return;
      }
      const items = files
        .map(
          (f) =>
            '<div class="file-item">' +
              '<span class="file-badge ' + (f.isEpub ? 'badge-epub' : 'badge-xhtml') + '">' +
                (f.isEpub ? 'EPUB' : 'XHTML') +
              '</span>' +
              '<div class="file-info">' +
                '<span class="file-name">' + escapeHtml(f.name) + '</span>' +
                '<span class="file-path" title="' + escapeHtml(f.relPath) + '">' + escapeHtml(f.relPath) + '</span>' +
              '</div>' +
              '<button type="button" class="btn-open" onclick="openFile(\\'' + escapeHtml(f.relPath).replace(/'/g, "\\\\'") + '\\')">' +
                '<span>Buka</span>' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                  '<line x1="5" y1="12" x2="19" y2="12"></line>' +
                  '<polyline points="12 5 19 12 12 19"></polyline>' +
                '</svg>' +
              '</button>' +
            '</div>'
        )
        .join('');

      container.innerHTML =
        '<div class="workspace-section">' +
          '<div class="section-title">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>' +
            '</svg>' +
            '<span>Berkas di Workspace</span>' +
            '<span class="counter-chip">' + files.length + '</span>' +
          '</div>' +
          '<div class="file-list">' +
            items +
          '</div>' +
        '</div>';
    }

    async function loadWorkspaceFiles(ws) {
      const targetWs = ws || currentWorkspace;
      const url = targetWs
        ? '/api/workspace-files?workspace=' + encodeURIComponent(targetWs)
        : '/api/workspace-files';
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.workspace) {
          currentWorkspace = data.workspace;
          sessionStorage.setItem('xhtml_reader_workspace', currentWorkspace);
        }
        if (data && Array.isArray(data.files)) {
          renderWorkspaceFiles(data.files);
        }
      } catch (err) {
        console.error('Failed to load workspace files:', err);
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
        const url = currentWorkspace
          ? '/api/upload?workspace=' + encodeURIComponent(currentWorkspace)
          : '/api/upload';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name)
          },
          body: file
        });
        const data = await res.json();
        if (data.success) {
          const ws = data.workspace || currentWorkspace;
          if (ws) {
            sessionStorage.setItem('xhtml_reader_workspace', ws);
            location.href = '/?workspace=' + encodeURIComponent(ws);
          } else {
            location.reload();
          }
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

    // Host workspace changes listener
    window.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'workspace-change') {
        const uris = event.data.payload && event.data.payload.workspaceUris;
        if (Array.isArray(uris) && uris.length > 0) {
          try {
            const res = await fetch('/api/set-workspace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspaceUris: uris })
            });
            const data = await res.json();
            if (data && data.workspace) {
              const previousWs = currentWorkspace;
              currentWorkspace = data.workspace;
              sessionStorage.setItem('xhtml_reader_workspace', currentWorkspace);

              if (previousWs && previousWs.toLowerCase() !== currentWorkspace.toLowerCase()) {
                const statusRes = await fetch('/api/status?workspace=' + encodeURIComponent(currentWorkspace));
                const statusData = await statusRes.json();
                if (statusData && statusData.loaded) {
                  location.replace('/?workspace=' + encodeURIComponent(currentWorkspace));
                  return;
                }
              }
            }
            if (data && Array.isArray(data.files)) {
              renderWorkspaceFiles(data.files);
            }
          } catch (err) {
            console.error('Failed to sync workspace:', err);
          }
        }
      }
    });

    // Drag and Drop & Initial load
    window.addEventListener('DOMContentLoaded', () => {
      loadWorkspaceFiles(currentWorkspace);

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
          <svg class="brand-logo-svg" width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 10.5C6 9.11929 7.11929 8 8.5 8H22C23.1046 8 24 8.89543 24 10V38C24 37.1716 23.3284 36.5 22.5 36.5H8.5C7.11929 36.5 6 37.6193 6 39V10.5Z" stroke="#58a6ff" stroke-width="2.5" stroke-linejoin="round"/>
            <path d="M42 10.5C42 9.11929 40.8807 8 39.5 8H26C24.8954 8 24 8.89543 24 10V38C24 37.1716 24.6716 36.5 25.5 36.5H39.5C40.8807 36.5 42 37.6193 42 39V10.5Z" stroke="#58a6ff" stroke-width="2.5" stroke-linejoin="round"/>
            <line x1="11" y1="15" x2="19" y2="15" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="11" y1="21" x2="19" y2="21" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="11" y1="27" x2="17" y2="27" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="29" y1="15" x2="37" y2="15" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="29" y1="21" x2="37" y2="21" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="29" y1="27" x2="35" y2="27" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <h1>XHTML & EPUB Reader</h1>
        <p class="brand-lead">Belum ada buku atau berkas XHTML yang dimuat ke dalam Auxiliary Pane.</p>
        <p class="brand-sub">Pilih naskah di workspace atau pilih berkas untuk mulai membaca.</p>
      </div>

      <div id="workspace-files-container">${filesListHtml}</div>

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
      const chapterContentRaw = await fsp.readFile(loadedBook.currentChapterPath, 'utf-8');
      const sanitized = sanitizeXhtml(chapterContentRaw);
      const chapterDir = path.dirname(loadedBook.currentChapterPath);
      const rewrittenContent = await this.rewriteAssets(sanitized, chapterDir, loadedBook.bookRootDir);

      const tocItems: ReaderTocItem[] | undefined = loadedBook.epubPackage?.toc.map((t) => ({
        label: t.label,
        href: t.href,
        active: t.href.includes(path.basename(loadedBook.currentChapterPath))
      }));

      const navInfo: ReaderNavInfo = {
        hasPrev: loadedBook.isEpub ? loadedBook.currentSpineIndex > 0 : false,
        hasNext: loadedBook.isEpub
          ? loadedBook.currentSpineIndex < (loadedBook.epubPackage?.spine.length ?? 1) - 1
          : false,
        bookTitle: loadedBook.title,
        chapterIndex: loadedBook.currentSpineIndex + 1,
        totalChapters: loadedBook.epubPackage?.spine.length ?? 1,
        currentFileName: path.basename(loadedBook.currentChapterPath),
        isLinear: true,
        toc: tocItems
      };

      if (loadedBook.epubPackage) {
        navInfo.spineItems = loadedBook.epubPackage.spine.map((sp, idx) => ({
          index: idx + 1,
          idref: sp.idref,
          href: sp.href,
          fileName: path.basename(sp.href),
          linear: sp.linear !== false,
          active: idx === loadedBook.currentSpineIndex
        }));
      }

      const initialLocation = this.stateManager.getReadingLocation(loadedBook.currentChapterPath);

      const resetToTop = Boolean(loadedBook.resetToTop);
      const startAtBottom = Boolean(loadedBook.startAtBottom);
      loadedBook.resetToTop = false;
      loadedBook.startAtBottom = false;

      const html = readerShell(
        rewrittenContent,
        loadedBook.currentChapterPath,
        loadedBook.currentFragment,
        { cspSource: `http://${this.host}:*` },
        navInfo,
        preferences,
        initialLocation,
        resetToTop,
        startAtBottom
      );

      const injectedHtml = html.replace(
        '<script nonce=',
        `<script>window.__XHTML_WORKSPACE__ = ${JSON.stringify(wsPath)};</script><script nonce=`
      );

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(injectedHtml);
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
