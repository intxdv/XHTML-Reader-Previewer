import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { sanitizeXhtml } from './xhtml';

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

function readerShell(content: string, source: vscode.Uri, fragment: string | undefined, webview: vscode.Webview): string {
  const nonce = randomBytes(16).toString('base64');
  const title = escapeHtml(vscode.workspace.asRelativePath(source, false) || source.fsPath);
  const initialFragment = escapeHtml(fragment ?? '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style nonce="${nonce}">:root{--reader-size:18px;--reader-bg:#111827;--reader-fg:#e5e7eb;--reader-link:#93c5fd}body{background:var(--reader-bg);color:var(--reader-fg);font:var(--reader-size)/1.8 Georgia,serif;margin:0;padding:4.5rem 1.5rem 3rem}main{max-width:42rem;margin:auto}img,video{display:block;max-width:100%;height:auto;margin:1.5rem auto}a{color:var(--reader-link)}hr{border:0;border-top:1px solid #374151;margin:2rem 0}#toolbar{position:fixed;z-index:1;top:0;left:0;right:0;display:flex;gap:.5rem;align-items:center;padding:.65rem 1rem;background:#111827e8;border-bottom:1px solid #374151;font-family:var(--vscode-font-family,system-ui)}button{color:inherit;background:#1f2937;border:1px solid #4b5563;border-radius:.35rem;padding:.3rem .55rem;cursor:pointer}dialog{max-width:min(34rem,calc(100vw - 2rem));max-height:70vh;overflow:auto;background:#1f2937;color:#f3f4f6;border:1px solid #6b7280;border-radius:.5rem;padding:1rem}dialog::backdrop{background:#0009}.light{--reader-bg:#f8fafc;--reader-fg:#172033;--reader-link:#1d4ed8}.light #toolbar{background:#f8fafce8}.light button{background:#e2e8f0;color:#172033}</style>
</head>
<body data-fragment="${initialFragment}"><header id="toolbar" aria-label="Reader controls"><button type="button" data-action="smaller" aria-label="Decrease text size">A−</button><button type="button" data-action="larger" aria-label="Increase text size">A+</button><button type="button" data-action="theme" aria-label="Toggle reader theme">Theme</button></header><main>${content.replace(/<style\b/gi, `<style nonce="${nonce}"`)}</main><dialog id="footnote"><button type="button" data-action="close-note">Close</button><div id="footnote-content"></div></dialog><script nonce="${nonce}">const vscode=acquireVsCodeApi();const dialog=document.getElementById('footnote');const noteContent=document.getElementById('footnote-content');let size=18;const setSize=()=>document.documentElement.style.setProperty('--reader-size',size+'px');const scrollToFragment=(id)=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});document.getElementById('toolbar').addEventListener('click',(event)=>{const action=event.target.dataset.action;if(action==='smaller'){size=Math.max(12,size-1);setSize()}if(action==='larger'){size=Math.min(32,size+1);setSize()}if(action==='theme'){document.documentElement.classList.toggle('light')}});document.addEventListener('click',(event)=>{const button=event.target.closest('[data-action="close-note"]');if(button){dialog.close();return}const link=event.target.closest('a[href]');if(!link)return;const href=link.getAttribute('href');if(!href)return;const isNote=(link.getAttribute('epub:type')||'').split(/\\s+/).includes('noteref')||(link.getAttribute('role')||'').split(/\\s+/).includes('doc-noteref');if(href.startsWith('#')){event.preventDefault();const id=decodeURIComponent(href.slice(1));const target=document.getElementById(id);if(isNote&&target){noteContent.innerHTML=target.innerHTML;dialog.showModal();return}scrollToFragment(id);return}if(!/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(href)){event.preventDefault();vscode.postMessage({type:'openLink',href})}});const initial=document.body.dataset.fragment;if(initial)scrollToFragment(initial);</script></body>
</html>`;
}

function errorShell(error: unknown): string {
  const message = escapeHtml(error instanceof Error ? error.message : String(error));
  return `<!DOCTYPE html><html><body><h1>Cannot load preview</h1><p>${message}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}
