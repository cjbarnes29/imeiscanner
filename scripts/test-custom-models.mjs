// Your own Samsung model names: code cleanup, file import, and the add / replace / delete behaviour.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-custom-'));
try {
  const compile = async (name, patch = text => text) => writeFile(join(dir, `${name}.mjs`),
    patch(ts.transpileModule(await readFile(`src/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText));
  await compile('samsung-models');
  await compile('phone-names', text => text.replace("'./samsung-models'", "'./samsung-models.mjs'"));
  await compile('custom-models', text => text.replace("'./samsung-models'", "'./samsung-models.mjs'"));
  const { normalizeCode, cleanName, parseModelFile, scannedDevices } = await import(pathToFileURL(join(dir, 'custom-models.mjs')).href);
  const { phoneInfo } = await import(pathToFileURL(join(dir, 'phone-names.mjs')).href);

  // Codes are reduced to the four characters shared by every region and colour.
  for (const text of ['SM-R420', 'sm-r420b', 'R420', ' SM-R420B/DS ', 'Model: SM-R420U1', 'SM R420']) assert.equal(normalizeCode(text), 'R420', text);
  for (const text of ['', 'hello', 'SM-', 'code', '1234']) assert.equal(normalizeCode(text), '', `"${text}" is not a code`);
  assert.equal(cleanName('  Galaxy   Buds3 FE \n'), 'Galaxy Buds3 FE');
  assert.equal(cleanName('x'.repeat(200)).length, 80);

  // Files: text lines, quoted CSV with a header, JSON map, JSON list, and the app's catalog file.
  let parsed = parseModelFile('SM-Z999, Galaxy Test One\nsm-y888;Galaxy Test Two\n\nnonsense line');
  assert.deepEqual(parsed.entries, { Z999: 'Galaxy Test One', Y888: 'Galaxy Test Two' });
  assert.equal(parsed.skipped, 1);
  parsed = parseModelFile('﻿model code,name\n"SM-Z999","Galaxy, Test One"\n');
  assert.deepEqual(parsed.entries, { Z999: 'Galaxy, Test One' }, 'quoted names keep their comma');
  assert.equal(parsed.skipped, 1, 'the header line is skipped');
  assert.deepEqual(parseModelFile('{"R420":"Galaxy Buds3 FE","bad":"x"}').entries, { R420: 'Galaxy Buds3 FE' });
  assert.deepEqual(parseModelFile('[{"modelCode":"SM-Z111","name":"A"},{"code":"Z222","name":"B"},{"name":"no code"}]').entries, { Z111: 'A', Z222: 'B' });
  assert.deepEqual(parseModelFile('{"products":[{"modelCode":"SM-S948BZKOMDA","name":"Galaxy S26 Ultra"}]}').entries, { S948: 'Galaxy S26 Ultra' });
  assert.deepEqual(parseModelFile('{ broken json').entries, {});

  // Using the names: yours first, built-in next; deleting yours brings the built-in name back.
  assert.equal(phoneInfo('SM-Z999B').name, 'Galaxy Z999', 'unknown code before adding');
  assert.equal(phoneInfo('SM-Z999B', [], { Z999: 'Galaxy My Phone' }).name, 'Galaxy My Phone', 'your name is shown');
  assert.equal(phoneInfo('SM-R420B', [], { R420: 'My Buds' }).name, 'My Buds', 'yours replaces a built-in name');
  assert.equal(phoneInfo('SM-R420B', [], {}).name, 'Galaxy Buds3 FE', 'after deleting yours the built-in name is back');
  assert.equal(phoneInfo('SM-S948B', [{ name: 'Catalog Name', modelCode: 'SM-S948B' }], { S948: 'Mine' }).name, 'Mine', 'yours beats the catalog');
  assert.equal(phoneInfo('SM-Z999B', [], { Z999: 'My Watch' }).series, 'Watch series', 'series follows the name');
  // Devices check: which scanned models are known, and from where.
  const scan = ['SM-R420B', 'SM-R420', 'SM-S948B/DS', 'SM-Z999B', 'SM-Z999F', 'SM-Z999U', 'SM-Q777', 'SM-A376B', 'Unknown', '', 'iPhone 15'];
  const { rows, noCode } = scannedDevices(scan, { A376: 'My A37' }, [{ name: 'Catalog Q', modelCode: 'SM-Q777ZKA' }]);
  assert.equal(noCode, 3, 'Unknown, blank and non-Samsung text have no model code');
  const by = Object.fromEntries(rows.map(r => [r.code, r]));
  assert.deepEqual([by.R420.source, by.R420.count, by.R420.name], ['built-in', 2, 'Galaxy Buds3 FE']);
  assert.deepEqual([by.S948.source, by.S948.name], ['built-in', 'Galaxy S26 Ultra']);
  assert.deepEqual([by.A376.source, by.A376.name], ['mine', 'My A37'], 'your name wins over built-in');
  assert.deepEqual([by.Q777.source, by.Q777.name], ['catalog', 'Catalog Q']);
  assert.deepEqual([by.Z999.source, by.Z999.count, by.Z999.name], ['missing', 3, ''], 'unknown code is missing, counted across suffixes');
  assert.equal(rows[0].code, 'Z999', 'missing codes are listed first');
  assert.equal(scannedDevices(['SM-Z999B'], { Z999: 'Now known' }, []).rows[0].source, 'mine', 'adding a name moves it out of missing');
  console.log('PASS: model codes cleaned, files imported (text, CSV, JSON, catalog), and your names replace built-in ones until deleted.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
