import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSite } from './build-site.mjs';

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  return await res.text();
}

function parseArgs(argv) {
  const out = { url: 'https://www.warframe.com/droptables', force: false, outputDir: 'site' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--outputDir') out.outputDir = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const htmlPath = path.join(repoRoot, 'droptables-en.html');
  const outDirAbs = path.join(repoRoot, args.outputDir);

  const fresh = await download(args.url);
  const freshHash = sha256(fresh);

  let oldHash = null;
  if (await fileExists(htmlPath)) {
    const old = await fs.readFile(htmlPath, 'utf8');
    oldHash = sha256(old);
  }

  const changed = oldHash !== freshHash;
  if (changed) await fs.writeFile(htmlPath, fresh, 'utf8');

  const outExists = await fileExists(outDirAbs);
  if (changed || args.force || !outExists) {
    await buildSite({ repoRoot, outputDir: args.outputDir });
  }

  // GitHub Actions output
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${changed ? 'true' : 'false'}\n`);
  }

  // Also print for local runs
  console.log(JSON.stringify({ changed, oldHash, freshHash }, null, 2));
}

await main();

