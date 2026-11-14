<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="XHTML Reader Previewer Logo" />
</p>

# XHTML Reader Previewer

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=selvagant.xhtml-reader-previewer"><img src="https://img.shields.io/visual-studio-marketplace/v/selvagant.xhtml-reader-previewer?style=flat-square&color=blue&label=VS%20Marketplace" alt="Marketplace Version"></a>
  <a href="https://github.com/intxdv/XHTML-Reader-Previewer/releases/latest"><img src="https://img.shields.io/github/v/release/intxdv/XHTML-Reader-Previewer?style=flat-square&color=emerald&label=GitHub%20Release" alt="GitHub Release"></a>
  <a href="https://github.com/intxdv/XHTML-Reader-Previewer/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/intxdv/XHTML-Reader-Previewer/ci.yml?branch=main&style=flat-square&label=CI" alt="Build Status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/vscode-^1.95.0-purple.svg?style=flat-square" alt="VS Code Compatibility">
</p>

A modern, immersive, and feature-rich XHTML, HTML, and EPUB reader and live previewer extension for VS Code and compatible IDEs (Antigravity, Cursor, VSCodium).

Whether you are authoring ebooks, inspecting XHTML documents, or reading `.epub` files directly inside your editor, **XHTML Reader Previewer** provides a distraction-free, beautifully crafted reading experience with dual reading modes, customizable typography, and instant footnote inspection.

---

## 📥 Installation

### Option 1: Visual Studio Marketplace
1. Open VS Code extensions pane (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **`XHTML Reader Previewer`** (by `selvagant`).
3. Click **Install**.

Or install directly via CLI:
```bash
code --install-extension selvagant.xhtml-reader-previewer
```

### Option 2: Direct VSIX Download (GitHub Release)
Download the standalone `.vsix` installer from the [Latest GitHub Release](https://github.com/intxdv/XHTML-Reader-Previewer/releases/latest).

To install manually:
```bash
code --install-extension xhtml-reader-previewer-0.0.1.vsix
```
*Or via VS Code UI: Extensions View ➔ Click `...` (More Actions) ➔ **Install from VSIX...** ➔ Select the downloaded file.*

---

## ✨ Key Features

- 📖 **EPUB Archive Support (`.epub`)**: Open binary `.epub` archives directly with zero manual extraction. Works seamlessly as a Custom Editor or through preview commands.
- 📁 **EPUB Folder Package Support**: Full parsing of extracted EPUB 3 folder packages (`package.opf`, nav doc, NCX, and spine sequence).
- 🔄 **Dual Reading Modes**:
  - **Continuous Scroll**: Smooth web-like reading with natural overscroll resistance and gesture-based chapter transitions (Moon+ Reader style).
  - **Paginated Reader**: Clean multi-column book layout with page navigation and smooth pagination.
- 🧭 **Table of Contents (TOC) Sidebar**: Slide-over drawer with hierarchical navigation and live search filtering.
- 🎨 **Customizable Typography & Themes**:
  - Themes: **Dark**, **Light**, and **Sepia**
  - Font families: **Serif**, **Sans-Serif**, and **Monospace**
  - Adjust font sizes, line heights, and reading column widths on the fly.
- 📌 **Anchored Footnote & Noteref Popovers**: Hover or click footnote references to read notes without losing your reading position.
- 💾 **Reading Location Persistence**: Automatically remembers your exact reading progress, scroll offset, and last opened chapter per book across sessions.
- ⚡ **Ultra-Compact Immersive UI**: Floating, auto-collapsing toolbar with official Phosphor icons and ghost aesthetics.

---

## 🚀 Usage

### Preview Active File
Right-click any `.xhtml`, `.html`, `.htm`, or `.epub` file in the Explorer, or click the preview button in the editor title bar:
- **`XHTML Reader: Open Preview`**
- **`XHTML Reader: Open Split Preview`**

### Custom Editor Integration
Double-click any `.epub` file in your workspace to open it immediately in the dedicated reader view.

---

## ⌨️ Shortcuts & Navigation

| Action | Shortcut / Gesture |
| :--- | :--- |
| **Next / Previous Page (Paginated)** | `→` / `←` or `PageDown` / `PageUp` |
| **Next / Previous Chapter** | `]` / `[` or Header Navigation Buttons (`‹` / `›`) |
| **Toggle Table of Contents** | `T` or Click Contents Button |
| **Quick Search TOC** | `/` (focuses TOC search input) |
| **Open Settings** | `S` or Click Settings Icon |
| **Natural Chapter Scroll Transition** | Scroll past top/bottom boundaries (Overscroll) |

---

## 🛠️ Development & Building

```bash
# Install dependencies
npm install

# Type check
npm run check

# Run unit tests
npm test

# Build extension bundles
npm run build

# Package local VSIX
npx @vscode/vsce package
```

---

## 🔒 Security & Privacy

- **Local Execution**: No telemetry, no external network requests, zero remote scripts.
- **Strict Content Security Policy (CSP)**: Dynamic HTML is safely rendered with nonces and sandbox isolation.
- **Resource Protection**: Path traversal checks and ZIP bomb prevention built into the archive reader.

---

## 📄 License

Distributed under the [MIT License](LICENSE).  
Copyright (c) 2026 **selvagant**.
