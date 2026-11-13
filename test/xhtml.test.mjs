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
