export interface ResourceUri {
  path: string;
  fsPath?: string;
  scheme?: string;
  toString(): string;
  with?(change: { path?: string }): ResourceUri;
}

export function createResourceUri(filePath: string): ResourceUri {
  const normalized = filePath.replace(/\\/g, '/');
  return {
    path: normalized,
    fsPath: filePath,
    scheme: 'file',
    toString: () => normalized,
    with: (change: { path?: string }) => createResourceUri(change.path ?? normalized)
  };
}

export interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
  uri: ResourceUri;
}

export interface EpubSpineItem {
  idref: string;
  linear?: boolean;
  href: string;
  uri: ResourceUri;
}

export interface EpubTocItem {
  id?: string;
  label: string;
  href: string;
  uri: ResourceUri;
}

export interface EpubPackage {
  containerRoot: ResourceUri;
  opfUri: ResourceUri;
  opfDir: ResourceUri;
  title: string;
  creator?: string;
  language?: string;
  manifest: Map<string, EpubManifestItem>;
  spine: EpubSpineItem[];
  toc: EpubTocItem[];
}

/**
 * Ascends from the given source file directory to locate a META-INF/container.xml file.
 */
export async function locateEpubContainer(
  source: ResourceUri,
  fileExists?: (candidate: ResourceUri) => Promise<boolean>
): Promise<ResourceUri | undefined> {
  const checkExists = fileExists ?? (async (candidate: ResourceUri) => {
    try {
      const fs = await import('node:fs/promises');
      const targetPath = candidate.fsPath || candidate.path;
      await fs.stat(targetPath);
      return true;
    } catch {
      return false;
    }
  });

  let current = parentUri(source);

  for (let i = 0; i < 6; i++) {
    const candidate = joinPath(current, 'META-INF', 'container.xml');
    try {
      if (await checkExists(candidate)) {
        return current;
      }
    } catch {
      // ignore
    }
    const parent = parentUri(current);
    if (parent.toString() === current.toString()) {
      break;
    }
    current = parent;
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
export function parseOpfXml(xml: string, opfUri: ResourceUri, containerRoot: ResourceUri): EpubPackage {
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
    spine,
    toc: []
  };
}

/**
 * Parses EPUB 3 Navigation Document XHTML into TOC items.
 */
export function parseNavHtml(html: string, baseDir: ResourceUri): EpubTocItem[] {
  const items: EpubTocItem[] = [];
  // Find <nav> with epub:type="toc" or id="toc", or fallback to any nav
  const navMatch = /<nav\b(?=[^>]*\b(?:epub:type=["'][^"']*toc|id=["']toc))\b[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
    || /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
    || /<div\b(?=[^>]*\bid=["']chapters["'])[^>]*>([\s\S]*?)<\/div>/i.exec(html)
    || /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);

  const content = navMatch ? navMatch[1] : html;
  const linkRegex = /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(content)) !== null) {
    const rawHref = match[2].trim();
    const rawLabel = match[3].replace(/<[^>]+>/g, '').trim();
    if (!rawHref || !rawLabel) continue;

    const label = decodeXmlEntities(rawLabel);
    const decodedHref = decodeURIComponent(rawHref.split('#')[0]);
    const segments = decodedHref.split('/').filter((s) => s && s !== '.');
    const uri = joinPath(baseDir, ...segments);

    items.push({
      label,
      href: rawHref,
      uri
    });
  }

  return items;
}

/**
 * Parses EPUB 2 NCX XML into TOC items.
 */
export function parseNcxXml(xml: string, baseDir: ResourceUri): EpubTocItem[] {
  const items: EpubTocItem[] = [];
  const navPointRegex = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
  let pointMatch: RegExpExecArray | null;

  while ((pointMatch = navPointRegex.exec(xml)) !== null) {
    const pointContent = pointMatch[1];
    const textMatch = /<navLabel>\s*<text\b[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>/i.exec(pointContent);
    const srcMatch = /<content\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/i.exec(pointContent);

    if (textMatch && srcMatch) {
      const label = decodeXmlEntities(textMatch[1].trim());
      const rawHref = srcMatch[2].trim();
      const decodedHref = decodeURIComponent(rawHref.split('#')[0]);
      const segments = decodedHref.split('/').filter((s) => s && s !== '.');
      const uri = joinPath(baseDir, ...segments);

      items.push({
        label,
        href: rawHref,
        uri
      });
    }
  }

  return items;
}

/**
 * Discovers and parses the TOC for an EPUB package.
 */
export async function loadEpubToc(
  epub: EpubPackage,
  readFileText: (uri: ResourceUri) => Promise<string>
): Promise<EpubTocItem[]> {
  // 1. Try finding nav item in manifest with properties="nav"
  for (const item of epub.manifest.values()) {
    if (item.properties && item.properties.split(/\s+/).includes('nav')) {
      try {
        const html = await readFileText(item.uri);
        const parsed = parseNavHtml(html, parentUri(item.uri));
        if (parsed.length > 0) return parsed;
      } catch (err) {
        console.warn('Error reading nav XHTML:', err);
      }
    }
  }

  // 2. Try item with id="toc" or href ending with toc.html / toc.xhtml
  const tocHtmlItem = epub.manifest.get('toc')
    || [...epub.manifest.values()].find((it) => /toc\.(?:x?html|htm)$/i.test(it.href));
  if (tocHtmlItem) {
    try {
      const html = await readFileText(tocHtmlItem.uri);
      const parsed = parseNavHtml(html, parentUri(tocHtmlItem.uri));
      if (parsed.length > 0) return parsed;
    } catch (err) {
      console.warn('Error reading toc.html:', err);
    }
  }

  // 3. Try NCX item (id="ncx" or media-type="application/x-dtbncx+xml" or toc.ncx)
  const ncxItem = epub.manifest.get('ncx')
    || [...epub.manifest.values()].find((it) => it.mediaType.includes('ncx') || it.href.endsWith('.ncx'));
  if (ncxItem) {
    try {
      const xml = await readFileText(ncxItem.uri);
      const parsed = parseNcxXml(xml, parentUri(ncxItem.uri));
      if (parsed.length > 0) return parsed;
    } catch (err) {
      console.warn('Error reading toc.ncx:', err);
    }
  }

  // 4. Fallback: generate from spine items
  return epub.spine.map((sp, idx) => ({
    label: `Chapter ${idx + 1} (${sp.href})`,
    href: sp.href,
    uri: sp.uri
  }));
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

export function parentUri(uri: ResourceUri): ResourceUri {
  const path = uri.path.slice(0, uri.path.lastIndexOf('/'));
  return uri.with ? uri.with({ path }) : {
    ...uri,
    path,
    toString: () => path
  };
}

export function joinPath(base: ResourceUri, ...segments: string[]): ResourceUri {
  const cleanBase = base.path.replace(/\/+$/, '');
  const cleanSegments = segments.map((s) => s.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  const newPath = cleanBase + '/' + cleanSegments.join('/');
  return base.with ? base.with({ path: newPath }) : {
    ...base,
    path: newPath,
    toString: () => newPath
  };
}
