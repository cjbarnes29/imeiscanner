// Release gate for an APK. Used by .github/workflows/beta-release.yml before anything is published, and runnable by hand:
//   node scripts/verify-apk.mjs --apk AI-LENS.apk --kind main --cert <expected signer SHA-256>
//   node scripts/verify-apk.mjs --apk AI-LENS-Test.apk --kind test
// It refuses (exit 1) unless the package id, version, app label and signing certificate are what that kind of release must have, so a test
// APK can never go out as the main app, and a main APK signed with the wrong key (which could not update the installed app) never goes out.
// The decision logic (checkApk) is pure and unit-tested in scripts/test-verify-apk.mjs. No key or password is ever read or printed here.
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

export const MAIN_PACKAGE = 'com.imeilens.scanner';
export const TEST_PACKAGE = 'com.imeilens.scanner.phonetest';

/** Reads versionCode and versionName from android/app/build.gradle (the single source of truth). */
export function gradleVersion(text) {
  return { code: text.match(/versionCode\s+(\d+)/)?.[1] || '', name: text.match(/versionName\s+'([^']+)'/)?.[1] || '' };
}

/** Pulls the facts out of `aapt2 dump badging` and `apksigner verify --print-certs` text. */
export function parseFacts(badging, signer) {
  const pkg = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m);
  return {
    package: pkg?.[1] || '', versionCode: pkg?.[2] || '', versionName: pkg?.[3] || '',
    label: badging.match(/^application-label:'([^']*)'/m)?.[1] || '',
    verifies: /^Verifies\s*$/m.test(signer),
    signers: [...signer.matchAll(/^\s*Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})/gm)].map(m => m[1].toLowerCase())
  };
}

/**
 * Returns the list of problems; an empty list means the APK may be published.
 * kind "main": the real app. kind "test": the isolated test app. `cert` (hex SHA-256 of the signing certificate) is REQUIRED for "main".
 */
export function checkApk(facts, expected) {
  const problems = [];
  const main = expected.kind === 'main';
  if (!['main', 'test'].includes(expected.kind)) return [`Unknown kind "${expected.kind}" (use main or test).`];
  const wantPackage = main ? MAIN_PACKAGE : TEST_PACKAGE;
  if (facts.package !== wantPackage) problems.push(`Package is "${facts.package}" but a ${expected.kind} release must be "${wantPackage}".`);
  if (!facts.verifies) problems.push('apksigner did not verify the APK signature.');
  if (expected.versionCode && facts.versionCode !== expected.versionCode) problems.push(`versionCode is ${facts.versionCode} but android/app/build.gradle says ${expected.versionCode}.`);
  if (expected.versionName) {
    const want = main ? expected.versionName : `${expected.versionName}-phonetest`;
    if (facts.versionName !== want) problems.push(`versionName is "${facts.versionName}" but should be "${want}".`);
  }
  const testLabel = /test/i.test(facts.label);
  if (main && testLabel) problems.push(`The app label is "${facts.label}": a test label must never be published as the main app.`);
  if (!main && !testLabel) problems.push(`The app label is "${facts.label}": a test release must be labelled as a test app.`);
  if (facts.signers.length !== 1) problems.push(`Expected exactly one signing certificate, found ${facts.signers.length}.`);
  if (main) {
    const want = String(expected.cert || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (want.length !== 64) problems.push('No valid expected signing certificate (SHA-256) was given. A main APK is only published when its certificate matches the one on the installed app.');
    else if (facts.signers[0] !== want) problems.push(`Signed with certificate ${facts.signers[0]?.slice(0, 16)}… but the installed app uses ${want.slice(0, 16)}…: it could not update the installed app without uninstalling it (losing its data).`);
  }
  return problems;
}

function findTool(name, home) {
  const tools = join(home, 'build-tools');
  if (!existsSync(tools)) return '';
  const extensions = process.platform === 'win32' ? ['.exe', '.bat', '.cmd'] : ['']; // on Windows the extension-less file is a shell script that cannot run
  for (const v of readdirSync(tools).sort().reverse()) for (const ext of extensions) { const p = join(tools, v, name + ext); if (existsSync(p)) return p; }
  return '';
}

function cli(argv) {
  const arg = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : ''; };
  const apk = arg('apk'), kind = arg('kind') || 'main', cert = arg('cert') || process.env.EXPECTED_APK_CERT_SHA256 || '';
  if (!apk || !existsSync(apk)) { console.error('Give --apk <file>.'); return 2; }
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
  const aapt2 = arg('aapt2') || findTool('aapt2', home), signer = arg('apksigner') || findTool('apksigner', home);
  if (!aapt2 || !signer) { console.error('aapt2 / apksigner not found. Set ANDROID_HOME or pass --aapt2 and --apksigner.'); return 2; }
  const run = (file, args) => { try { return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: /\.(bat|cmd)$/i.test(file) }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
  const badging = run(aapt2, ['dump', 'badging', apk]), signed = run(signer, ['verify', '--verbose', '--print-certs', apk]);
  const gradle = gradleVersion(readFileSync(arg('gradle') || 'android/app/build.gradle', 'utf8'));
  const facts = parseFacts(badging, signed), problems = checkApk(facts, { kind, cert, versionCode: gradle.code, versionName: gradle.name });
  console.log(`APK ${apk}\n  package ${facts.package} · version ${facts.versionName} (${facts.versionCode}) · label "${facts.label}"\n  signer SHA-256 ${facts.signers.join(', ') || 'none'} · signature ${facts.verifies ? 'verifies' : 'DOES NOT verify'}`);
  if (facts.signers.length !== 1) console.error(`\nSigning tool output (public certificate details only; shown because the number of certificates is not 1):\n${signed.split(/\r?\n/).filter(l => /Signer|signers|Verif|ERROR|error|DOES NOT/i.test(l) && !/^WARNING: (?:A restricted|java\.lang|Use --enable|Restricted)/.test(l)).slice(0, 20).join('\n') || '(no matching lines)'}\nTool: ${signer || 'unknown'}`);
  if (!facts.verifies || !facts.package) console.error(`\nTool output (to diagnose a failure; it contains no secrets):\n${(!facts.package ? badging : signed).slice(0, 500).trim()}`);
  if (problems.length) { console.error(`\nNOT PUBLISHABLE (${kind}):\n- ${problems.join('\n- ')}`); return 1; }
  console.log(`\nOK: this is a valid ${kind} release APK.`);
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) process.exit(cli(process.argv.slice(2)));
