import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { ArchiveReader } from '../core/archive';
import {
  parseContainerXml,
  parseOpfXml,
  loadEpubToc,
  locateEpubContainer,
  createResourceUri,
  ResourceUri,
  EpubPackage
} from '../core/epub';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'xhtml_open_preview',
    description: 'Open an EPUB or XHTML document inside the Antigravity Reader Sidecar UI and return a sidecar link to preview it in the Auxiliary Pane.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or workspace-relative path to the .epub file, extracted EPUB directory, or standalone .xhtml file.'
        },
        spineIndex: {
          type: 'number',
          description: 'Optional 0-based spine chapter index to jump directly to upon loading.'
        },
        targetId: {
          type: 'string',
          description: 'Optional anchor/element ID to scroll into view upon loading.'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'xhtml_get_toc',
    description: 'Inspect and retrieve the hierarchical Table of Contents (TOC) and spine chapter list of an EPUB or XHTML publication without opening the GUI.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or workspace-relative path to the .epub file, extracted EPUB directory, or standalone .xhtml file.'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'xhtml_get_metadata',
    description: 'Extract publication metadata (title, author/creator, language, identifier, total chapters, manifest items) from an EPUB publication.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute or workspace-relative path to the .epub file, extracted EPUB directory, or standalone .xhtml file.'
        }
      },
      required: ['filePath']
    }
  }
];

export interface LoadedEpubData {
  title: string;
  creator?: string;
  language?: string;
  identifier?: string;
  description?: string;
  publisher?: string;
  date?: string;
  epubPackage?: EpubPackage;
  isArchive: boolean;
  isExtracted: boolean;
}

export class McpServer {
  private stdin: NodeJS.ReadableStream;
  private stdout: NodeJS.WritableStream;
  private buffer = '';

  constructor(stdin: NodeJS.ReadableStream = process.stdin, stdout: NodeJS.WritableStream = process.stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
  }

  public start(): void {
    this.stdin.setEncoding('utf-8');
    this.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      let lineEndIndex: number;
      while ((lineEndIndex = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, lineEndIndex).trim();
        this.buffer = this.buffer.slice(lineEndIndex + 1);
        if (line) {
          void this.processLine(line);
        }
      }
    });

    this.stdin.on('end', () => {
      // Stream ended
    });
  }

  public async processLine(line: string): Promise<void> {
    const response = await this.handleMessage(line);
    if (response) {
      this.stdout.write(response + '\n');
    }
  }

  public async handleMessage(rawMessage: string): Promise<string | null> {
    let req: any;
    try {
      req = JSON.parse(rawMessage);
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      });
    }

    if (!req || typeof req !== 'object') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' }
      });
    }

    const { id, method, params } = req;

    // Notifications (no id)
    if (id === undefined || id === null) {
      // E.g. notifications/initialized
      return null;
    }

    switch (method) {
      case 'initialize':
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'xhtml-reader-previewer-mcp',
              version: '0.1.0'
            }
          }
        });

      case 'ping':
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {}
        });

      case 'tools/list':
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            tools: MCP_TOOLS
          }
        });

      case 'tools/call':
        if (!params || typeof params.name !== 'string') {
          return JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' }
          });
        }
        try {
          const res = await this.executeTool(params.name, params.arguments || {});
          return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: res.text
                }
              ],
              isError: res.isError
            }
          });
        } catch (err: any) {
          return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Execution error: ${err.message || String(err)}`
                }
              ],
              isError: true
            }
          });
        }

      default:
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        });
    }
  }

  public async executeTool(name: string, args: Record<string, any>): Promise<{ text: string; isError: boolean }> {
    switch (name) {
      case 'xhtml_open_preview':
        return this.handleOpenPreview(args);
      case 'xhtml_get_toc':
        return this.handleGetToc(args);
      case 'xhtml_get_metadata':
        return this.handleGetMetadata(args);
      default:
        return {
          text: `Unknown tool: "${name}". Available tools: ${MCP_TOOLS.map((t) => t.name).join(', ')}`,
          isError: true
        };
    }
  }

  private async handleOpenPreview(args: Record<string, any>): Promise<{ text: string; isError: boolean }> {
    const rawPath = args.filePath;
    if (!rawPath || typeof rawPath !== 'string') {
      return { text: 'Error: Missing required argument "filePath"', isError: true };
    }

    const resolvedPath = path.resolve(rawPath);
    try {
      await fsp.access(resolvedPath, fs.constants.R_OK);
    } catch {
      return { text: `Error: File not found or unreadable: "${rawPath}" (resolved: "${resolvedPath}")`, isError: true };
    }

    const port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) || 5890;
    const sidecarApiUrl = `http://127.0.0.1:${port}/api/open`;
    const sidecarPillLink = 'sidecar://xhtml-reader-plugin/xhtml-previewer/';
    const localWebUrl = `http://127.0.0.1:${port}/`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(sidecarApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: resolvedPath,
          spineIndex: args.spineIndex,
          targetId: args.targetId
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        return {
          text: `Sidecar server returned HTTP ${res.status}: ${errorText}`,
          isError: true
        };
      }

      const json = await res.json() as any;
      const title = json.title || path.basename(resolvedPath);
      const chapters = json.totalChapters ?? 1;
      const isEpub = Boolean(json.isEpub);

      const text = [
        `📖 **Document successfully loaded into XHTML Reader Previewer!**`,
        ``,
        `- **Title:** ${title}`,
        `- **Format:** ${isEpub ? 'EPUB Publication' : 'Standalone XHTML / HTML'}`,
        `- **Total Chapters:** ${chapters}`,
        `- **File Path:** \`${resolvedPath}\``,
        args.spineIndex !== undefined ? `- **Initial Spine Index:** ${args.spineIndex}` : '',
        args.targetId ? `- **Target Fragment:** \`#${args.targetId}\`` : '',
        ``,
        `🔗 **Open in Auxiliary Pane:** [Open Reader Preview](${sidecarPillLink})`,
        `🌐 **Direct Browser URL:** ${localWebUrl}`
      ].filter(Boolean).join('\n');

      return { text, isError: false };
    } catch (err: any) {
      return {
        text: [
          `⚠️ **Could not connect to Antigravity Sidecar Server on port ${port}.**`,
          `The document at \`${resolvedPath}\` exists, but the preview server is not currently reachable.`,
          ``,
          `*To start the Sidecar server manually, run:*`,
          `\`node dist/sidecar-server.cjs\``,
          ``,
          `Error detail: ${err.message || String(err)}`
        ].join('\n'),
        isError: true
      };
    }
  }

  private async handleGetToc(args: Record<string, any>): Promise<{ text: string; isError: boolean }> {
    const rawPath = args.filePath;
    if (!rawPath || typeof rawPath !== 'string') {
      return { text: 'Error: Missing required argument "filePath"', isError: true };
    }

    const resolvedPath = path.resolve(rawPath);
    try {
      await fsp.access(resolvedPath, fs.constants.R_OK);
    } catch {
      return { text: `Error: File not found or unreadable: "${rawPath}" (resolved: "${resolvedPath}")`, isError: true };
    }

    try {
      const epubData = await this.extractEpubData(resolvedPath);

      if (!epubData.epubPackage) {
        // Standalone file
        const text = [
          `# Table of Contents: ${epubData.title}`,
          `*Single document publication (no EPUB manifest)*`,
          ``,
          `1. [${epubData.title}](${path.basename(resolvedPath)})`
        ].join('\n');
        return { text, isError: false };
      }

      const pkg = epubData.epubPackage;
      const lines: string[] = [
        `# 📑 Table of Contents: ${pkg.title}`,
        `- **Spine Items (Reading Sequence):** ${pkg.spine.length} chapters`,
        `- **Navigation Items (TOC):** ${pkg.toc.length} items`,
        ``
      ];

      if (pkg.toc.length > 0) {
        lines.push(`### 📚 Navigation TOC:`);
        pkg.toc.forEach((item, index) => {
          lines.push(`${index + 1}. **${item.label}** (\`${item.href}\`)`);
        });
        lines.push('');
      }

      lines.push(`### 📄 Spine Order:`);
      pkg.spine.forEach((sp, idx) => {
        lines.push(`${idx + 1}. \`${sp.href}\` (idref: \`${sp.idref}\`${sp.linear === false ? ', non-linear' : ''})`);
      });

      return { text: lines.join('\n'), isError: false };
    } catch (err: any) {
      return {
        text: `Error parsing TOC from "${rawPath}": ${err.message || String(err)}`,
        isError: true
      };
    }
  }

  private async handleGetMetadata(args: Record<string, any>): Promise<{ text: string; isError: boolean }> {
    const rawPath = args.filePath;
    if (!rawPath || typeof rawPath !== 'string') {
      return { text: 'Error: Missing required argument "filePath"', isError: true };
    }

    const resolvedPath = path.resolve(rawPath);
    try {
      await fsp.access(resolvedPath, fs.constants.R_OK);
    } catch {
      return { text: `Error: File not found or unreadable: "${rawPath}" (resolved: "${resolvedPath}")`, isError: true };
    }

    try {
      const epubData = await this.extractEpubData(resolvedPath);

      if (!epubData.epubPackage) {
        const stat = await fsp.stat(resolvedPath);
        const text = [
          `# 📖 Publication Metadata: ${epubData.title}`,
          `- **Type:** Standalone XHTML / HTML Document`,
          `- **File Path:** \`${resolvedPath}\``,
          `- **File Size:** ${(stat.size / 1024).toFixed(1)} KB`,
          `- **Modified:** ${stat.mtime.toISOString()}`
        ].join('\n');
        return { text, isError: false };
      }

      const pkg = epubData.epubPackage;
      const text = [
        `# 📖 Publication Metadata: ${pkg.title}`,
        `- **Title:** ${pkg.title}`,
        `- **Creator / Author:** ${pkg.creator || 'Unknown'}`,
        `- **Language:** ${pkg.language || 'Unknown'}`,
        epubData.identifier ? `- **Identifier:** ${epubData.identifier}` : '',
        epubData.publisher ? `- **Publisher:** ${epubData.publisher}` : '',
        epubData.date ? `- **Date:** ${epubData.date}` : '',
        epubData.description ? `- **Description:** ${epubData.description}` : '',
        `- **Spine Chapters:** ${pkg.spine.length}`,
        `- **Manifest Resources:** ${pkg.manifest.size}`,
        `- **TOC Entries:** ${pkg.toc.length}`,
        `- **Format:** ${epubData.isArchive ? 'EPUB Archive (.epub)' : 'Extracted EPUB Directory'}`
      ].filter(Boolean).join('\n');

      return { text, isError: false };
    } catch (err: any) {
      return {
        text: `Error extracting metadata from "${rawPath}": ${err.message || String(err)}`,
        isError: true
      };
    }
  }

  private async extractEpubData(resolvedPath: string): Promise<LoadedEpubData> {
    const stat = await fsp.stat(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();

    // 1. .epub ZIP Archive
    if (!stat.isDirectory() && ext === '.epub') {
      const buf = await fsp.readFile(resolvedPath);
      const archive = new ArchiveReader(buf);

      if (!archive.hasEntry('META-INF/container.xml')) {
        throw new Error('Invalid EPUB archive: META-INF/container.xml not found');
      }

      const containerXml = archive.readEntry('META-INF/container.xml').toString('utf-8');
      const opfRelPath = parseContainerXml(containerXml);
      if (!opfRelPath) {
        throw new Error('Invalid EPUB: no rootfile full-path found in container.xml');
      }

      if (!archive.hasEntry(opfRelPath)) {
        throw new Error(`OPF package document "${opfRelPath}" not found in archive`);
      }

      const opfXml = archive.readEntry(opfRelPath).toString('utf-8');
      const opfUri = createResourceUri(opfRelPath);
      const rootUri = createResourceUri('');
      const epubPackage = parseOpfXml(opfXml, opfUri, rootUri);

      epubPackage.toc = await loadEpubToc(epubPackage, async (uri) => {
        const cleanRel = (uri.fsPath || uri.path).replace(/^[/\\]+/, '').replace(/\\/g, '/');
        if (archive.hasEntry(cleanRel)) {
          return archive.readEntry(cleanRel).toString('utf-8');
        }
        return '';
      });

      return {
        title: epubPackage.title,
        creator: epubPackage.creator,
        language: epubPackage.language,
        epubPackage,
        isArchive: true,
        isExtracted: false
      };
    }

    // 2. Extracted EPUB Directory or individual file inside EPUB
    let containerRootPath: string | undefined;
    if (stat.isDirectory()) {
      const containerFile = path.join(resolvedPath, 'META-INF', 'container.xml');
      try {
        await fsp.access(containerFile, fs.constants.R_OK);
        containerRootPath = resolvedPath;
      } catch {
        // Not a root
      }
    } else {
      const foundContainer = await locateEpubContainer(createResourceUri(resolvedPath));
      if (foundContainer) {
        containerRootPath = foundContainer.fsPath || foundContainer.path;
      }
    }

    if (containerRootPath) {
      const containerFile = path.join(containerRootPath, 'META-INF', 'container.xml');
      const containerXml = await fsp.readFile(containerFile, 'utf-8');
      const opfRelPath = parseContainerXml(containerXml);
      if (!opfRelPath) {
        throw new Error('Invalid EPUB: no rootfile full-path in container.xml');
      }

      const opfPath = path.join(containerRootPath, ...opfRelPath.split('/').filter(Boolean));
      const opfXml = await fsp.readFile(opfPath, 'utf-8');
      const opfUri = createResourceUri(opfPath);
      const rootUri = createResourceUri(containerRootPath);
      const epubPackage = parseOpfXml(opfXml, opfUri, rootUri);

      epubPackage.toc = await loadEpubToc(epubPackage, async (uri) => {
        return fsp.readFile(uri.fsPath || uri.path, 'utf-8');
      });

      return {
        title: epubPackage.title,
        creator: epubPackage.creator,
        language: epubPackage.language,
        epubPackage,
        isArchive: false,
        isExtracted: true
      };
    }

    // 3. Standalone file
    return {
      title: path.basename(resolvedPath),
      isArchive: false,
      isExtracted: false
    };
  }
}

// Entrypoint when run directly via Node CLI
if (require.main === module) {
  const server = new McpServer();
  server.start();
}
