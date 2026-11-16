# XHTML Reader Previewer v0.1.0

We are thrilled to announce the milestone release of **XHTML Reader Previewer** (`v0.1.0`)! 🚀🎉

This release marks a major evolution in the reading and inspection capabilities of the extension. It introduces comprehensive **cross-file asynchronous footnote extraction**, an intelligent **reading navigation history stack** with jump-and-return memory, strict compliance with the **EPUB 3 canonical spine reading order** with an inspector sidebar tab, rich non-linear badges, and an automated test suite with unordered fixtures.

---

## 🌟 What's New in v0.1.0

### 1. 📌 Cross-File & Heuristic Footnote Popover Extraction
- **Asynchronous Cross-File Resolution**: Footnotes located in separate files (e.g., `notes.xhtml` or `endnotes.xhtml`) are now loaded asynchronously via webview message passing without opening full external documents.
- **5-Layer Heuristic Detection**: Automatically detects footnote and citation links via `epub:type` (`noteref`, `footnote`), ARIA roles (`doc-noteref`, `doc-biblioref`), class names, structural patterns (`sup`, `sub`), text patterns (`[1]`, `(1)`, `*`, `†`), and fragment identifier semantics (`#fn1`, `#note-1`).
- **Clean Content Extraction**: Extracts `<aside>`, `<li>`, or enclosing `<p>` elements while cleanly stripping backlink return symbols (`↩`, `^`, `↑`) for distraction-free previewing.
- **Graceful Fallbacks & Loaders**: Features a lightweight animated loading spinner and an informative "Target Not Found" fallback popover if the target anchor is missing, complete with a direct button to open the file.

### 2. ⏪ Reading Navigation History Stack & Return Pill
- **Jump-and-Return Navigation Memory**: Jumping to chapters or sections (via Table of Contents, intra-text cross-references, or popover fallbacks) automatically pushes the previous reading coordinates (`uri`, `scrollY`, `scrollRatio`, chapter title) onto a dedicated navigation history stack.
- **Floating Return Pill**: Displays an elegant glassmorphism return pill in the bottom-left corner (*"← Return to {Chapter} ({Ratio}%)"*).
- **Flexible Keyboard Shortcuts**: Jump back effortlessly using `Backspace`, `B`, or `Alt+Left`.
- **Intelligent Dismissal**: Pill auto-minimizes smoothly when scrolling past 350px or can be closed with the `×` button.

### 3. 📑 Canonical EPUB Spine Reading Order Inspector
- **Strict Canonical Spine Traversal**: Sequential chapter navigation (`Next Chapter` / `Prev Chapter` / `]` / `[`) strictly respects the canonical sequence declared in the OPF `<spine>`, completely independent of alphabetical file naming or `<manifest>` declaration order.
- **Sidebar Tab Switcher**: The navigation sidebar now features dual tabs:
  - **`Contents`**: Hierarchical Table of Contents from EPUB 3 Navigation Document or NCX.
  - **`Spine Order`**: Numbered canonical reading order (1, 2, 3, ...) showing chapter titles, underlying file names (`ch01.xhtml`), and non-linear status.
- **Non-Linear Indicator**: Items with `linear="no"` (e.g., cover pages, appendices) are highlighted with distinctive `NON-LINEAR` badges on both the sidebar and the reader toolbar.
- **Rich Toolbar Metadata & Tooltip**: The central chapter badge displays rich spine information (`Spine 3/15 • ch02.xhtml`) with comprehensive hover tooltips.

---

## 🔄 Improvements & Polish
- **Unified Sidebar Search**: The `#toc-search` filter seamlessly queries items across both the Table of Contents and Spine Order tabs.
- **Theme Consistency**: All new visual components (return pill, spine list, non-linear badges, tabs) have bespoke, high-contrast styling across Dark, Light, and Sepia themes.
- **Auto-Scroll Active Item**: Opening the navigation sidebar (`T`) automatically centers the currently active chapter in view on the active tab pane.
- **Safe Protocol Sanitization**: Hardened URL parsing in the webview to prevent template escaping pitfalls.

---

## 🧪 Testing & Reliability
- **Unordered Spine Test Fixture**: Built an automated EPUB test fixture in `test/fixtures/unordered-spine/` with deliberately non-alphabetical file names (`z_cover.xhtml`, `m_prologue.xhtml`, `b_chapter2.xhtml`, `a_chapter1.xhtml`) to continuously verify canonical spine ordering.
- **Comprehensive Unit Test Suite**: Expanded the automated test suite to 32 tests covering:
  - OPF spine sequencing & linear attribute extraction.
  - Navigation history stack depth limits, branch resetting, and lifecycle cleanup.
  - Cross-file footnote message handling and HTML element extraction.
  - Reader shell DOM structures, toolbar spine metadata, and keyboard handlers.
- **Zero-Warning TypeScript Build**: 100% clean typecheck (`tsc --noEmit`) and esbuild bundling.

---

## 📦 Installation & Verification

### From VS Code Marketplace
Search for **`XHTML Reader Previewer`** (by `selvagant`) in the Extensions view and click **Install**.

Or run in your terminal:
```bash
code --install-extension selvagant.xhtml-reader-previewer
```

### Manual Installation via VSIX
Download `xhtml-reader-previewer-0.1.0.vsix` from GitHub Release assets, then run:
```bash
code --install-extension xhtml-reader-previewer-0.1.0.vsix
```

---

## 📄 Full Changelog
Compare commits: https://github.com/intxdv/XHTML-Reader-Previewer/compare/v0.0.3...v0.1.0
