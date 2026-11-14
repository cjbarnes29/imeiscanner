// Incomplete labels: the retake prompt is shown only while a record still needs a check, words follow the evidence, and no number is ever shown.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'imei-issue-'));
await writeFile(join(dir,'label-issue.mjs'),ts.transpileModule(await readFile('src/label-issue.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const r=await import(pathToFileURL(join(dir,'label-issue.mjs')).href);

// active only while the record asks for a check, and only for known kinds
assert.equal(r.activeIssue({labelIssue:'cut-edge',cropNeedsReview:true}),'cut-edge');
assert.equal(r.activeIssue({labelIssue:'cut-edge',cropNeedsReview:false,imei:'x'}),null,'resolved by a person: no prompt');
assert.equal(r.activeIssue({labelIssue:'cut-edge',cropNeedsReview:false,imei:''}),'cut-edge','a record without an IMEI keeps asking');
assert.equal(r.activeIssue({labelIssue:'cut-edge',cropNeedsReview:false,imei:'123'}),null,'typing an IMEI clears it');
assert.equal(r.activeIssue({labelIssue:'cut-edge',cropNeedsReview:true,labelIssueDismissed:true}),null,'Keep as is hides the prompt');
assert.equal(r.activeIssue({labelIssue:'weird',cropNeedsReview:true}),null,'unknown kind from a newer app: ignored');
assert.equal(r.activeIssue({cropNeedsReview:true}),null,'old records have no issue');
assert.equal(r.activeIssue({imei:''}),null,'no issue recorded: nothing to show');

// wording follows the evidence
const cut=r.issueText('cut-edge','bottom',1);
assert.match(cut.text,/appears to be cut off at the bottom edge of the photo/);
assert.match(cut.text,/Retake the photo with the whole label inside the frame/);
assert.match(r.issueText('cut-edge','right',2).text,/2 labels appear to be cut off at the right edge/);
assert.match(r.issueText('cut-edge','',1).text,/the edge of the photo/,'unknown side: no invented side');
assert.match(r.issueText('partial-number','',1,7).text,/Only 7 of 15 digits/);
assert.match(r.issueText('unreadable','',1).text,/could not be read\. Retake the photo, or crop/);
for(const kind of ['cut-edge','partial-number','unreadable']){
  const t=r.issueText(kind,'left',3,9);
  assert.ok(!/\d{15}/.test(t.title+t.text+t.short),'no IMEI-like number in any message');
  assert.ok(t.short.length<80,'short note stays short');
}
assert.equal(r.issueTextFor({cropNeedsReview:true}),null);
assert.ok(r.issueTextFor({labelIssue:'unreadable',cropNeedsReview:true}).title==='Retake this photo');
console.log('label-issue: ok');
