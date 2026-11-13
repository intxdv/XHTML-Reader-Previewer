import type * as vscodeTypes from 'vscode';

let vscodeModule: typeof import('vscode') | undefined;
try {
  vscodeModule = require('vscode');
} catch {
  // Allow running in pure Node.js environments (e.g. unit tests)
}

export interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
  uri: vscodeTypes.Uri;
}

export interface EpubSpineItem {
  idref: string;
  linear?: boolean;
  href: string;
  uri: vscodeTypes.Uri;
}

export interface EpubPackage {
  containerRoot: vscodeTypes.Uri;
  opfUri: vscodeTypes.Uri;
  opfDir: vscodeTypes.Uri;
  title: string;
  creator?: string;
  language?: string;
  manifest: Map<string, EpubManifestItem>;
  spine: EpubSpineItem[];
}

/**
 * Ascends from the given source file directory to locate a META-INF/container.xml file.
 */
export async function locateEpubContainer(source: vscodeTypes.Uri): Promise<vscodeTypes.Uri | undefined> {
  if (!vscodeModule) {
    return undefined;
  }
  let current = parentUri(source);
  const root = vscodeModule.workspace.workspaceFolders?.[0]?.uri;

  for (let i = 0; i < 6; i++) {
    const candidate = joinPath(current, 'META-INF', 'container.xml');
    try {
      await vscodeModule.workspace.fs.stat(candidate);
      return current;
    } catch {
      const parent = parentUri(current);
      if (parent.toString() === current.toString()) {
        break;
      }
      if (root && current.toString() === root.toString()) {
        break;
      }
      current = parent;
    }
  }
  return undefined;
}

/**
 * Extracts the full-path of the OPF package document from container.xml.
 */
export function parseContainerXml(xml: string): string | undefined {
  const match = /<rootfile\b[^>]*\bfull-path\s*=\s*(["'])([^"']+)\1/i.exec(xml);
  return match ? match[2].trim() : undefined;
}

/**
 * Safely parses the OPF Package Document into metadata, manifest, and spine.
 */
export function parseOpfXml(xml: string, opfUri: vscodeTypes.Uri, containerRoot: vscodeTypes.Uri): EpubPackage {
  const opfDir = parentUri(opfUri);

  // Metadata
  const titleMatch = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(xml);
  const title = titleMatch ? decodeXmlEntities(titleMatch[1].trim()) : 'Untitled EPUB';

  const creatorMatch = /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(xml);
  const creator = creatorMatch ? decodeXmlEntities(creatorMatch[1].trim()) : undefined;

  const langMatch = /<dc:language\b[^>]*>([\s\S]*?)<\/dc:language>/i.exec(xml);
  const language = langMatch ? decodeXmlEntities(langMatch[1].trim()) : undefined;

  // Manifest
  const manifest = new Map<string, EpubManifestItem>();
  const itemRegex = /<item\b([^>]+?)\/?>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const attrs = itemMatch[1];
    const id = getAttr(attrs, 'id');
    const href = getAttr(attrs, 'href');
    const mediaType = getAttr(attrs, 'media-type') || '';
    const properties = getAttr(attrs, 'properties');

    if (id && href) {
      const decodedHref = decodeURIComponent(href);
      const segments = decodedHref.split('/').filter((s) => s && s !== '.');
      const itemUri = joinPath(opfDir, ...segments);
      manifest.set(id, {
        id,
        href,
        mediaType,
        properties,
        uri: itemUri
      });
    }
  }

  // Spine
  const spine: EpubSpineItem[] = [];
  const spineBlockMatch = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(xml);
  if (spineBlockMatch) {
    const itemrefRegex = /<itemref\b([^>]+?)\/?>/gi;
    let refMatch: RegExpExecArray | null;

    while ((refMatch = itemrefRegex.exec(spineBlockMatch[1])) !== null) {
      const attrs = refMatch[1];
      const idref = getAttr(attrs, 'idref');
      const linear = getAttr(attrs, 'linear') !== 'no';

      if (idref) {
        const manifestItem = manifest.get(idref);
        if (manifestItem) {
          spine.push({
            idref,
            linear,
            href: manifestItem.href,
            uri: manifestItem.uri
          });
        }
      }
    }
  }

  return {
    containerRoot,
    opfUri,
    opfDir,
    title,
    creator,
    language,
    manifest,
    spine
  };
}

function getAttr(attrs: string, name: string): string | undefined {
  const regex = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i');
  const match = regex.exec(attrs);
  return match ? match[2] : undefined;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function parentUri(uri: vscodeTypes.Uri): vscodeTypes.Uri {
  const path = uri.path.slice(0, uri.path.lastIndexOf('/'));
  return uri.with ? uri.with({ path }) : ({ ...uri, path } as vscodeTypes.Uri);
}

function joinPath(base: vscodeTypes.Uri, ...segments: string[]): vscodeTypes.Uri {
  if (vscodeModule) {
    return vscodeModule.Uri.joinPath(base, ...segments);
  }
  const cleanBase = base.path.replace(/\/+$/, '');
  const cleanSegments = segments.map((s) => s.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  const newPath = cleanBase + '/' + cleanSegments.join('/');
  return {
    ...base,
    path: newPath,
    toString: () => newPath
  } as vscodeTypes.Uri;
}
