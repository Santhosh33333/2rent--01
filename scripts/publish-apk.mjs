#!/usr/bin/env node
/**
 * Build (optional) and publish the Nabri Android APK as a GitHub Release, then
 * print the NABRI_APK_URL to paste into Vercel.
 *
 * Zero dependencies - Node 18+. Uses the `gh` CLI if it is installed. When it
 * is not, the script prints the exact commands to run once `gh` is available,
 * rather than silently doing nothing.
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

import { existsSync, statSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_SLUG = 'Santhosh33333/2rent--01';
const WORKFLOW_PATH = '.github/workflows/build-apk-and-release.yml';

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

if (dryRun && (!version || doBuild)) {
  // still allow any combo; dry-run just never calls gh
}

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
// gh presence
// ---------------------------------------------------------------------------
function which(cmd) {
  try {
    execFileSync(isWin ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!which('gh')) {
  console.error(
    [
      '\n[apk] The `gh` CLI is not installed, so nothing was published.',
      '  Install it from https://cli.github.com/, authenticate (gh auth login),',
      '  then either:',
      '    a) Re-run this script:',
      `       node scripts/publish-apk.mjs --version ${releasedVersion} --apk "${apkSource}"`,
      '    b) Or publish from any GitHub Actions run (no local tooling needed):',
      `       Actions -> "Build APK and publish a GitHub Release" -> Run workflow`,
      `       version: ${releasedVersion}   (signed if your ANDROID_KEYSTORE_BASE64 secret is set)`,
      '',
      '  The workflow to do this in CI already exists: ' + WORKFLOW_PATH,
      '',
    ].join('\n'),
  );
  process.exit(3);
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------
const staging = join(tmpdir(), 'nabri-release-publish');
mkdirSync(staging, { recursive: true });
const uploadFile = join(staging, 'nabri.apk');
copyFileSync(apkSource, uploadFile);

const signedMark = 'Release build (signed locally unless built without the keystore).';
const notes = `Nabri Android APK v${releasedVersion}\n\n${signedMark}\n\nAsset URL:\n${url}\n\nSet this URL as \`NABRI_APK_URL\` on the Vercel \`2rent-01\` project to enable the landing/download-page buttons (see DEPLOY_APK.md).\n\nInstall is gated on \`versionCode\` being higher than what users already have - bump \`packages/web/android/app/build.gradle\` before a real update.`;

const baseargs = ['release', 'create', tag, uploadFile, '--title', `Nabri v${releasedVersion}`, '--notes', notes];
if (prerelease) baseargs.push('--prerelease');

// replace a prior release of the same tag so re-runs are idempotent
spawnSync('gh', ['release', 'delete', tag, '--yes', '--cleanup-tag'], { stdio: 'inherit' });

const pub = spawnSync('gh', baseargs, { stdio: 'inherit' });
rmSync(staging, { recursive: true, force: true });

if (pub.status !== 0) {
  console.error('\n[apk] gh release create failed. Nothing was published.\n');
  process.exit(4);
}

console.log('\n[apk] Published:');
console.log(`  ${url}`);
console.log('\nNext steps:');
console.log(`  1. Vercel dashboard (2rent-01 project) -> Settings -> Environment Variables:`);
console.log(`     Name: NABRI_APK_URL   Value: ${url}`);
console.log(`     (or: npx vercel env add NABRI_APK_URL production)`);
console.log('  2. Redeploy the web app so the build bakes the URL in:');
console.log('     npx vercel --prod        (or push to the branch Vercel watches)');
console.log('  3. Render auto-deploys the API on push (render.yaml autoDeploy: true);');
console.log('     for a manual redeploy: Render dashboard -> rentbuddy-api -> Manual Deploy -> Deploy latest commit.');
console.log('\nRunbook: DEPLOY_APK.md\n');