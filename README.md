<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="XHTML Reader Previewer Logo" />
</p>

# XHTML Reader Previewer

Starter workspace for a VS Code-compatible XHTML and EPUB reader extension.

## Setup

```powershell
npm install
npm run check
npm run build
```

Open this folder in VS Code, press `F5`, then run either command:

- `XHTML Reader: Open Preview`
- `XHTML Reader: Open Split Preview`

The preview renders the active XHTML with its local images and stylesheets, uses a dark reader layout, refreshes when the XHTML file changes, follows same-folder XHTML links, and opens EPUB noterefs as popups. EPUB package parsing, pagination, persistent reader settings, and archive support remain in the phases described in [resource/specs/implementation-plan.md](resource/specs/implementation-plan.md).

## Design documents

- [Technical specification](resource/specs/spec.md)
- [Implementation plan](resource/specs/implementation-plan.md)
