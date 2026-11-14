// Phone camera modes: unknown settings fall back to "scan right away", and every camera outcome has a plain sentence (failures are never silent).
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-cammode-'));
await writeFile(join(dir,'camera-mode.mjs'),ts.transpileModule(await readFile('src/camera-mode.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const m=await import(pathToFileURL(join(dir,'camera-mode.mjs')).href);

assert.deepEqual(m.CAMERA_MODES.map(x=>x.value),['now','series','collect']);
assert.equal(m.normalizeCameraMode('series'),'series');
assert.equal(m.normalizeCameraMode('collect'),'collect');
for(const bad of [undefined,null,'',' now','NOW','burst',3,{}])assert.equal(m.normalizeCameraMode(bad),'now',`fallback for ${String(bad)}`);

assert.match(m.cameraMessage({state:'queued'},'now'),/scanning it in the background/i);
assert.match(m.cameraMessage({state:'queued'},'series'),/opens again/i);
assert.match(m.cameraMessage({state:'waiting',waiting:1},'collect'),/^1 photo waiting/);
assert.match(m.cameraMessage({state:'waiting',waiting:3},'collect'),/^3 photos waiting/);
assert.match(m.cameraMessage({state:'cancelled',waiting:0},'now'),/No photo was taken/);
assert.match(m.cameraMessage({state:'cancelled',waiting:2},'collect'),/2 photos still waiting/);
assert.match(m.cameraMessage({state:'kept',waiting:1},'now'),/photo was saved/);
assert.match(m.cameraMessage({state:'denied'},'now'),/permission/i);
assert.match(m.cameraMessage({state:'unavailable'},'now'),/No camera app/);
assert.match(m.cameraMessage({state:'failed'},'now'),/could not be saved/);
assert.match(m.cameraMessage({},'now'),/could not be saved/,'an unknown outcome is reported as a failure, not hidden');
assert.match(m.cameraMessage({state:'waiting',waiting:-4},'collect'),/^0 photos waiting/);
assert.doesNotMatch(m.cameraMessage({state:'waiting',waiting:'abc'},'collect'),/NaN/);
console.log('camera mode tests passed');
