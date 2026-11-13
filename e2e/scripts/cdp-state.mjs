// Reads the isolated test app's WEB state (IndexedDB records and archive) through the WebView DevTools socket. Read-only.
import { adb, guardApp } from './lib.mjs';

export async function evaluate(device, app, expression, port = 9333) {
  guardApp(app);
  const pid = adb(device, 'shell', 'pidof', app).trim();
  if (!pid) throw new Error('the test app is not running');
  adb(device, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve));
  // A page that stays silent (for example blocked by a JavaScript dialog) must fail the test, not hang it.
  const result = await Promise.race([
    new Promise(resolve => {
      ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id === 1) resolve(m); });
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('DevTools did not answer within 25 s (the page may be blocked by a JavaScript dialog)')), 25000)),
  ]).finally(() => { try { ws.close(); } catch { /* closed */ } });
  adb(device, 'forward', '--remove', `tcp:${port}`);
  return result.result?.result?.value;
}

export async function webState(device, app) {
  const js = `(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('imei-lens-v2',1);q.onsuccess=()=>r(q.result);q.onerror=j});
    const get=p=>new Promise(r=>{const q=db.transaction('inventory').objectStore('inventory').getAll(IDBKeyRange.bound(p,p+'\uffff'));q.onsuccess=()=>r(q.result)});
    const rec=await get('record:'),arc=await get('archive:');db.close();
    return {records:rec.length,names:rec.map(r=>r.name),imeis:rec.map(r=>r.imei||''),duplicates:rec.filter(r=>r.duplicate).length,
      archive:arc.map(a=>({name:a.record.name,reason:a.reason,restored:!!a.restoredAt,removedCrops:(a.removedCrops||[]).length,cropIds:a.cropIds.length,duplicateOf:!!a.duplicateOf}))}})()`;
  return evaluate(device, app, js);
}
