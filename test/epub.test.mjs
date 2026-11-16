import assert from 'node:assert/strict';
import test from 'node:test';

test('parseContainerXml extracts full-path to opf file', async () => {
  const epub = await import('../dist/epub.js');
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opfPath = epub.parseContainerXml(containerXml);
  assert.equal(opfPath, 'OEBPS/content.opf');
});

test('parseOpfXml extracts title, creator, manifest, and spine in sequence', async () => {
  const epub = await import('../dist/epub.js');
  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Omniscient Reader's Viewpoint</dc:title>
    <dc:creator>singNsong</dc:creator>
    <dc:language>id</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch_1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch_2.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

  // Mock Uri
  const mockOpfUri = {
    path: '/project/OEBPS/content.opf',
    with(change) { return { ...this, ...change }; }
  };
  const mockRootUri = {
    path: '/project',
    with(change) { return { ...this, ...change }; }
  };

  const parsed = epub.parseOpfXml(opfXml, mockOpfUri, mockRootUri);
  assert.equal(parsed.title, "Omniscient Reader's Viewpoint");
  assert.equal(parsed.creator, 'singNsong');
  assert.equal(parsed.language, 'id');

  assert.equal(parsed.manifest.size, 4);
  assert.equal(parsed.manifest.get('ch1')?.href, 'ch_1.xhtml');

  assert.equal(parsed.spine.length, 3);
  assert.equal(parsed.spine[0].idref, 'cover');
  assert.equal(parsed.spine[1].idref, 'ch1');
  assert.equal(parsed.spine[2].idref, 'ch2');
});

test('parseOpfXml strictly respects spine itemref order and linear attribute over manifest declaration order', async () => {
  const epub = await import('../dist/epub.js');
  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Unordered Spine Demo</dc:title>
  </metadata>
  <manifest>
    <item id="a-ch1" href="a_chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="b-ch2" href="b_chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="z_cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="prologue" href="m_prologue.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover" linear="no"/>
    <itemref idref="prologue"/>
    <itemref idref="b-ch2"/>
    <itemref idref="a-ch1"/>
  </spine>
</package>`;

  const mockOpfUri = {
    path: '/project/OEBPS/content.opf',
    with(change) { return { ...this, ...change }; }
  };
  const mockRootUri = {
    path: '/project',
    with(change) { return { ...this, ...change }; }
  };

  const parsed = epub.parseOpfXml(opfXml, mockOpfUri, mockRootUri);
  assert.equal(parsed.spine.length, 4);

  // Verify exact order in spine: cover (z_cover) -> prologue (m_prologue) -> ch2 (b_chapter2) -> ch1 (a_chapter1)
  assert.equal(parsed.spine[0].idref, 'cover');
  assert.equal(parsed.spine[0].href, 'z_cover.xhtml');
  assert.equal(parsed.spine[0].linear, false); // linear="no"

  assert.equal(parsed.spine[1].idref, 'prologue');
  assert.equal(parsed.spine[1].href, 'm_prologue.xhtml');
  assert.equal(parsed.spine[1].linear, true);

  assert.equal(parsed.spine[2].idref, 'b-ch2');
  assert.equal(parsed.spine[2].href, 'b_chapter2.xhtml');
  assert.equal(parsed.spine[2].linear, true);

  assert.equal(parsed.spine[3].idref, 'a-ch1');
  assert.equal(parsed.spine[3].href, 'a_chapter1.xhtml');
  assert.equal(parsed.spine[3].linear, true);
});

test('parseNavHtml extracts TOC items from EPUB 3 Navigation document', async () => {
  const epub = await import('../dist/epub.js');
  const navHtml = `<!DOCTYPE html>
<html>
<body>
  <nav epub:type="toc" id="toc">
    <h2>Table of Contents</h2>
    <ol>
      <li><a href="ch_1.xhtml">Chapter 1: The Beginning</a></li>
      <li><a href="ch_2.xhtml">Chapter 2: The Journey</a></li>
    </ol>
  </nav>
</body>
</html>`;

  const mockBaseDir = {
    path: '/project/OEBPS',
    with(change) { return { ...this, ...change }; }
  };

  const toc = epub.parseNavHtml(navHtml, mockBaseDir);
  assert.equal(toc.length, 2);
  assert.equal(toc[0].label, 'Chapter 1: The Beginning');
  assert.equal(toc[0].href, 'ch_1.xhtml');
  assert.equal(toc[1].label, 'Chapter 2: The Journey');
});

test('parseNcxXml extracts TOC items from NCX XML', async () => {
  const epub = await import('../dist/epub.js');
  const ncxXml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="p1" playOrder="1">
      <navLabel><text>Prologue</text></navLabel>
      <content src="intro.xhtml"/>
    </navPoint>
    <navPoint id="p2" playOrder="2">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="ch_1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

  const mockBaseDir = {
    path: '/project/OEBPS',
    with(change) { return { ...this, ...change }; }
  };

  const toc = epub.parseNcxXml(ncxXml, mockBaseDir);
  assert.equal(toc.length, 2);
  assert.equal(toc[0].label, 'Prologue');
  assert.equal(toc[0].href, 'intro.xhtml');
  assert.equal(toc[1].label, 'Chapter 1');
  assert.equal(toc[1].href, 'ch_1.xhtml');
});
