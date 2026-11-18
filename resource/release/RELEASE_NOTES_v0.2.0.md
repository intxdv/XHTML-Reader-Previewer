# XHTML Reader Previewer v0.2.0

We are pleased to announce the release of **XHTML Reader Previewer** (`v0.2.0`)! 🎉

This release represents a major milestone: **Dual-Target Support**. In addition to being a full-featured VS Code and Cursor extension, XHTML Reader Previewer is now officially a **Google Antigravity 2.0 Plugin**. It provides an autonomous Model Context Protocol (MCP) server, an interactive Auxiliary Pane Sidecar, and shared, zero-dependency pure core parsing engine.

---

## 🌟 What's New in v0.2.0

### 1. 🤖 Google Antigravity 2.0 Native Plugin
- **Auxiliary Pane Sidecar**: Open and preview EPUB books and XHTML documents in Antigravity's Auxiliary side panel with one-click pill links (`sidecar://xhtml-reader-plugin/xhtml-previewer/`).
- **Autonomous MCP Server (`xhtml_reader_mcp`)**: Three official STDIO tools for AI agents:
  - `xhtml_open_preview`: Open documents inside the reader previewer UI.
  - `xhtml_get_toc`: Query chapter structure and reading order without opening GUI.
  - `xhtml_get_metadata`: Extract publication metadata (title, creator, language, chapter count).
- **Agent Skill & Rules**: Built-in `skills/xhtml-reader/SKILL.md` and `rules/AGENTS.md` guiding AI assistants to present interactive sidecar links whenever interacting with digital books.
- **One-Command Local Deployment**: Run `npm run deploy:local-plugin` to deploy to `~/.gemini/config/plugins/xhtml-reader-plugin`.

### 2. 🗂️ Multi-Workspace Isolation & Interactive File Picker
- **Multi-Workspace Isolation**: Reader sessions and workspace file scanning are isolated per-workspace (`Map<workspaceKey, LoadedBookState>`), completely preventing cross-workspace file contamination.
- **Dynamic Host Workspace Synchronization**: Listens to Antigravity `workspace-change` events and updates automatically.
- **Close Book Action**: Added a return-to-folder action in the reader toolbar to close the active book and return to the workspace launcher.

### 3. 🎨 Impeccable Empty State & Live Search Filter
- **Natural Numeric Sort**: Files and chapters are sorted naturally (`ch_1`, `ch_2`, ..., `ch_10`, ..., `ch_100`) using `{ numeric: true }` rather than ASCII alphabetical order.
- **Instant Search / Live Filter**: Instant filtering input for massive publications (tested with 557-chapter web novels).
- **Clickable Row Design**: Replaced repetitive action buttons with full-card clickable rows (`cursor: pointer`), dynamic hover arrows, and tactile click feedback.
- **Soft Translucent Badges**: Restyled `[EPUB]` (blue) and `[XHTML]` (purple) pills with soft translucent backgrounds and crisp typography.

### 4. ⚙️ Dual-Target Build Pipeline & Lean VSIX Packaging
- Unified build scripts in `package.json`: `build:all`, `build:vscode`, `build:plugin`, `check:core`, and `package:vsix`.
- Strict packaging audit in `.vscodeignore` excluding Antigravity bundles and test fixtures. The resulting `.vsix` contains only 11 essential files (~100.8 KB).

---

## 🔄 Improvements & Polish
- **[Core] Pure Architecture**: `src/core/` is 100% decoupled from `vscode` API, verified by `tsconfig.core.json` and `npm run check:core`.
- **[Sidecar] Security & Path Traversal Guards**: Strict path checks prevent asset extraction outside the loaded book directory.
- **[UI] Responsive Design**: Adapted layouts for both narrow sidebars and full-screen editor views.

---

## 🐛 Bug Fixes
- **[Sidecar] Windows Drive Letter Normalization**: Resolved case sensitivity issues (`D:` vs `d:`) when matching workspace root paths on Windows.
- **[Sidecar] File Type Badge Logic**: Fixed issue where chapter files inside `OEBPS` subfolders were erroneously flagged with `EPUB` badges instead of `XHTML`.

---

## 🧪 Testing & Reliability
- **67 Automated Tests Passing**:
  - Full suite covering ArchiveReader, OPF/NCX/NAV parsers, MCP server handshake and tools, Antigravity plugin manifests, reader shell, and sidecar HTTP server.
  - Zero TypeScript compile errors (`tsc --noEmit`).

---

## 📦 Installation & Verification

### Option 1: From VS Code Marketplace / Open VSX
Search for **`XHTML Reader Previewer`** (by `selvagant`) and click **Install**.

Or run in terminal:
```bash
code --install-extension selvagant.xhtml-reader-previewer
```

### Option 2: Standalone VSIX (GitHub Release)
Download `xhtml-reader-previewer-0.2.0.vsix` from GitHub Release assets, then run:
```bash
code --install-extension xhtml-reader-previewer-0.2.0.vsix
```

### Option 3: Google Antigravity 2.0 Plugin
Deploy to your local Antigravity installation:
```bash
npm run deploy:local-plugin
```

---

## 📄 Full Changelog
Compare commits: https://github.com/intxdv/XHTML-Reader-Previewer/compare/v0.1.0...v0.2.0
