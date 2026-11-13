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
