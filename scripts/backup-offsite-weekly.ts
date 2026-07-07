/**
 * Weekly encrypted offsite push of the newest nightly backup (local Mac → GitHub).
 *
 * Tars the newest ~/Backups/mycoldmars/YYYY-MM-DD/ dir, encrypts it with
 * AES-256-CBC (openssl -pbkdf2, 200k iterations — age is installed but its
 * passphrase mode demands a TTY, useless under launchd), and force-pushes the
 * last 8 weekly archives to the private repo parleypott/mycoldmars-backups.
 * Force-push with a fresh orphan commit each week is deliberate: it keeps the
 * remote at exactly 8 archives instead of growing git history by ~35MB/week
 * forever. Archives over 90MB are split (GitHub hard-caps files at 100MB);
 * restore with `cat weekly-X.tar.enc.part-* > weekly-X.tar.enc` first.
 *
 * Passphrase: BACKUP_PASSPHRASE in ~/.config/mycoldmars/secrets.env. Generated
 * once on first run and ALSO written to ~/Desktop/backup-key.txt — Johnny must
 * keep a copy off this machine or the offsite copies are decorative.
 *
 * Decrypt: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in weekly-X.tar.enc -out weekly-X.tar -pass env:BACKUP_PASSPHRASE
 *
 * Run:      bun scripts/backup-offsite-weekly.ts
 * Schedule: ~/Library/LaunchAgents/com.johnnyharris.mycoldmars-backup-offsite.plist (Sundays 04:00 local)
 * Log:      ~/Backups/mycoldmars/offsite.log
 */
import { mkdirSync, readdirSync, rmSync, statSync, appendFileSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseEnvFile, dateStamp } from './backup-script-data.ts';

const BACKUP_ROOT = join(homedir(), 'Backups', 'mycoldmars');
const WEEKLIES_DIR = join(BACKUP_ROOT, 'weeklies');
const SECRETS_PATH = join(homedir(), '.config', 'mycoldmars', 'secrets.env');
const KEY_NOTE_PATH = join(homedir(), 'Desktop', 'backup-key.txt');
const REPO = 'parleypott/mycoldmars-backups';
const KEEP_WEEKLIES = 8;
// GitHub rejects files ≥100MB; 90MB parts leave headroom for any padding.
const SPLIT_BYTES = 90 * 1024 * 1024;
const PBKDF2_ITER = 200000;

// ---------------------------------------------------------------------------
// pure helpers (exported for backup-offsite-weekly.test.mjs)
// ---------------------------------------------------------------------------

/** Newest exact-YYYY-MM-DD name — the nightly dir this week's archive snapshots. */
export function newestDatedDir(names: string[]): string | null {
  const dated = names.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  return dated.length ? dated[dated.length - 1] : null;
}

export function weeklyArchiveName(stamp: string): string {
  return `weekly-${stamp}.tar.enc`;
}

/** Stamp of a weekly archive file (whole or split part); null for anything else. */
export function stampOfWeekly(name: string): string | null {
  const m = name.match(/^weekly-(\d{4}-\d{2}-\d{2})\.tar\.enc(?:\.part-[a-z]+)?$/);
  return m ? m[1] : null;
}

/**
 * Which weekly files (including split parts) belong to stamps older than the
 * newest `keep` stamps? Non-weekly names are never candidates.
 */
export function weekliesToPrune(names: string[], keep: number): string[] {
  const stamps = [...new Set(names.map(stampOfWeekly).filter((s): s is string => s !== null))].sort();
  const dead = new Set(stamps.slice(0, Math.max(0, stamps.length - keep)));
  return names.filter((n) => {
    const s = stampOfWeekly(n);
    return s !== null && dead.has(s);
  });
}

/** 32 random bytes, base64url — no shell-hostile characters, ~256 bits of entropy. */
export function generatePassphrase(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(join(BACKUP_ROOT, 'offsite.log'), line + '\n'); } catch { /* first run before dir exists */ }
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): string {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Read BACKUP_PASSPHRASE; on first run generate it, persist to secrets.env AND Desktop note. */
function ensurePassphrase(): string {
  const env = parseEnvFile(readFileSync(SECRETS_PATH, 'utf8'));
  if (env.BACKUP_PASSPHRASE) return env.BACKUP_PASSPHRASE;

  const pass = generatePassphrase();
  const raw = readFileSync(SECRETS_PATH, 'utf8');
  writeFileSync(SECRETS_PATH, raw + (raw.endsWith('\n') ? '' : '\n') + `BACKUP_PASSPHRASE=${pass}\n`);
  writeFileSync(KEY_NOTE_PATH, [
    'BACKUP KEY — mycoldmars offsite backups',
    '',
    'This passphrase decrypts the weekly backup archives pushed to',
    `https://github.com/${REPO} (private).`,
    '',
    `BACKUP_PASSPHRASE=${pass}`,
    '',
    'KEEP A COPY OF THIS SOMEWHERE SAFE that is NOT this laptop —',
    'password manager, a note on your phone, a printed page in a drawer.',
    'If the laptop dies, this passphrase is the only way to open the',
    'offsite copies. Without it they are random noise.',
    '',
    'To restore an archive:',
    '  1. Download weekly-YYYY-MM-DD.tar.enc from the repo',
    '     (if it came as .part-aa/.part-ab pieces: cat weekly-*.tar.enc.part-* > weekly-YYYY-MM-DD.tar.enc)',
    `  2. openssl enc -d -aes-256-cbc -pbkdf2 -iter ${PBKDF2_ITER} -in weekly-YYYY-MM-DD.tar.enc -out backup.tar -pass pass:THE_PASSPHRASE`,
    '  3. tar -xf backup.tar',
    '',
  ].join('\n'));
  log(`generated BACKUP_PASSPHRASE → ${SECRETS_PATH} + ${KEY_NOTE_PATH} (tell Johnny to copy it somewhere safe)`);
  return pass;
}

function ensureRepo() {
  try {
    run('gh', ['repo', 'view', REPO, '--json', 'name']);
  } catch {
    run('gh', ['repo', 'create', REPO, '--private', '--description', 'Encrypted weekly backups of mycoldmars script data. Useless without the passphrase.']);
    log(`created private repo ${REPO}`);
  }
}

function bytesOf(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function buildArchive(sourceDir: string, stamp: string, passphrase: string): string[] {
  mkdirSync(WEEKLIES_DIR, { recursive: true });
  const tarPath = join(WEEKLIES_DIR, `.weekly-${stamp}.tar.tmp`);
  const encPath = join(WEEKLIES_DIR, weeklyArchiveName(stamp));
  try {
    // -C so the tar contains "YYYY-MM-DD/..." and extracts as a clean dir
    run('tar', ['-cf', tarPath, '-C', BACKUP_ROOT, sourceDir]);
    run('openssl', [
      'enc', '-aes-256-cbc', '-pbkdf2', '-iter', String(PBKDF2_ITER), '-salt',
      '-in', tarPath, '-out', encPath, '-pass', 'env:BACKUP_PASSPHRASE',
    ], { env: { BACKUP_PASSPHRASE: passphrase } });
  } finally {
    rmSync(tarPath, { force: true });
  }

  if (bytesOf(encPath) <= SPLIT_BYTES) return [weeklyArchiveName(stamp)];

  run('split', ['-b', '90m', encPath, `${encPath}.part-`], { cwd: WEEKLIES_DIR });
  rmSync(encPath);
  const parts = readdirSync(WEEKLIES_DIR).filter((n) => n.startsWith(`${weeklyArchiveName(stamp)}.part-`)).sort();
  log(`archive exceeded ${SPLIT_BYTES} bytes — split into ${parts.length} parts`);
  return parts;
}

/** Fresh orphan commit of the current weeklies, force-pushed — remote never accumulates history. */
function pushToRemote(files: string[]): void {
  const token = run('gh', ['auth', 'token']).trim();
  const work = mkdtempSync(join(tmpdir(), 'mycoldmars-offsite-'));
  try {
    run('git', ['init', '-b', 'main'], { cwd: work });
    run('git', ['config', 'user.email', 'backup@mycoldmars.local'], { cwd: work });
    run('git', ['config', 'user.name', 'mycoldmars backup'], { cwd: work });
    for (const f of files) copyFileSync(join(WEEKLIES_DIR, f), join(work, f));
    writeFileSync(join(work, 'README.md'), [
      '# mycoldmars encrypted backups',
      '',
      'Weekly `tar` snapshots of `~/Backups/mycoldmars/<newest-night>/`, encrypted with',
      `AES-256-CBC (openssl, pbkdf2, ${PBKDF2_ITER} iterations). The passphrase lives in`,
      '`~/.config/mycoldmars/secrets.env` as `BACKUP_PASSPHRASE` (copy on Desktop: `backup-key.txt`).',
      '',
      '```sh',
      '# if split: cat weekly-YYYY-MM-DD.tar.enc.part-* > weekly-YYYY-MM-DD.tar.enc',
      `openssl enc -d -aes-256-cbc -pbkdf2 -iter ${PBKDF2_ITER} -in weekly-YYYY-MM-DD.tar.enc -out backup.tar -pass pass:PASSPHRASE`,
      'tar -xf backup.tar',
      '```',
      '',
      `History is force-pushed weekly to hold exactly the last ${KEEP_WEEKLIES} archives.`,
      '',
    ].join('\n'));
    run('git', ['add', '-A'], { cwd: work });
    run('git', ['commit', '-m', `weekly backup push ${dateStamp(new Date())}`], { cwd: work });
    run('git', ['remote', 'add', 'origin', `https://x-access-token:${token}@github.com/${REPO}.git`], { cwd: work });
    run('git', ['push', '--force', 'origin', 'main'], { cwd: work });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  log('offsite backup start');

  const sourceDir = newestDatedDir(readdirSync(BACKUP_ROOT));
  if (!sourceDir) throw new Error(`no dated backup dirs in ${BACKUP_ROOT} — has the nightly ever run?`);

  const passphrase = ensurePassphrase();
  const archiveFiles = buildArchive(sourceDir, sourceDir, passphrase);
  const archiveBytes = archiveFiles.reduce((n, f) => n + bytesOf(join(WEEKLIES_DIR, f)), 0);
  log(`encrypted ${sourceDir} → ${archiveFiles.join(', ')} (${archiveBytes} bytes)`);

  for (const dead of weekliesToPrune(readdirSync(WEEKLIES_DIR), KEEP_WEEKLIES)) {
    rmSync(join(WEEKLIES_DIR, dead), { force: true });
    log(`pruned local weekly ${dead}`);
  }

  ensureRepo();
  const toPush = readdirSync(WEEKLIES_DIR).filter((n) => stampOfWeekly(n) !== null).sort();
  pushToRemote(toPush);
  log(`offsite backup complete: ${toPush.length} archive files live at https://github.com/${REPO} (this week: ${archiveBytes} bytes)`);
}

if (import.meta.main) {
  main().catch((e) => {
    log(`OFFSITE BACKUP FAILED: ${e?.message ?? e}`);
    process.exit(1);
  });
}
