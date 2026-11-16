import assert from 'node:assert/strict';
import test from 'node:test';

test('NavigationHistory pushes, peeks, and respects max depth', async () => {
  const { NavigationHistory } = await import('../dist/state-manager.js');
  const history = new NavigationHistory(3);

  assert.equal(history.canGoBack(), false);
  assert.equal(history.canGoForward(), false);

  history.push({ uri: 'chapter1.xhtml', chapterTitle: 'Chapter 1', scrollY: 100, scrollRatio: 0.1 });
  history.push({ uri: 'chapter2.xhtml', chapterTitle: 'Chapter 2', scrollY: 200, scrollRatio: 0.2 });
  history.push({ uri: 'chapter3.xhtml', chapterTitle: 'Chapter 3', scrollY: 300, scrollRatio: 0.3 });

  assert.equal(history.canGoBack(), true);
  assert.equal(history.getBackCount(), 3);
  assert.equal(history.peekBack()?.uri, 'chapter3.xhtml');

  // Push 4th item beyond capacity 3 -> oldest (chapter1) pruned
  history.push({ uri: 'chapter4.xhtml', chapterTitle: 'Chapter 4', scrollY: 400, scrollRatio: 0.4 });
  assert.equal(history.getBackCount(), 3);

  // Navigate back to chapter 3
  const currentLoc = { uri: 'chapter5.xhtml', chapterTitle: 'Chapter 5', scrollY: 500, scrollRatio: 0.5 };
  const back1 = history.goBack(currentLoc);
  assert.equal(back1?.uri, 'chapter4.xhtml');
  assert.equal(history.canGoForward(), true);
  assert.equal(history.peekForward()?.uri, 'chapter5.xhtml');

  // Navigate forward again
  const fwd = history.goForward({ uri: 'chapter4.xhtml', chapterTitle: 'Chapter 4', scrollY: 400, scrollRatio: 0.4 });
  assert.equal(fwd?.uri, 'chapter5.xhtml');
});

test('NavigationHistory clears forward stack on new push and clears all on clear()', async () => {
  const { NavigationHistory } = await import('../dist/state-manager.js');
  const history = new NavigationHistory();

  history.push({ uri: 'chapter1.xhtml', chapterTitle: 'Chapter 1', scrollY: 100, scrollRatio: 0.1 });
  history.goBack({ uri: 'chapter2.xhtml', chapterTitle: 'Chapter 2', scrollY: 200, scrollRatio: 0.2 });
  assert.equal(history.canGoForward(), true);

  // New push should reset forward stack
  history.push({ uri: 'chapter3.xhtml', chapterTitle: 'Chapter 3', scrollY: 300, scrollRatio: 0.3 });
  assert.equal(history.canGoForward(), false);

  history.clear();
  assert.equal(history.canGoBack(), false);
  assert.equal(history.canGoForward(), false);
  assert.equal(history.getBackCount(), 0);
});
