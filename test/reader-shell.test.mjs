import assert from 'node:assert/strict';
import test from 'node:test';

test('readerShell contains anchored footnote popover elements instead of modal dialog', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify modal dialog is replaced
  assert.doesNotMatch(extensionBundle, /<dialog id=["']footnote["']/);

  // Verify anchored popover exists with caret and accessibility
  assert.match(extensionBundle, /id=["']footnote-popover["']/);
  assert.match(extensionBundle, /id=["']footnote-caret["']/);
  assert.match(extensionBundle, /id=["']footnote-content["']/);
  assert.match(extensionBundle, /role=["']dialog["']/);

  // Verify enhanced detection logic is bundled
  assert.match(extensionBundle, /isFootnoteLink/);
  assert.match(extensionBundle, /extractCleanFootnote/);
  assert.match(extensionBundle, /showFootnotePopover/);
  assert.match(extensionBundle, /hidePopover/);
});

test('readerShell contains advanced typography controls and sepia theme', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify theme cycle (dark, light, sepia)
  assert.match(extensionBundle, /\.sepia\s*\{/);
  assert.match(extensionBundle, /id=["']theme-btn["']/);

  // Verify font, spacing, and width controls
  assert.match(extensionBundle, /id=["']font-btn["']/);
  assert.match(extensionBundle, /id=["']spacing-btn["']/);
  assert.match(extensionBundle, /id=["']width-btn["']/);

  // Verify reading progress bar
  assert.match(extensionBundle, /id=["']progress-bar["']/);
  assert.match(extensionBundle, /updateProgress/);
});

test('readerShell contains TOC sidebar, backdrop, search filter, and toggle button', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify TOC elements
  assert.match(extensionBundle, /id=["']toc-btn["']/);
  assert.match(extensionBundle, /id=["']toc-sidebar["']/);
  assert.match(extensionBundle, /id=["']toc-backdrop["']/);
  assert.match(extensionBundle, /id=["']toc-search["']/);
  assert.match(extensionBundle, /toggleToc/);
});
