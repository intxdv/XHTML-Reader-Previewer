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

  // Verify natural backward chapter scroll landing (starts from bottom on prevChapter)
  assert.match(extensionBundle, /forceBottom/);
  assert.match(extensionBundle, /data-start-at-bottom/);
  assert.match(extensionBundle, /startAtBottom:\s*true/);
});

test('readerShell contains ultra-compact single-row toolbar with settings popover and immersive auto-hide mode', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify compact toolbar structure with inline chapter navigation
  assert.match(extensionBundle, /id=["']toolbar["']/);
  assert.match(extensionBundle, /id=["']toolbar-hover-sensor["']/);
  assert.match(extensionBundle, /id=["']settings-btn["']/);
  assert.match(extensionBundle, /id=["']settings-popover["']/);
  assert.match(extensionBundle, /chapter-nav-inline/);
  assert.match(extensionBundle, /id=["']prev-btn["']/);
  assert.match(extensionBundle, /id=["']next-btn["']/);

  // Verify settings popover content and pills
  assert.match(extensionBundle, /Reading Settings/);
  assert.match(extensionBundle, /mode-choice/);
  assert.match(extensionBundle, /theme-choice/);
  assert.match(extensionBundle, /font-choice/);
  assert.match(extensionBundle, /spacing-choice/);
  assert.match(extensionBundle, /width-choice/);
  assert.match(extensionBundle, /id=["']font-size-display["']/);

  // Verify immersive auto-hide and toggle mechanics
  assert.match(extensionBundle, /toggleToolbar/);
  assert.match(extensionBundle, /toggleSettings/);
  assert.match(extensionBundle, /updateSettingsPills/);
  assert.match(extensionBundle, /toolbar-hover-sensor/);
  assert.match(extensionBundle, /auxclick/); // Middle-click
});

test('readerShell contains heuristic cross-file footnote popover and asynchronous message communication', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify loading spinner & classes
  assert.match(extensionBundle, /\.footnote-loading/);
  assert.match(extensionBundle, /\.footnote-spinner/);
  assert.match(extensionBundle, /footnoteSpin/);

  // Verify cross-file request and response communication
  assert.match(extensionBundle, /requestFootnote/);
  assert.match(extensionBundle, /footnoteResponse/);
  assert.match(extensionBundle, /isRequestFootnoteMessage/);

  // Verify heuristic patterns in isFootnoteLink
  assert.match(extensionBundle, /activeFootnoteRequestId/);
  assert.match(extensionBundle, /positionPopover/);
});

test('readerShell contains reading navigation history return pill and keyboard bindings', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify return pill elements & styles
  assert.match(extensionBundle, /id=["']history-return-pill["']/);
  assert.match(extensionBundle, /id=["']history-return-btn["']/);
  assert.match(extensionBundle, /id=["']history-return-close["']/);
  assert.match(extensionBundle, /history-return-pct/);
  assert.match(extensionBundle, /pillSlideIn/);

  // Verify message handlers and reading position payload
  assert.match(extensionBundle, /isHistoryBackMessage/);
  assert.match(extensionBundle, /isHistoryForwardMessage/);
  assert.match(extensionBundle, /triggerHistoryBack/);
  assert.match(extensionBundle, /getCurrentReadingPosition/);

  // Verify keyboard navigation priority for Alt+Left
  assert.match(extensionBundle, /data-can-go-back/);
});

test('readerShell contains spine order inspector tab and toolbar spine metadata', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify sidebar tab switcher elements
  assert.match(extensionBundle, /class=["']sidebar-tabs["']/);
  assert.match(extensionBundle, /id=["']tab-btn-toc["']/);
  assert.match(extensionBundle, /id=["']tab-btn-spine["']/);
  assert.match(extensionBundle, /id=["']tab-pane-toc["']/);
  assert.match(extensionBundle, /id=["']tab-pane-spine["']/);

  // Verify spine order list items and linear badge
  assert.match(extensionBundle, /class=["']toc-item spine-item/);
  assert.match(extensionBundle, /spine-item-idx/);
  assert.match(extensionBundle, /spine-item-file/);
  assert.match(extensionBundle, /spine-item-badge non-linear/);

  // Verify toolbar spine metadata & non-linear indicator
  assert.match(extensionBundle, /chapter-badge-file/);
  assert.match(extensionBundle, /badge-non-linear/);

  // Verify client-side tab switching script logic
  assert.match(extensionBundle, /sidebar-tab-btn/);
  assert.match(extensionBundle, /tabPanes\.spine/);
  assert.match(extensionBundle, /tabPanes\.toc/);
});

test('readerShell contains dual-mode messaging polyfill for standalone and webview environments', async () => {
  const fs = await import('node:fs');
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  assert.match(extensionBundle, /typeof acquireVsCodeApi === ['"]function['"]/);
  assert.match(extensionBundle, /window\.parent\.postMessage/);
  assert.match(extensionBundle, /\/api\/message/);
});

