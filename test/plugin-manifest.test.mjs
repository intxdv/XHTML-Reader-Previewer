import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

test('Antigravity Plugin Manifests and Structure test suite', async (t) => {
  const pluginDir = path.resolve('plugin');

  await t.test('1. plugin/plugin.json is valid and contains standard metadata', async () => {
    const filePath = path.join(pluginDir, 'plugin.json');
    assert.ok(fs.existsSync(filePath), 'plugin.json must exist');

    const content = await fsp.readFile(filePath, 'utf-8');
    const json = JSON.parse(content);

    assert.equal(json.name, 'xhtml-reader-plugin');
    assert.equal(json.displayName, 'XHTML & EPUB Reader');
    assert.ok(json.version);
    assert.ok(json.description);
    assert.equal(json.logo, 'assets/logo.png');
    assert.ok(Array.isArray(json.suggestedPrompts));
    assert.equal(json.suggestedPrompts.length, 3);
  });

  await t.test('2. plugin/mcp_config.json declares xhtml_reader_mcp server', async () => {
    const filePath = path.join(pluginDir, 'mcp_config.json');
    assert.ok(fs.existsSync(filePath), 'mcp_config.json must exist');

    const content = await fsp.readFile(filePath, 'utf-8');
    const json = JSON.parse(content);

    assert.ok(json.mcpServers);
    assert.ok(json.mcpServers.xhtml_reader_mcp);
    assert.equal(json.mcpServers.xhtml_reader_mcp.command, 'node');
    assert.equal(json.mcpServers.xhtml_reader_mcp.type, 'stdio');
    assert.ok(Array.isArray(json.mcpServers.xhtml_reader_mcp.args));
    assert.match(json.mcpServers.xhtml_reader_mcp.args[0], /dist\/mcp-server\.cjs$/);
  });

  await t.test('3. plugin/sidecars/xhtml-previewer/sidecar.json declares valid Auxiliary Pane', async () => {
    const filePath = path.join(pluginDir, 'sidecars', 'xhtml-previewer', 'sidecar.json');
    assert.ok(fs.existsSync(filePath), 'sidecar.json must exist');

    const content = await fsp.readFile(filePath, 'utf-8');
    const json = JSON.parse(content);

    assert.equal(json.command, 'node');
    assert.equal(json.has_web_ui, true);
    assert.ok(json.ui_config);
    assert.equal(json.ui_config.views[0].entrypoint, 'SIDECAR_UI_ENTRYPOINT_AUX_PANE');
    assert.equal(json.ui_config.views[0].path, '/');
  });

  await t.test('4. plugin/skills/xhtml-reader/SKILL.md contains valid YAML frontmatter and documentation', async () => {
    const filePath = path.join(pluginDir, 'skills', 'xhtml-reader', 'SKILL.md');
    assert.ok(fs.existsSync(filePath), 'SKILL.md must exist');

    const content = await fsp.readFile(filePath, 'utf-8');
    assert.match(content, /^---\s*[\r\n]+name:\s*xhtml-reader/m);
    assert.match(content, /description:\s*.+/m);
    assert.match(content, /xhtml_open_preview/);
    assert.match(content, /xhtml_get_toc/);
    assert.match(content, /xhtml_get_metadata/);
    assert.match(content, /sidecar:\/\/xhtml-reader-plugin\/xhtml-previewer\//);
  });

  await t.test('5. plugin/rules/AGENTS.md enforces sidecar pill link presentation', async () => {
    const filePath = path.join(pluginDir, 'rules', 'AGENTS.md');
    assert.ok(fs.existsSync(filePath), 'rules/AGENTS.md must exist');

    const content = await fsp.readFile(filePath, 'utf-8');
    assert.match(content, /XHTML & EPUB Reader Presentation Rules/);
    assert.match(content, /sidecar:\/\/xhtml-reader-plugin\/xhtml-previewer\//);
  });

  await t.test('6. plugin/assets/logo.png exists and is non-empty', () => {
    const filePath = path.join(pluginDir, 'assets', 'logo.png');
    assert.ok(fs.existsSync(filePath), 'logo.png must exist');
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 1000);
  });

  await t.test('7. scripts/install-plugin.js deploys valid bundle without error', async () => {
    const scriptPath = path.resolve('scripts/install-plugin.js');
    assert.ok(fs.existsSync(scriptPath));
  });
});
