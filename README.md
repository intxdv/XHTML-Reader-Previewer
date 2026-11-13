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

The preview renders the active XHTML with its local images and stylesheets, uses a dark reader layout, refreshes when the XHTML file changes, follows same-folder XHTML links, and opens EPUB noterefs as popups. EPUB package parsing, pagination, persistent reader settings, and archive support remain in the phases described in [docs/implementation-plan.md](docs/implementation-plan.md).

## Design documents

- [Technical specification](docs/spec.md)
- [Implementation plan](docs/implementation-plan.md)
