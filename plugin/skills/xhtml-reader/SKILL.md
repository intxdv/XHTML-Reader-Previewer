---
name: xhtml-reader
description: Live interactive preview and inspection of XHTML and EPUB publications inside Antigravity 2.0. Use when the user asks to preview, read, or inspect an EPUB book, XHTML chapter, or digital publication. Provides autonomous tools to open the reader preview in the Auxiliary Pane, inspect publication metadata, and retrieve the Table of Contents (TOC).
---

# XHTML & EPUB Reader Skill

This skill allows the agent to interact with and preview `.epub` archives, extracted EPUB directories, and standalone `.xhtml`/`.html` publications using the integrated **XHTML Reader Previewer Sidecar** and **MCP Tools**.

## When to Use

Activate this skill when:
- The user asks to preview, view, or read an `.epub`, `.xhtml`, or `.html` file.
- The user is editing or reviewing EPUB publication markup, CSS styles, or chapter layouts.
- The user wants to inspect a book's Table of Contents (TOC) or spine reading order without manually unzipping.
- The user asks for publication metadata (title, author, language, total chapters, manifest items).

## Autonomous MCP Tools

The plugin exposes 3 tools via the `xhtml_reader_mcp` server:

### 1. `xhtml_open_preview`
Opens a publication file inside the Antigravity Reader Sidecar and prepares the interactive reader shell in the Auxiliary Pane.

**Arguments:**
- `filePath` *(string, required)*: Absolute path or workspace-relative path to the `.epub` file, extracted EPUB directory, or `.xhtml` file.
- `spineIndex` *(number, optional)*: 0-based index of the spine chapter to open directly.
- `targetId` *(string, optional)*: Element or anchor ID to scroll into view upon loading.

**Always emit the Sidecar Pill Link:**
Whenever you call `xhtml_open_preview`, you MUST present the interactive sidecar pill link to the user in the response:
```markdown
[Buka XHTML Reader](sidecar://xhtml-reader-plugin/xhtml-previewer/)
```
*(Or in English: `[Open Reader Preview](sidecar://xhtml-reader-plugin/xhtml-previewer/)`)*

### 2. `xhtml_get_toc`
Extracts and parses the Table of Contents (`toc.xhtml` / `toc.ncx`) and spine reading sequence of an EPUB publication without opening the GUI.

**Arguments:**
- `filePath` *(string, required)*: Path to the publication.

**Use Case:** Quick chapter lookups, book structure analysis, or finding a specific chapter file path.

### 3. `xhtml_get_metadata`
Extracts publication metadata from the package document (`content.opf`).

**Arguments:**
- `filePath` *(string, required)*: Path to the publication.

**Returns:** Title, creator/author, language, identifier, publisher, date, spine chapter count, and total manifest resources.

## Best Practices & Guidelines

1. **Prefer Interactive Preview Over Raw Dumps:**
   When the user asks about an eBook or chapter, load it with `xhtml_open_preview` and share the `sidecar://` pill so the user can comfortably read it in the Auxiliary Pane alongside their code.
2. **Path Resolution:**
   Always provide a valid workspace-relative or absolute path. If the user mentions a file name casually (e.g. "preview ch1"), verify its existence first before calling `xhtml_open_preview`.
3. **Graceful Fallback:**
   If the Sidecar server is not yet active, the tool will return a helpful message with instructions to start `node dist/sidecar-server.cjs`. Inform the user or launch the sidecar accordingly.
