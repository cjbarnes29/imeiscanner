// Runs the app's real crop-apply helpers (splitRecords, modelForCrop) and the original-photo release rule.
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('src/App.tsx', 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['luhnValid', 'recordImeiPair', 'modelForCrop', 'splitRecords', 'extractImei1s', 'extractPreferredImei', 'unindexedImeisShim'].filter(n => n !== 'unindexedImeisShim');
let helpers = 'let idCounter = 0; const newId = () => "id" + (++idCounter) + "-abcdefgh";\nconst digits = s => s.replace(/\\D/g, "");\n';
helpers += 'const identifyModel = (text) => { const m = text.match(/\\bSM-[A-Z][0-9]{3}[A-Z0-9]/i); return m ? m[0].toUpperCase() : "Unknown unit — review"; };\n';
for (const name of names) {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Missing app function ${name}`);
  helpers += node.getText(ast) + '\n';
}
helpers += (await readFile('src/serial.ts', 'utf8')).replace(/^import .*$/gm, '');
helpers += (await readFile('src/barcode-imei.ts', 'utf8')).replace(/^import .*$/gm, '');
const layout = ts.createSourceFile('scan-layout.ts', await readFile('src/scan-layout.ts', 'utf8'), ts.ScriptTarget.Latest, true);
helpers += layout.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'exportModel').getText(layout);
helpers += `\nexport { ${names.join(',')} };`;
const runtime = new URL('../verification-crop-apply-runtime.mjs', import.meta.url);
await writeFile(runtime, ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const store = ts.transpileModule(await readFile('src/record-store.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const storeFile = new URL('../verification-record-store-runtime.mjs', import.meta.url);
await writeFile(storeFile, store);
try {
  const f = await import(runtime.href);
  const { orphanedSources } = await import(storeFile.href);

  const A = '352099001761481', B = '353879234252633';
  assert.ok(f.luhnValid(A) && f.luhnValid(B));
  const original = { id: 'orig', pictureId: 'PIC-ORIG', sourcePictureId: 'PIC-SRC', number: 7, personId: 'person-9', name: 'IMG_1.jpg',
    dataUrl: 'data:big-original', originalDataUrl: 'data:big-original', model: 'SM-S938B', imei: '', status: 'Review', duplicate: false, createdAt: 'x', raw: '', cropNeedsReview: true, deviceCount: 2, deviceImeis: [A, B] };
  const crop = (imei, model, raw = `Model : ${model}\nIMEI 1: ${imei}\nS/N: R58X1234ABC`) => ({ cropDataUrl: 'data:crop-' + imei, imei, model, raw });

  // Two products in one photo: every crop is its own record, the person stays, the original photo is gone, nothing is mixed.
  const rows = f.splitRecords(original, [crop(A, 'SM-S938B'), crop(B, 'SM-A165F')], 8);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.imei), [A, B], 'each crop keeps the number read from its own label');
  assert.deepEqual(rows.map(r => r.model), ['SM-S938B', 'SM-A165F'], 'each crop keeps its own model');
  assert.ok(rows.every(r => r.personId === 'person-9'), 'the person stays with every crop');
  assert.deepEqual(rows.map(r => r.number), [7, 8], 'the first crop keeps the number, the next ones follow');
  assert.ok(rows.every(r => r.dataUrl === r.cropDataUrl && r.dataUrl.startsWith('data:crop-')), 'the stored picture is the crop, never the big original');
  assert.ok(rows.every(r => r.originalDataUrl === undefined), 'the original photo is not kept on any record');
  assert.ok(rows.every(r => r.sourcePictureId !== 'PIC-SRC') && rows[0].sourcePictureId === rows[1].sourcePictureId, 'crops form a new group, apart from the original photo');
  assert.equal(new Set(rows.map(r => r.id)).size, 2);
  assert.ok(rows.every(r => r.deviceCount === undefined && r.deviceImeis === undefined && r.status === 'Valid'));
  assert.equal(rows[0].serial, 'R58X1234ABC');

  // A crop that read nothing from a multi-product photo does NOT borrow another product's details.
  const mixed = f.splitRecords({ ...original, imei: A, serial: 'OLDSERIAL', model: 'SM-S938B' }, [crop(A, 'SM-S938B'), { cropDataUrl: 'data:crop-blank', imei: '', model: '', raw: '' }], 8);
  assert.equal(mixed[1].imei, '', 'second product does not inherit the first product IMEI');
  assert.equal(mixed[1].model, 'Unknown unit — review', 'nor its model');
  assert.ok(!mixed[1].serial, 'nor its serial');
  assert.equal(mixed[1].status, 'Review');
  assert.equal(mixed[1].cropNeedsReview, true, 'it is flagged for a manual look');

  // One product cropped once keeps its known numbers when the crop shows none.
  const single = { ...original, deviceCount: undefined, cropNeedsReview: false, imei: A, serial: 'KEEPME12345', imei2: B, model: 'SM-S938B', status: 'Valid' };
  const kept = f.splitRecords(single, [{ cropDataUrl: 'data:tight', imei: '', model: '', raw: '' }], 8)[0];
  assert.equal(kept.imei, A); assert.equal(kept.serial, 'KEEPME12345'); assert.equal(kept.imei2, B);
  assert.equal(kept.personId, 'person-9'); assert.equal(kept.number, 7);
  // …and a crop that did read a number wins over the old one
  assert.equal(f.splitRecords(single, [crop(B, 'SM-S938B')], 8)[0].imei, B);

  // Uncertain readings are flagged
  const flagged = f.splitRecords(original, [{ ...crop(A, 'SM-S938B'), review: true }, crop(B, 'SM-A165F')], 8);
  assert.equal(flagged[0].cropNeedsReview, true); assert.equal(flagged[1].cropNeedsReview, false);

  // Model choice
  const multi = { model: 'SM-S938B', single: false }, one = { model: 'SM-S938B', single: true };
  assert.equal(f.modelForCrop(multi, 'Model : SM-A165F', 2), 'SM-A165F', 'the crop text decides');
  assert.equal(f.modelForCrop(multi, '', 3), 'Unknown unit — review', 'multi-product photo: never copy the old model');
  assert.equal(f.modelForCrop(one, '', 1), 'SM-S938B', 'single product, single crop: keep the known model');
  assert.equal(f.modelForCrop(one, '', 2), 'Unknown unit — review', 'two crops of one record: do not copy');

  // Original photo release
  assert.deepEqual([...orphanedSources([original], [{ sourcePictureId: rows[0].sourcePictureId }])], ['PIC-SRC'], 'the original stored photo is released once its record is replaced by crops');
  assert.deepEqual([...orphanedSources([original], [{ sourcePictureId: 'PIC-SRC' }])], [], 'a photo other records still use is kept');
  assert.deepEqual([...orphanedSources([undefined, { }], [])], [], 'records without a stored photo are ignored');
  console.log('PASS: crops replace the original photo (stored once, original released), each crop keeps its own IMEI/serial/model, the person stays, no details are copied between products, single-product crops keep known numbers, uncertain crops are flagged.');
} finally {
  await unlink(runtime).catch(() => {});
  await unlink(storeFile).catch(() => {});
}
