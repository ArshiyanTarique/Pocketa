/**
 * Point this build at a Supabase project, everywhere it needs pointing.
 *
 *   node scripts/connect-supabase.mjs <project-url> <publishable-key>
 *
 * Vite reads these at BUILD time, not run time, so setting them in one place is
 * never enough: the local `.env.local` is what `npm run dev` uses, and the host's
 * environment is what the deployed build uses. Setting one and forgetting the
 * other is the most common way "sync is not set up in this build" survives a
 * deploy that was supposed to fix it.
 *
 * The browser key is meant to be public — it ships inside the bundle by design,
 * and row-level security, not secrecy, is what protects the data. A privileged
 * key is the opposite of that, and this refuses to accept one.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [url, key] = process.argv.slice(2);

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!url || !key) {
  die('Usage: node scripts/connect-supabase.mjs <project-url-or-ref> <publishable-key>');
}

/**
 * Accept the project reference on its own.
 *
 * The dashboard moved the Project URL out of the API keys page, but the
 * reference is always in the address bar — `/dashboard/project/<ref>` — and the
 * URL is only ever that reference under supabase.co. Taking either saves
 * hunting for a field that has moved.
 */
function toProjectUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, '');

  const full = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(trimmed);
  if (full) return `https://${full[1]}.supabase.co`;

  // A pasted dashboard address, e.g. https://supabase.com/dashboard/project/<ref>/...
  const dashboard = /supabase\.com\/dashboard\/project\/([a-z0-9]{20})/.exec(trimmed);
  if (dashboard) return `https://${dashboard[1]}.supabase.co`;

  // The bare reference.
  if (/^[a-z0-9]{20}$/.test(trimmed)) return `https://${trimmed}.supabase.co`;

  return null;
}

const projectUrl = toProjectUrl(url);
if (!projectUrl) {
  die(
    [
      `Could not read a project from: ${url}`,
      '',
      '  Give any one of these:',
      '    https://abcdefghijklmnopqrst.supabase.co',
      '    abcdefghijklmnopqrst                       (the project reference)',
      '    the dashboard address you are looking at right now',
      '',
      '  The reference is the 20 characters after /project/ in the dashboard URL.',
    ].join('\n'),
  );
}

/**
 * Which key is this?
 *
 * Supabase issues two shapes. The current one is a prefixed opaque string —
 * `sb_publishable_…` for the browser, `sb_secret_…` for a server. Older projects
 * have a JWT whose payload names the role: `anon` or `service_role`.
 *
 * Both browser-safe forms are accepted. Both privileged forms are refused with
 * the same warning, because pasting one here would ship it to every visitor.
 */
function classify(value) {
  if (value.startsWith('sb_publishable_')) return { kind: 'publishable', safe: true };
  if (value.startsWith('sb_secret_')) return { kind: 'secret', safe: false };

  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
    const role = payload.role;
    if (role === 'anon') return { kind: 'legacy anon', safe: true };
    if (role === 'service_role') return { kind: 'legacy service_role', safe: false };
    return { kind: `a key granting "${role ?? 'unknown'}"`, safe: false };
  } catch {
    return null;
  }
}

const classified = classify(key);
if (!classified) {
  die(
    'That is not a recognisable Supabase key.\n' +
      '  In Project Settings -> API keys, copy the one under "Publishable key".',
  );
}
if (!classified.safe) {
  die(
    `That is the ${classified.kind} key. It grants privileged access that bypasses\n` +
      '  every row-level security policy, and this build ships its keys to the browser —\n' +
      '  so it must never be used here.\n\n' +
      '  Copy the "Publishable key" instead, and rotate the one you just pasted.',
  );
}

const clean = projectUrl;

// --- 1. The local build ------------------------------------------------------

const envPath = '.env.local';
const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const keep = existing
  .split('\n')
  .filter((line) => line.trim() && !/^VITE_SUPABASE_(URL|ANON_KEY)=/.test(line));

writeFileSync(
  envPath,
  [...keep, `VITE_SUPABASE_URL=${clean}`, `VITE_SUPABASE_ANON_KEY=${key}`, ''].join('\n'),
);
console.log(`  wrote ${envPath} (${classified.kind} key)`);

// --- 2. The hosted build -----------------------------------------------------

/**
 * Run the Netlify CLI.
 *
 * On Windows it is a `.cmd` shim, and Node refuses to spawn one without a
 * shell. Going through a shell means the arguments are parsed by it, so both
 * values are checked against a strict character set first — neither can contain
 * a quote, a space or anything a shell treats as punctuation.
 */
const SHELL_SAFE = /^[A-Za-z0-9._:/-]+$/;

function netlify(args) {
  const windows = process.platform === 'win32';
  if (!windows) {
    return execFileSync('netlify', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  // `cmd.exe /c` rather than `shell: true`: the latter concatenates arguments
  // into a command line without escaping them, which Node now warns about.
  // The character check stays as a second line of defence.
  if (!args.every((arg) => SHELL_SAFE.test(arg))) {
    throw new Error('refusing to pass an unexpected character to the command line');
  }
  return execFileSync('cmd.exe', ['/c', 'netlify.cmd', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

if (existsSync('.netlify/state.json')) {
  for (const [name, value] of [
    ['VITE_SUPABASE_URL', clean],
    ['VITE_SUPABASE_ANON_KEY', key],
  ]) {
    try {
      netlify(['env:set', name, value]);
      console.log(`  set ${name} on Netlify`);
    } catch (error) {
      console.warn(`  could not set ${name} on Netlify: ${String(error.message).split('\n')[0]}`);
      console.warn('  set it by hand in Site configuration -> Environment variables.');
    }
  }
} else {
  console.log('  no linked Netlify site; skipping the hosted build');
}

console.log('\n  Now rebuild and deploy, so both halves carry the new values:\n');
console.log('    npm run build && netlify deploy --prod --dir=dist\n');
