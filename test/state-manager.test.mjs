import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

class MockMemento {
  constructor(initialData = {}) {
    this.data = { ...initialData };
  }

  get(key, defaultValue) {
    return key in this.data ? this.data[key] : defaultValue;
  }

  async update(key, value) {
    this.data[key] = value;
  }
}

test('StateManager returns default preferences when none are stored', async () => {
  const { StateManager, DEFAULT_PREFERENCES } = await import('../dist/state-manager.js');
  const mockStorage = new MockMemento();
  const manager = new StateManager(mockStorage);

  const prefs = manager.getPreferences();
  assert.deepEqual(prefs, DEFAULT_PREFERENCES);
});

test('StateManager updates and validates preferences', async () => {
  const { StateManager } = await import('../dist/state-manager.js');
  const mockStorage = new MockMemento();
  const manager = new StateManager(mockStorage);

  await manager.savePreferences({
    theme: 'sepia',
    fontSize: 22,
    fontFamily: 'mono',
    lineHeight: 'relaxed',
    readerWidth: 'wide',
    readerMode: 'paginated'
  });

  const prefs = manager.getPreferences();
  assert.equal(prefs.theme, 'sepia');
  assert.equal(prefs.fontSize, 22);
  assert.equal(prefs.fontFamily, 'mono');
  assert.equal(prefs.lineHeight, 'relaxed');
  assert.equal(prefs.readerWidth, 'wide');
  assert.equal(prefs.readerMode, 'paginated');

  // Test invalid values fallback safely
  await manager.savePreferences({
    theme: 'invalid-theme',
    fontSize: 999,
    fontFamily: 'non-existent',
    readerMode: 'invalid-mode'
  });

  const fallbackPrefs = manager.getPreferences();
  assert.equal(fallbackPrefs.theme, 'dark'); // fallback
  assert.equal(fallbackPrefs.fontSize, 18); // fallback
  assert.equal(fallbackPrefs.fontFamily, 'serif'); // fallback
  assert.equal(fallbackPrefs.readerMode, 'scroll'); // fallback
});

test('StateManager saves and retrieves reading locations by URI', async () => {
  const { StateManager } = await import('../dist/state-manager.js');
  const mockStorage = new MockMemento();
  const manager = new StateManager(mockStorage);

  const chapterUri = 'file:///workspace/OEBPS/ch_1.xhtml';
  await manager.saveReadingLocation(chapterUri, {
    scrollRatio: 0.45,
    scrollY: 1250,
    anchorId: 'sec-2'
  });

  const loc = manager.getReadingLocation(chapterUri);
  assert.ok(loc);
  assert.equal(loc.scrollRatio, 0.45);
  assert.equal(loc.scrollY, 1250);
  assert.equal(loc.anchorId, 'sec-2');
  assert.ok(typeof loc.timestamp === 'number');
});

test('readerShell bundle contains scroll debounce, preference sync, and instant restoration', () => {
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Message handlers
  assert.match(extensionBundle, /isSavePreferencesMessage/);
  assert.match(extensionBundle, /isSaveReadingPositionMessage/);

  // Webview client functions
  assert.match(extensionBundle, /scheduleSaveReadingPosition/);
  assert.match(extensionBundle, /notifyPreferences/);
  assert.match(extensionBundle, /restorePosition/);
  assert.match(extensionBundle, /data-initial-ratio/);
  assert.match(extensionBundle, /data-initial-scroll-y/);
  assert.match(extensionBundle, /data-initial-anchor-id/);
});
