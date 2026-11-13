import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export interface ReaderNavInfo {
  hasPrev?: boolean;
  hasNext?: boolean;
  bookTitle?: string;
  chapterIndex?: number;
  totalChapters?: number;
}

export function readerShell(
  content: string,
  source: vscode.Uri,
  fragment: string | undefined,
  webview: vscode.Webview,
  navInfo?: ReaderNavInfo
): string {
  const nonce = randomBytes(16).toString('base64');
  const title = escapeHtml(vscode.workspace.asRelativePath(source, false) || source.fsPath);
  const initialFragment = escapeHtml(fragment ?? '');

  const hasNav = navInfo && typeof navInfo.totalChapters === 'number' && navInfo.totalChapters > 0;
  const navHtml = hasNav
    ? `<div class="toolbar-separator"></div>
    <div class="toolbar-group nav-group">
      <button type="button" data-action="prev-chapter" id="prev-btn" title="Previous chapter (Shortcut: [ or Alt+Left)" ${navInfo.hasPrev ? '' : 'disabled'}>← Prev</button>
      <span class="chapter-badge" title="${escapeHtml(navInfo.bookTitle || '')}">${navInfo.chapterIndex ?? 1} / ${navInfo.totalChapters}</span>
      <button type="button" data-action="next-chapter" id="next-btn" title="Next chapter (Shortcut: ] or Alt+Right)" ${navInfo.hasNext ? '' : 'disabled'}>Next →</button>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style nonce="${nonce}">
    :root {
      --reader-size: 18px;
      --reader-line-height: 1.8;
      --reader-max-width: 44rem;
      --reader-font: Georgia, "Times New Roman", serif;

      /* Dark Theme (Default) */
      --reader-bg: #111827;
      --reader-fg: #e5e7eb;
      --reader-link: #93c5fd;
      --popover-bg: #1e2430;
      --popover-fg: #f3f4f6;
      --popover-border: #374151;
      --popover-shadow: 0 10px 25px -5px rgba(0,0,0,0.6), 0 8px 10px -6px rgba(0,0,0,0.5);
    }
    body {
      background: var(--reader-bg);
      color: var(--reader-fg);
      font-family: var(--reader-font);
      font-size: var(--reader-size);
      line-height: var(--reader-line-height);
      margin: 0;
      padding: 5rem 1.5rem 4rem;
      transition: background 0.2s ease, color 0.2s ease;
    }
    main {
      max-width: var(--reader-max-width);
      margin: auto;
      transition: max-width 0.2s ease;
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
      z-index: 10;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      align-items: center;
      padding: 0.55rem 1rem;
      background: #111827e8;
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #374151;
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      transition: background 0.2s ease, border-color 0.2s ease;
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
    .font-size-badge, .chapter-badge {
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
    /* Light Theme */
    .light {
      --reader-bg: #f8fafc;
      --reader-fg: #172033;
      --reader-link: #1d4ed8;
      --popover-bg: #ffffff;
      --popover-fg: #1e293b;
      --popover-border: #cbd5e1;
      --popover-shadow: 0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1);
    }
    .light #toolbar {
      background: #f8fafce8;
      border-color: #cbd5e1;
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
    /* Sepia Theme */
    .sepia {
      --reader-bg: #fbf0d9;
      --reader-fg: #5f4b32;
      --reader-link: #92400e;
      --popover-bg: #f5e6c8;
      --popover-fg: #453216;
      --popover-border: #d4bc91;
      --popover-shadow: 0 10px 25px -5px rgba(95,75,50,0.15), 0 8px 10px -6px rgba(95,75,50,0.1);
    }
    .sepia #toolbar {
      background: #fbf0d9e8;
      border-color: #d4bc91;
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
  </style>
</head>
<body data-fragment="${initialFragment}">
  <header id="toolbar" aria-label="Reader controls">
    <div class="toolbar-group">
      <button type="button" data-action="smaller" aria-label="Decrease text size">A−</button>
      <span id="font-size-display" class="font-size-badge" aria-label="Current text size">18px</span>
      <button type="button" data-action="larger" aria-label="Increase text size">A+</button>
    </div>

    <div class="toolbar-separator"></div>

    <button type="button" data-action="theme" id="theme-btn" aria-label="Change theme">Theme: Dark</button>
    <button type="button" data-action="font" id="font-btn" aria-label="Change font">Font: Serif</button>
    <button type="button" data-action="spacing" id="spacing-btn" aria-label="Change line height">Spacing: Normal</button>
    <button type="button" data-action="width" id="width-btn" aria-label="Change content width">Width: Normal</button>

    ${navHtml}

    <div id="progress-track" aria-hidden="true">
      <div id="progress-bar"></div>
    </div>
  </header>

  <main>${content.replace(/<style\b/gi, `<style nonce="${nonce}"`)}</main>

  <div id="footnote-popover" class="footnote-popover" role="dialog" aria-modal="false" aria-label="Footnote" hidden>
    <div id="footnote-caret" class="footnote-caret"></div>
    <div id="footnote-content" class="footnote-body"></div>
  </div>

  <script nonce="${nonce}">
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

    let size = 18;
    const themes = ['dark', 'light', 'sepia'];
    let themeIndex = 0;

    const fonts = [
      { id: 'serif', label: 'Font: Serif', css: 'Georgia, "Times New Roman", serif' },
      { id: 'sans', label: 'Font: Sans', css: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
      { id: 'mono', label: 'Font: Mono', css: '"Cascadia Code", Consolas, "Courier New", monospace' }
    ];
    let fontIndex = 0;

    const spacings = [
      { id: 'normal', label: 'Spacing: Normal', val: '1.8' },
      { id: 'relaxed', label: 'Spacing: Relaxed', val: '2.1' },
      { id: 'tight', label: 'Spacing: Tight', val: '1.5' }
    ];
    let spacingIndex = 0;

    const widths = [
      { id: 'normal', label: 'Width: Normal', val: '44rem' },
      { id: 'wide', label: 'Width: Wide', val: '54rem' },
      { id: 'compact', label: 'Width: Compact', val: '36rem' }
    ];
    let widthIndex = 0;

    const setSize = () => {
      document.documentElement.style.setProperty('--reader-size', size + 'px');
      if (fontSizeDisplay) fontSizeDisplay.textContent = size + 'px';
    };

    const scrollToFragment = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    function hidePopover() {
      if (!popover.hidden) {
        popover.hidden = true;
      }
    }

    function updateProgress() {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollY / docHeight) * 100)) : 0;
      if (progressBar) {
        progressBar.style.width = pct + '%';
      }
    }
    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();

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
      requestAnimationFrame(() => {
        if (window.scrollY !== lockScrollY || window.scrollX !== lockScrollX) {
          window.scrollTo(lockScrollX, lockScrollY);
        }
      });
    }

    // Toolbar actions
    document.getElementById('toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;

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
      }
      if (action === 'font') {
        fontIndex = (fontIndex + 1) % fonts.length;
        const font = fonts[fontIndex];
        document.documentElement.style.setProperty('--reader-font', font.css);
        fontBtn.textContent = font.label;
      }
      if (action === 'spacing') {
        spacingIndex = (spacingIndex + 1) % spacings.length;
        const sp = spacings[spacingIndex];
        document.documentElement.style.setProperty('--reader-line-height', sp.val);
        spacingBtn.textContent = sp.label;
      }
      if (action === 'width') {
        widthIndex = (widthIndex + 1) % widths.length;
        const w = widths[widthIndex];
        document.documentElement.style.setProperty('--reader-max-width', w.val);
        widthBtn.textContent = w.label;
      }
      if (action === 'prev-chapter') {
        vscode.postMessage({ type: 'prevChapter' });
      }
      if (action === 'next-chapter') {
        vscode.postMessage({ type: 'nextChapter' });
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
        hidePopover();
      }
      if (event.key === '[' || (event.altKey && event.key === 'ArrowLeft')) {
        vscode.postMessage({ type: 'prevChapter' });
      }
      if (event.key === ']' || (event.altKey && event.key === 'ArrowRight')) {
        vscode.postMessage({ type: 'nextChapter' });
      }
    });

    // Close on window resize to avoid detached floating cards
    window.addEventListener('resize', hidePopover);

    const initial = document.body.dataset.fragment;
    if (initial) scrollToFragment(initial);
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
