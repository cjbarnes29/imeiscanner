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

// ---- HELD-OUT: written after the wording work, never used to tune it. If these score far below the tuned groups, the improvement is overfitted.
const H = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: true, ...extra }); };
H('people.add', { names: ['Tariq'] }, 'add a new promoter named Tariq', 'hey, can you register Tariq as a new person', 'add Tariq to my team', 'we need a promoter called Tariq', 'create a person for Tariq', 'put Tariq into the people list', 'add promoter Tariq please', 'new team member Tariq');
H('people.add', { names: ['Imran', 'Faisal'] }, 'i hired two people, Imran and Faisal', 'add 2 people Imran Faisal', 'we have two new promoters imran and faisal');
H('people.rename', { id: 'p1', to: 'Ashley' }, 'change Asha to Ashley', "Asha's name is wrong, it should be Ashley", 'please change asha to ashley', "update Asha's name to Ashley please", 'rename asha, she is ashley');
H('people.delete', { id: 'p2' }, 'Bilal quit, take him out of the app', 'remove bilal from my people list', 'i want to delete bilal', 'erase bilal', 'bilal is gone, please remove him from the team', 'bilal has left the company, delete him');
H('read', {}, 'who works for me', 'show the people list', 'list all my staff');
H('calendar', {}, 'Asha has a day off on friday', 'Bilal is on holiday from 24 nov to 28 nov', "Asha won't be in tomorrow", 'Bilal will be sick next monday', 'asha is off on 25/11', 'mark Bilal on leave for 3 days from monday', 'Asha is out of office until friday', 'Bilal is not coming in on the 22nd of november', 'bilal sick today', 'put asha on holiday next week');
H('none', {}, 'is asha on leave tomorrow', 'what if bilal is sick', 'how do i mark leave', 'asha is a good promoter', 'bilal is working hard today', 'delete is a scary word', "don't mark asha on leave", 'remove all the clutter', 'who is off tomorrow', 'can i add a person here');

// ---- FRESH: a second held-out batch, written blind after the first one was used for tuning. Score it once; do not tune against it.
const F = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: 2, ...extra }); };
F('people.add', { names: ['Yasir', 'Mubashir'] }, 'hey add Yasir and Mubashir as people');
F('people.add', { names: ['Noor'] }, "I'd like to add a promoter called Noor", 'welcome a new promoter, Noor', 'add new person Noor', 'register a new staff member named Noor', 'include Noor in my team please');
F('people.add', { names: ['Hira', 'Sadia', 'Maria'] }, 'add three promoters: Hira, Sadia and Maria');
F('people.add', { names: ['Rafay', 'Arham'] }, 'create 2 new people called Rafay and Arham');
F('people.rename', { id: 'p1', to: 'Aisha' }, 'can you rename Asha to Aisha for me', "make Asha's name Aisha", 'change the promoter Asha into Aisha');
F('people.rename', { id: 'p2', to: 'Billy' }, 'Bilal wants to be called Billy now', 'call Bilal Billy from now on');
F('people.delete', { id: 'p1' }, 'Asha is no longer with us, remove her from the list', 'please get rid of Asha from the app', 'can you take Asha off my team');
F('people.delete', { id: 'p2' }, "Bilal doesn't work here anymore so delete him", 'remove promoter Bilal for me please');
F('read', {}, 'give me a list of all the promoters', 'how many promoters are there', 'who is working for me');
F('calendar', {}, 'Asha is on sick leave from monday until wednesday', 'Bilal is away on the 28th', 'put Bilal down as unavailable next friday', 'Asha will not be working on 30 nov', 'Bilal has the day off tomorrow', 'Asha is taking leave from 2 dec to 5 dec', 'Bilal is going on holiday for 5 days from 1 dec', "Asha can't make it tomorrow", 'mark asha as absent on monday');
F('none', {}, 'will asha be on leave tomorrow', 'if I delete bilal what happens to his phones', 'asha is on top of the target', "I'll rename things later", 'remove the filter', 'did bilal take leave yesterday', 'who is on holiday next week', 'what is the best way to add people', 'no need to delete anyone', "stop, don't remove asha");

// ---- BLIND: a third batch for giving, targets, stock, reports, settings, routines and WhatsApp, written in ordinary wording BEFORE the rules for those areas were
// generalised and never used to tune them. Score it once per phase; a gap of more than 10 points to the tuned groups means the rules are overfitted.
const B = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: 3, ...extra }); };
B('give', { nums: ['5'] }, 'i want to give 5 fold6 to bilal', 'assign bilal 5 fold6 pls', 'bilal should receive 5 fold6', 'pass 5 fold6 across to bilal', 'kindly give bilal 5 units of fold6', 'send over 5 fold6 for bilal', 'hand bilal five fold6 please', 'put 5 fold6 under bilal', 'let bilal take 5 fold6', 'bilal is taking 5 fold6 today');
B('give', { nums: ['2', '3'] }, 'give bilal two fold6 and asha three');
B('give', { okIfBlocked: /Nothing to give/ }, 'give out phones to everyone based on limits', "distribute today's stock across the team", 'do the auto give now', 'allocate phones automatically');
B('target', { nums: ['15'] }, 'asha needs a flagship 1 target of 15', "set asha's flagship 1 target at 15", 'asha flagship 1 target = 15', 'lower asha flagship 1 target to 15');
B('target', { nums: ['8'] }, 'target for asha on flagship 2 should be 8', 'everyone gets a flagship 2 target of 8', 'all promoters: flagship 2 target 8');
B('target', { nums: ['80'] }, 'store target for mid is 80, divide it between all promoters', 'split 80 mid among everyone', 'set the mid store target to 80 and share equally', 'the team needs to do 80 mid, split it equally');
B('stock', { nums: ['3'] }, 'reserve 3 fold6', 'stash 3 fold6 for later', 'put 3 fold6 aside', 'pull 3 fold6 out of stock', 'delete 3 fold6 from my stock', 'take away 3 fold6 from the stock', 'put 3 fold6 back to available');
B('add-phones', {}, `add new stock fold6 imei ${imei(950)}`, `got one fold6, imei ${imei(951)}, please add`, `please record fold6 with imei ${imei(952)}`);
B('report', { nums: ['7'] }, 'set fold6 to 7 in the report', 'fold6 sold 7 today, update report', 'correct the report: fold6 should be 7');
B('report', {}, 'generate a report for 2026-11-21', 'i need todays phone report', 'build me the daily stock report', 'make a report for tomorrow');
B('whatsapp', {}, 'ready the whatsapp daily report', "get today's whatsapp report ready for the group", 'whatsapp report please');
B('settings', {}, 'disable auto crop', 'turn auto detection back on', 'please stop automatic retries', 'enable automatic detection', 'uploads should be stored automatically');
B('routine', {}, 'every morning at 8 prepare the report', 'each weekday at 17:30 auto give', 'daily at 9am prepare todays whatsapp report', 'set up a routine: every friday at 4pm prepare the report');
B('none', {}, 'how many fold6 does asha have', "what is bilal's flagship 1 target", 'can i give asha 4 fold6', "should i set asha's target to 12", 'what happens if i split store target 120', 'did you give the phones yet', 'i gave bilal 3 fold6 earlier', 'if there is stock left give asha 2 fold6', 'maybe store 2 fold6', "don't hold any fold6", 'never turn off auto detection', 'is the report ready', 'what time does my routine run');

// ---- BLIND-4: a fourth batch, written in new wording (dispatch, credit, allot, shorthand, "fold 6") before the rules were looked at again. Score it once; never tune on it.
const D = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: 4, ...extra }); };
D('give', { nums: ['4'] }, 'dispatch 4 fold6 to bilal', 'asha will take 4 fold 6', "i'd like asha to get 4 fold6", 'bilal wants 4 fold6, give them to him', 'credit asha with 4 fold6', 'allot 4 fold6 to asha today');
D('give', { nums: ['3', '2'] }, 'give 3 z fold6 to asha and 2 to bilal');
D('give', { nums: ['2'] }, '2 fold6 for bilal');
D('give', { okIfBlocked: /Nothing to give/ }, 'share out the phones automatically', 'run auto give');
D('target', { nums: ['9'] }, "bilal's target on flagship 1 is 9", "make asha's mid target 9", 'flagship 3 for asha: 9');
D('target', { nums: ['30'] }, "i want everyone's low target to be 30", 'set flagship 2 target for all promoters to 30');
D('target', { nums: ['150'] }, 'split a store target of 150 for low between everyone');
D('stock', { nums: ['5'] }, 'store 5 fold6 pls', 'hold 5 fold6', 'put 5 fold6 back in available stock', 'remove 5 fold6 from stock', 'write off 5 fold6 from stock');
D('add-phones', {}, `add stock: fold6 imei ${imei(960)}`, `i have a new fold6 with imei ${imei(961)} add to stock`);
D('report', { nums: ['3'] }, 'update the report so fold6 is 3', 'can you set the report for fold6 to 3', 'set todays report fold6 sold = 3');
D('report', {}, 'create report for 2026-11-22', 'make me a daily report');
D('whatsapp', {}, 'prepare the whatsapp report', 'whatsapp daily report for the team please');
D('settings', {}, 'disable automatic detection', 'turn off auto retry', 'switch on auto crop');
D('routine', {}, 'every day at 7pm prepare the whatsapp report', 'daily 8:30 auto give', 'each friday at 3pm prepare the report');
D('people.add', { names: ['Zoya'] }, 'add zoya to my people');
D('people.rename', { id: 'p2', to: 'Bilal Ahmed' }, 'rename bilal to bilal ahmed');
D('calendar', {}, 'asha is on leave from monday to wednesday');
D('none', {}, 'who has the most fold6', 'how many phones are stored', 'would it be possible to give bilal 3 fold6', 'i think i will store 3 fold6', 'give 3 fold6 to asha or bilal', 'delete everything from stock', "can you tell me asha's target", "i didn't give bilal anything", 'what is the whatsapp report');

// ---- BLIND-5: a fifth batch with new vocabulary ("goal", "inventory", "register as a promoter", "arrange"), written after BLIND-4 was fixed. Score it once; never tune on it.
const E = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: 5, ...extra }); };
E('give', { nums: ['4'] }, 'pls give bilal 4 fold6', 'bilal 4 fold6', 'arrange 4 fold6 for asha', 'move 4 fold6 over to bilal', 'i need bilal to have 4 fold6');
E('target', { nums: ['11'] }, 'asha target flagship 3 equals 11', 'set a goal of 11 on mid for bilal');
E('target', { nums: ['90'] }, 'total team target for flagship 1 is 90, divide equally among all');
E('stock', { nums: ['4'] }, 'hold on to 4 fold6', 'set 4 fold6 aside please', 'remove 4 fold6 from the inventory', 'pull 4 fold6 from stock');
E('report', { nums: ['4'] }, 'report: fold6 = 4', 'set fold6 to 4 in todays report');
E('report', {}, 'prepare tomorrows report');
E('whatsapp', {}, 'send the daily whatsapp report');
E('settings', {}, 'stop automatic cropping', 'disable auto retries');
E('routine', {}, 'everyday at 9am auto give', 'weekdays at 6pm prepare the report');
E('people.add', { names: ['Nida'] }, 'register nida as a new promoter');
E('people.rename', { id: 'p1', to: 'Ashi' }, 'change asha to ashi');
E('calendar', {}, 'bilal off on friday', 'asha: sick 2026-11-24');
E('none', {}, 'how many fold6 are left', "asha hasn't been given anything", 'if bilal is free give him 3 fold6', 'could you maybe store 3 fold6', 'never remove anybody', 'do i have any stored fold6', 'why was my report empty', 'what would the report say if fold6 were 4', 'is asha off on friday', 'tell me which phones bilal has', "can asha's flagship 2 target be 11");

// ---- BLIND-6: written before any tuning for this round, in the plain words a shop worker might type. Score it once for the first-pass number; never tune on these exact sentences.
{ const E6 = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: 6, ...extra }); };
E6('give', { nums: ['3'] }, 'bilal needs 3 fold6 today', 'put 3 fold6 with asha', 'hand asha 3 fold6', 'asha gets 3 fold6', 'allocate 3 fold6 to bilal', 'can bilal take 3 fold6', 'send 3 fold6 to asha please', 'assign asha 3 fold6', 'bilal should have 3 fold6 now', 'let asha have 3 fold6');
E6('target', { nums: ['14'] }, 'asha flagship 1 goal is 14', 'bump bilal flagship 2 to 14', 'make the target for asha mid 14', 'new target for bilal in flagship 3: 14', 'raise asha flagship 1 target to 14');
E6('stock', { nums: ['5'] }, 'keep 5 fold6 in store', 'put 5 fold6 on hold', 'take 5 fold6 out of the stock list', 'mark 5 fold6 as sold out', 'bring 5 fold6 back into stock');
E6('report', { nums: ['7'] }, 'fold6 is 7 in the report', 'change fold6 to 7 in the report', 'report fold6 7', 'make todays report show fold6 at 7');
E6('report', {}, 'build the report for today', 'draft tomorrows report', 'create the daily report');
E6('whatsapp', {}, 'get the whatsapp report ready', 'prepare a whatsapp message for the report');
E6('settings', {}, 'switch off auto crop', 'turn off background cropping', 'enable automatic retries');
E6('routine', {}, 'every morning at 8 auto give', 'each day at 7pm prepare the report');
E6('people.add', { names: ['Zara'] }, 'we have a new person called zara', 'put zara on the team', 'bring zara into the app');
E6('people.add', { names: ['Zara', 'Omar'] }, 'add zara and omar to the team', 'new staff zara omar');
E6('people.rename', { id: 'p1', to: 'Ashley' }, 'asha is now called ashley', 'call asha ashley instead', 'rename asha as ashley');
E6('people.delete', { id: 'p2' }, 'bilal left, take him off the list', 'drop bilal from the team', 'bilal no longer works here');
E6('calendar', {}, 'asha is on leave on 2026-11-26', 'bilal will be away on 2026-11-27', 'mark asha unavailable on 2026-11-28', 'asha has a day off on 2026-11-29');
E6('none', {}, 'what did i give asha yesterday', 'who has the most fold6', 'i was going to give bilal 3 fold6', 'maybe later store 3 fold6', 'dont give asha anything today', 'would it be ok to remove 3 fold6', 'is it possible to give 3 fold6 to bilal', 'did bilal get his phones', 'how many people do i have', 'if asha is off then skip her', 'i wish i could give asha 3 fold6', 'not now, no need to store anything', 'never mind the report', 'should the target be 14', 'what happens when i delete bilal', 'tell me when asha is off', 'should i put asha on leave', 'imagine we give 3 fold6 to bilal'); }

// ---- BLIND-7: written after BLIND-6 was tuned, with different wording again. Score it once; never tune on these exact sentences.
{ const E7 = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: 7, ...extra }); };
E7('give', { nums: ['6'] }, 'give asha six fold6', 'asha: 6 fold6', 'i want asha to get 6 fold6', 'bilal receives 6 fold6 this morning', 'issue 6 fold6 for bilal', 'pass 6 fold6 over to asha', 'asha is taking 6 fold6', 'make it 6 fold6 for bilal', 'asha could use 6 fold6');
E7('target', { nums: ['20'] }, 'asha needs 20 in flagship 2', 'flagship 2 for bilal should be 20', 'lift asha mid target up to 20', 'target of 20 for bilal on flagship 1', 'asha flagship 3 = 20');
E7('stock', { nums: ['2'] }, 'store 2 fold6 for now', 'lock away 2 fold6', 'strike 2 fold6 off the stock', 'free up 2 fold6 for giving', 'take 2 fold6 out of circulation');
E7('report', { nums: ['9'] }, 'fold6 should read 9 in the report', 'put fold6 at 9 on the report', 'todays report: fold6 9', 'update the report so fold6 is 9');
E7('report', {}, 'i need the report for today', 'get todays report done', 'start tomorrows report');
E7('whatsapp', {}, 'ready the whatsapp daily report', 'whatsapp the report to the group');
E7('settings', {}, 'turn auto crop back on', 'please disable automatic retry', 'switch on automatic retries');
E7('routine', {}, 'every evening at 6 prepare the report', 'daily at 8am auto give');
E7('people.add', { names: ['Hana'] }, 'add hana as a promoter', 'hana is joining the team', 'we hired hana');
E7('people.add', { names: ['Hana', 'Ravi'] }, 'add hana, ravi', 'new promoters: hana and ravi');
E7('people.rename', { id: 'p2', to: 'Bilal K' }, 'rename bilal to bilal k', 'bilal should be listed as bilal k');
E7('people.delete', { id: 'p1' }, 'remove asha from the list', 'delete asha from my team', 'asha has quit, remove her');
E7('calendar', {}, 'asha is sick on 2026-12-02', 'bilal off on 2026-12-03', 'asha on holiday 2026-12-04');
E7('none', {}, 'who is on leave', 'how many fold6 did asha get', 'what is bilals target', 'i might remove bilal later', 'dont delete asha', 'whats the plan for tomorrow', 'maybe give asha 6 fold6 if there is stock', 'has the report been sent', 'could asha take 6 fold6', 'not sure if i should store 2 fold6', 'forget the target for now', 'am i allowed to delete asha', 'would a target of 20 be too high', 'cancel that', 'i do not want to give anything today', 'what if bilal is sick'); }

// ---- BLIND-8: written after BLIND-7 was tuned, new wording and a few typos. Score it once; never tune on these exact sentences.
{ const E8 = (expected, extra, ...phrases) => { for (const t of phrases) cases.push({ expected, t, heldout: 8, ...extra }); };
E8('give', { nums: ['5'] }, 'giv asha 5 fold6', 'asha will receive 5 fold6 tomorrow', 'sort bilal out with 5 fold6', 'bilal, 5 fold6 please', 'i would like asha to have 5 fold6', 'transfer 5 fold6 to bilal', 'asha to get 5 fold6');
E8('target', { nums: ['16'] }, 'asha flagship 1 should hit 16', 'set bilals flagship 2 goal to 16', 'for asha, mid is 16', 'aim for 16 on flagship 3 for bilal');
E8('stock', { nums: ['3'] }, 'store 3 fold6 please', 'stow away 3 fold6', 'drop 3 fold6 from the stock count', 'make 3 fold6 ready to give', 'reserve 3 fold6 for later');
E8('report', { nums: ['8'] }, 'in the report fold6 should be 8', 'edit fold6 to 8 in todays report', 'fold6 8 for the report', 'report should show 8 for fold6');
E8('report', {}, 'can you do todays report', 'prepare the daily report', 'create the report for tomorrow');
E8('whatsapp', {}, 'make the whatsapp report', 'whatsapp report please');
E8('settings', {}, 'switch automatic cropping off', 'turn on auto retries');
E8('routine', {}, 'every day at 10am prepare the report', 'weekdays at 9am auto give');
E8('people.add', { names: ['Mina'] }, 'add a promoter mina', 'mina starts today', 'please add mina to my team');
E8('people.add', { names: ['Mina', 'Karl'] }, 'add 2 promoters mina and karl', 'register mina, karl as promoters');
E8('people.rename', { id: 'p1', to: 'Asha M' }, 'rename asha to asha m', 'asha is really asha m');
E8('people.delete', { id: 'p2' }, 'delete bilal', 'take bilal off the team', 'please remove bilal from my list');
E8('calendar', {}, 'asha will be absent on 2026-12-08', 'bilal sick 2026-12-09', 'asha vacation on 2026-12-10');
E8('none', {}, 'how many phones are with bilal', 'was the report sent', 'what would happen if i give 5 fold6 to asha', 'dont store 3 fold6', 'i could give bilal 5 fold6 later', 'is bilal available', 'do not change any targets', 'what is the plan', 'should asha get 5 fold6', 'its possible that i will delete asha', 'no need to remove anyone', 'ignore the last command', 'who needs more phones', 'was asha given 5 fold6', 'wondering if 16 is a good target'); }

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
for (const r of results) { const g = (group[(r.heldout === 8 ? 'BLIND-8 ' : r.heldout === 7 ? 'BLIND-7 ' : r.heldout === 6 ? 'BLIND-6 ' : r.heldout === 5 ? 'BLIND-5 ' : r.heldout === 4 ? 'BLIND-4 ' : r.heldout === 3 ? 'BLIND ' : r.heldout === 2 ? 'FRESH ' : r.heldout ? 'HELD-OUT ' : '') + area[r.expected]] ||= { total: 0, ok: 0, asked: 0 }); g.total++; if (r.ok) g.ok++; else if (r.asked) g.asked++; }
const total = results.length, passed = results.filter(r => r.ok).length, asked = results.filter(r => r.asked).length;
console.log(`\nEveryday-language check: ${passed} of ${total} understood correctly (${(100 * passed / total).toFixed(0)}%). ${asked} more were understood but the assistant asked for details; ${total - passed - asked} were missed or wrong.\n`);
for (const [name, g] of Object.entries(group)) console.log(`${name.padEnd(28)} ${String(g.ok).padStart(3)}/${String(g.total).padEnd(3)} ok${g.asked ? `, ${g.asked} asked back` : ''}`);
if (process.argv.includes('--show-failures')) { console.log('\nNot understood correctly:'); for (const r of results.filter(r => !r.ok)) console.log(`- [${r.expected} -> ${r.actual}] ${r.t}${r.note ? '   (' + r.note.slice(0, 80) + ')' : ''}`); }
// the safety group is a hard rule: a question, a "what if" or a negation must NEVER be turned into a change
const unsafe = results.filter(r => r.expected === 'none' && !r.ok);
if (unsafe.length) { console.log('\nUNSAFE: these must not change anything but did:'); for (const r of unsafe) console.log('- ' + r.t); process.exit(1); }
// the original 204 sentences must stay at or above the required share (--min-original)
const original = results.filter(r => !r.heldout), originalPassed = original.filter(r => r.ok).length;
console.log(`Original ${original.length} sentences: ${originalPassed} understood (${(100 * originalPassed / original.length).toFixed(1)}%).`);
const minOriginal = process.argv.indexOf('--min-original'); if (minOriginal > 0 && 100 * originalPassed / original.length < +process.argv[minOriginal + 1]) { console.log(`\nThe original sentences are below the required ${process.argv[minOriginal + 1]}%.`); process.exit(1); }
const min = process.argv.indexOf('--min'); if (min > 0 && 100 * passed / total < +process.argv[min + 1]) { console.log(`\nBelow the required ${process.argv[min + 1]}%.`); process.exit(1); }
