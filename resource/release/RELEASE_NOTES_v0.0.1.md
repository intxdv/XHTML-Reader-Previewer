# XHTML Reader Previewer v0.0.1

We are thrilled to announce the initial release of **XHTML Reader Previewer** (`v0.0.1`)! 🎉

**XHTML Reader Previewer** brings a desktop-grade, distraction-free reading and previewing experience directly inside VS Code and compatible editors (Cursor, Antigravity, VSCodium). It is designed specifically for ebook developers, technical writers, and readers who work with XHTML, HTML, and EPUB files.

---

## 🌟 What's New in v0.0.1

### 1. 📖 First-Class EPUB Archive Support (`.epub`)
- Open binary `.epub` files directly as a Custom Editor without manual decompression.
- Built-in secure, zero-dependency streaming archive parser with ZIP-bomb protection and path-traversal guards.
- Automatic isolated workspace cache management with graceful cleanup.

### 2. 📁 EPUB 3 Folder Package Parser
- Automatically parses `META-INF/container.xml`, `package.opf`, navigation documents, NCX tables of contents, and spine sequences.
- Supports multi-chapter reading with sequential spine traversal.

### 3. 🔄 Dual Reading Modes
- **Continuous Scroll Mode**: Natural web-style reading with Moon+ Reader-inspired overscroll resistance and gesture-based chapter switching.
- **Paginated Reader Mode**: True multi-column ebook reader layout with column-aware paging and keyboard navigation (`←` / `→`).

### 4. 🧭 Table of Contents Drawer with Real-Time Search
- Slide-over TOC sidebar showing all book chapters and nested sections.
- Instant fuzzy search filtering (`/` hotkey) to jump to any section in seconds.

### 5. 🎨 Immersive UI & Typography Customization
- **Themes**: Dark, Light, and Sepia.
- **Font Families**: Serif (Georgia/Times), Sans-Serif (system-ui), and Monospace (Cascadia/Consolas).
- Customizable font size, line spacing (tight, normal, relaxed), and column width.
- Ultra-compact floating toolbar with official **Phosphor icons** and auto-collapsing immersive mode.

### 6. 📌 Anchored Footnote & Noteref Popovers
- Hover or click any footnote link or EPUB noteref to inspect notes in an anchored floating popover without losing your place in the text.

### 7. 💾 Reading Location & Progress Persistence
- Automatically remembers reading progress, scroll offset, and last opened chapter per book across IDE restarts.

---

## 📦 Download & Verification

| Asset | Size | SHA-256 Checksum |
| :--- | :--- | :--- |
| **`xhtml-reader-previewer-0.0.1.vsix`** | ~89.4 KB | `9E74D91FE677428892AA782CB68866830023ED61FF22FC73332A459C1E6A234A` |

---

## 🚀 How to Install

### Option A: From VS Code Marketplace (Recommended)
1. Open Extensions in VS Code (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **`XHTML Reader Previewer`** (by `selvagant`).
3. Click **Install**.

Or run in terminal:
```bash
code --install-extension selvagant.xhtml-reader-previewer
```

### Option B: Manual Installation via VSIX
1. Download `xhtml-reader-previewer-0.0.1.vsix` from the Assets below.
2. In VS Code, open the Extensions view (`Ctrl+Shift+X`).
3. Click the `...` menu (Views and More Actions) at the top of the Extensions pane.
4. Select **Install from VSIX...** and pick the downloaded file.

Or via terminal:
```bash
code --install-extension xhtml-reader-previewer-0.0.1.vsix
```

---

## 📄 License & Attribution
- Distributed under the [MIT License](LICENSE).
- Built with zero runtime dependencies.
- Copyright (c) 2026 **selvagant**.
