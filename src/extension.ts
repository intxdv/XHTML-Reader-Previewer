import * as vscode from 'vscode';
import { sanitizeXhtml } from './xhtml';
import { readerShell } from './reader-shell';

const supportedExtensions = new Set(['.xhtml', '.html', '.htm']);
const resourceAttributes = /(<(?:img|source|video|audio|link)\b[^>]*?\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('xhtmlReader.openPreview', (uri?: vscode.Uri) => openPreview(uri)),
    vscode.commands.registerCommand('xhtmlReader.openSplitPreview', (uri?: vscode.Uri) => openPreview(uri, vscode.ViewColumn.Beside)),
  );
}

function openPreview(uri: vscode.Uri | undefined, viewColumn = vscode.ViewColumn.Active): void {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!source || !supportedExtensions.has(extensionOf(source))) {
    void vscode.window.showWarningMessage('Open an XHTML, HTML, or HTM file first.');
    return;
  }

  const root = parentUri(source);
  let currentSource = source;
  let pendingFragment: string | undefined;
  const panel = vscode.window.createWebviewPanel(
    'xhtmlReaderPreview',
    `Reader: ${vscode.workspace.asRelativePath(source, false) || source.fsPath}`,
    viewColumn,
    { enableScripts: true, localResourceRoots: [root] },
  );
  let timer: NodeJS.Timeout | undefined;

  const render = async (): Promise<void> => {
    try {
      const xhtml = await readSource(currentSource);
      const content = await rewriteResourceUris(sanitizeXhtml(xhtml), root, panel.webview);
      panel.title = `Reader: ${vscode.workspace.asRelativePath(currentSource, false) || currentSource.fsPath}`;
      panel.webview.html = readerShell(content, currentSource, pendingFragment, panel.webview);
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
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
  const documentChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() === currentSource.toString()) {
      scheduleRender();
    }
  });
  const messageSubscription = panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isOpenLinkMessage(message)) {
      return;
    }
    const target = resolveChapterLink(message.href, currentSource, root);
    if (target) {
      currentSource = target.source;
      pendingFragment = target.fragment;
      void render();
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
  });
  void render();
}

function isOpenLinkMessage(message: unknown): message is { type: 'openLink'; href: string } {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'openLink'
    && typeof (message as { href?: unknown }).href === 'string';
}

function resolveChapterLink(href: string, source: vscode.Uri, root: vscode.Uri): { source: vscode.Uri; fragment?: string } | undefined {
  const [path, fragment] = href.split('#', 2);
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) {
    return undefined;
  }

  try {
    const segments = path.split('/').map(decodeURIComponent);
    if (segments.some((segment) => segment === '..' || !segment)) {
      return undefined;
    }
    const target = vscode.Uri.joinPath(parentUri(source), ...segments);
    if (!target.path.startsWith(`${root.path}/`) || !supportedExtensions.has(extensionOf(target))) {
      return undefined;
    }
    return { source: target, fragment: fragment ? decodeURIComponent(fragment) : undefined };
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

async function rewriteResourceUris(markup: string, root: vscode.Uri, webview: vscode.Webview): Promise<string> {
  const resources = new Map<string, string>();
  const matches = [...markup.matchAll(resourceAttributes)];

  for (const match of matches) {
    const raw = match[3];
    if (!resources.has(raw)) {
      const resolved = await resolveResource(raw, root, webview);
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

async function resolveResource(raw: string, root: vscode.Uri, webview: vscode.Webview): Promise<string | undefined> {
  const path = raw.split(/[?#]/, 1)[0];
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) {
    return undefined;
  }

  try {
    const segments = path.split('/').map(decodeURIComponent);
    if (segments.some((segment) => segment === '..' || !segment)) {
      return undefined;
    }
    const resource = vscode.Uri.joinPath(root, ...segments);
    await vscode.workspace.fs.stat(resource);
    return webview.asWebviewUri(resource).toString();
  } catch {
    return undefined;
  }
}

function parentUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ path: uri.path.slice(0, uri.path.lastIndexOf('/')) });
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
