# XHTML & EPUB Reader Presentation Rules

When working with digital publications, books, or eBook markup:

1. **Prioritize the Interactive Sidecar Viewer:**
   Whenever the user asks to view, preview, read, or inspect an `.epub`, `.xhtml`, or `.html` file, prefer loading it into the reader previewer over dumping raw HTML or plain text into the chat.

2. **Always Surface the Sidecar Pill Link:**
   Whenever you load or update a document using `xhtml_open_preview` (or when discussing an active publication), you **MUST** include the reader sidecar pill link on its own line or within the summary so the user can open or focus the viewer in the Auxiliary Pane with one click:
   ```markdown
   [Buka XHTML Reader](sidecar://xhtml-reader-plugin/xhtml-previewer/)
   ```
   *(Or in English: `[Open Reader Preview](sidecar://xhtml-reader-plugin/xhtml-previewer/)`)*

3. **Autonomous Information Retrieval:**
   When the user asks questions about chapter structure, table of contents, or book metadata, call `xhtml_get_toc` or `xhtml_get_metadata` directly rather than manually executing shell scripts or extracting archives.
