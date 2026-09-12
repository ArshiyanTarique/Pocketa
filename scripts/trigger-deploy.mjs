/**
 * Deploy the dist/ folder to Netlify via file upload (no build minutes consumed).
 * Usage: node scripts/trigger-deploy.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const configPath = join(homedir(), 'AppData', 'Roaming', 'netlify', 'Config', 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const userEntry = Object.values(config.users ?? {})[0];
const token = userEntry?.token ?? userEntry?.auth?.token;
if (!token) {
  console.error('No Netlify token found in', configPath);
  process.exit(1);
}

const SITE_ID = '559ccf3d-ce6a-425e-8361-eedc20fe8a93';
const DIST_DIR = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Collect all files in dist/
function walk(dir, base = dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full, base));
    } else {
      results.push(full);
    }
  }
  return results;
}

console.log('Reading dist/ files...');
const files = walk(DIST_DIR);
console.log(`  Found ${files.length} files`);

// Build sha1 digest map: { "/path": "sha1hex" }
const digestMap = {};
const fileMap = {}; // sha1 -> full path
for (const f of files) {
  const rel = '/' + relative(DIST_DIR, f).replace(/\\/g, '/');
  const content = readFileSync(f);
  const sha1 = createHash('sha1').update(content).digest('hex');
  digestMap[rel] = sha1;
  fileMap[sha1] = f;
}

// Step 1: Create a deploy with file digests
console.log('Creating deploy...');
const createRes = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ files: digestMap, draft: false }),
});

const deploy = await createRes.json();
if (!createRes.ok) {
  console.error('Failed to create deploy:', createRes.status, JSON.stringify(deploy));
  process.exit(1);
}

console.log(`  Deploy ID: ${deploy.id}`);
console.log(`  State: ${deploy.state}`);

const required = deploy.required ?? [];
console.log(`  Files to upload: ${required.length}`);

// Step 2: Upload required files
for (const sha1 of required) {
  const filePath = fileMap[sha1];
  if (!filePath) {
    console.error(`  Missing file for sha1: ${sha1}`);
    continue;
  }
  const rel = '/' + relative(DIST_DIR, filePath).replace(/\\/g, '/');
  const content = readFileSync(filePath);
  
  const uploadRes = await fetch(
    `https://api.netlify.com/api/v1/deploys/${deploy.id}/files${rel}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    }
  );
  
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error(`  Upload failed for ${rel}: ${uploadRes.status} ${err}`);
  } else {
    console.log(`  ✓ ${rel}`);
  }
}

console.log('\nDeploy complete!');
console.log(`  Live URL: https://pocketaweb.netlify.app`);
console.log(`  Admin:    https://app.netlify.com/projects/pocketaweb/deploys/${deploy.id}`);
