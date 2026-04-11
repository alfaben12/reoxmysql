import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import process from 'process';

const rootDir = process.cwd();
const releasesDir = path.join(rootDir, 'releases');
const releaseEntries = [
  'dist',
  'lib/MySQL.lua',
  'logger',
  'web/build',
  'docs',
  'fxmanifest.lua',
  'LICENSE',
  'README.md',
  'ui.lua',
];

for (const entry of releaseEntries) {
  if (!existsSync(path.join(rootDir, entry))) {
    throw new Error(`Missing release entry: ${entry}`);
  }
}

mkdirSync(releasesDir, { recursive: true });

const now = new Date();
const pad = (value) => String(value).padStart(2, '0');
const zipName = `reoxmysql-${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}.zip`;
const zipPath = path.join(releasesDir, zipName);
const stagingDir = path.join(releasesDir, `.tmp-${zipName.replace(/\.zip$/, '')}`);

if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true, force: true });
}

mkdirSync(stagingDir, { recursive: true });

for (const entry of releaseEntries) {
  const sourcePath = path.join(rootDir, entry);
  const targetPath = path.join(stagingDir, entry);

  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
}

if (process.platform === 'win32') {
  const escapedStagingDir = stagingDir.replace(/'/g, "''");
  const escapedZipPath = zipPath.replace(/'/g, "''");
  const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedStagingDir}', '${escapedZipPath}')`;

  execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: rootDir,
    stdio: 'inherit',
  });
} else {
  execFileSync('zip', ['-r', zipPath, '.'], {
    cwd: stagingDir,
    stdio: 'inherit',
  });
}

rmSync(stagingDir, { recursive: true, force: true });

console.log(`Release archive created: ${path.relative(rootDir, zipPath)}`);
