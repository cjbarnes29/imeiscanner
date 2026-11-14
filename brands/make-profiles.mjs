// Generates brands/profiles/*.json from the objects below (so regex backslashes are written correctly). The JSON files are the source of truth that
// Java (Android assets) and the web both read; edit them directly afterwards if you prefer, this script is only a convenience for the first write.
//   node brands/make-profiles.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'profiles');
mkdirSync(out, { recursive: true });

const samsung = {
  schema: 1, id: 'samsung', name: 'Samsung', status: 'active',
  evidence: {
    note: "Evidence must be in THE LABEL'S OWN text. Words are matched as whole words, case-insensitively; code shapes as written (case-sensitive).",
    words: ['SAMSUNG'],
    codeShapes: ['\\bS\\s*M\\s*[-–—]\\s*[A-Z0-9|]{5}']
  },
  model: {
    prefix: 'SM-',
    labelled: '\\bmodel\\s*[:：;.-]?\\s*S\\s*M\\s*[-–—]?\\s*([A-Z0-9|]{5})',
    visible: '\\bS\\s*M\\s*[-–—]\\s*([A-Z0-9|]{5})',
    core: '[A-Z][0-9]{3}[A-Z0-9]',
    digitPositions: [1, 2, 3],
    repairs: { O: '0', D: '0', Q: '0', I: '1', L: '1', '|': '1', T: '1', Z: '2', S: '5', G: '6', b: '6', B: '8' },
    editShape: '^SM-[A-Z][0-9]{3}[A-Z0-9][A-Z0-9/]*$',
    notes: {
      noCode: 'No model code was read. Type the code from the label (for example SM-A165F).',
      unclear: 'The model code could not be read clearly. Check the model.',
      repaired: 'The model code was not clearly readable; read as {prefix}{code}. Check the model.',
      repairedMany: 'The model code was not clearly readable. Check the model.',
      disagree: 'The two model lines disagree ({prefix}{code} / {prefix}{other}). Check the model.',
      different: 'Different model codes were read ({codes}). Check the model.',
      editShape: 'Not a Samsung model code (for example SM-A165F). Check the model.'
    }
  },
  imeiRules: [{
    id: 'same-device-imei1', type: 'shared-digits', from: 8, to: 14, trust: 'observed',
    evidence: 'Seen on every label of three Samsung models in the test data (IMEI 1 and IMEI 2 of one device share digits 9 to 14 and differ in the first 8). Not documented by the manufacturer.',
    note: 'IMEI 1 was taken from its barcode because its printed number could not be read. Check it against the label.'
  }]
};

const generic = {
  schema: 1, id: 'generic', name: 'Unknown brand', status: 'active',
  evidence: { note: "Used when no brand has clear evidence in the label's own text. Checksum validation and the shared layout logic only: no brand rules.", words: [], codeShapes: [] },
  model: { prefix: '', notes: { noCode: 'No model code was read. Type the model from the label.', editShape: 'Check the model against the label.' } },
  imeiRules: []
};

const apple = {
  schema: 1, id: 'apple', name: 'Apple', status: 'draft',
  evidence: {
    note: 'DRAFT: nothing here is verified. Apple stays inactive until at least 20 varied real labels were collected and checked (see brands/SAMPLES.md). The empty lists are placeholders for what the labels show.',
    words: [], codeShapes: []
  },
  model: { prefix: '', notes: { noCode: 'No model code was read. Type the model from the label.', editShape: 'Check the model against the label.' } },
  imeiRules: []
};

for (const profile of [samsung, generic, apple]) writeFileSync(join(out, `${profile.id}.json`), JSON.stringify(profile, null, 2) + '\n');
console.log('wrote', [samsung, generic, apple].map(p => p.id).join(', '));
