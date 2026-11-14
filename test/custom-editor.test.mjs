import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('package.json contributes customEditors with default priority for .epub and option for .xhtml', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.ok(Array.isArray(pkg.contributes.customEditors));
  assert.equal(pkg.contributes.customEditors.length, 2);

  // EPUB custom editor
  const epubEditor = pkg.contributes.customEditors.find(e => e.viewType === 'xhtmlReader.epubEditor');
  assert.ok(epubEditor);
  assert.equal(epubEditor.priority, 'default');
  assert.deepEqual(epubEditor.selector, [{ filenamePattern: '*.epub' }]);

  // XHTML custom editor
  const xhtmlEditor = pkg.contributes.customEditors.find(e => e.viewType === 'xhtmlReader.customEditor');
  assert.ok(xhtmlEditor);
  assert.equal(xhtmlEditor.priority, 'option');
  assert.deepEqual(xhtmlEditor.selector, [
    { filenamePattern: '*.xhtml' },
    { filenamePattern: '*.html' },
    { filenamePattern: '*.htm' }
  ]);

  // Activation events: omitted in modern VS Code since contributes.customEditors infers them automatically
  assert.equal(pkg.activationEvents, undefined);

  // Official extension icon
  assert.equal(pkg.icon, 'media/icon.png');
  assert.ok(fs.existsSync('media/icon.png'));
});

test('extension bundle implements and registers CustomEditor providers', () => {
  const extensionBundle = fs.readFileSync('dist/extension.js', 'utf8');

  // Verify class definitions
  assert.match(extensionBundle, /(?:class\s+EpubCustomEditorProvider|EpubCustomEditorProvider\s*=\s*class)/);
  assert.match(extensionBundle, /(?:class\s+XhtmlCustomTextEditorProvider|XhtmlCustomTextEditorProvider\s*=\s*class)/);

  // Verify registration
  assert.match(extensionBundle, /registerCustomEditorProvider/);
  assert.match(extensionBundle, /xhtmlReader\.epubEditor/);
  assert.match(extensionBundle, /xhtmlReader\.customEditor/);

  // Verify attachReaderToWebview logic and panel.iconPath
  assert.match(extensionBundle, /attachReaderToWebview/);
  assert.match(extensionBundle, /iconPath/);
});
