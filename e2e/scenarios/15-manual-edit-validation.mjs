// Manual editing in the Records table: a typed model code is validated against the Samsung shape (SM-A165F) and an invalid
// one is flagged for review; a typed IMEI is checked (checksum). Nothing is saved silently as valid.
import { ctx, scanAll, clickText, js, sleep, check, finish } from './helpers.mjs';

const c = ctx(), results = [];
await scanAll(c);
await clickText(c, '^Records');
await sleep(1000);

const setField = (labelStart, value) => js(c, `(()=>{const inp=[...document.querySelectorAll('input')].find(i=>(i.getAttribute('aria-label')||'').startsWith(${JSON.stringify(labelStart)}));if(!inp)return 'no field';
  const st=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;st.call(inp,${JSON.stringify(value)});inp.dispatchEvent(new Event('input',{bubbles:true}));return inp.getAttribute('aria-label')})()`);
const text = () => js(c, 'document.body.innerText');

// model code
check(results, 'model field found', (await setField('Model for record', 'SM-A16SF')) !== 'no field');
await sleep(800);
let body = await text();
check(results, 'an invalid model code shows the hint', body.includes('Not a Samsung model code'));
check(results, 'the record is marked "Needs review"', /Needs review/.test(body));
await setField('Model for record', 'SM-A165F');
await sleep(800);
body = await text();
check(results, 'a valid model code removes the hint', !body.includes('Not a Samsung model code'));

// IMEI: a wrong checksum is not "Valid"
const label = await setField('IMEI 1 for record', '490154203237519'); // synthetic, wrong check digit
await sleep(800);
check(results, 'IMEI field found', label !== 'no field');
const status = await js(c, `(()=>{const inp=[...document.querySelectorAll('input')].find(i=>(i.getAttribute('aria-label')||'')===${JSON.stringify(label)});const card=inp&&inp.closest('tr');return card?card.innerText:''})()`);
check(results, 'a typed IMEI with a wrong checksum is flagged', /Needs review|Invalid/.test(status));
finish('15-manual-edit-validation', results);
