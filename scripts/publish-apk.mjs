#!/usr/bin/env node
/**
 * Build (optional) and publish the Nabri Android APK as a GitHub Release, then
 * print the NABRI_APK_URL to paste into Vercel.
 *
 * Zero dependencies - Node 18+. Publishing has two paths:
 *   - `gh` CLI when it is installed AND authenticated (`gh auth status`).
 *   - Otherwise the GitHub REST API using a token from, in order:
 *       1. $GH_TOKEN / $GITHUB_TOKEN
 *       2. the git credential manager (`git credential fill` - GCM stores the
 *          PAT/OAuth token used by `git push`), which needs only the `repo`
 *          scope and therefore works even though `gh auth login --with-token`
 *          demands the extra `read:org` scope.
 *
 * Usage:
 *   node scripts/publish-apk.mjs --version 1.0.14
 *   node scripts/publish-apk.mjs --version 1.0.14 --build     # run the gradle release build first
 *   node scripts/publish-apk.mjs --version 1.0.15 --apk C:\some\signed-release.apk
 *   node scripts/publish-apk.mjs --dry-run                    # resolve the plan without touching GitHub
 *
 * The asset is uploaded with the stable name `nabri.apk`, so the published URL
 * is always:
 *   https://github.com/Santhosh33333/2rent--01/releases/download/nabri-v<version>/nabri.apk
 */

import { existsSync, statSync, copyFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_SLUG = 'Santhosh33333/2rent--01';
const WORKFLOW_PATH = '.github/workflows/build-apk-and-release.yml';
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const apiHeaders = (tok) => ({
  Authorization: `Bearer ${tok}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
const args = process.argv.slice(2);
const version = argValue(args, '--version');
const explicitApk = argValue(args, '--apk');
const doBuild = args.includes('--build');
const prerelease = args.includes('--prerelease');
const dryRun = args.includes('--dry-run');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

// ---------------------------------------------------------------------------
// Resolve the APK
// ---------------------------------------------------------------------------
const candidates = [explicitApk].filter(Boolean);
if (!explicitApk) {
  const releaseOut = join('packages', 'web', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const manualCopy = join('packages', 'web', 'apk', 'nabri.apk');
  const rootArtifact = version ? `nabri-app-release-${version}.apk` : undefined;
  candidates.push(join(ROOT, releaseOut));
  candidates.push(join(ROOT, manualCopy));
  if (rootArtifact) candidates.push(join(ROOT, rootArtifact));
}

let apkSource = candidates.find((p) => p && existsSync(p));
const buildable = join(ROOT, 'packages', 'web');

if (!apkSource && doBuild) {
  console.log('\n[apk] No existing APK found - building it now (npm run build && cap:build:release)...\n');
  const build = spawnSync(npm, ['run', 'build'], { cwd: buildable, stdio: 'inherit', shell: isWin });
  if (build.status !== 0) throw new Error('Web build failed.');
  const cap = spawnSync(npm, ['run', 'cap:build:release'], { cwd: buildable, stdio: 'inherit', shell: isWin });
  if (cap.status !== 0) throw new Error('Capacitor release build failed.');
  apkSource = candidates.find((p) => p && existsSync(p));
}

if (!apkSource) {
  console.error(
    [
      '\n[apk] No APK found.',
      '  Checked:',
      ...candidates.map((c) => `    - ${c}`),
      '\n  Build one locally first:',
      '    cd packages/web && npm run build && npm run cap:build:release',
      '  or run this script with --build. Or point at an artifact with:',
      '    node scripts/publish-apk.mjs --apk <path> --version <v>',
      '',
      `  The signing keystore lives locally (gitignored keystore.properties +`,
      `  rentbuddy-release.jks), so the local build is the signed release build.`,
    ].join('\n'),
  );
  process.exit(2);
}

const sizeMb = Math.round((statSync(apkSource).size / (1024 * 1024)) * 10) / 10;
if (sizeMb < 10) {
  console.error(`\n[apk] Suspiciously small for a real app (${sizeMb} MB): ${apkSource}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Version + tag
// ---------------------------------------------------------------------------
let releasedVersion = version;
if (!releasedVersion) {
  const gradle = readFileSync(join(ROOT, 'packages', 'web', 'android', 'app', 'build.gradle'), 'utf8');
  const m = gradle.match(/versionName\s+"([^"]+)"/);
  releasedVersion = m ? m[1] : undefined;
}
if (!releasedVersion) {
  console.error('\n[apk] Could not determine a version. Pass --version <v> (e.g. 1.0.14).\n');
  process.exit(2);
}

const tag = `nabri-v${releasedVersion}`;
const url = `https://github.com/${REPO_SLUG}/releases/download/${tag}/nabri.apk`;

console.log('\n[apk] Plan:');
console.log(`  source   : ${apkSource} (${sizeMb} MB)`);
console.log(`  version  : ${releasedVersion}`);
console.log(`  tag      : ${tag}`);
console.log(`  asset    : nabri.apk (stable name)`);
console.log(`  will URL : ${url}`);

if (dryRun) {
  console.log('\n[apk] Dry run - nothing was published.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers for the two publish paths
// ---------------------------------------------------------------------------
function which(cmd) {
  try {
    execFileSync(isWin ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ghAuthed() {
  const r = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  return r.status === 0;
}

/** Best-effort token from git's credential manager (works on push-configured machines). */
function gitCredentialToken() {
  try {
    const out = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n',
      encoding: 'utf8',
    });
    if (out.status !== 0) return null;
    const line = (out.stdout || '').split('\n').find((l) => l.startsWith('password='));
    return line ? line.slice('password='.length).trim() : null;
  } catch {
    return null;
  }
}

/**
 * gh-free publish: idempotently creates a release for `tag` and uploads the APK
 * as `nabri.apk`. Needs only the `repo` scope.
 */
async function publishViaAPI({ apkSource, version, tag, url, notes, prerelease, token }) {
  const headers = apiHeaders(token);
  const base = `${API}/repos/${REPO_SLUG}`;

  const existing = await fetch(`${base}/releases/tags/${encodeURIComponent(tag)}`, { headers });
  if (existing.status === 200) {
    const rel = await existing.json();
    await fetch(`${base}/releases/${rel.id}`, { method: 'DELETE', headers });
    await fetch(`${base}/git/refs/tags/${encodeURIComponent(tag)}`, { method: 'DELETE', headers });
    console.log(`[apk] Replaced previous release ${tag}.`);
  }

  const created = await fetch(`${base}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name: `Nabri v${version}`,
      body: notes,
      prerelease,
      draft: false,
    }),
  });
  const release = await created.json();
  if (!release.id) {
    throw new Error(`Release create failed (${created.status}): ${JSON.stringify(release)}`);
  }

  const uploaded = await fetch(
    `${UPLOADS}/repos/${REPO_SLUG}/releases/${release.id}/assets?name=nabri.apk`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: readFileSync(apkSource),
    },
  );
  const asset = await uploaded.json();
  if (!asset.browser_download_url) {
    throw new Error(`Asset upload failed (${uploaded.status}): ${JSON.stringify(asset)}`);
  }

  console.log('\n[apk] Published:');
  console.log(`  ${url}`);
}

/** gh path: needs gh installed and authed (also requires `read:org` on the token). */
async function publishViaGH({ apkSource, releasedVersion, tag, notes, prerelease }) {
  const staging = join(tmpdir(), 'nabri-release-publish');
  mkdirSync(staging, { recursive: true });
  const uploadFile = join(staging, 'nabri.apk');
  copyFileSync(apkSource, uploadFile);

  const baseargs = ['release', 'create', tag, uploadFile, '--title', `Nabri v${releasedVersion}`, '--notes', notes];
  if (prerelease) baseargs.push('--prerelease');
  spawnSync('gh', ['release', 'delete', tag, '--yes', '--cleanup-tag'], { stdio: 'inherit' });

  const pub = spawnSync('gh', baseargs, { stdio: 'inherit' });
  rmSync(staging, { recursive: true, force: true });
  if (pub.status !== 0) {
    throw new Error('gh release create failed.');
  }
  console.log('\n[apk] Published:');
  console.log(`  ${url}`);
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------
const signedMark =
  'Release build (signed locally unless built without the keystore).';
const notes = `Nabri Android APK v${releasedVersion}\n\n${signedMark}\n\nAsset URL:\n${url}\n\nSet this URL as \`NABRI_APK_URL\` on the Vercel \`2rent-01\` project to enable the landing/download-page buttons (see DEPLOY_APK.md).\n\nInstall is gated on \`versionCode\` being higher than what users already have - bump \`packages/web/android/app/build.gradle\` before a real update.`;

(async () => {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;

  if (envToken) {
    console.log('\n[apk] Publishing via GitHub REST API (GH_TOKEN).');
    await publishViaAPI({ apkSource, version: releasedVersion, tag, url, notes, prerelease, token: envToken });
  } else if (which('gh') && ghAuthed()) {
    console.log('\n[apk] Publishing via gh CLI.');
    await publishViaGH({ apkSource, releasedVersion, tag, notes, prerelease });
  } else {
    const gitToken = gitCredentialToken();
    if (gitToken) {
      console.log('\n[apk] Publishing via GitHub REST API (git credential manager token).');
      await publishViaAPI({ apkSource, version: releasedVersion, tag, url, notes, prerelease, token: gitToken });
    } else {
      console.error(
        [
          '\n[apk] No working publish path was found.',
          '  - $GH_TOKEN / $GITHUB_TOKEN env var: not set.',
          '  - gh CLI: ' + (which('gh') ? 'installed but NOT authenticated' : 'not installed') + '.',
          '  - git credential manager: returned no token for github.com.',
          '',
          '  Fix any one of these, e.g.:',
          '    set GH_TOKEN=<pat-with-repo-scope>   (simplest, no gh needed)',
          '    winget install GitHub.cli && gh auth login',
          '  or run the workflow instead: Actions -> "Build APK and publish a GitHub Release".',
          '',
        ].join('\n'),
      );
      process.exit(3);
    }
  }

  console.log('\nNext steps:');
  console.log(`  1. Vercel dashboard (2rent-01 project) -> Settings -> Environment Variables:`);
  console.log(`     Name: NABRI_APK_URL   Value: ${url}`);
  console.log(`     (or: npx vercel env add NABRI_APK_URL production)`);
  console.log('  2. Redeploy the web app so the build bakes the URL in:');
  console.log('     npx vercel --prod        (or push to the branch Vercel watches)');
  console.log('  3. Render auto-deploys the API on push (render.yaml autoDeploy: true);');
  console.log('     for a manual redeploy: Render dashboard -> rentbuddy-api -> Manual Deploy -> Deploy latest commit.');
  console.log('\nRunbook: DEPLOY_APK.md\n');
})().catch((err) => {
  console.error(`\n[apk] Publish failed: ${err.message}\n`);
  process.exit(4);
});