#!/usr/bin/env node
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function installPlugin() {
  const rootDir = path.resolve(__dirname, '..');
  const pluginSourceDir = path.join(rootDir, 'plugin');
  const distDir = path.join(rootDir, 'dist');

  console.log('[XHTML Plugin Installer] Checking prerequisites...');

  // 1. Verify build artifacts
  const sidecarBundle = path.join(distDir, 'sidecar-server.cjs');
  const mcpBundle = path.join(distDir, 'mcp-server.cjs');

  if (!fs.existsSync(sidecarBundle) || !fs.existsSync(mcpBundle)) {
    console.error('❌ Build artifacts missing. Please run "npm run build" first.');
    process.exit(1);
  }

  // 2. Resolve Antigravity Plugins directory
  const homeDir = os.homedir();
  const configBase = process.env.ANTIGRAVITY_CONFIG_DIR || path.join(homeDir, '.gemini', 'config');
  const pluginsDir = path.join(configBase, 'plugins');
  const targetDir = path.join(pluginsDir, 'xhtml-reader-plugin');

  console.log(`[XHTML Plugin Installer] Target directory: ${targetDir}`);

  // 3. Ensure target directories exist
  await fsp.mkdir(targetDir, { recursive: true });

  // 4. Recursive copy helper
  async function copyDir(src, dest) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fsp.copyFile(srcPath, destPath);
      }
    }
  }

  // 5. Copy plugin manifest and components
  const itemsToCopy = [
    'plugin.json',
    'mcp_config.json',
    'assets',
    'sidecars',
    'skills',
    'rules',
    'README.md'
  ];

  for (const item of itemsToCopy) {
    const srcPath = path.join(pluginSourceDir, item);
    const destPath = path.join(targetDir, item);
    if (!fs.existsSync(srcPath)) continue;

    const stat = await fsp.stat(srcPath);
    if (stat.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }

  // 6. Copy dist artifacts into plugin directory
  const targetDistDir = path.join(targetDir, 'dist');
  await copyDir(distDir, targetDistDir);

  console.log('✅ Antigravity 2.0 Plugin successfully deployed!');
  console.log('--------------------------------------------------');
  console.log(`Plugin ID:      xhtml-reader-plugin`);
  console.log(`Location:       ${targetDir}`);
  console.log(`MCP Server:     dist/mcp-server.cjs (3 tools)`);
  console.log(`Sidecar:        dist/sidecar-server.cjs (Auxiliary Pane)`);
  console.log(`Skill:          skills/xhtml-reader/SKILL.md`);
  console.log(`Rule:           rules/AGENTS.md`);
  console.log('--------------------------------------------------');
  console.log('Open Antigravity 2.0 -> Settings / Customizations to inspect the plugin.');
}

installPlugin().catch((err) => {
  console.error('❌ Installation failed:', err);
  process.exit(1);
});
