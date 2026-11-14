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

test('readerShell contains multi-column paginated mode controls, layout, and keyboard handlers', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify mode button in toolbar
  assert.match(extensionBundle, /id=["']mode-btn["']/);
  assert.match(extensionBundle, /data-action=["']mode["']/);

  // Verify CSS multi-column pagination rules
  assert.match(extensionBundle, /body\.paginated/);
  assert.match(extensionBundle, /column-width/);
  assert.match(extensionBundle, /column-gap/);
  assert.match(extensionBundle, /column-fill:\s*auto/);

  // Verify floating navigation chevrons and page footer
  assert.match(extensionBundle, /id=["']page-prev-arrow["']/);
  assert.match(extensionBundle, /id=["']page-next-arrow["']/);
  assert.match(extensionBundle, /id=["']page-footer["']/);
  assert.match(extensionBundle, /id=["']page-counter["']/);

  // Verify pagination controller logic
  assert.match(extensionBundle, /toggleMode/);
  assert.match(extensionBundle, /renderPage/);
  assert.match(extensionBundle, /nextPage/);
  assert.match(extensionBundle, /prevPage/);
  assert.match(extensionBundle, /computeTotalPages/);
  assert.match(extensionBundle, /updatePagination/);

  // Verify keyboard navigation support (ArrowRight / ArrowLeft / Space)
  assert.match(extensionBundle, /ArrowRight/);
  assert.match(extensionBundle, /ArrowLeft/);
});

test('readerShell contains Moon+ Reader style continuous overscroll cues and chapter transition logic', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify overscroll cues in DOM
  assert.match(extensionBundle, /id=["']top-overscroll-cue["']/);
  assert.match(extensionBundle, /id=["']bottom-overscroll-cue["']/);
  assert.match(extensionBundle, /\.overscroll-cue/);

  // Verify resistance and threshold mechanics
  assert.match(extensionBundle, /PULL_THRESHOLD/);
  assert.match(extensionBundle, /resetOverscrollCues/);
  assert.match(extensionBundle, /isTransitioningChapter/);
  assert.match(extensionBundle, /isAtBottom/);
  assert.match(extensionBundle, /isAtTop/);

  // Verify wheel and touch event handling
  assert.match(extensionBundle, /addEventListener\(["']wheel["']/);
  assert.match(extensionBundle, /addEventListener\(["']touchstart["']/);
  assert.match(extensionBundle, /addEventListener\(["']touchmove["']/);
});
