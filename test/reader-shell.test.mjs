import assert from 'node:assert/strict';
import test from 'node:test';

test('readerShell contains anchored footnote popover elements instead of modal dialog', async () => {
  // Read dist/extension.js or test template structure
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
