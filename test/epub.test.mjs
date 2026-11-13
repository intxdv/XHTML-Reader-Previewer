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
