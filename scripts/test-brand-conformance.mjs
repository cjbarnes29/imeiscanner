// Brand profiles on the web side: the SAME conformance file as the Java tests (brands/conformance/samsung.json) must hold, so the two readers cannot drift.
// Also: the brand decision, old records without a brand, and unknown-brand records accepting free-text models (a person's typing is the confirmation).
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'imei-brands-'));
const transpile = async (file) => ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
await writeFile(join(dir, 'brand-engine.mjs'), await transpile('src/brand-engine.ts'));
const profiles = {};
for (const id of ['samsung', 'generic', 'apple']) profiles[id] = JSON.parse(await readFile(`brands/profiles/${id}.json`, 'utf8'));
// brands.ts imports the JSON profiles: give it the same data from disk instead of the bundler.
let registry = await transpile('src/brands.ts');
registry = registry.replace(/import (\w+) from '\.\.\/brands\/profiles\/\w+\.json';\n/g, '').replace("from './brand-engine'", `from '${pathToFileURL(join(dir, 'brand-engine.mjs')).href}'`);
await writeFile(join(dir, 'brands.mjs'), `const samsung=${JSON.stringify(profiles.samsung)},generic=${JSON.stringify(profiles.generic)},apple=${JSON.stringify(profiles.apple)};\n${registry}`);
const engine = await import(pathToFileURL(join(dir, 'brand-engine.mjs')).href);
const brands = await import(pathToFileURL(join(dir, 'brands.mjs')).href);

const conformance = JSON.parse(await readFile('brands/conformance/samsung.json', 'utf8'));
for (const c of conformance.evidence) assert.equal(engine.hasEvidence(profiles.samsung, c.text), c.match, `evidence: ${JSON.stringify(c.text)}`);
for (const c of conformance.editShape) assert.equal(engine.looksLikeModelCode(profiles.samsung, c.model), c.ok, `edit shape: ${JSON.stringify(c.model)}`);

// the brand decision: one clear brand, else generic + unclear; a draft brand never takes part
const all = Object.values(profiles);
assert.deepEqual(engine.detectBrand(all, 'SAMSUNG\nModel : SM-A165F/DS'), { brand: profiles.samsung, unclear: false });
for (const text of ['iPhone 16 Pro Apple', 'Xiaomi Redmi', '', 'IMEI 1 : 1234']) {
  const d = engine.detectBrand(all, text);
  assert.equal(d.brand.id, 'generic', text); assert.equal(d.unclear, true, text);
}
assert.equal(profiles.apple.status, 'draft', 'Apple stays a draft until 20 real labels were verified');

// records: old ones (no brand field) keep working; unknown brand = free text
assert.equal(brands.brandOf({ model: 'SM-A165F' }).id, 'samsung', 'old Samsung record');
assert.equal(brands.brandOf({ model: 'iPhone 16' }).id, 'generic', 'old non-Samsung record');
assert.equal(brands.brandOf({ brand: 'samsung', model: '' }).id, 'samsung');
assert.equal(brands.brandOf({ brand: 'unheard-of' }).id, 'generic', 'unknown id falls back to generic');
assert.equal(brands.typedModelOk({ brand: 'samsung' }, 'SM-A16SF'), false);
assert.equal(brands.typedModelOk({ brand: 'samsung' }, 'SM-A165F'), true);
assert.equal(brands.typedModelOk({ brand: 'generic' }, 'iPhone 16 Pro'), true, 'a person typed it: accepted for an unknown brand');
assert.equal(brands.typedModelOk({ brand: 'generic' }, '   '), false, 'empty is never a confirmed model');
assert.match(brands.typedModelNote({ brand: 'samsung' }, 'SM-A16SF'), /Not a Samsung model code/);
assert.equal(brands.typedModelNote({ brand: 'generic' }, 'iPhone 16 Pro'), '');
console.log('brand conformance (web): ok');
