import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ReaderPreferences, ReadingLocation, DEFAULT_PREFERENCES } from './state-manager';

export interface ReaderTocItem {
  label: string;
  href: string;
  active?: boolean;
}

export interface ReaderNavInfo {
  hasPrev?: boolean;
  hasNext?: boolean;
  bookTitle?: string;
  creator?: string;
  chapterIndex?: number;
  totalChapters?: number;
  toc?: ReaderTocItem[];
}

const fontCssMap: Record<string, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"Cascadia Code", Consolas, "Courier New", monospace'
};

const fontLabelMap: Record<string, string> = {
  serif: 'Font: Serif',
  sans: 'Font: Sans',
  mono: 'Font: Mono'
};

const spacingValMap: Record<string, string> = {
  normal: '1.8',
  relaxed: '2.1',
  tight: '1.5'
};

const spacingLabelMap: Record<string, string> = {
  normal: 'Spacing: Normal',
  relaxed: 'Spacing: Relaxed',
  tight: 'Spacing: Tight'
};

const widthValMap: Record<string, string> = {
  normal: '44rem',
  wide: '54rem',
  compact: '36rem'
};

const widthLabelMap: Record<string, string> = {
  normal: 'Width: Normal',
  wide: 'Width: Wide',
  compact: 'Width: Compact'
};

const PHOSPHOR = {
  sidebarSimple: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM96,200H40V56H96Zm120,0H112V56H216Z"/></svg>`,
  magnifyingGlass: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="18" aria-hidden="true"><circle cx="112" cy="112" r="80"/><line x1="168.57" y1="168.57" x2="224" y2="224"/></svg>`,
  bookOpen: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="18" aria-hidden="true"><path d="M128,48V208c-32-24-72-32-112-32V40C56,40,96,48,128,48Z"/><path d="M128,48V208c32-24,72-32,112-32V40C200,40,160,48,128,48Z"/></svg>`,
  caretLeft: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="20" aria-hidden="true"><polyline points="160 208 80 128 160 48"/></svg>`,
  caretRight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="20" aria-hidden="true"><polyline points="96 48 176 128 96 208"/></svg>`,
  arrowsOutLineVertical: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="18" aria-hidden="true"><polyline points="104 32 128 8 152 32"/><line x1="128" y1="8" x2="128" y2="248"/><polyline points="152 224 128 248 104 224"/><line x1="40" y1="128" x2="216" y2="128"/></svg>`,
  slidersHorizontal: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="18" aria-hidden="true"><line x1="40" y1="64" x2="216" y2="64"/><line x1="40" y1="128" x2="216" y2="128"/><line x1="40" y1="192" x2="216" y2="192"/><line x1="96" y1="32" x2="96" y2="96"/><line x1="160" y1="96" x2="160" y2="160"/><line x1="104" y1="160" x2="104" y2="224"/></svg>`,
  dotsThree: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M144,128a16,16,0,1,1-16-16A16,16,0,0,1,144,128ZM60,112a16,16,0,1,0,16,16A16,16,0,0,0,60,112Zm136,0a16,16,0,1,0,16,16A16,16,0,0,0,196,112Z"/></svg>`,
  bookmarkSimple: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.76,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Zm0,177.57-51.76-32.35a8,8,0,0,0-8.48,0L72,209.57V48H184Z"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="14" height="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="20" aria-hidden="true"><line x1="200" y1="56" x2="56" y2="200"/><line x1="200" y1="200" x2="56" y2="56"/></svg>`
};

export function readerShell(
  content: string,
  source: vscode.Uri,
  fragment: string | undefined,
  webview: vscode.Webview,
  navInfo?: ReaderNavInfo,
  preferences?: ReaderPreferences,
  initialLocation?: ReadingLocation,
  resetToTop = false,
  startAtBottom = false
): string {
  const nonce = randomBytes(16).toString('base64');
  const title = escapeHtml(vscode.workspace.asRelativePath(source, false) || source.fsPath);
  const initialFragment = escapeHtml(fragment ?? '');

  const prefs: ReaderPreferences = {
    theme: preferences?.theme ?? DEFAULT_PREFERENCES.theme,
    fontSize: preferences?.fontSize ?? DEFAULT_PREFERENCES.fontSize,
    fontFamily: preferences?.fontFamily ?? DEFAULT_PREFERENCES.fontFamily,
    lineHeight: preferences?.lineHeight ?? DEFAULT_PREFERENCES.lineHeight,
    readerWidth: preferences?.readerWidth ?? DEFAULT_PREFERENCES.readerWidth,
    readerMode: preferences?.readerMode ?? DEFAULT_PREFERENCES.readerMode
  };

  const htmlClass = prefs.theme === 'dark' ? '' : ` class="${prefs.theme}"`;
  const initialLineHeight = spacingValMap[prefs.lineHeight] ?? '1.8';
  const initialMaxWidth = widthValMap[prefs.readerWidth] ?? '44rem';
  const initialFontCss = fontCssMap[prefs.fontFamily] ?? fontCssMap.serif;
  const initialThemeLabel = `Theme: ${prefs.theme.charAt(0).toUpperCase() + prefs.theme.slice(1)}`;
  const initialFontLabel = fontLabelMap[prefs.fontFamily] ?? 'Font: Serif';
  const initialSpacingLabel = spacingLabelMap[prefs.lineHeight] ?? 'Spacing: Normal';
  const initialWidthLabel = widthLabelMap[prefs.readerWidth] ?? 'Width: Normal';
  const initialModeLabel = prefs.readerMode === 'paginated' ? 'Mode: Paginated' : 'Mode: Scroll';
  const bodyClasses = [prefs.readerMode === 'paginated' ? 'paginated' : ''].filter(Boolean).join(' ');

  const hasNav = navInfo && typeof navInfo.totalChapters === 'number' && navInfo.totalChapters > 0;
  const hasToc = navInfo && Array.isArray(navInfo.toc) && navInfo.toc.length > 0;

  const tocBtnHtml = hasToc
    ? `<button type="button" data-action="toggle-toc" id="toc-btn" aria-label="Table of Contents (Shortcut: T)" title="Table of Contents (Shortcut: T)">${PHOSPHOR.sidebarSimple} <span>Contents</span></button>`
    : '';

  const navHtml = hasNav
    ? `<div class="toolbar-separator"></div>
    <div class="toolbar-group nav-group">
      <button type="button" data-action="prev-chapter" id="prev-btn" title="Previous chapter (Shortcut: [ or Alt+Left)" ${navInfo.hasPrev ? '' : 'disabled'}>← Prev</button>
      <span class="chapter-badge" title="${escapeHtml(navInfo.bookTitle || '')}">${navInfo.chapterIndex ?? 1} / ${navInfo.totalChapters}</span>
      <button type="button" data-action="next-chapter" id="next-btn" title="Next chapter (Shortcut: ] or Alt+Right)" ${navInfo.hasNext ? '' : 'disabled'}>Next →</button>
    </div>`
    : '';

  const tocItemsHtml = (navInfo?.toc || [])
    .map((item) => {
      const activeClass = item.active ? ' active' : '';
      return `<a href="${escapeHtml(item.href)}" class="toc-item${activeClass}" data-href="${escapeHtml(item.href)}">
        <span class="toc-item-label">${escapeHtml(item.label)}</span>
      </a>`;
    })
    .join('');

  const sidebarHtml = hasToc
    ? `<aside id="toc-sidebar" class="toc-sidebar" aria-label="Table of Contents">
      <div class="toc-header">
        <div class="toc-book-info">
          <div class="toc-book-title">${escapeHtml(navInfo?.bookTitle || 'Table of Contents')}</div>
          ${navInfo?.creator ? `<div class="toc-book-author">${escapeHtml(navInfo.creator)}</div>` : ''}
        </div>
        <button type="button" data-action="close-toc" class="toc-close-btn" aria-label="Close Table of Contents">${PHOSPHOR.x}</button>
      </div>
      <div class="toc-search-wrap">
        <span class="toc-search-icon">${PHOSPHOR.magnifyingGlass}</span>
        <input type="text" id="toc-search" placeholder="Filter chapters..." aria-label="Filter chapters" />
      </div>
      <nav class="toc-list" id="toc-list">
        ${tocItemsHtml}
      </nav>
    </aside>
    <div id="toc-backdrop" class="toc-backdrop"></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"${htmlClass}>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style nonce="${nonce}">
    :root {
      --reader-size: ${prefs.fontSize}px;
      --reader-line-height: ${initialLineHeight};
      --reader-max-width: ${initialMaxWidth};
      --reader-font: ${initialFontCss};

      /* Dark Theme (Default) */
      --reader-bg: #111827;
      --reader-fg: #e5e7eb;
      --reader-link: #93c5fd;
      --popover-bg: #1e2430;
      --popover-fg: #f3f4f6;
      --popover-border: #374151;
      --popover-shadow: 0 10px 25px -5px rgba(0,0,0,0.6), 0 8px 10px -6px rgba(0,0,0,0.5);
      --toc-bg: #131722;
      --toc-item-hover: rgba(255, 255, 255, 0.06);
      --toc-item-active-bg: rgba(147, 197, 253, 0.12);
      --toc-item-active-fg: #93c5fd;
    }
    body {
      background: var(--reader-bg);
      color: var(--reader-fg);
      font-family: var(--reader-font);
      font-size: var(--reader-size);
      line-height: var(--reader-line-height);
      margin: 0;
      padding: 3.2rem 1.5rem 3.5rem;
      transition: background 0.2s ease, color 0.2s ease;
      scroll-padding-top: 3.2rem;
    }
    main {
      max-width: var(--reader-max-width);
      margin: auto;
      transition: max-width 0.2s ease;
      will-change: transform;
    }
    img, video {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 1.5rem auto;
    }
    a {
      color: var(--reader-link);
    }
    hr {
      border: 0;
      border-top: 1px solid rgba(156, 163, 175, 0.25);
      margin: 2rem 0;
    }
    #toolbar {
      position: fixed;
      z-index: 25;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.45rem 1rem;
      height: 2.45rem;
      box-sizing: border-box;
      background: var(--reader-bg);
      border-bottom: 1px solid rgba(156, 163, 175, 0.12);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease, border-color 0.2s ease;
    }
    #toolbar.hidden {
      transform: translateY(-100%);
      pointer-events: none;
    }
    .toolbar-left, .toolbar-right, .toolbar-center {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .toolbar-center {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      pointer-events: auto;
    }
    .chapter-nav-inline {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
    }
    .toolbar-hover-sensor {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 28px;
      z-index: 24;
      pointer-events: auto;
    }
    .toolbar-group {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .toolbar-separator {
      width: 1px;
      height: 1.25rem;
      background: rgba(156, 163, 175, 0.25);
      margin: 0 0.25rem;
    }
    button {
      color: inherit;
      background: #1f2937;
      border: 1px solid #4b5563;
      border-radius: 0.35rem;
      padding: 0.28rem 0.55rem;
      cursor: pointer;
      font-size: 0.82rem;
      font-family: inherit;
      font-weight: 500;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    button:hover:not(:disabled) {
      background: #374151;
    }
    button:disabled {
      opacity: 0.35;
      cursor: not-allowed;
      border-color: transparent;
    }
    #toolbar button {
      color: inherit;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 0.35rem;
      padding: 0.25rem 0.55rem;
      cursor: pointer;
      font-size: 0.85rem;
      font-family: inherit;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      transition: background 0.15s ease, opacity 0.15s ease, transform 0.1s ease;
      user-select: none;
    }
    #toolbar button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      border-color: transparent;
    }
    #toolbar button:active:not(:disabled) {
      background: rgba(255, 255, 255, 0.14);
      transform: scale(0.96);
    }
    #toolbar button:disabled {
      opacity: 0.22;
      cursor: default;
    }
    .nav-arrow-btn {
      width: 1.7rem !important;
      height: 1.7rem !important;
      padding: 0 !important;
      font-size: 1.15rem !important;
      line-height: 1 !important;
      border-radius: 50% !important;
    }
    .icon-btn {
      font-size: 1.05rem !important;
      width: 2rem;
      height: 2rem;
      padding: 0 !important;
      border-radius: 0.35rem;
    }
    .chapter-badge {
      font-size: 0.82rem;
      font-weight: 500;
      padding: 0.2rem 0.45rem;
      border-radius: 0.25rem;
      background: transparent;
      color: var(--reader-fg);
      font-variant-numeric: tabular-nums;
      user-select: none;
      opacity: 0.85;
    }
    .font-size-badge {
      font-size: 0.82rem;
      font-weight: 500;
      padding: 0.2rem 0.45rem;
      border-radius: 0.25rem;
      background: rgba(255, 255, 255, 0.08);
      color: var(--reader-fg);
      font-variant-numeric: tabular-nums;
      user-select: none;
      min-width: 2.2rem;
      text-align: center;
    }
    /* Reading Progress Bar */
    #progress-track {
      position: absolute;
      bottom: -3px;
      left: 0;
      right: 0;
      height: 3px;
      background: transparent;
      pointer-events: none;
    }
    #progress-bar {
      height: 100%;
      width: 0%;
      background: var(--reader-link);
      transition: width 0.08s linear;
    }

    /* TOC Sidebar & Backdrop */
    .toc-sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: min(22rem, 85vw);
      background: var(--toc-bg);
      color: var(--reader-fg);
      border-right: 1px solid var(--popover-border);
      z-index: 50;
      display: flex;
      flex-direction: column;
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
      transform: translateX(-100%);
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
    }
    .toc-sidebar.open {
      transform: translateX(0);
    }
    .toc-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
      z-index: 45;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .toc-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }
    .toc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 1rem 1.1rem 0.75rem;
      border-bottom: 1px solid rgba(156, 163, 175, 0.15);
    }
    .toc-book-title {
      font-weight: 600;
      font-size: 0.95rem;
      line-height: 1.35;
      color: var(--reader-fg);
    }
    .toc-book-author {
      font-size: 0.8rem;
      opacity: 0.7;
      margin-top: 0.2rem;
    }
    .toc-close-btn, .settings-close-btn {
      background: transparent;
      border: none;
      color: inherit;
      padding: 0.25rem;
      cursor: pointer;
      opacity: 0.7;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s ease, background 0.15s ease;
    }
    .toc-close-btn:hover, .settings-close-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }
    .toc-search-wrap {
      position: relative;
      display: flex;
      align-items: center;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid rgba(156, 163, 175, 0.1);
    }
    .toc-search-icon {
      position: absolute;
      left: 1.55rem;
      display: inline-flex;
      align-items: center;
      opacity: 0.5;
      pointer-events: none;
    }
    .toc-search-wrap input {
      width: 100%;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(156, 163, 175, 0.2);
      border-radius: 4px;
      padding: 0.4rem 0.65rem 0.4rem 2rem;
      color: inherit;
      font-size: 0.82rem;
      outline: none;
    }
    .toc-search-wrap input:focus {
      border-color: var(--reader-link);
    }
    .toc-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem 0;
      scrollbar-width: thin;
    }
    .toc-item {
      display: block;
      padding: 0.6rem 1.1rem;
      color: var(--reader-fg);
      text-decoration: none;
      font-size: 0.85rem;
      line-height: 1.4;
      border-left: 3px solid transparent;
      transition: background 0.12s ease;
      cursor: pointer;
    }
    .toc-item:hover {
      background: var(--toc-item-hover);
    }
    .toc-item.active {
      background: var(--toc-item-active-bg);
      color: var(--toc-item-active-fg);
      border-left-color: var(--toc-item-active-fg);
      font-weight: 600;
    }

    /* Anchored Footnote Popover */
    .footnote-popover {
      position: absolute;
      z-index: 100;
      max-width: min(32rem, calc(100vw - 2rem));
      background: var(--popover-bg);
      color: var(--popover-fg);
      border: 1px solid var(--popover-border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      box-shadow: var(--popover-shadow);
      font-size: 0.88rem;
      line-height: 1.6;
      box-sizing: border-box;
      overflow: visible;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
      animation: popoverFadeIn 0.12s ease-out;
    }
    .footnote-popover::-webkit-scrollbar,
    .footnote-body::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }
    .footnote-popover[hidden] {
      display: none !important;
    }
    @keyframes popoverFadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
    /* Caret Indicator */
    .footnote-caret {
      position: absolute;
      width: 10px;
      height: 10px;
      background: var(--popover-bg);
      border: 1px solid var(--popover-border);
      transform: rotate(45deg);
      pointer-events: none;
    }
    .footnote-caret.place-bottom {
      top: -6px;
      border-right: none;
      border-bottom: none;
    }
    .footnote-caret.place-top {
      bottom: -6px;
      border-left: none;
      border-top: none;
    }
    .footnote-body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-height: 45vh;
      overflow-y: auto;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    .footnote-body p {
      margin: 0.25rem 0;
    }

    /* Settings Popover */
    .settings-popover {
      position: fixed;
      top: 2.75rem;
      right: 0.85rem;
      z-index: 100;
      width: min(20rem, calc(100vw - 2rem));
      background: var(--popover-bg);
      color: var(--popover-fg);
      border: 1px solid var(--popover-border);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      box-shadow: var(--popover-shadow);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: 0.85rem;
      animation: popoverFadeIn 0.12s ease-out;
      box-sizing: border-box;
    }
    .settings-popover[hidden] {
      display: none !important;
    }
    .settings-popover-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
      padding-bottom: 0.45rem;
      border-bottom: 1px solid rgba(156, 163, 175, 0.15);
      font-weight: 600;
    }
    .settings-close-btn {
      background: transparent;
      border: none;
      color: inherit;
      font-size: 1rem;
      cursor: pointer;
      opacity: 0.7;
      padding: 0.15rem 0.35rem;
    }
    .settings-close-btn:hover {
      opacity: 1;
    }
    .settings-row {
      margin-bottom: 0.7rem;
    }
    .settings-row:last-child {
      margin-bottom: 0;
    }
    .settings-label {
      display: block;
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.65;
      margin-bottom: 0.3rem;
    }
    .settings-pill-group {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      background: rgba(0, 0, 0, 0.2);
      padding: 0.2rem;
      border-radius: 0.35rem;
    }
    .pill-btn {
      flex: 1;
      padding: 0.25rem 0.45rem;
      font-size: 0.8rem;
      border: 1px solid transparent;
      border-radius: 0.25rem;
      background: transparent;
      color: var(--reader-fg);
      cursor: pointer;
      text-align: center;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
    }
    .pill-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .pill-btn.active {
      background: var(--reader-link);
      color: #0f172a;
      font-weight: 600;
      border-color: rgba(255, 255, 255, 0.1);
    }
    .settings-val-badge {
      min-width: 2.8rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      font-size: 0.82rem;
    }

    /* Paginated Mode */
    body.paginated {
      height: 100vh;
      overflow: hidden;
      padding-top: 3.2rem;
      padding-bottom: 2.6rem;
      padding-left: 0;
      padding-right: 0;
      box-sizing: border-box;
    }
    body.paginated main {
      height: calc(100vh - 5.8rem);
      width: min(var(--reader-max-width), calc(100vw - 6rem));
      max-width: none;
      margin: 0 auto;
      column-width: calc(min(var(--reader-max-width), calc(100vw - 6rem)));
      column-gap: 4rem;
      column-fill: auto;
      overflow-x: hidden;
      overflow-y: hidden;
      box-sizing: border-box;
      scroll-behavior: auto;
    }
    body.paginated img, body.paginated video, body.paginated svg {
      max-width: 100%;
      max-height: calc(100vh - 10rem);
      object-fit: contain;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    body.paginated h1, body.paginated h2, body.paginated h3, body.paginated h4, body.paginated h5, body.paginated h6 {
      break-after: avoid;
      page-break-after: avoid;
    }
    body.paginated p, body.paginated li, body.paginated blockquote {
      break-inside: auto;
    }
    body.paginated pre, body.paginated table {
      break-inside: avoid;
      max-width: 100%;
      overflow-x: auto;
    }

    /* Floating Page Chevrons */
    .page-nav-arrow {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      z-index: 15;
      width: 2.5rem;
      height: 3.5rem;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(17, 24, 39, 0.65);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(75, 85, 99, 0.4);
      border-radius: 0.5rem;
      color: var(--reader-fg);
      font-size: 1.6rem;
      cursor: pointer;
      transition: opacity 0.2s, background 0.2s, transform 0.15s;
      user-select: none;
      opacity: 0.4;
    }
    .page-nav-arrow:hover:not(:disabled) {
      opacity: 1;
      background: rgba(31, 41, 55, 0.9);
      transform: translateY(-50%) scale(1.05);
    }
    .page-nav-arrow:disabled {
      opacity: 0.12;
      cursor: not-allowed;
    }
    #page-prev-arrow {
      left: 0.6rem;
    }
    #page-next-arrow {
      right: 0.6rem;
    }
    body.paginated .page-nav-arrow {
      display: flex;
    }

    /* Pagination Footer */
    #page-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2.4rem;
      z-index: 10;
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.25rem;
      background: #111827e8;
      backdrop-filter: blur(8px);
      border-top: 1px solid #374151;
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: 0.82rem;
      color: var(--reader-fg);
      user-select: none;
    }
    body.paginated #page-footer {
      display: flex;
    }
    .page-footer-info {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.65;
      font-size: 0.8rem;
    }
    .page-footer-center {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      opacity: 0.85;
      margin: 0 1rem;
    }

    /* Overscroll Cues (Moon+ Reader Style) */
    .overscroll-cue {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      font-size: 0.85rem;
      color: var(--reader-fg);
      opacity: 0;
      pointer-events: auto;
      cursor: pointer;
      transition: opacity 0.18s ease, transform 0.18s ease;
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      user-select: none;
    }
    .overscroll-cue.visible {
      opacity: 0.75;
    }
    .overscroll-cue.active {
      opacity: 1;
      color: var(--reader-link);
      font-weight: 600;
    }
    .overscroll-cue .overscroll-arrow {
      font-size: 1.15rem;
      display: inline-block;
      transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .overscroll-cue.active .overscroll-arrow {
      transform: scale(1.3) translateY(-2px);
    }
    .overscroll-cue.top {
      position: fixed;
      top: 3.2rem;
      left: 0;
      right: 0;
      z-index: 5;
      background: var(--reader-bg);
      border-bottom: 1px solid rgba(156, 163, 175, 0.15);
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    .overscroll-cue.bottom {
      max-width: var(--reader-max-width);
      margin: 2rem auto 3rem;
      border-top: 1px dashed rgba(156, 163, 175, 0.25);
      padding-top: 1.5rem;
    }
    body.paginated .overscroll-cue {
      display: none !important;
    }

    /* Light Theme */
    .light {
      --reader-bg: #f8fafc;
      --reader-fg: #172033;
      --reader-link: #1d4ed8;
      --popover-bg: #ffffff;
      --popover-fg: #1e293b;
      --popover-border: #cbd5e1;
      --popover-shadow: 0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1);
      --toc-bg: #f1f5f9;
      --toc-item-hover: rgba(0, 0, 0, 0.05);
      --toc-item-active-bg: rgba(29, 78, 216, 0.08);
      --toc-item-active-fg: #1d4ed8;
    }
    .light #toolbar {
      background: var(--reader-bg);
      border-bottom-color: rgba(0, 0, 0, 0.08);
    }
    .light #toolbar button {
      background: transparent;
      border-color: transparent;
      color: var(--reader-fg);
    }
    .light #toolbar button:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.06);
    }
    .light #toolbar button:active:not(:disabled) {
      background: rgba(0, 0, 0, 0.12);
    }
    .light button {
      background: #e2e8f0;
      color: #172033;
      border-color: #cbd5e1;
    }
    .light button:hover:not(:disabled) {
      background: #cbd5e1;
    }
    .light .font-size-badge, .light .chapter-badge {
      background: rgba(0, 0, 0, 0.08);
    }
    .light .toc-search-wrap input {
      background: #ffffff;
      border-color: #cbd5e1;
    }
    .light .page-nav-arrow {
      background: rgba(248, 250, 252, 0.75);
      border-color: rgba(203, 213, 225, 0.8);
      color: #172033;
    }
    .light .page-nav-arrow:hover:not(:disabled) {
      background: rgba(226, 232, 240, 0.95);
    }
    .light #page-footer {
      background: #f8fafce8;
      border-top-color: #cbd5e1;
    }
    .light .settings-pill-group {
      background: #e2e8f0;
    }
    .light .pill-btn:hover {
      background: rgba(0, 0, 0, 0.06);
    }
    .light .pill-btn.active {
      background: #1d4ed8;
      color: #ffffff;
    }

    /* Sepia Theme */
    .sepia {
      --reader-bg: #fbf0d9;
      --reader-fg: #5f4b32;
      --reader-link: #92400e;
      --popover-bg: #f5e6c8;
      --popover-fg: #453216;
      --popover-border: #d4bc91;
      --popover-shadow: 0 10px 25px -5px rgba(95,75,50,0.15), 0 8px 10px -6px rgba(95,75,50,0.1);
      --toc-bg: #f3e6ce;
      --toc-item-hover: rgba(95, 75, 50, 0.07);
      --toc-item-active-bg: rgba(146, 64, 14, 0.12);
      --toc-item-active-fg: #92400e;
    }
    .sepia #toolbar {
      background: var(--reader-bg);
      border-bottom-color: rgba(95, 75, 50, 0.12);
    }
    .sepia #toolbar button {
      background: transparent;
      border-color: transparent;
      color: var(--reader-fg);
    }
    .sepia #toolbar button:hover:not(:disabled) {
      background: rgba(95, 75, 50, 0.08);
    }
    .sepia #toolbar button:active:not(:disabled) {
      background: rgba(95, 75, 50, 0.16);
    }
    .sepia button {
      background: #ebd8b5;
      color: #5f4b32;
      border-color: #d4bc91;
    }
    .sepia button:hover:not(:disabled) {
      background: #dfcaa4;
    }
    .sepia .font-size-badge, .sepia .chapter-badge {
      background: rgba(95, 75, 50, 0.08);
    }
    .sepia .toc-search-wrap input {
      background: #faf4e8;
      border-color: #d4bc91;
    }
    .sepia .page-nav-arrow {
      background: rgba(251, 240, 217, 0.75);
      border-color: rgba(212, 188, 145, 0.8);
      color: #5f4b32;
    }
    .sepia .page-nav-arrow:hover:not(:disabled) {
      background: rgba(235, 216, 181, 0.95);
    }
    .sepia #page-footer {
      background: #fbf0d9e8;
      border-top-color: #d4bc91;
    }
    .sepia .settings-pill-group {
      background: #ebd8b5;
    }
    .sepia .pill-btn:hover {
      background: rgba(95, 75, 50, 0.08);
    }
    .sepia .pill-btn.active {
      background: #92400e;
      color: #ffffff;
    }
  </style>
</head>
<body${bodyClasses ? ` class="${bodyClasses}"` : ''} data-fragment="${initialFragment}" data-reset-to-top="${resetToTop ? 'true' : 'false'}" data-start-at-bottom="${startAtBottom ? 'true' : 'false'}" data-initial-ratio="${initialLocation?.scrollRatio ?? 0}" data-initial-scroll-y="${initialLocation?.scrollY ?? 0}" data-initial-anchor-id="${escapeHtml(initialLocation?.anchorId ?? '')}" data-reader-mode="${prefs.readerMode}">
  <div id="toolbar-hover-sensor" class="toolbar-hover-sensor" aria-hidden="true"></div>

  <header id="toolbar" aria-label="Reader controls">
    <div class="toolbar-left">
      ${tocBtnHtml}
    </div>

    <div class="toolbar-center">
      ${navInfo?.chapterIndex ? `
        <div class="chapter-nav-inline">
          <button type="button" data-action="prev-chapter" id="prev-btn" class="nav-arrow-btn" title="Previous chapter (Shortcut: [ or Alt+Left)" ${navInfo?.hasPrev ? '' : 'disabled'} aria-label="Previous chapter">${PHOSPHOR.caretLeft}</button>
          <span class="chapter-badge" title="${escapeHtml(navInfo?.bookTitle || '')}">${navInfo.chapterIndex} / ${navInfo.totalChapters}</span>
          <button type="button" data-action="next-chapter" id="next-btn" class="nav-arrow-btn" title="Next chapter (Shortcut: ] or Alt+Right)" ${navInfo?.hasNext ? '' : 'disabled'} aria-label="Next chapter">${PHOSPHOR.caretRight}</button>
        </div>
      ` : ''}
    </div>

    <div class="toolbar-right">
      <button type="button" data-action="mode" id="mode-btn" class="icon-btn" aria-label="Reading Mode" title="Reading Mode: ${prefs.readerMode === 'paginated' ? 'Paginated (Click to switch to Continuous Scroll)' : 'Continuous Scroll (Click to switch to Paginated)'}">${prefs.readerMode === 'paginated' ? PHOSPHOR.bookOpen : PHOSPHOR.arrowsOutLineVertical}</button>
      <button type="button" data-action="toggle-settings" id="settings-btn" class="icon-btn" aria-label="Reader settings" title="Settings (Keyboard: S)">${PHOSPHOR.slidersHorizontal}</button>
    </div>

    <div id="progress-track" aria-hidden="true">
      <div id="progress-bar"></div>
    </div>
  </header>

  <div id="settings-popover" class="settings-popover" role="dialog" aria-modal="false" aria-label="Reading Settings" hidden>
    <div class="settings-popover-header">
      <span class="settings-popover-title">Reading Settings</span>
      <button type="button" data-action="close-settings" class="settings-close-btn" aria-label="Close settings">${PHOSPHOR.x}</button>
    </div>

    <div class="settings-row">
      <span class="settings-label">Reading Mode</span>
      <div class="settings-pill-group mode-pill-group">
        <button type="button" data-action="mode-choice" data-mode="scroll" class="pill-btn mode-choice-btn${prefs.readerMode !== 'paginated' ? ' active' : ''}" title="Scroll like a web page">Scroll</button>
        <button type="button" data-action="mode-choice" data-mode="paginated" class="pill-btn mode-choice-btn${prefs.readerMode === 'paginated' ? ' active' : ''}" title="Pages like an ebook reader">Paginated</button>
      </div>
    </div>

    <div class="settings-row">
      <span class="settings-label">Text Size</span>
      <div class="settings-pill-group">
        <button type="button" data-action="smaller" aria-label="Decrease text size" class="pill-btn">A−</button>
        <span id="font-size-display" class="settings-val-badge">${prefs.fontSize}px</span>
        <button type="button" data-action="larger" aria-label="Increase text size" class="pill-btn">A+</button>
      </div>
    </div>

    <div class="settings-row">
      <span class="settings-label">Theme</span>
      <div class="settings-pill-group theme-pill-group">
        <button type="button" data-action="theme-choice" data-theme="dark" id="theme-btn" class="pill-btn theme-choice-btn${prefs.theme === 'dark' ? ' active' : ''}">Dark</button>
        <button type="button" data-action="theme-choice" data-theme="sepia" class="pill-btn theme-choice-btn${prefs.theme === 'sepia' ? ' active' : ''}">Sepia</button>
        <button type="button" data-action="theme-choice" data-theme="light" class="pill-btn theme-choice-btn${prefs.theme === 'light' ? ' active' : ''}">Light</button>
      </div>
    </div>

    <div class="settings-row">
      <span class="settings-label">Font</span>
      <div class="settings-pill-group">
        <button type="button" data-action="font-choice" data-font="serif" id="font-btn" class="pill-btn font-choice-btn${prefs.fontFamily === 'serif' ? ' active' : ''}">Serif</button>
        <button type="button" data-action="font-choice" data-font="sans" class="pill-btn font-choice-btn${prefs.fontFamily === 'sans' ? ' active' : ''}">Sans</button>
        <button type="button" data-action="font-choice" data-font="mono" class="pill-btn font-choice-btn${prefs.fontFamily === 'mono' ? ' active' : ''}">Mono</button>
      </div>
    </div>

    <div class="settings-row">
      <span class="settings-label">Spacing</span>
      <div class="settings-pill-group">
        <button type="button" data-action="spacing-choice" data-spacing="tight" class="pill-btn spacing-choice-btn${prefs.lineHeight === 'tight' ? ' active' : ''}">Tight</button>
        <button type="button" data-action="spacing-choice" data-spacing="normal" id="spacing-btn" class="pill-btn spacing-choice-btn${prefs.lineHeight === 'normal' ? ' active' : ''}">Normal</button>
        <button type="button" data-action="spacing-choice" data-spacing="relaxed" class="pill-btn spacing-choice-btn${prefs.lineHeight === 'relaxed' ? ' active' : ''}">Relaxed</button>
      </div>
    </div>

    <div class="settings-row">
      <span class="settings-label">Width</span>
      <div class="settings-pill-group">
        <button type="button" data-action="width-choice" data-width="compact" class="pill-btn width-choice-btn${prefs.readerWidth === 'compact' ? ' active' : ''}">Compact</button>
        <button type="button" data-action="width-choice" data-width="normal" id="width-btn" class="pill-btn width-choice-btn${prefs.readerWidth === 'normal' ? ' active' : ''}">Normal</button>
        <button type="button" data-action="width-choice" data-width="wide" class="pill-btn width-choice-btn${prefs.readerWidth === 'wide' ? ' active' : ''}">Wide</button>
      </div>
    </div>
  </div>

  ${sidebarHtml}

  <div id="top-overscroll-cue" class="overscroll-cue top" aria-hidden="true">
    <span class="overscroll-arrow">↓</span>
    <span class="overscroll-label">Tarik untuk ke Bab Sebelumnya</span>
  </div>

  <main id="content">${content.replace(/<style\b/gi, `<style nonce="${nonce}"`)}</main>

  <div id="bottom-overscroll-cue" class="overscroll-cue bottom" aria-hidden="true">
    <span class="overscroll-arrow">↑</span>
    <span class="overscroll-label">Tarik untuk ke Bab Berikutnya</span>
  </div>

  <button type="button" id="page-prev-arrow" class="page-nav-arrow" aria-label="Previous page (Shortcut: Left Arrow)" title="Previous page (Left Arrow)">‹</button>
  <button type="button" id="page-next-arrow" class="page-nav-arrow" aria-label="Next page (Shortcut: Right Arrow)" title="Next page (Right Arrow)">›</button>

  <footer id="page-footer" aria-label="Pagination footer">
    <div class="page-footer-info">
      ${navInfo?.bookTitle ? `<span class="page-footer-title" title="${escapeHtml(navInfo.bookTitle)}">${escapeHtml(navInfo.bookTitle)}</span>` : ''}
    </div>
    <div class="page-footer-center">
      <span id="page-counter">Page 1 / 1</span>
    </div>
  </footer>

  <div id="footnote-popover" class="footnote-popover" role="dialog" aria-modal="false" aria-label="Footnote" hidden>
    <div id="footnote-caret" class="footnote-caret"></div>
    <div id="footnote-content" class="footnote-body"></div>
  </div>

  <script nonce="${nonce}">
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    const vscode = acquireVsCodeApi();
    const popover = document.getElementById('footnote-popover');
    const caret = document.getElementById('footnote-caret');
    const noteContent = document.getElementById('footnote-content');
    const fontSizeDisplay = document.getElementById('font-size-display');
    const themeBtn = document.getElementById('theme-btn');
    const fontBtn = document.getElementById('font-btn');
    const spacingBtn = document.getElementById('spacing-btn');
    const widthBtn = document.getElementById('width-btn');
    const progressBar = document.getElementById('progress-bar');
    const tocSidebar = document.getElementById('toc-sidebar');
    const tocBackdrop = document.getElementById('toc-backdrop');
    const tocSearch = document.getElementById('toc-search');
    const modeBtn = document.getElementById('mode-btn');
    const pagePrevArrow = document.getElementById('page-prev-arrow');
    const pageNextArrow = document.getElementById('page-next-arrow');
    const pageCounter = document.getElementById('page-counter');
    const contentEl = document.getElementById('content') || document.querySelector('main');
    const topCue = document.getElementById('top-overscroll-cue');
    const bottomCue = document.getElementById('bottom-overscroll-cue');
    const toolbar = document.getElementById('toolbar');
    const toolbarSensor = document.getElementById('toolbar-hover-sensor');
    const settingsPopover = document.getElementById('settings-popover');
    const settingsBtn = document.getElementById('settings-btn');

    let isPaginated = ${prefs.readerMode === 'paginated'};
    let currentPage = 1;
    let totalPages = 1;

    function getColumnMetrics() {
      if (!contentEl) return { width: 0, gap: 0, step: 0 };
      const gap = parseFloat(window.getComputedStyle(contentEl).columnGap) || 64;
      const width = contentEl.clientWidth;
      return { width, gap, step: width + gap };
    }

    function computeTotalPages() {
      if (!isPaginated || !contentEl) return 1;
      const { gap, step } = getColumnMetrics();
      if (step <= 0) return 1;
      return Math.max(1, Math.round((contentEl.scrollWidth + gap) / step));
    }

    function updatePageControls() {
      if (!isPaginated) return;
      if (pageCounter) {
        pageCounter.textContent = 'Page ' + currentPage + ' / ' + totalPages;
      }
      if (progressBar) {
        const pct = totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 100;
        progressBar.style.width = pct + '%';
      }
      const hasPrev = ${Boolean(navInfo?.hasPrev)};
      const hasNext = ${Boolean(navInfo?.hasNext)};
      const disablePrev = currentPage <= 1 && !hasPrev;
      const disableNext = currentPage >= totalPages && !hasNext;
      if (pagePrevArrow) pagePrevArrow.disabled = disablePrev;
      if (pageNextArrow) pageNextArrow.disabled = disableNext;
    }

    function renderPage(smooth = true) {
      if (!isPaginated || !contentEl) return;
      const { step } = getColumnMetrics();
      const targetLeft = (currentPage - 1) * step;
      if (smooth) {
        contentEl.scrollTo({ left: targetLeft, behavior: 'smooth' });
      } else {
        contentEl.scrollLeft = targetLeft;
      }
      updatePageControls();
      scheduleSaveReadingPosition();
    }

    function nextPage() {
      if (!isPaginated) return;
      if (currentPage < totalPages) {
        currentPage++;
        renderPage(true);
      } else {
        const hasNext = ${Boolean(navInfo?.hasNext)};
        if (hasNext) {
          navigateToChapter({ type: 'nextChapter' });
        }
      }
    }

    function prevPage() {
      if (!isPaginated) return;
      if (currentPage > 1) {
        currentPage--;
        renderPage(true);
      } else {
        const hasPrev = ${Boolean(navInfo?.hasPrev)};
        if (hasPrev) {
          navigateToChapter({ type: 'prevChapter', startAtBottom: true });
        }
      }
    }

    function updatePagination(maintainRatio = false, prevRatio = 0) {
      if (!isPaginated) return;
      totalPages = computeTotalPages();
      if (maintainRatio && totalPages > 1) {
        currentPage = Math.max(1, Math.min(totalPages, Math.round(prevRatio * (totalPages - 1)) + 1));
      } else {
        currentPage = Math.max(1, Math.min(currentPage, totalPages));
      }
      renderPage(false);
    }

    function toggleMode(targetMode) {
      const nextMode = targetMode || (isPaginated ? 'scroll' : 'paginated');
      if (nextMode === 'paginated' && !isPaginated) {
        const scrollY = window.scrollY || document.documentElement.scrollTop;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = docHeight > 0 ? scrollY / docHeight : 0;

        isPaginated = true;
        document.body.classList.add('paginated');
        if (modeBtn) {
          modeBtn.innerHTML = '${PHOSPHOR.bookOpen}';
          modeBtn.title = 'Reading Mode: Paginated (Click to switch to Continuous Scroll)';
        }
        updateSettingsPills();

        window.scrollTo(0, 0);
        requestAnimationFrame(() => {
          totalPages = computeTotalPages();
          currentPage = Math.max(1, Math.min(totalPages, Math.round(ratio * (totalPages - 1)) + 1));
          renderPage(false);
          notifyPreferences();
        });
      } else if (nextMode === 'scroll' && isPaginated) {
        const ratio = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0;

        isPaginated = false;
        document.body.classList.remove('paginated');
        if (modeBtn) {
          modeBtn.innerHTML = '${PHOSPHOR.arrowsOutLineVertical}';
          modeBtn.title = 'Reading Mode: Continuous Scroll (Click to switch to Paginated)';
        }
        updateSettingsPills();
        if (contentEl) contentEl.scrollLeft = 0;

        requestAnimationFrame(() => {
          const docHeight = document.documentElement.scrollHeight - window.innerHeight;
          if (docHeight > 0 && ratio > 0) {
            window.scrollTo({ top: ratio * docHeight, behavior: 'instant' });
          }
          updateProgress();
          notifyPreferences();
        });
      }
    }

    if (pagePrevArrow) pagePrevArrow.addEventListener('click', prevPage);
    if (pageNextArrow) pageNextArrow.addEventListener('click', nextPage);

    function navigateToChapter(message) {
      if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
      if (pullResetTimer) clearTimeout(pullResetTimer);
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      vscode.postMessage(message);
    }

    let size = ${prefs.fontSize};
    const themes = ['dark', 'light', 'sepia'];
    let themeIndex = ${Math.max(0, ['dark', 'light', 'sepia'].indexOf(prefs.theme))};

    const fonts = [
      { id: 'serif', label: 'Font: Serif', css: 'Georgia, "Times New Roman", serif' },
      { id: 'sans', label: 'Font: Sans', css: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
      { id: 'mono', label: 'Font: Mono', css: '"Cascadia Code", Consolas, "Courier New", monospace' }
    ];
    let fontIndex = ${Math.max(0, ['serif', 'sans', 'mono'].indexOf(prefs.fontFamily))};

    const spacings = [
      { id: 'normal', label: 'Spacing: Normal', val: '1.8' },
      { id: 'relaxed', label: 'Spacing: Relaxed', val: '2.1' },
      { id: 'tight', label: 'Spacing: Tight', val: '1.5' }
    ];
    let spacingIndex = ${Math.max(0, ['normal', 'relaxed', 'tight'].indexOf(prefs.lineHeight))};

    const widths = [
      { id: 'normal', label: 'Width: Normal', val: '44rem' },
      { id: 'wide', label: 'Width: Wide', val: '54rem' },
      { id: 'compact', label: 'Width: Compact', val: '36rem' }
    ];
    let widthIndex = ${Math.max(0, ['normal', 'wide', 'compact'].indexOf(prefs.readerWidth))};

    function notifyPreferences() {
      vscode.postMessage({
        type: 'savePreferences',
        preferences: {
          theme: themes[themeIndex],
          fontSize: size,
          fontFamily: fonts[fontIndex].id,
          lineHeight: spacings[spacingIndex].id,
          readerWidth: widths[widthIndex].id,
          readerMode: isPaginated ? 'paginated' : 'scroll'
        }
      });
    }

    const setSize = () => {
      document.documentElement.style.setProperty('--reader-size', size + 'px');
      if (fontSizeDisplay) fontSizeDisplay.textContent = size + 'px';
      if (isPaginated) {
        requestAnimationFrame(() => updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0));
      }
      notifyPreferences();
    };

    const scrollToFragment = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    let isToolbarHidden = false;

    function toggleToolbar(show) {
      if (!toolbar) return;
      if (show !== undefined) {
        isToolbarHidden = !show;
      } else {
        isToolbarHidden = !isToolbarHidden;
      }
      if (isToolbarHidden) {
        toolbar.classList.add('hidden');
        if (settingsPopover) settingsPopover.hidden = true;
      } else {
        toolbar.classList.remove('hidden');
      }
    }

    function toggleSettings(open) {
      if (!settingsPopover) return;
      const isOpen = open !== undefined ? open : settingsPopover.hidden;
      if (isOpen) {
        toggleToolbar(true);
        settingsPopover.hidden = false;
        updateSettingsPills();
      } else {
        settingsPopover.hidden = true;
      }
    }

    function updateSettingsPills() {
      document.querySelectorAll('.mode-choice-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === (isPaginated ? 'paginated' : 'scroll'));
      });
      const currentTheme = themes[themeIndex];
      document.querySelectorAll('.theme-choice-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === currentTheme);
      });
      const currentFont = fonts[fontIndex].id;
      document.querySelectorAll('.font-choice-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.font === currentFont);
      });
      const currentSpacing = spacings[spacingIndex].id;
      document.querySelectorAll('.spacing-choice-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.spacing === currentSpacing);
      });
      const currentWidth = widths[widthIndex].id;
      document.querySelectorAll('.width-choice-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.width === currentWidth);
      });
      if (fontSizeDisplay) fontSizeDisplay.textContent = size + 'px';
    }

    function hidePopover() {
      if (!popover.hidden) {
        popover.hidden = true;
      }
    }

    function toggleToc(open) {
      if (!tocSidebar) return;
      const isOpen = open !== undefined ? open : !tocSidebar.classList.contains('open');
      if (isOpen) {
        tocSidebar.classList.add('open');
        tocBackdrop?.classList.add('open');
        // Scroll active item into view
        const activeItem = tocSidebar.querySelector('.toc-item.active');
        activeItem?.scrollIntoView({ block: 'center' });
      } else {
        tocSidebar.classList.remove('open');
        tocBackdrop?.classList.remove('open');
      }
    }

    function updateProgress() {
      if (isPaginated) {
        updatePageControls();
        return;
      }
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollY / docHeight) * 100)) : 0;
      if (progressBar) {
        progressBar.style.width = pct + '%';
      }
    }

    let scrollSaveTimer = null;
    function scheduleSaveReadingPosition() {
      if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(() => {
        if (isPaginated) {
          const ratio = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0;
          let anchorId = undefined;
          if (contentEl) {
            const { step, width } = getColumnMetrics();
            const pageLeft = (currentPage - 1) * step;
            const pageRight = pageLeft + width;
            const candidates = contentEl.querySelectorAll('[id]');
            for (let i = 0; i < candidates.length; i++) {
              const el = candidates[i];
              if (el.id === 'footnote-popover' || el.id === 'footnote-caret' || el.id === 'footnote-content') continue;
              if (el.offsetLeft >= pageLeft && el.offsetLeft <= pageRight) {
                anchorId = el.id;
                break;
              }
            }
          }
          vscode.postMessage({
            type: 'saveReadingPosition',
            scrollRatio: ratio,
            scrollY: 0,
            anchorId: anchorId
          });
          return;
        }

        const scrollY = window.scrollY || document.documentElement.scrollTop;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = docHeight > 0 ? Math.min(1, Math.max(0, scrollY / docHeight)) : 0;

        let anchorId = undefined;
        if (contentEl) {
          const candidates = contentEl.querySelectorAll('[id]');
          for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.id === 'footnote-popover' || el.id === 'footnote-caret' || el.id === 'footnote-content') continue;
            const rect = el.getBoundingClientRect();
            if (rect.top >= 0 && rect.top <= window.innerHeight * 0.5) {
              anchorId = el.id;
              break;
            }
          }
        }

        vscode.postMessage({
          type: 'saveReadingPosition',
          scrollRatio: ratio,
          scrollY: Math.round(scrollY),
          anchorId: anchorId
        });
      }, 200);
    }

    window.addEventListener('scroll', () => {
      updateProgress();
      scheduleSaveReadingPosition();
    }, { passive: true });
    updateProgress();

    // Overscroll Resistance & Threshold Release (Moon+ Reader Style)
    let pullOffset = 0;
    let isTransitioningChapter = false;
    let pullResetTimer = null;
    const PULL_THRESHOLD = 55;
    const MAX_PULL = 85;

    function resetOverscrollCues() {
      if (contentEl) {
        contentEl.style.transition = 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1)';
        contentEl.style.transform = 'translateY(0)';
      }
      if (bottomCue) {
        bottomCue.classList.remove('visible', 'active');
        const label = bottomCue.querySelector('.overscroll-label');
        if (label) label.textContent = 'Tarik untuk ke Bab Berikutnya';
      }
      if (topCue) {
        topCue.classList.remove('visible', 'active');
        const label = topCue.querySelector('.overscroll-label');
        if (label) label.textContent = 'Tarik untuk ke Bab Sebelumnya';
      }
      pullOffset = 0;
    }

    window.addEventListener('wheel', (event) => {
      if (isPaginated || isTransitioningChapter) return;
      if (tocSidebar && tocSidebar.classList.contains('open')) return;

      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const isAtBottom = docHeight <= 0 || scrollY >= docHeight - 3;
      const isAtTop = scrollY <= 3;

      const hasNext = ${Boolean(navInfo?.hasNext)};
      const hasPrev = ${Boolean(navInfo?.hasPrev)};

      // Mentok Bawah (Tarik ke atas untuk ke Bab Berikutnya)
      if (isAtBottom && event.deltaY > 0 && hasNext) {
        if (pullResetTimer) clearTimeout(pullResetTimer);
        pullOffset = Math.min(MAX_PULL, pullOffset + (event.deltaY * 0.3));
        if (contentEl) {
          contentEl.style.transition = 'none';
          contentEl.style.transform = 'translateY(-' + pullOffset + 'px)';
        }

        if (bottomCue) {
          bottomCue.classList.add('visible');
          const label = bottomCue.querySelector('.overscroll-label');
          if (pullOffset >= PULL_THRESHOLD) {
            bottomCue.classList.add('active');
            if (label) label.textContent = 'Lepaskan untuk membuka Bab Berikutnya';
          } else {
            bottomCue.classList.remove('active');
            if (label) label.textContent = 'Tarik untuk ke Bab Berikutnya';
          }
        }

        pullResetTimer = setTimeout(() => {
          if (pullOffset >= PULL_THRESHOLD) {
            isTransitioningChapter = true;
            if (contentEl) {
              contentEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
              contentEl.style.transform = 'translateY(-120px)';
              contentEl.style.opacity = '0';
            }
            setTimeout(() => {
              navigateToChapter({ type: 'nextChapter' });
            }, 180);
          } else {
            resetOverscrollCues();
          }
        }, 150);
        return;
      }

      // Mentok Atas (Tarik ke bawah untuk ke Bab Sebelumnya)
      if (isAtTop && event.deltaY < 0 && hasPrev) {
        if (pullResetTimer) clearTimeout(pullResetTimer);
        pullOffset = Math.min(MAX_PULL, pullOffset + (Math.abs(event.deltaY) * 0.3));
        if (contentEl) {
          contentEl.style.transition = 'none';
          contentEl.style.transform = 'translateY(' + pullOffset + 'px)';
        }

        if (topCue) {
          topCue.classList.add('visible');
          const label = topCue.querySelector('.overscroll-label');
          if (pullOffset >= PULL_THRESHOLD) {
            topCue.classList.add('active');
            if (label) label.textContent = 'Lepaskan untuk membuka Bab Sebelumnya';
          } else {
            topCue.classList.remove('active');
            if (label) label.textContent = 'Tarik untuk ke Bab Sebelumnya';
          }
        }

        pullResetTimer = setTimeout(() => {
          if (pullOffset >= PULL_THRESHOLD) {
            isTransitioningChapter = true;
            if (contentEl) {
              contentEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
              contentEl.style.transform = 'translateY(120px)';
              contentEl.style.opacity = '0';
            }
            setTimeout(() => {
              navigateToChapter({ type: 'prevChapter', startAtBottom: true });
            }, 180);
          } else {
            resetOverscrollCues();
          }
        }, 150);
        return;
      }
    }, { passive: true });

    // Touch events for touchscreen devices
    let touchStartY = 0;
    window.addEventListener('touchstart', (e) => {
      if (isPaginated || isTransitioningChapter) return;
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (isPaginated || isTransitioningChapter || !touchStartY) return;
      const currentY = e.touches[0].clientY;
      const delta = currentY - touchStartY;
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const isAtBottom = docHeight <= 0 || scrollY >= docHeight - 3;
      const isAtTop = scrollY <= 3;
      const hasNext = ${Boolean(navInfo?.hasNext)};
      const hasPrev = ${Boolean(navInfo?.hasPrev)};

      if (isAtBottom && delta < -10 && hasNext) {
        pullOffset = Math.min(MAX_PULL, Math.abs(delta) * 0.35);
        if (contentEl) {
          contentEl.style.transition = 'none';
          contentEl.style.transform = 'translateY(-' + pullOffset + 'px)';
        }
        if (bottomCue) {
          bottomCue.classList.add('visible');
          const label = bottomCue.querySelector('.overscroll-label');
          if (pullOffset >= PULL_THRESHOLD) {
            bottomCue.classList.add('active');
            if (label) label.textContent = 'Lepaskan untuk membuka Bab Berikutnya';
          } else {
            bottomCue.classList.remove('active');
            if (label) label.textContent = 'Tarik untuk ke Bab Berikutnya';
          }
        }
      } else if (isAtTop && delta > 10 && hasPrev) {
        pullOffset = Math.min(MAX_PULL, delta * 0.35);
        if (contentEl) {
          contentEl.style.transition = 'none';
          contentEl.style.transform = 'translateY(' + pullOffset + 'px)';
        }
        if (topCue) {
          topCue.classList.add('visible');
          const label = topCue.querySelector('.overscroll-label');
          if (pullOffset >= PULL_THRESHOLD) {
            topCue.classList.add('active');
            if (label) label.textContent = 'Lepaskan untuk membuka Bab Sebelumnya';
          } else {
            topCue.classList.remove('active');
            if (label) label.textContent = 'Tarik untuk ke Bab Sebelumnya';
          }
        }
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (isPaginated || isTransitioningChapter) return;
      touchStartY = 0;
      if (pullOffset >= PULL_THRESHOLD) {
        isTransitioningChapter = true;
        const isPullingUp = contentEl && contentEl.style.transform.indexOf('-') !== -1;
        if (contentEl) {
          contentEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
          contentEl.style.transform = isPullingUp ? 'translateY(-120px)' : 'translateY(120px)';
          contentEl.style.opacity = '0';
        }
        setTimeout(() => {
          navigateToChapter({ type: isPullingUp ? 'nextChapter' : 'prevChapter', startAtBottom: !isPullingUp });
        }, 180);
      } else if (pullOffset > 0) {
        resetOverscrollCues();
      }
    }, { passive: true });

    // Clickable fallback on cues
    if (bottomCue) {
      bottomCue.addEventListener('click', () => {
        if (!isPaginated && !isTransitioningChapter && ${Boolean(navInfo?.hasNext)}) {
          isTransitioningChapter = true;
          if (contentEl) {
            contentEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
            contentEl.style.transform = 'translateY(-120px)';
            contentEl.style.opacity = '0';
          }
          setTimeout(() => {
            navigateToChapter({ type: 'nextChapter' });
          }, 180);
        }
      });
    }

    if (topCue) {
      topCue.addEventListener('click', () => {
        if (!isPaginated && !isTransitioningChapter && ${Boolean(navInfo?.hasPrev)}) {
          isTransitioningChapter = true;
          if (contentEl) {
            contentEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
            contentEl.style.transform = 'translateY(120px)';
            contentEl.style.opacity = '0';
          }
          setTimeout(() => {
            navigateToChapter({ type: 'prevChapter', startAtBottom: true });
          }, 180);
        }
      });
    }

    // TOC search filter
    if (tocSearch) {
      tocSearch.addEventListener('input', () => {
        const query = tocSearch.value.trim().toLowerCase();
        const items = document.querySelectorAll('.toc-item');
        items.forEach((item) => {
          const text = (item.textContent || '').toLowerCase();
          item.style.display = text.includes(query) ? '' : 'none';
        });
      });
    }

    function isFootnoteLink(link, href) {
      if (!href.startsWith('#')) return false;
      const epubType = (link.getAttribute('epub:type') || '').toLowerCase();
      const role = (link.getAttribute('role') || '').toLowerCase();
      const className = (link.className || '').toLowerCase();
      const rel = (link.getAttribute('rel') || '').toLowerCase();

      if (epubType.split(/\\s+/).includes('noteref')) return true;
      if (role.split(/\\s+/).includes('doc-noteref')) return true;
      if (rel.split(/\\s+/).includes('footnote')) return true;
      if (/\\b(?:footnote|noteref|note-ref)\\b/i.test(className)) return true;
      if (link.closest('sup, sub')) return true;

      const id = decodeURIComponent(href.slice(1));
      const target = document.getElementById(id);
      if (target) {
        const targetEpubType = (target.getAttribute('epub:type') || '').toLowerCase();
        const targetRole = (target.getAttribute('role') || '').toLowerCase();
        const targetClass = (target.className || '').toLowerCase();
        const targetTag = target.tagName.toLowerCase();
        if (targetTag === 'aside' || targetEpubType.includes('footnote') || targetRole.includes('doc-footnote') || /\\bfootnote\\b/i.test(targetClass)) {
          return true;
        }
      }
      return false;
    }

    function extractCleanFootnote(target) {
      const clone = target.cloneNode(true);
      const links = clone.querySelectorAll('a');
      links.forEach((el) => {
        const h = el.getAttribute('href') || '';
        const role = el.getAttribute('role') || '';
        const epubType = el.getAttribute('epub:type') || '';
        if (role.includes('doc-backlink') || epubType.includes('backlink') || el.classList.contains('footnote-backref') || el.classList.contains('backlink')) {
          el.remove();
        } else if (h.startsWith('#')) {
          el.replaceWith(document.createTextNode(el.textContent));
        }
      });
      clone.innerHTML = clone.innerHTML.replace(/[\\s\\u00A0]*[\\u21A9\\u2191\\u21B5][\\s\\u00A0]*/g, '');
      return clone.innerHTML;
    }

    function showFootnotePopover(link, target) {
      if (link && typeof link.blur === 'function') {
        link.blur();
      }

      noteContent.innerHTML = extractCleanFootnote(target);
      popover.hidden = false;

      const linkRect = link.getBoundingClientRect();
      const popoverWidth = popover.offsetWidth;
      const popoverHeight = popover.offsetHeight;
      const scrollY = window.scrollY || window.pageYOffset;
      const scrollX = window.scrollX || window.pageXOffset;

      const toolbarHeight = 56;
      const spaceAbove = linkRect.top - toolbarHeight;
      const spaceBelow = window.innerHeight - linkRect.bottom;
      const placeAbove = spaceAbove >= popoverHeight + 10;

      let top = 0;
      if (placeAbove) {
        top = scrollY + linkRect.top - popoverHeight - 8;
        caret.className = 'footnote-caret place-top';
      } else {
        top = scrollY + linkRect.bottom + 8;
        caret.className = 'footnote-caret place-bottom';
      }

      const linkCenter = scrollX + linkRect.left + (linkRect.width / 2);
      let left = linkCenter - (popoverWidth / 2);
      const minLeft = scrollX + 12;
      const maxLeft = scrollX + window.innerWidth - popoverWidth - 12;
      left = Math.max(minLeft, Math.min(left, maxLeft));

      popover.style.top = top + 'px';
      popover.style.left = left + 'px';

      const caretLeft = Math.max(12, Math.min(popoverWidth - 22, linkCenter - left - 5));
      caret.style.left = caretLeft + 'px';

      const lockScrollY = scrollY;
      const lockScrollX = scrollX;
      const lockMainScrollLeft = contentEl ? contentEl.scrollLeft : 0;
      requestAnimationFrame(() => {
        if (window.scrollY !== lockScrollY || window.scrollX !== lockScrollX) {
          window.scrollTo(lockScrollX, lockScrollY);
        }
        if (isPaginated && contentEl && contentEl.scrollLeft !== lockMainScrollLeft) {
          contentEl.scrollLeft = lockMainScrollLeft;
        }
      });
    }

    // Toolbar actions
    document.getElementById('toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;

      if (action === 'toggle-toc') {
        toggleToc();
      }
      if (action === 'toggle-settings') {
        toggleSettings();
      }
      if (action === 'smaller') {
        size = Math.max(12, size - 1);
        setSize();
      }
      if (action === 'larger') {
        size = Math.min(32, size + 1);
        setSize();
      }
      if (action === 'theme') {
        themeIndex = (themeIndex + 1) % themes.length;
        document.documentElement.classList.remove('light', 'sepia');
        const nextTheme = themes[themeIndex];
        if (nextTheme !== 'dark') {
          document.documentElement.classList.add(nextTheme);
        }
        themeBtn.textContent = 'Theme: ' + nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1);
        updateSettingsPills();
        notifyPreferences();
      }
      if (action === 'font') {
        fontIndex = (fontIndex + 1) % fonts.length;
        const font = fonts[fontIndex];
        document.documentElement.style.setProperty('--reader-font', font.css);
        fontBtn.textContent = font.label;
        updateSettingsPills();
        if (isPaginated) {
          requestAnimationFrame(() => updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0));
        }
        notifyPreferences();
      }
      if (action === 'spacing') {
        spacingIndex = (spacingIndex + 1) % spacings.length;
        const sp = spacings[spacingIndex];
        document.documentElement.style.setProperty('--reader-line-height', sp.val);
        spacingBtn.textContent = sp.label;
        updateSettingsPills();
        if (isPaginated) {
          requestAnimationFrame(() => updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0));
        }
        notifyPreferences();
      }
      if (action === 'width') {
        widthIndex = (widthIndex + 1) % widths.length;
        const w = widths[widthIndex];
        document.documentElement.style.setProperty('--reader-max-width', w.val);
        widthBtn.textContent = w.label;
        updateSettingsPills();
        if (isPaginated) {
          requestAnimationFrame(() => updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0));
        }
        notifyPreferences();
      }
      if (action === 'mode') {
        toggleMode();
      }
      if (action === 'prev-chapter') {
        navigateToChapter({ type: 'prevChapter', startAtBottom: true });
      }
      if (action === 'next-chapter') {
        navigateToChapter({ type: 'nextChapter' });
      }
    });

    // Settings Popover actions
    if (settingsPopover) {
      settingsPopover.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;

        if (action === 'close-settings') {
          toggleSettings(false);
          return;
        }

        if (action === 'mode-choice') {
          const targetMode = button.dataset.mode;
          toggleMode(targetMode);
          return;
        }

        if (action === 'smaller') {
          size = Math.max(12, size - 1);
          setSize();
          return;
        }

        if (action === 'larger') {
          size = Math.min(32, size + 1);
          setSize();
          return;
        }

        if (action === 'theme-choice') {
          const targetTheme = button.dataset.theme;
          const idx = themes.indexOf(targetTheme);
          if (idx !== -1) {
            themeIndex = idx;
            document.documentElement.classList.remove('light', 'sepia');
            if (targetTheme !== 'dark') {
              document.documentElement.classList.add(targetTheme);
            }
            updateSettingsPills();
            notifyPreferences();
          }
          return;
        }

        if (action === 'font-choice') {
          const targetFont = button.dataset.font;
          const idx = fonts.findIndex(f => f.id === targetFont);
          if (idx !== -1) {
            fontIndex = idx;
            const font = fonts[fontIndex];
            document.documentElement.style.setProperty('--reader-font', font.css);
            updateSettingsPills();
            if (isPaginated) {
              requestAnimationFrame(() => updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0));
            }
            notifyPreferences();
          }
          return;
        }

        if (action === 'spacing-choice') {
          const targetSpacing = button.dataset.spacing;
          const idx = spacings.findIndex(s => s.id === targetSpacing);
          if (idx !== -1) {
            spacingIndex = idx;
            const sp = spacings[spacingIndex];
            document.documentElement.style.setProperty('--reader-line-height', sp.val);
            updateSettingsPills();
            if (isPaginated) {
              requestAnimationFrame(() => updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0));
            }
            notifyPreferences();
          }
          return;
        }

        if (action === 'width-choice') {
          const targetWidth = button.dataset.width;
          const idx = widths.findIndex(w => w.id === targetWidth);
          if (idx !== -1) {
            widthIndex = idx;
            const w = widths[widthIndex];
            document.documentElement.style.setProperty('--reader-max-width', w.val);
            updateSettingsPills();
            if (isPaginated) {
              requestAnimationFrame(() => updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0));
            }
            notifyPreferences();
          }
          return;
        }
      });
    }

    // Close Settings Popover on outside click
    document.addEventListener('click', (event) => {
      if (settingsPopover && !settingsPopover.hidden) {
        if (!settingsPopover.contains(event.target) && !event.target.closest('#settings-btn')) {
          toggleSettings(false);
        }
      }
    });

    // Hover sensor at top edge
    if (toolbarSensor) {
      toolbarSensor.addEventListener('mouseenter', () => {
        if (toolbar) toolbar.classList.remove('hidden');
      });
    }

    if (toolbar) {
      toolbar.addEventListener('mouseleave', () => {
        if (isToolbarHidden && settingsPopover && settingsPopover.hidden) {
          toolbar.classList.add('hidden');
        }
      });
    }

    // Middle-click (mouse wheel click) to toggle toolbar
    document.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        toggleToolbar();
      }
    });

    // Reading area click to toggle toolbar
    document.addEventListener('click', (event) => {
      if (event.target.closest('#toolbar, #settings-popover, #toc-sidebar, #toc-backdrop, .footnote-popover, .page-nav-arrow, .overscroll-cue')) {
        return;
      }
      if (event.target.closest('a, button, input, textarea, select, [role="button"]')) {
        return;
      }
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        return;
      }
      toggleToolbar();
    });

    // Close TOC button and backdrop click
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="close-toc"]') || event.target === tocBackdrop) {
        toggleToc(false);
      }
    });

    // Link handling & footnote interception
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link) {
        if (!popover.contains(event.target)) {
          hidePopover();
        }
        return;
      }

      const href = link.getAttribute('href');
      if (!href) return;

      // Handle TOC item click
      if (link.classList.contains('toc-item')) {
        event.preventDefault();
        toggleToc(false);
        navigateToChapter({ type: 'openLink', href });
        return;
      }

      if (href.startsWith('#')) {
        event.preventDefault();
        event.stopPropagation();

        const id = decodeURIComponent(href.slice(1));
        const target = document.getElementById(id);

        if (isFootnoteLink(link, href) && target) {
          showFootnotePopover(link, target);
          return;
        }

        hidePopover();
        if (isPaginated && target && contentEl) {
          const { step } = getColumnMetrics();
          if (step > 0) {
            const colIndex = Math.floor(target.offsetLeft / step);
            currentPage = Math.max(1, Math.min(totalPages, colIndex + 1));
            renderPage(true);
          }
          return;
        }
        scrollToFragment(id);
        return;
      }

      // External / cross-chapter link
      if (!/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(href)) {
        event.preventDefault();
        hidePopover();
        vscode.postMessage({ type: 'openLink', href });
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (settingsPopover && !settingsPopover.hidden) {
          toggleSettings(false);
          return;
        }
        if (tocSidebar && tocSidebar.classList.contains('open')) {
          toggleToc(false);
          return;
        }
        hidePopover();
      }
      if (event.key === 'h' || event.key === 'H') {
        if (document.activeElement !== tocSearch) {
          toggleToolbar();
        }
      }
      if (event.key === 's' || event.key === 'S') {
        if (document.activeElement !== tocSearch) {
          toggleSettings();
        }
      }
      if (event.key === 't' || event.key === 'T') {
        // Only toggle if not typing in search box
        if (document.activeElement !== tocSearch) {
          toggleToc();
        }
      }
      if (document.activeElement !== tocSearch && isPaginated) {
        if (event.key === 'ArrowRight' || (event.key === ' ' && !event.shiftKey) || event.key === 'PageDown') {
          event.preventDefault();
          nextPage();
          return;
        }
        if (event.key === 'ArrowLeft' || (event.key === ' ' && event.shiftKey) || event.key === 'PageUp') {
          event.preventDefault();
          prevPage();
          return;
        }
      }
      if (event.key === '[' || (event.altKey && event.key === 'ArrowLeft')) {
        navigateToChapter({ type: 'prevChapter', startAtBottom: true });
      }
      if (event.key === ']' || (event.altKey && event.key === 'ArrowRight')) {
        navigateToChapter({ type: 'nextChapter' });
      }
    });

    // Close on window resize to avoid detached floating cards
    window.addEventListener('resize', () => {
      hidePopover();
      if (isPaginated) {
        updatePagination(true, totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0);
      }
    });

    const initial = document.body.dataset.fragment;
    const isResetToTop = document.body.dataset.resetToTop === 'true';
    const isStartAtBottom = document.body.dataset.startAtBottom === 'true';
    const initialRatio = parseFloat(document.body.dataset.initialRatio || '0');
    const initialScrollY = parseFloat(document.body.dataset.initialScrollY || '0');
    const initialAnchorId = document.body.dataset.initialAnchorId || '';

    let userScrolled = false;
    window.addEventListener('wheel', () => { userScrolled = true; }, { passive: true, once: true });
    window.addEventListener('touchmove', () => { userScrolled = true; }, { passive: true, once: true });

    function forceTop() {
      if (isPaginated) {
        currentPage = 1;
        renderPage(false);
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        if (progressBar) progressBar.style.width = '0%';
      }
    }

    function forceBottom() {
      if (isPaginated) {
        totalPages = computeTotalPages();
        currentPage = totalPages;
        renderPage(false);
      } else {
        const bottomY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo({ top: bottomY, left: 0, behavior: 'instant' });
        document.documentElement.scrollTop = bottomY;
        document.body.scrollTop = bottomY;
        updateProgress();
      }
    }

    function restorePosition() {
      if (isStartAtBottom) {
        forceBottom();
        return;
      }
      if (isResetToTop) {
        forceTop();
        return;
      }
      if (isPaginated) {
        totalPages = computeTotalPages();
        if (initialAnchorId && contentEl) {
          const target = document.getElementById(initialAnchorId);
          if (target) {
            const { step } = getColumnMetrics();
            if (step > 0) {
              const colIndex = Math.floor(target.offsetLeft / step);
              currentPage = Math.max(1, Math.min(totalPages, colIndex + 1));
              renderPage(false);
              return;
            }
          }
        }
        if (initialRatio > 0 && totalPages > 1) {
          currentPage = Math.max(1, Math.min(totalPages, Math.round(initialRatio * (totalPages - 1)) + 1));
          renderPage(false);
          return;
        }
        currentPage = 1;
        renderPage(false);
        return;
      }
      if (userScrolled) return;
      if (initial) {
        scrollToFragment(initial);
        return;
      }
      if (initialScrollY > 0) {
        window.scrollTo({ top: initialScrollY, behavior: 'instant' });
        return;
      }
      if (initialRatio > 0) {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (docHeight > 0) {
          window.scrollTo({ top: initialRatio * docHeight, behavior: 'instant' });
          return;
        }
      }
      if (initialAnchorId) {
        const target = document.getElementById(initialAnchorId);
        if (target) {
          target.scrollIntoView({ behavior: 'instant', block: 'start' });
          return;
        }
      }
      forceTop();
    }

    if (isStartAtBottom) {
      forceBottom();
      requestAnimationFrame(forceBottom);
      setTimeout(forceBottom, 30);
      setTimeout(forceBottom, 100);
      setTimeout(forceBottom, 250);
      window.addEventListener('load', forceBottom, { once: true });
    } else if (isResetToTop) {
      forceTop();
      requestAnimationFrame(forceTop);
      setTimeout(forceTop, 30);
      setTimeout(forceTop, 100);
      window.addEventListener('load', forceTop, { once: true });
    } else {
      restorePosition();
      requestAnimationFrame(restorePosition);
      window.addEventListener('load', () => {
        if (!userScrolled) {
          restorePosition();
        }
      }, { once: true });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] ?? character);
}
