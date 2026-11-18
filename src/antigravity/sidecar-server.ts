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

      if (msg.type === 'prevChapter') {
        if (this.loadedBook.isEpub && this.loadedBook.epubPackage && this.loadedBook.currentSpineIndex > 0) {
          this.loadedBook.currentSpineIndex -= 1;
          const chapter = this.loadedBook.epubPackage.spine[this.loadedBook.currentSpineIndex];
          this.loadedBook.currentChapterPath = chapter.uri.fsPath || chapter.uri.path;
          this.loadedBook.currentFragment = undefined;
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
          this.broadcastEvent('chapterChanged', {
            spineIndex: this.loadedBook.currentSpineIndex,
            chapterPath: this.loadedBook.currentChapterPath
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
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, lastFootnote: this.lastFootnoteResponse }));
    } catch (err) {
      console.error('[Sidecar] openBook error:', err);
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

  private async serveReaderUi(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const preferences = this.stateManager.getPreferences();

    if (!this.loadedBook) {
      // Empty state
      const emptyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>XHTML Reader Previewer</title>
  <style>
    body {
      margin: 0; padding: 2rem;
      background: #111827; color: #f3f4f6;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 80vh; text-align: center;
    }
    .card {
      background: #1f2937; border: 1px solid #374151; border-radius: 12px;
      padding: 2.5rem; max-width: 440px; box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    }
    h1 { font-size: 1.4rem; margin-bottom: 0.75rem; color: #60a5fa; }
    p { font-size: 0.95rem; color: #9ca3af; line-height: 1.5; margin-bottom: 1.5rem; }
    .badge {
      display: inline-block; background: #374151; color: #e5e7eb;
      padding: 0.35rem 0.75rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 500;
    }
    code { background: #111827; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.85rem; color: #93c5fd; }
  </style>
  <script>
    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('bookLoaded', () => { location.reload(); });
  </script>
</head>
<body>
  <div class="card">
    <div style="font-size: 2.5rem; margin-bottom: 1rem;">📖</div>
    <h1>XHTML & EPUB Reader</h1>
    <p>Belum ada buku atau berkas XHTML yang dimuat ke dalam Auxiliary Pane.</p>
    <div class="badge">Gunakan perintah Agent atau panggil <code>/api/open</code></div>
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

      // Inject SSE live listener directly into HTML reader shell
      let html = readerShell(
        rewrittenContent,
        this.loadedBook.currentChapterPath,
        this.loadedBook.currentFragment,
        { cspSource: `http://${this.host}:*` },
        navInfo,
        preferences,
        initialLocation,
        false,
        false
      );

      // Inject client SSE hot-reload script before </body>
      const sseScript = `
<script>
  (function() {
    const sse = new EventSource('/api/events');
    sse.addEventListener('chapterChanged', () => { location.reload(); });
    sse.addEventListener('bookLoaded', () => { location.reload(); });
  })();
</script>
</body>`;
      html = html.replace('</body>', sseScript);

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
