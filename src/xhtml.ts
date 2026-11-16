const blockedElements = /<(script|iframe|object|embed|form|base)\b[^>]*>[\s\S]*?<\/\1\s*>|<(script|iframe|object|embed|form|base)\b[^>]*\/?\s*>/gi;
const eventAttributes = /\s+on[a-z0-9-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const javascriptUrls = /\s+(?:href|src)\s*=\s*(["'])\s*javascript:[^"']*\1/gi;

export function sanitizeXhtml(markup: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(markup)?.[1] ?? markup;
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(markup)?.[1] ?? '';
  const styles = head.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) ?? [];
  const styleSheets = head.match(/<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet\b)[^>]*>/gi) ?? [];

  return [...styles, ...styleSheets, body]
    .join('\n')
    .replace(blockedElements, '')
    .replace(eventAttributes, '')
    .replace(javascriptUrls, '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cleans extracted footnote markup by removing back-references, return arrows,
 * unwrapping self-referential anchors, and sanitizing.
 */
export function cleanFootnoteMarkup(markup: string): string {
  const cleaned = markup
    .replace(/<a\b[^>]*(?:role=["'][^"']*doc-backlink[^"']*|epub:type=["'][^"']*backlink[^"']*|class=["'][^"']*(?:footnote-backref|backlink)[^"']*)[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/[\s\u00A0]*[\u21A9\u2191\u21B5][\s\u00A0]*/g, '')
    .replace(/<a\b[^>]*\bhref=["']#[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, '$1');

  return sanitizeXhtml(cleaned).trim();
}

/**
 * Extracts the element matching `targetId` from raw XHTML/HTML content.
 * Handles block elements (<aside>, <li>, <p>, <div>, <dd>) and inline anchors inside blocks.
 */
export function extractElementById(xhtml: string, targetId: string): string | undefined {
  if (!xhtml || !targetId) return undefined;

  const decodedId = decodeURIComponent(targetId);
  const idRegexStr = `(?:id|name)=["'](?:${escapeRegex(targetId)}|${escapeRegex(decodedId)})["']`;
  const pattern = new RegExp(`<([a-zA-Z0-9_-]+)\\b([^>]*?\\b${idRegexStr}[^>]*)>`, 'i');
  const match = pattern.exec(xhtml);
  if (!match) return undefined;

  const tagName = match[1].toLowerCase();
  const fullOpenTag = match[0];
  const startIndex = match.index;

  // If self-closing: <aside id="fn1"/> or <a id="fn1"/>
  if (fullOpenTag.endsWith('/>')) {
    if (tagName === 'a') {
      const parentBlock = extractEnclosingBlock(xhtml, startIndex);
      if (parentBlock) return cleanFootnoteMarkup(parentBlock);
    }
    return cleanFootnoteMarkup(fullOpenTag);
  }

  // Extract element with balanced tags
  const extracted = extractTagAndContent(xhtml, startIndex, tagName, fullOpenTag.length);
  if (!extracted) return undefined;

  // If target is an <a> tag that is just an anchor (short/empty), check enclosing block
  if (tagName === 'a') {
    const textContent = extracted.replace(/<[^>]+>/g, '').trim();
    if (textContent.length <= 4) {
      const parentBlock = extractEnclosingBlock(xhtml, startIndex);
      if (parentBlock) return cleanFootnoteMarkup(parentBlock);
    }
  }

  return cleanFootnoteMarkup(extracted);
}

function extractEnclosingBlock(xhtml: string, targetIndex: number): string | undefined {
  const windowStart = Math.max(0, targetIndex - 300);
  const lookback = xhtml.slice(windowStart, targetIndex);
  const blockMatch = /(<(?:p|li|dd|aside|div)\b[^>]*>)(?![\s\S]*<\/\1>)[^<]*$/i.exec(lookback);
  if (!blockMatch) return undefined;

  const parentTagMatch = /<([a-zA-Z0-9_-]+)/.exec(blockMatch[1]);
  if (!parentTagMatch) return undefined;

  const parentTagName = parentTagMatch[1].toLowerCase();
  const parentStart = windowStart + blockMatch.index;
  return extractTagAndContent(xhtml, parentStart, parentTagName, blockMatch[1].length);
}

function extractTagAndContent(xhtml: string, startIndex: number, tagName: string, openTagLength: number): string | undefined {
  const rest = xhtml.slice(startIndex + openTagLength);
  const tagRegex = new RegExp(`<\/?${tagName}\\b[^>]*>`, 'gi');
  let depth = 1;
  let matchTag: RegExpExecArray | null;

  while ((matchTag = tagRegex.exec(rest)) !== null) {
    const isClosing = matchTag[0].startsWith('</');
    const isSelfClosing = matchTag[0].endsWith('/>');
    if (isClosing) {
      depth--;
      if (depth === 0) {
        const outerEnd = matchTag.index + matchTag[0].length;
        return xhtml.slice(startIndex, startIndex + openTagLength + outerEnd);
      }
    } else if (!isSelfClosing) {
      depth++;
    }
  }
  return undefined;
}
