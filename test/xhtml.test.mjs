import assert from 'node:assert/strict';
import test from 'node:test';
import xhtml from '../dist/xhtml.js';

test('sanitizeXhtml keeps reader content and removes executable markup', () => {
  const result = xhtml.sanitizeXhtml('<html><head><link rel="stylesheet" href="book.css"><style>p{color:red}</style></head><body><p onclick="bad()">Text</p><script>alert(1)</script><img src="javascript:bad()"></body></html>');

  assert.match(result, /book\.css/);
  assert.match(result, /p\{color:red\}/);
  assert.match(result, /<p>Text<\/p>/);
  assert.doesNotMatch(result, /script|onclick|javascript:/i);
});

test('extractElementById extracts <aside> or <li> footnote by ID and removes backlink return symbols', () => {
  const rawHtml = `
    <html>
      <body>
        <section class="chapter">
          <p>Some text with footnote reference.</p>
        </section>
        <section class="footnotes">
          <aside id="fn-1" epub:type="footnote">
            <p>1. This is the first footnote text. <a href="ch1.xhtml#ref1" role="doc-backlink">↩</a></p>
          </aside>
          <li id="note_2">
            <span>2. Second footnote explaining details.</span> <a class="footnote-backref" href="#ref2">↵</a>
          </li>
        </section>
      </body>
    </html>
  `;

  const fn1 = xhtml.extractElementById(rawHtml, 'fn-1');
  assert.ok(fn1);
  assert.match(fn1, /This is the first footnote text/);
  assert.doesNotMatch(fn1, /↩/);
  assert.doesNotMatch(fn1, /doc-backlink/);

  const fn2 = xhtml.extractElementById(rawHtml, 'note_2');
  assert.ok(fn2);
  assert.match(fn2, /Second footnote explaining details/);
  assert.doesNotMatch(fn2, /↵/);
  assert.doesNotMatch(fn2, /footnote-backref/);
});

test('extractElementById extracts enclosing paragraph when ID is placed on an inline anchor', () => {
  const rawHtml = `
    <div class="notes">
      <p><a name="fn3" id="fn3"></a>3. Footnote text inside paragraph with inline anchor. <a href="#ref3">↑</a></p>
    </div>
  `;

  const fn3 = xhtml.extractElementById(rawHtml, 'fn3');
  assert.ok(fn3);
  assert.match(fn3, /Footnote text inside paragraph with inline anchor/);
  assert.doesNotMatch(fn3, /↑/);
});

test('extractElementById returns undefined if ID not found', () => {
  const rawHtml = '<p id="para1">Just regular text</p>';
  const result = xhtml.extractElementById(rawHtml, 'nonexistent');
  assert.equal(result, undefined);
});
