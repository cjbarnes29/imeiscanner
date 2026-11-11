// Checks that scanned Samsung model codes are shown as readable names (e.g. SM-R420B -> Galaxy Buds3 FE).
// The expected list below is typed out separately from src/samsung-models.ts on purpose.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-models-'));
try {
  const compile = async (name, patch = text => text) => writeFile(join(dir, `${name}.mjs`),
    patch(ts.transpileModule(await readFile(`src/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText));
  await compile('samsung-models');
  await compile('phone-names', text => text.replace("'./samsung-models'", "'./samsung-models.mjs'"));
  const { phoneInfo } = await import(pathToFileURL(join(dir, 'phone-names.mjs')).href);

  const expected = [
    // 2026
    ['SM-A576', 'Galaxy A57 5G'], ['SM-A376', 'Galaxy A37 5G'], ['SM-A276', 'Galaxy A27 5G'], ['SM-A176', 'Galaxy A17 5G'],
    ['SM-A175', 'Galaxy A17'], ['SM-A085', 'Galaxy A08'], ['SM-A075', 'Galaxy A07'],
    ['SM-S948', 'Galaxy S26 Ultra'], ['SM-S947', 'Galaxy S26+'], ['SM-S942', 'Galaxy S26'], ['SM-S741', 'Galaxy S26 FE'],
    ['SM-F978', 'Galaxy Z Fold8 Ultra'], ['SM-F976', 'Galaxy Z Fold8'], ['SM-F971', 'Galaxy Z Fold8'], ['SM-F776', 'Galaxy Z Flip8'],
    ['SM-L715', 'Galaxy Watch Ultra2 LTE'],
    ['SM-L350', 'Galaxy Watch9 44mm'], ['SM-L355', 'Galaxy Watch9 44mm LTE'], ['SM-L340', 'Galaxy Watch9 40mm'], ['SM-L345', 'Galaxy Watch9 40mm LTE'],
    ['SM-R640', 'Galaxy Buds4 Pro'], ['SM-R540', 'Galaxy Buds4'],
    // 2025
    ['SM-A566', 'Galaxy A56 5G'], ['SM-A366', 'Galaxy A36 5G'], ['SM-A266', 'Galaxy A26 5G'], ['SM-A166', 'Galaxy A16 5G'],
    ['SM-A165', 'Galaxy A16'], ['SM-A066', 'Galaxy A06 5G'], ['SM-A065', 'Galaxy A06'],
    ['SM-S938', 'Galaxy S25 Ultra'], ['SM-S937', 'Galaxy S25 Edge'], ['SM-S936', 'Galaxy S25+'], ['SM-S931', 'Galaxy S25'], ['SM-S731', 'Galaxy S25 FE'],
    ['SM-F966', 'Galaxy Z Fold7'], ['SM-F766', 'Galaxy Z Flip7'], ['SM-F761', 'Galaxy Z Flip7 FE'],
    ['SM-L705', 'Galaxy Watch Ultra 2025 LTE'],
    ['SM-L500', 'Galaxy Watch8 Classic 46mm'], ['SM-L505', 'Galaxy Watch8 Classic 46mm LTE'],
    ['SM-L330', 'Galaxy Watch8 44mm'], ['SM-L335', 'Galaxy Watch8 44mm LTE'], ['SM-L320', 'Galaxy Watch8 40mm'], ['SM-L325', 'Galaxy Watch8 40mm LTE'],
    ['SM-R420', 'Galaxy Buds3 FE'],
  ];
  assert.equal(expected.length, 45, 'the full list is checked');

  // Every listed code is recognised as typed, with a regional suffix, dual-SIM text and lowercase.
  for (const [code, name] of expected) {
    for (const scanned of [code, `${code}B`, `${code}B/DS`, `${code}F`.toLowerCase(), `Model: ${code}U1`]) {
      assert.equal(phoneInfo(scanned).name, name, `${scanned} -> ${name}`);
    }
  }
  // A catalog entry for the same code never replaces the listed name.
  assert.equal(phoneInfo('SM-S948B', [{ name: 'Galaxy S26 Ultra Enterprise Edition', modelCode: 'SM-S948BZKOMDA' }]).name, 'Galaxy S26 Ultra');

  // Kind and series are readable too.
  assert.equal(phoneInfo('SM-R420B').series, 'Buds series');
  assert.equal(phoneInfo('SM-R640B').series, 'Buds series');
  assert.equal(phoneInfo('SM-L330').series, 'Watch series');
  assert.equal(phoneInfo('SM-L715').series, 'Watch series');
  assert.equal(phoneInfo('SM-F978B').series, 'Fold series');
  assert.equal(phoneInfo('SM-F761B').series, 'Flip series');
  assert.equal(phoneInfo('SM-S948B').series, 'S26 series');
  assert.equal(phoneInfo('SM-S937B').series, 'S25 series');
  assert.equal(phoneInfo('SM-S741B').series, 'S26 series');
  assert.equal(phoneInfo('SM-A576B').series, 'A57 series');

  // Codes outside the list still use the old rules, and unknown text stays unknown.
  assert.equal(phoneInfo('SM-S918B').name, 'Galaxy S23 Ultra');
  assert.equal(phoneInfo('').name, 'Unknown phone');
  console.log('PASS: all 45 listed Samsung codes show their readable names (with regional suffixes, lowercase and catalog entries present), with the right Watch / Buds / Fold / Flip / S series.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
