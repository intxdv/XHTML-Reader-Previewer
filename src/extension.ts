import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { sanitizeXhtml } from './xhtml';
import { readerShell, ReaderNavInfo } from './reader-shell';
import { locateEpubContainer, parseContainerXml, parseOpfXml, loadEpubToc, EpubPackage } from './epub';
import { StateManager, ReaderPreferences } from './state-manager';
import { EpubCacheManager, ArchiveSecurityError, ArchiveCorruptError } from './archive';

const supportedExtensions = new Set(['.xhtml', '.html', '.htm', '.epub']);
const resourceAttributes = /(<(?:img|source|video|audio|link)\b[^>]*?\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi;

export function activate(context: vscode.ExtensionContext): void {
  const stateManager = new StateManager(context.workspaceState);
  const cacheStorageDir = context.storageUri ? context.storageUri.fsPath : path.join(os.tmpdir(), 'xhtml-reader-previewer');
  const cacheManager = new EpubCacheManager(cacheStorageDir);

  context.subscriptions.push(
    vscode.commands.registerCommand('xhtmlReader.openPreview', (uri?: vscode.Uri) => openPreview(uri, vscode.ViewColumn.Active, stateManager, cacheManager)),
    vscode.commands.registerCommand('xhtmlReader.openSplitPreview', (uri?: vscode.Uri) => openPreview(uri, vscode.ViewColumn.Beside, stateManager, cacheManager)),
  );
}

async function openPreview(
  uri: vscode.Uri | undefined,
  viewColumn = vscode.ViewColumn.Active,
  stateManager?: StateManager,
  cacheManager?: EpubCacheManager
): Promise<void> {
  let source = uri ?? getActiveFileUri();

  if (!source || !supportedExtensions.has(extensionOf(source))) {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: 'Select XHTML or EPUB Book to Preview',
      openLabel: 'Open Preview',
      filters: {
        'EPUB & XHTML Books': ['epub', 'xhtml', 'html', 'htm']
      }
    });

    if (selected && selected[0]) {
      source = selected[0];
    } else {
      return;
    }
  }

  const ext = extensionOf(source);
  let archiveCacheDir: string | undefined;

  // Handle direct .epub archive extraction
  if (ext === '.epub') {
    if (!cacheManager) {
      void vscode.window.showErrorMessage('EPUB Cache Manager is unavailable.');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Opening EPUB...',
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: 'Validating and extracting EPUB package...' });
          const bytes = await vscode.workspace.fs.readFile(source);
          archiveCacheDir = cacheManager.extractEpubToCache(source.fsPath, Buffer.from(bytes));
        }
      );
    } catch (error) {
      const msg = error instanceof ArchiveSecurityError || error instanceof ArchiveCorruptError
        ? error.message
        : error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to open EPUB archive: ${msg}`);
      return;
    }
  }

  const root = archiveCacheDir ? vscode.Uri.file(archiveCacheDir) : parentUri(source);
  let currentSource = source;
  let pendingFragment: string | undefined;

  // Attempt EPUB Package discovery & TOC loading
  let epubPackage: EpubPackage | undefined;
  try {
    const containerRoot = archiveCacheDir ? vscode.Uri.file(archiveCacheDir) : await locateEpubContainer(source);
    if (containerRoot) {
      const containerUri = vscode.Uri.joinPath(containerRoot, 'META-INF', 'container.xml');
      const containerBytes = await vscode.workspace.fs.readFile(containerUri);
      const containerXml = new TextDecoder('utf-8').decode(containerBytes);
      const opfRelPath = parseContainerXml(containerXml);
      if (opfRelPath) {
        const opfSegments = opfRelPath.split('/').filter(Boolean);
        const opfUri = vscode.Uri.joinPath(containerRoot, ...opfSegments);
        const opfBytes = await vscode.workspace.fs.readFile(opfUri);
        const opfXml = new TextDecoder('utf-8').decode(opfBytes);
        epubPackage = parseOpfXml(opfXml, opfUri, containerRoot);

        // Load Table of Contents
        epubPackage.toc = await loadEpubToc(epubPackage, async (itemUri) => {
          const bytes = await vscode.workspace.fs.readFile(itemUri);
          return new TextDecoder('utf-8').decode(bytes);
        });

        // If opened from .epub archive, default initial chapter to first spine chapter
        if (ext === '.epub' && epubPackage.spine.length > 0) {
          currentSource = epubPackage.spine[0].uri;
        }
      }
    }
  } catch (error) {
    console.warn('XHTML Reader: EPUB container parsing fallback:', error);
  }

  const localResourceRoots = epubPackage
    ? [epubPackage.containerRoot, epubPackage.opfDir, root]
    : [root];

  const panel = vscode.window.createWebviewPanel(
    'xhtmlReaderPreview',
    getPanelTitle(currentSource, epubPackage),
    viewColumn,
    { enableScripts: true, localResourceRoots },
  );

  let timer: NodeJS.Timeout | undefined;

  const render = async (resetToTop = false): Promise<void> => {
    try {
      const xhtml = await readSource(currentSource);
      const chapterDir = parentUri(currentSource);
      const fallbackDir = epubPackage?.opfDir;
      const content = await rewriteResourceUris(sanitizeXhtml(xhtml), chapterDir, panel.webview, fallbackDir);

      const spineIndex = epubPackage?.spine.findIndex(
        (item) => item.uri.path.toLowerCase() === currentSource.path.toLowerCase()
      ) ?? -1;

      const currentFileName = currentSource.path.slice(currentSource.path.lastIndexOf('/') + 1).toLowerCase();
      const tocWithActive = epubPackage?.toc.map((item) => {
        const itemFileName = item.href.split(/[?#]/, 1)[0].split('/').pop()?.toLowerCase();
        const isActive = item.uri.path.toLowerCase() === currentSource.path.toLowerCase()
          || (itemFileName && itemFileName === currentFileName);
        return {
          label: item.label,
          href: item.href,
          active: Boolean(isActive)
        };
      });

      const navInfo: ReaderNavInfo = {
        hasPrev: spineIndex > 0,
        hasNext: spineIndex >= 0 && spineIndex < (epubPackage?.spine.length ?? 0) - 1,
        bookTitle: epubPackage?.title,
        creator: epubPackage?.creator,
        chapterIndex: spineIndex >= 0 ? spineIndex + 1 : undefined,
        totalChapters: epubPackage?.spine.length,
        toc: tocWithActive
      };

      panel.title = getPanelTitle(currentSource, epubPackage, spineIndex);
      const preferences = stateManager?.getPreferences();
      const location = resetToTop ? undefined : stateManager?.getReadingLocation(currentSource.toString());
      panel.webview.html = readerShell(content, currentSource, pendingFragment, panel.webview, navInfo, preferences, location, resetToTop);
      pendingFragment = undefined;
    } catch (error) {
      panel.webview.html = errorShell(error);
    }
  };

  const scheduleRender = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void render(), 200);
  };

  const watchRoot = epubPackage ? epubPackage.containerRoot : root;
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(watchRoot, '**/*'));
  const documentChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() === currentSource.toString()) {
      scheduleRender();
    }
  });

  const messageSubscription = panel.webview.onDidReceiveMessage((message: unknown) => {
    if (isPrevChapterMessage(message)) {
      if (epubPackage) {
        const currentIndex = epubPackage.spine.findIndex(
          (item) => item.uri.path.toLowerCase() === currentSource.path.toLowerCase()
        );
        if (currentIndex > 0) {
          currentSource = epubPackage.spine[currentIndex - 1].uri;
          pendingFragment = undefined;
          void render(true);
        }
      }
      return;
    }

    if (isNextChapterMessage(message)) {
      if (epubPackage) {
        const currentIndex = epubPackage.spine.findIndex(
          (item) => item.uri.path.toLowerCase() === currentSource.path.toLowerCase()
        );
        if (currentIndex >= 0 && currentIndex < epubPackage.spine.length - 1) {
          currentSource = epubPackage.spine[currentIndex + 1].uri;
          pendingFragment = undefined;
          void render(true);
        }
      }
      return;
    }

    if (isSavePreferencesMessage(message)) {
      void stateManager?.savePreferences(message.preferences);
      return;
    }

    if (isSaveReadingPositionMessage(message)) {
      void stateManager?.saveReadingLocation(currentSource.toString(), {
        scrollRatio: message.scrollRatio,
        scrollY: message.scrollY,
        anchorId: message.anchorId
      });
      return;
    }

    if (isOpenLinkMessage(message)) {
      const target = resolveChapterLink(message.href, currentSource, watchRoot, epubPackage?.opfDir);
      if (target) {
        currentSource = target.source;
        pendingFragment = target.fragment;
        void render(!target.fragment);
      }
    }
  });

  const watcherChanges = [
    watcher.onDidChange(scheduleRender),
    watcher.onDidCreate(scheduleRender),
    watcher.onDidDelete(scheduleRender),
  ];

  panel.onDidDispose(() => {
    if (timer) {
      clearTimeout(timer);
    }
    watcher.dispose();
    documentChange.dispose();
    messageSubscription.dispose();
    watcherChanges.forEach((subscription) => subscription.dispose());

    if (archiveCacheDir && cacheManager) {
      cacheManager.cleanupCache(archiveCacheDir);
    }
  });

  void render();
}

function getPanelTitle(source: vscode.Uri, epub?: EpubPackage, spineIndex = -1): string {
  const fileName = source.path.slice(source.path.lastIndexOf('/') + 1);
  if (!epub) {
    return `Reader: ${fileName}`;
  }
  if (spineIndex >= 0) {
    return `${epub.title} [${spineIndex + 1}/${epub.spine.length}] — ${fileName}`;
  }
  return `${epub.title} — ${fileName}`;
}

function isPrevChapterMessage(message: unknown): message is { type: 'prevChapter' } {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'prevChapter';
}

function isNextChapterMessage(message: unknown): message is { type: 'nextChapter' } {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'nextChapter';
}

function isOpenLinkMessage(message: unknown): message is { type: 'openLink'; href: string } {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'openLink'
    && typeof (message as { href?: unknown }).href === 'string';
}

function isSavePreferencesMessage(message: unknown): message is {
  type: 'savePreferences';
  preferences: Partial<ReaderPreferences>;
} {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'savePreferences'
    && typeof (message as { preferences?: unknown }).preferences === 'object';
}

function isSaveReadingPositionMessage(message: unknown): message is {
  type: 'saveReadingPosition';
  scrollRatio: number;
  scrollY: number;
  anchorId?: string;
} {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'saveReadingPosition'
    && typeof (message as { scrollRatio?: unknown }).scrollRatio === 'number'
    && typeof (message as { scrollY?: unknown }).scrollY === 'number';
}

function resolveChapterLink(
  href: string,
  source: vscode.Uri,
  root: vscode.Uri,
  fallbackDir?: vscode.Uri
): { source: vscode.Uri; fragment?: string } | undefined {
  const [path, fragment] = href.split('#', 2);
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) {
    return undefined;
  }

  try {
    const segments = path.split('/').map(decodeURIComponent);
    const target = vscode.Uri.joinPath(parentUri(source), ...segments);
    if (target.path.toLowerCase().startsWith(`${root.path.toLowerCase()}/`) && supportedExtensions.has(extensionOf(target))) {
      return { source: target, fragment: fragment ? decodeURIComponent(fragment) : undefined };
    }
    if (fallbackDir) {
      const fallbackTarget = vscode.Uri.joinPath(fallbackDir, ...segments);
      if (fallbackTarget.path.toLowerCase().startsWith(`${root.path.toLowerCase()}/`) && supportedExtensions.has(extensionOf(fallbackTarget))) {
        return { source: fallbackTarget, fragment: fragment ? decodeURIComponent(fragment) : undefined };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function readSource(source: vscode.Uri): Promise<string> {
  const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === source.toString());
  if (openDocument) {
    return openDocument.getText();
  }
  return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(source));
}

async function rewriteResourceUris(
  markup: string,
  root: vscode.Uri,
  webview: vscode.Webview,
  fallbackRoot?: vscode.Uri
): Promise<string> {
  const resources = new Map<string, string>();
  const matches = [...markup.matchAll(resourceAttributes)];

  for (const match of matches) {
    const raw = match[3];
    if (!resources.has(raw)) {
      const resolved = await resolveResource(raw, root, webview, fallbackRoot);
      if (resolved) {
        resources.set(raw, resolved);
      }
    }
  }

  return markup.replace(resourceAttributes, (full, prefix: string, quote: string, raw: string) => {
    const replacement = resources.get(raw);
    return replacement ? `${prefix}${quote}${replacement}${quote}` : full;
  });
}

async function resolveResource(
  raw: string,
  root: vscode.Uri,
  webview: vscode.Webview,
  fallbackRoot?: vscode.Uri
): Promise<string | undefined> {
  const path = raw.split(/[?#]/, 1)[0];
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) {
    return undefined;
  }

  try {
    const segments = path.split('/').map(decodeURIComponent);
    const resource = vscode.Uri.joinPath(root, ...segments);
    try {
      await vscode.workspace.fs.stat(resource);
      return webview.asWebviewUri(resource).toString();
    } catch {
      if (fallbackRoot) {
        const fallbackResource = vscode.Uri.joinPath(fallbackRoot, ...segments);
        await vscode.workspace.fs.stat(fallbackResource);
        return webview.asWebviewUri(fallbackResource).toString();
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parentUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ path: uri.path.slice(0, uri.path.lastIndexOf('/')) });
}

function getActiveFileUri(): vscode.Uri | undefined {
  if (vscode.window.activeTextEditor?.document.uri) {
    return vscode.window.activeTextEditor.document.uri;
  }

  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  if (activeTab?.input && typeof activeTab.input === 'object') {
    const input = activeTab.input as { uri?: unknown };
    if (input.uri instanceof vscode.Uri) {
      return input.uri;
    }
  }

  return undefined;
}

function extensionOf(uri: vscode.Uri): string {
  const match = /\.[^.]+$/.exec(uri.path);
  return match?.[0].toLowerCase() ?? '';
}

function errorShell(error: unknown): string {
  const message = escapeHtml(error instanceof Error ? error.message : String(error));
  return `<!DOCTYPE html><html><body><h1>Cannot load preview</h1><p>${message}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}
