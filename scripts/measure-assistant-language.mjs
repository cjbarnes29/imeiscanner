// How much ordinary wording the assistant understands. It runs everyday sentences through the real preview code and compares what the assistant
// would do with what a person meant. It only MEASURES: it never changes anything and always exits 0 unless --min <percent> is given and not reached.
//   node scripts/measure-assistant-language.mjs [--min 80] [--show-failures]
// Synthetic names and IMEIs only (test IMEIs start 49015420).
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const bundled = await build({
  stdin: { contents: "export { previewAssistant } from './src/retail/assistant-actions'; export { emptyState } from './src/retail/data';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'e.ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'empty' }, define: { 'import.meta.env': '{}' }, banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }
});
const dir = await mkdtemp(join(tmpdir(), 'imei-language-'));
const file = join(dir, 'a.mjs');
await writeFile(file, bundled.outputFiles[0].text);
const { previewAssistant, emptyState } = await import(pathToFileURL(file).href);

const luhn = body => { let sum = 0; for (let i = 0; i < body.length; i++) { let n = +body[body.length - 1 - i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; } return String((10 - sum % 10) % 10); };
const imei = n => { const b = '49015420' + String(n).padStart(6, '0'); return b + luhn(b); };
const records = Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, imei: imei(100 + i), model: 'SM-F956B', personId: '', name: 'r' + i, createdAt: '2026-11-18T0' + (i % 10) + ':00:00Z', raw: 'Galaxy Z Fold6' }));
const people = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bilal' }];
const today = '2026-11-19';

const cases = [];
// expected: people.add | people.rename | people.delete | target | give | stock | add-phones | report | calendar | settings | routine | whatsapp | read | none
// extra checks: names (people added), to (new name), id (person removed/renamed), nums (numbers that must show in the preview)
const C = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, ...extra }); };
const area = { 'people.add': 'People: add', 'people.rename': 'People: rename', 'people.delete': 'People: delete', read: 'People/stock: read', target: 'Targets', give: 'Giving phones', stock: 'Stock', 'add-phones': 'Stock: add phones', report: 'Reports', calendar: 'Calendar', settings: 'Settings', routine: 'Routines', whatsapp: 'WhatsApp report', none: 'Must NOT change anything' };

// ---- people: add
C('people.add', { names: ['Khuram', 'Raseen', 'Carlou'] }, 'add 3 person khuram raseen and carlou', 'add 3 people khuram raseen carlou', 'please add khuram, raseen and carlou as people', 'create 3 people: Khuram, Raseen, Carlou', 'i need 3 new promoters khuram raseen and carlou', 'add three people khuram raseen and carlou');
C('people.add', { names: ['Maya'] }, 'add person Maya', 'add a person called maya', 'create a new promoter named Maya', 'can you add maya to the team', 'i want to add maya as a new person', 'please add a person named Maya', 'new person maya', 'register maya as a promoter', 'put maya on the list as a new person', 'add one more person maya', 'can u add a promoter maya', 'add staff member maya', 'make a new person called maya', 'add a team member named maya', 'could you create a new person maya for me', 'we have a new promoter, maya', 'add maya');
C('people.add', { names: ['Omar', 'Lee'] }, 'add 2 people omar and lee', 'add omar and lee as promoters', 'add two promoters omar lee', 'i need two new people omar and lee', 'create people omar, lee', 'add omar & lee to the team');
// ---- people: rename
C('people.rename', { id: 'p1', to: 'Ashley' }, 'rename Asha to Ashley', "change Asha's name to Ashley", 'can you rename asha to ashley', 'update asha name to ashley', 'asha should be called ashley', 'call asha ashley instead', 'edit person asha to ashley', 'i want to rename asha to ashley', 'change the name of asha to ashley', 'fix the spelling of asha, it is ashley', 'asha is now ashley');
C('people.rename', { id: 'p2', to: 'Bilal Khan' }, 'rename bilal to bilal khan', "change bilal's name to bilal khan", 'bilal should be called bilal khan', 'please rename bilal as bilal khan');
// ---- people: delete (asha p1 / bilal p2)
C('people.delete', { id: 'p2' }, 'delete Bilal', 'please delete person bilal', 'remove bilal from the team', 'get rid of bilal', 'take bilal off the list', 'drop promoter bilal', 'can you delete bilal for me', 'remove person bilal', 'bilal left, delete him', "i don't need bilal anymore, remove him", 'delete bilal please', 'remove bilal', 'bilal no longer works here, remove him from the app');
C('people.delete', { id: 'p1' }, 'delete asha', 'remove asha from the people', 'please remove asha, she left', 'get rid of asha', 'asha resigned, delete her');
// ---- read
C('read', {}, 'list people', 'who are my promoters', 'show me the team', 'how many people do i have', 'who is on the team', 'list the promoters', 'show all people');
// ---- targets
C('target', { nums: ['12'] }, 'set Asha flagship 1 target to 12', "set asha's flagship 1 target to 12", 'give asha a flagship 1 target of 12', "asha's target for flagship 1 is 12", 'make asha flagship 1 target 12', 'flagship 1 target for asha should be 12', 'change asha target on flagship 1 to 12', 'increase asha flagship 1 target to 12', 'i want asha to have a flagship 1 target of 12', 'put asha on 12 for flagship 1', 'asha flagship 1 12');
C('target', { nums: ['8'] }, "set everyone's flagship 1 target to 8", 'give everyone a flagship 1 target of 8', 'make all promoters flagship 1 target 8', 'everyone should have flagship 1 target 8', 'set flagship 1 target to 8 for everyone');
C('target', { nums: ['120'] }, 'split store target 120 for Flagship 1 among everyone', 'divide 120 flagship 1 equally between the promoters', 'the store target for flagship 1 is 120, share it between everyone', 'flagship 1 store target is 120, split it evenly', 'set the flagship 1 store target to 120 and divide it among the team', 'we have to do 120 flagship 1 this month, split it between everyone', 'share a flagship 1 target of 120 between the promoters', 'change flagship 3 target to 120 and divide it equally to promoters');
// ---- giving phones
C('give', { nums: ['4', '10'] }, 'give 4 Fold6 to Asha and 10 to Bilal', 'give asha 4 fold6 and bilal 10', 'asha gets 4 fold6 and bilal gets 10 fold6');
C('give', { nums: ['4'] }, 'give asha 4 fold6', 'put 4 fold6 with asha', 'assign 4 fold6 to asha', 'can you give asha 4 fold6 please', 'transfer 4 fold6 to asha', 'asha needs 4 fold6', 'hand 4 fold6 to asha', 'send 4 fold6 to asha', 'give 4 fold6 for asha', 'i want asha to have 4 fold6', 'move 4 fold6 to asha', '4 fold6 to asha', 'let asha have 4 fold6', 'allocate 4 fold6 to asha');
C('give', { okIfBlocked: /Nothing to give/ }, 'auto give', 'give out the phones', 'give the phones to everyone by the limits', 'divide the phones between everyone', 'share the phones out per person', 'give todays phones to the team');
// ---- stock
C('stock', { nums: ['4'] }, 'store 4 fold6', 'hold 4 fold6', 'hold 4 fold6 for now', 'put 4 fold6 in store', 'keep 4 fold6 aside', 'set aside 4 fold6', 'please store 4 fold6', 'make 4 fold6 stored');
C('stock', { nums: ['2'] }, 'make 2 fold6 available', 'release 2 fold6 to available', 'make 2 fold6 available again', 'move 2 fold6 back to available', 'put 2 fold6 back on available');
C('stock', { nums: ['2'] }, 'remove 2 fold6 from stock', 'delete 2 fold6 from stock', 'take 2 fold6 out of stock', 'i sold 2 fold6 elsewhere, remove them from stock', 'remove 2 fold6 from the stock please', 'take 2 fold6 off the stock');
C('add-phones', {}, `add phone stock Fold6 IMEIs ${imei(900)}`, `i received a fold6 imei ${imei(901)}, add it to stock`, `add stock fold6 imei ${imei(902)}`, `new phone fold6 with imei ${imei(903)}`);
// ---- reports
C('report', { nums: ['6'] }, 'set report fold6 to 6', 'change the report fold6 to 6', 'update report fold6 to 6', 'put 6 fold6 in the report', 'report fold6 sold 6', 'i sold 6 fold6 today, put it in the report', 'edit the report: fold6 6');
C('report', {}, "prepare today's report", 'make todays report', 'create the report for 2026-11-20', 'draft the daily report', 'prepare tomorrow report', 'generate the report for today', 'can you make the stock report for today', 'prepare the report');
// ---- calendar
C('calendar', {}, 'mark Asha not available from 2026-11-20 to 2026-11-24', 'asha is on leave from 2026-11-20 to 2026-11-24', 'put asha on annual leave 2026-11-20 to 2026-11-24', 'asha is not available 2026-11-20', 'bilal is unavailable on 2026-11-21', 'bilal off 2026-11-21 to 2026-11-23', 'asha will be away from 2026-11-20 until 2026-11-22', 'mark bilal as on leave 2026-11-21', 'asha not working 2026-11-20', 'bilal is sick on 2026-11-21');
// ---- settings
C('settings', {}, 'turn off auto-detection', 'stop automatic detection', 'store uploads automatically', 'show only plans and warnings on home', 'turn on auto give', 'switch off automatic crop', 'please turn off auto detect', 'i do not want auto detection');
// ---- routines
C('routine', {}, 'create daily routine to prepare today\'s report', 'every day at 9:00 give phones by the limits', 'every weekday at 6pm prepare the report', 'each morning at 9 auto give', 'add a routine to prepare todays report', 'daily task: prepare todays report', 'every monday and friday at 18:30 prepare the report', 'remind me every day at 8 to prepare the report');
// ---- WhatsApp
C('whatsapp', {}, "prepare today's WhatsApp report", 'make the whatsapp report for today', 'prepare a whatsapp report', 'create whatsapp daily report for the group', 'get the whatsapp report ready');
// ---- must NOT change anything (questions, hypotheticals, negations)
C('none', {}, 'what happens if i delete bilal', 'should i remove asha', 'how do i delete a person', "i don't want to delete bilal", 'do not remove asha', 'can i add a person later', 'what does rename do', 'how many phones do we have', 'what is my target', 'who is on leave today', 'how is asha doing', 'hello', 'thanks', 'what can you do', 'is bilal available today', 'never delete anyone', 'cancel', 'why was asha removed', 'tell me about bilal');

const hasChange = p => !!(p.giving.length || p.people || p.business || p.report || p.settings || p.additions?.length);
const kindOf = p => {
  if (!p.handled) return 'none';
  if (p.people) return 'people.' + p.people.ops[0].kind;
  if (p.blockers.length && !hasChange(p)) return 'blocked';
  if (p.giving.length) return 'give';
  if (p.additions?.length) return 'add-phones';
  if (p.report) return 'report';
  if (p.settings) return 'settings';
  if (p.business) { const k = Object.keys(p.business.after); return k.includes('workSchedules') ? 'calendar' : k.includes('targets') || k.includes('storeTargets') ? 'target' : k.includes('recordMeta') ? 'stock' : k.includes('assistantRoutines') ? 'routine' : k.includes('deliveryPackets') ? 'whatsapp' : 'other'; }
  return p.lines.length ? 'read' : 'none';
};
const results = [];
for (const c of cases) {
  const state = { ...emptyState(), assistantRequests: [], recordMeta: Object.fromEntries(records.slice(24).map(r => [r.id, { status: 'held' }])) };
  let p, actual;
  try { p = previewAssistant(state, records, people, today, c.t); actual = kindOf(p); } catch (e) { actual = 'THROWS'; p = { lines: [e.message], blockers: [] }; }
  let ok = c.okIfBlocked && actual === 'blocked' && c.okIfBlocked.test(p.blockers.join(' ')) ? true : c.expected === 'none' ? !hasChange(p) : actual === c.expected;
  if (c.expected === 'read') ok = actual === 'read';
  if (ok && c.names) ok = JSON.stringify(p.people.ops.map(o => o.name.toLowerCase())) === JSON.stringify(c.names.map(n => n.toLowerCase()));
  if (ok && c.to) ok = p.people.ops[0].to?.toLowerCase() === c.to.toLowerCase();
  if (ok && c.id) ok = p.people.ops[0].id === c.id;
  if (ok && c.nums) ok = c.nums.every(n => p.lines.join(' ').includes(n));
  results.push({ ...c, actual, ok, asked: !ok && actual === 'blocked', note: p.blockers[0] || '' });
}
const group = {};
for (const r of results) { const g = (group[area[r.expected]] ||= { total: 0, ok: 0, asked: 0 }); g.total++; if (r.ok) g.ok++; else if (r.asked) g.asked++; }
const total = results.length, passed = results.filter(r => r.ok).length, asked = results.filter(r => r.asked).length;
console.log(`\nEveryday-language check: ${passed} of ${total} understood correctly (${(100 * passed / total).toFixed(0)}%). ${asked} more were understood but the assistant asked for details; ${total - passed - asked} were missed or wrong.\n`);
for (const [name, g] of Object.entries(group)) console.log(`${name.padEnd(28)} ${String(g.ok).padStart(3)}/${String(g.total).padEnd(3)} ok${g.asked ? `, ${g.asked} asked back` : ''}`);
if (process.argv.includes('--show-failures')) { console.log('\nNot understood correctly:'); for (const r of results.filter(r => !r.ok)) console.log(`- [${r.expected} -> ${r.actual}] ${r.t}${r.note ? '   (' + r.note.slice(0, 80) + ')' : ''}`); }
const min = process.argv.indexOf('--min'); if (min > 0 && 100 * passed / total < +process.argv[min + 1]) { console.log(`\nBelow the required ${process.argv[min + 1]}%.`); process.exit(1); }
