// Release gate (scripts/verify-apk.mjs): the decision logic, with fixtures shaped like real `aapt2 dump badging` and `apksigner` output. No SDK needed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkApk,parseFacts,gradleVersion,MAIN_PACKAGE,TEST_PACKAGE} from './verify-apk.mjs';

const CERT = 'f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27', OTHER = '12423823ce3d82cb' + 'a'.repeat(48);
const badging = (pkg, name, label, code = '47') => `package: name='${pkg}' versionCode='${code}' versionName='${name}' platformBuildVersionName='15' platformBuildVersionCode='35'\nsdkVersion:'24'\napplication-label:'${label}'\napplication-label-en:'${label}'\n`;
const signed = (...certs) => `Verifies\n${certs.map((c, i) => `Signer #${i + 1} certificate DN: C=US, O=Android, CN=Android Debug\nSigner #${i + 1} certificate SHA-256 digest: ${c}\nSigner #${i + 1} certificate SHA-1 digest: 0000\n`).join('')}`;
const main = (over = {}) => parseFacts(badging(MAIN_PACKAGE, '1.27.4', 'AI LENS'), signed(CERT)) && { ...parseFacts(badging(MAIN_PACKAGE, '1.27.4', 'AI LENS'), signed(CERT)), ...over };
const test = (over = {}) => ({ ...parseFacts(badging(TEST_PACKAGE, '1.27.4-phonetest', 'AI LENS Test'), signed(OTHER)), ...over });
const wantMain = { kind: 'main', cert: CERT, versionCode: '47', versionName: '1.27.4' }, wantTest = { kind: 'test', versionCode: '47', versionName: '1.27.4' };
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS:', name); };

check('a correct main APK passes: right package, version, label, one signer, the installed app\'s certificate', () => {
  assert.deepEqual(checkApk(main(), wantMain), []);
  assert.deepEqual(checkApk(main(), { ...wantMain, cert: CERT.toUpperCase().replace(/(..)(?!$)/g, '$1:') }), [], 'a fingerprint written with colons and capitals is accepted');
});

check('a main APK signed with any other key is refused, with the reason (it could not update the installed app)', () => {
  const p = checkApk(main({ signers: [OTHER] }), wantMain);
  assert.equal(p.length, 1); assert.match(p[0], /could not update the installed app without uninstalling/);
});

check('without an expected certificate a main APK is never published (signing compatibility cannot be guaranteed)', () => {
  for (const cert of ['', undefined, 'abc', 'zz'.repeat(32)]) assert.match(checkApk(main(), { ...wantMain, cert }).join(' '), /No valid expected signing certificate/);
});

check('a test APK can never be published as the main app, in either direction', () => {
  assert.match(checkApk(test(), wantMain).join(' '), /must be "com\.imeilens\.scanner"/);
  assert.match(checkApk(test({ package: MAIN_PACKAGE, signers: [CERT] }), wantMain).join(' '), /test label must never be published as the main app/, 'a test label on the main package is refused');
  assert.match(checkApk(main(), wantTest).join(' '), /must be "com\.imeilens\.scanner\.phonetest"/, 'the main app is not accepted as a test release');
  assert.match(checkApk(main({ package: TEST_PACKAGE }), wantTest).join(' '), /labelled as a test app/, 'a test release must say test in its label');
});

check('a valid test APK passes without a certificate (it has its own app id and cannot touch the main app)', () => {
  assert.deepEqual(checkApk(test(), wantTest), []);
});

check('version mismatches, unverified signatures, several signers and unknown kinds are refused', () => {
  assert.match(checkApk(main({ versionCode: '46' }), wantMain).join(' '), /versionCode is 46 but android\/app\/build\.gradle says 47/);
  assert.match(checkApk(main({ versionName: '1.27.2' }), wantMain).join(' '), /versionName is "1\.27\.2" but should be "1.27.4"/);
  assert.match(checkApk(test({ versionName: '1.27.4' }), wantTest).join(' '), /should be "1.27.4-phonetest"/, 'a test build must carry the -phonetest suffix');
  assert.match(checkApk(main({ verifies: false }), wantMain).join(' '), /did not verify/);
  assert.match(checkApk(main({ signers: [CERT, OTHER] }), wantMain).join(' '), /exactly one signing certificate, found 2/);
  assert.match(checkApk(main({ signers: [] }), wantMain).join(' '), /found 0/);
  assert.match(checkApk(main(), { ...wantMain, kind: 'production' })[0], /Unknown kind/);
});

check('parsing real-shaped tool output, and reading the version from build.gradle', () => {
  const f = parseFacts(badging(MAIN_PACKAGE, '1.27.4', 'AI LENS'), signed(CERT));
  assert.deepEqual([f.package, f.versionCode, f.versionName, f.label, f.verifies, f.signers], [MAIN_PACKAGE, '47', '1.27.4', 'AI LENS', true, [CERT]]);
  assert.equal(parseFacts('', '').package, '', 'empty tool output never looks valid'); assert.equal(parseFacts('', 'Verifies\n').signers.length, 0);
  assert.equal(parseFacts(badging(MAIN_PACKAGE, '1', 'x'), 'DOES NOT VERIFY\nSigner #1 certificate SHA-256 digest: ' + CERT).verifies, false);
  assert.deepEqual(parseFacts('', 'Verifies' + '\n' + '  Signer #1 certificate SHA-256 digest: ' + CERT + '\n').signers, [CERT], 'an indented digest line (other tool versions) is still read');
  const g = gradleVersion(readFileSync('android/app/build.gradle', 'utf8'));
  assert.match(g.code, /^\d+$/); assert.match(g.name, /^\d+\.\d+\.\d+$/);
});

console.log(count + ' APK release gate checks passed');
