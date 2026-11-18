# XHTML & EPUB Reader — Antigravity 2.0 Plugin

Interactive reader previewer for EPUB and XHTML publications with native Antigravity 2.0 Auxiliary Pane sidecar and autonomous MCP agent tools.

## Features
- **Auxiliary Pane Sidecar UI (`sidecar://xhtml-reader-plugin/xhtml-previewer/`)**:
  - Standalone reader shell served over lightweight local HTTP server.
  - Responsive layout tailored for narrow auxiliary pane (~320px - 480px).
  - Light, Dark, and Sepia themes, multi-column paginated & continuous scroll modes, typography controls, and Moon+ Reader style continuous overscroll transitions.
  - Heuristic & semantic cross-file footnote preview popovers.
  - Live Server-Sent Events (SSE) synchronization.
- **Model Context Protocol (MCP) Tools**:
  - `xhtml_open_preview`: Autonomous document loading into the Sidecar previewer.
  - `xhtml_get_toc`: Autonomous Table of Contents and spine inspection.
  - `xhtml_get_metadata`: Publication metadata extraction (title, creator, language, spine count).

## Quick Start
1. Ensure bundles are built:
   ```bash
   npm run build
   ```
2. Install the plugin into local Antigravity config:
   ```bash
   node scripts/install-plugin.js
   ```
3. Open Antigravity 2.0 and ask the agent:
   > *"Show me a preview of sample-book/OEBPS/ch_1.xhtml"*
