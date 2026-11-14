<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="XHTML Reader Previewer Logo" />
</p>

# XHTML Reader Previewer

A modern, immersive, and feature-rich XHTML, HTML, and EPUB reader and live previewer extension for VS Code and compatible IDEs.

Whether you are authoring ebooks, inspecting XHTML documents, or reading `.epub` files directly inside your editor, **XHTML Reader Previewer** provides a distraction-free, beautifully crafted reading experience.

---

## ✨ Key Features

- 📖 **EPUB Archive Support (`.epub`)**: Open binary `.epub` archives directly with zero manual extraction. Works seamlessly as a Custom Editor or through preview commands.
- 📁 **EPUB Folder Package Support**: Full parsing of extracted EPUB 3 folder packages (`package.opf`, nav doc, NCX, and spine).
- 🔄 **Dual Reading Modes**:
  - **Continuous Scroll**: Smooth web-like reading with natural overscroll resistance and gesture-based chapter transitions.
  - **Paginated Reader**: Multi-column book layout with page navigation and smooth pagination.
- 🧭 **Table of Contents (TOC) Sidebar**: Slide-over drawer with hierarchical navigation and live search filtering.
- 🎨 **Customizable Typography & Themes**:
  - Themes: **Dark**, **Light**, and **Sepia**
  - Font families: **Serif**, **Sans-Serif**, and **Monospace**
  - Adjust font sizes, line heights, and reading column widths on the fly.
- 📌 **Anchored Footnote & Noteref Popovers**: Hover or click footnote references to read notes without losing your reading position.
- 💾 **Reading Location Persistence**: Automatically remembers your exact reading progress, scroll offset, and last opened chapter per book.
- ⚡ **Ultra-Compact Immersive UI**: Floating, auto-collapsing toolbar with official Phosphor icons and ghost aesthetics.

---

## 🚀 Getting Started

### Open Preview
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
| **Next / Previous Chapter** | `]` / `[` or Header Navigation Buttons |
| **Toggle Table of Contents** | `T` or Click Contents Button |
| **Quick Search TOC** | `/` (focuses TOC search input) |
| **Open Settings** | `S` or Click Settings Icon |
| **Natural Chapter Scroll Transition** | Scroll past chapter boundaries (Overscroll) |

---

## 🛠️ Development & Building

```bash
# Install dependencies
npm install

# Type check
npm run check

# Run test suite
npm test

# Build extension
npm run build
```

---

## 📄 License

[MIT License](LICENSE) © 2026 selvagant
