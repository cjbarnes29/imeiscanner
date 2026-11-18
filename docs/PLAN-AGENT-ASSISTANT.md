# Plan: Retail Lens in-app agent (audit, architecture, gaps, phases, tests)

Status: PLAN ONLY, for review. Nothing in this plan has been built. Scope: Retail Lens data only. No control of other apps, websites or the operating system. Based on a read of the code at main 84d19b7 plus the uncommitted everyday-wording work (people, calendar).

## 1. Audit: what exists today (verified in code)

| Area | Today | Where |
|---|---|---|
| Understanding | Regular-expression reader. People and calendar use a wide reader (new, uncommitted); giving, targets, stock, reports, settings, routines, WhatsApp use the original fixed sentence shapes | `retail/assistant-actions.ts` (172 lines), `people-commands.ts`, `calendar-commands.ts` |
| Preview / approve / undo | One path for everything: preview -> request saved -> Approve on Home -> receipt -> Undo. Fingerprint check blocks approving a stale preview | `AssistantReview.tsx`, `assistant-actions.ts` |
| Modes | Assistant (approve each), Copilot (approve a task once), Autopilot (allowed kinds apply by themselves, daily cap, never removals or warnings). Mode only changeable in Settings | `retail/assistant-tasks.ts`, `retail/auto-workflow.ts` |
| Multi-step tasks | "A, then B" becomes a task with steps; Stop button (after the current step); retries only for stale-data errors (max 2); Undo whole task newest-first | `AssistantTasks.tsx`, `assistant-tasks.ts` |
| Routines | Timed routines ("every day at 9:00"), Android foreground helper, last 10 runs per routine, learned routines from history | `routine-schedule.ts`, `RoutineLearning.tsx`, Android helper |
| Audit | `state.audit` entries `{at, what, detail<=300}`, capped at 500; request receipts keep before/after for Undo | `retail/data.ts` `withAudit` |
| Chat | One answer shown at a time (replaced on each question). No conversation history, no context between messages. Saved questions (50) and history chips only | `RetailPlanAI.tsx` |
| Memory / preferences | Workflow options in localStorage (mode, Autopilot allow list, cap). No facts or preferences the assistant remembers | `auto-workflow.ts` |
| AI model | Optional on-device Qwen 0.5B: explains and drafts a plan; it is not an agent. No cloud adapter | `local-ai.worker.ts` |
| Animation | Assistant face with 7 states (idle, checking, reading, thinking, waiting, ready, error), one `focus-pulse` keyframe, 3 reduced-motion rules. Progress bar for tasks exists on Home only, not in the chat | `assistant-activity.ts`, `AssistantMascot.tsx`, `AssistantTasks.tsx` |
| Storage | Retail state = ONE JSON value in IndexedDB (`retail:state`) with 8 snapshots; phone records = separate `record:` keys in the same database; people = localStorage `imei-lens-people-v1`; settings = localStorage. These are three separate stores, so there is no single transaction across them | `retail-store.ts`, `App.tsx` |
| Saving | `changeRetail` updates memory first, then saves asynchronously through a queue. Failure only shows a banner. The assistant has already said "Approved" by then | `App.tsx` `persistRetail` |

Benchmark today (`scripts/measure-assistant-language.mjs`): original 204 sentences = **146 / 204 (72%)**. Weak areas: Targets 7/24, Giving 8/23, Stock 7/19 (+2/4 add phones), Reports 7/15, Settings 7/8, Routines 7/8, WhatsApp 3/5. Safety group (nothing may change): 19/19; extra held-out safety sets 20/20. Regression comparison: 102 commands identical before/after the wording work.

## 2. Findings that matter (ranked)

1. **HIGH, exists in the released 1.27.3 build: the question/"what if" guard exists only in people and calendar.** Checked with 12 sentences: 7 would produce a change preview in giving, stock, targets and reports ("what if i give 4 fold6 to asha", "should i store 4 fold6", "can i remove 2 fold6 from stock", "what happens if i set report fold6 to 6", "i might give 4 fold6 to asha later", "tell me how to split store target 120 ...", "is it possible to mark asha not available ..."). In Assistant mode this only queues a request. In Autopilot the code path auto-applies any allowed, warning-free single sentence (read from `startAssistantTask`, not run on a phone), so a hypothetical give could be applied. Fix first (Phase 0).
2. **HIGH: completion is claimed before it is verified.** Nothing reads data back after a save. A failed save shows a banner while the chat already said done.
3. **MEDIUM: no atomic multi-module change.** People, records and retail state are separate stores. Rollback today = per-request Undo plus 8 snapshots of retail state only.
4. **MEDIUM: no conversational context**, so follow-ups cannot work.
5. **MEDIUM: CRUD is incomplete per module** (table below).
6. **LOW: progress is not visible in the chat**; animation is limited to the face.

## 3. CRUD coverage (actual data model decides what is possible)

| Module | Data | Create | Read | Update | Delete | Gap to close |
|---|---|---|---|---|---|---|
| People | `personGroups` (localStorage) | yes | yes | yes | yes (phones to Unassigned) | wrap as tools; verify across stores |
| Calendar | `workSchedules[person]` (annual leave, shifts, rosters) | leave only | no | no | no | read leave; change dates; cancel leave. Shift codes and roster import stay in the existing import flow |
| Targets | `targets[month][person].lines`, `storeTargets`, `leaveTransfers` | set (same as update) | questions only | set person / split store | no | show targets; clear a person's line. Formulas untouched (`targets.ts`, `store-targets.ts`) |
| Gives | `allocations`, owner on each record | give, auto give | questions only | no | undo only | move between people; take back (unassign) using `people.ts` plans |
| Stock | `recordMeta` status (held / given), manual phones | add manual phones (valid IMEI only) | counts via questions | store / hold / available | "remove from stock" = status, never a hard delete | model rename through the existing model-name function. Hard delete of a record stays outside the assistant |
| Reports | `reportDrafts[date]`, accessory report | prepare draft | check / compare | set sold quantity | no | discard a manual draft. Sold counts stay derived from phones |
| Routines | `assistantRoutines` | yes | list | enable/disable | yes | edit time/days; routine = saved plan |

Deliberate limits that remain: no editing of IMEI digits, no hard delete of scanned records or photos, sold counts are never typed in, WhatsApp is only prepared (you tap Send), nothing outside Retail Lens.

## 4. Target architecture (new code in `src/agent/`, existing modules wrapped, not replaced)

```
 chat UI + Progress panel
        |  events
 Conversation layer: turns, context frame (last person / model / segment / date), preferences, memory
        |
 Reader (offline, deterministic): Guard -> Intent {tool, op, args, missing[], confidence}
        |  optional ModelAdapter (on-device, or cloud if you opt in) can only PROPOSE the same Intent JSON
 Validator: known tool, typed args, saved names only, limits. Unknown or unsafe = refused
        |
 Planner: Plan = ordered steps of tool calls (existing task model extended)
        |
 Executor: checkpoint policy (risk x mode), duplicate guard, apply, VERIFY, record, emit events
        |
 Tool registry: People | Calendar | Targets | Gives | Stock | Reports | Routines | Settings
        each tool = { op: create|read|update|delete, risk, schema, preview, apply, verify, undo }
        wrapping the existing validated functions (setTargetLine, applyStoreTarget, applyAllocation,
        planDeletePerson, recordMeta changes, calculatedDatedReport, ...)
 Persistence: existing stores + read-back verification + agent log
```

Key rules:
- **Guard (one place, runs first):** questions, "what if / should I / how do I / can I / would", conditionals, past tense, negation, quoted text -> answered or refused, never a change. All modules share it.
- **Tool contract:** `preview` is pure; `apply` returns the new state and what it touched; `verify` re-reads persisted data and compares to the expected result; `undo` restores the exact previous values (property test: apply then undo gives an identical fingerprint).
- **Verified completion:** after `apply` the executor waits for the save queue, reloads from IndexedDB / localStorage, runs `verify`. Chat says **Done** only for "Verified". Otherwise: "Applied but not confirmed" or "Failed, nothing changed", with Retry/Undo.
- **Cross-store changes (e.g. delete person + move phones):** snapshot first, apply stores in a fixed order, verify each, and on any failure run compensation (undo applied parts) and report it. Honest limit: IndexedDB and localStorage cannot share one transaction, so this is compensation, not a true database transaction.
- **Destructive actions:** always a preview with counts ("3 people, 14 phones move to Unassigned"), explicit confirmation (press-and-hold for small, typed name for large), never by Autopilot, batch cap, 30-second duplicate window. Deletes of data we can restore use Trash/undo; where a restore is impossible the confirmation says so.
- **Duplicate prevention:** idempotency key = hash(tool, args, state version); a second identical request inside the window returns "already done".
- **Agent log v2:** append-only, capped (2000), `{time, actor: you|agent|routine, mode, tool, args summary (no full IMEIs), preview hash, outcome, verify status, receipt id}`; shown in Home > History and exportable. The existing 500-entry audit stays.
- **Memory and preferences:** explicit only ("remember that I prefer ..."), shown in Settings, editable, deletable, included in backups, never IMEIs or photos. Preferences: default segment/model, short or detailed answers, confirmation style.
- **Offline first:** every deterministic task runs offline. Cloud AI is a plug-in `ModelAdapter`, OFF by default, behind an explicit consent screen, sending only a redacted summary (no IMEIs, photos or phone numbers). Its output is just another Intent and passes Guard, Validator, preview and approval. If it fails, offline reading continues.
- **Routines:** keep the current timed routines and Android helper; a routine becomes a saved Plan (not only a sentence), with time/days, enabled, catch-up rule, and its own approval policy; run history up to 50 runs with per-step outcomes; Run now / pause.

## 5. Progress panel and animations (integrated)

Events from the executor: `thinking`, `planning`, `step-start`, `step-progress`, `step-done`, `step-error`, `verifying`, `verified`, `failed`, `cancelled`. Defined in Phase 1 so the panel can be built against them.

- **Compact collapsible panel** under the chat: one line ("Step 2 of 5: giving phones") + thin bar; tap to expand to the step list (done ✓, running spinner, pending ○, failed ✗), the elapsed time, and Cancel / Retry / Undo.
- **States:** thinking (three-dot pulse + face), typing (answer revealed by words, capped duration, skippable), planning (steps appear one by one), executing, verifying, then animated success (tick draws once) or error (short shake + message). Everything also exists as plain text for accessibility (`aria-live`, `role=progressbar`).
- **Chat stays responsive:** input never locks; messages queue; work is chunked with yields (existing `waitForManualIdle`); progress events throttled to about 4 per second.
- **Cancel / Retry:** Cancel stops after the current step (a running tool call is never killed half-way). Retry only for steps that are safe to repeat (reads, previews, steps that verifiably did not apply); a destructive step needs its confirmation again.
- **Android WebView rules:** animate only `transform` and `opacity`; no animated shadows, blur or layout properties; at most 3 animations at once; CSS keyframes, not JavaScript frame loops; `will-change` only during an animation; respect `prefers-reduced-motion` plus an in-app "Reduce animations" switch; automatically reduced on low-memory phones (existing `deviceRamGb`); checked for dropped frames on the API 35 emulator.

## 6. Phases (each phase ends with the gates in section 7 and your approval; nothing starts before approval)

| # | Phase | Size | Notes |
|---|---|---|---|
| 0 | Central Guard + Autopilot safety fix + extended safety tests (60+ questions and hypotheticals across all modules) | S | Urgent (finding 1). Changes no accepted command |
| 1 | Tool registry skeleton, wrap existing tools with no behaviour change, verification layer (read-back), agent log v2, executor event contract | M | 102-command comparison must stay identical |
| 2 | Reader to >= 90% on the original 204: giving, targets, stock, reports, settings, routines, WhatsApp; keep two fresh blind sets per phase | M-L | Reported separately: original 204, tuned sets, fresh sets |
| 3 | Conversation context, follow-ups, ask-back choice chips, preferences, memory, in-chat Approve/Undo | M | |
| 4 | Missing CRUD per module (section 3), each with preview, verify, undo, destructive confirmation | L | One module at a time |
| 5 | Planner/executor upgrade: tool-based steps, checkpoints, compensation, error recovery, duplicate guard | M | Reuses the current task model |
| 6 | Progress panel and animations | M | Can overlap phase 5 once events are fixed |
| 7 | Routines as plans, execution history screen | M | |
| 8 | Optional adapters: on-device model, cloud (only if you opt in) | M | Default OFF |
| 9 | Emulator and performance testing, APK, handover | M | Emulator start problem on imei-api35 must be solved first |

## 7. Testing plan and gates

- **Every phase:** `tsc`, `npm test`, browser suites (assistant, retail, simple, layout), build.
- **Regression:** the 102-command comparison between the previous commit and the new code must be identical (currently 102/102).
- **Safety:** original 19/19 plus the extended set at 100%. Any case that changes data from a question, hypothetical or negation fails the build (already enforced in `measure-assistant-language.mjs`).
- **Understanding:** original 204 >= 90% (ratchet in `npm test`), plus fresh blind sets never used for tuning; a gap between tuned and fresh scores > 10 points is a stop.
- **Tools:** per tool: preview is pure; apply then verify passes; apply then undo = identical state fingerprint; stale state is refused.
- **Persistence:** apply, reload from a real or fake IndexedDB/localStorage, verify; simulated save failure must produce "not confirmed", never "Done".
- **Duplicates and destructive:** double tap, repeated sentence, retry after failure; delete without confirmation is refused; Autopilot never deletes.
- **Modes matrix:** Assistant / Copilot / Autopilot x risk level.
- **UI and performance:** animation frame budget (browser trace, then emulator `gfxinfo` jank %), reduced-motion, large text, small screens, Cancel/Retry paths.
- **Emulator:** isolated `.phonetest` app on an emulator only. **Real phone:** never by me; a manual checklist for you.
- **Not claimed without evidence:** anything not run on an emulator or phone is reported as not run.

## 8. Decisions needed

1. Approve Phase 0 now (small, urgent safety fix).
2. Cloud AI: build the optional adapter in phase 8, default OFF, only after a separate approval? (Recommended: yes, later.)
3. Confirmation style for destructive actions (recommended: press-and-hold for small, typed name for large).
4. Stock delete stays "remove from stock" (status), never a hard delete (recommended).
5. What memory may hold (recommended: explicit preferences and facts you tell it, visible and deletable).
6. Order: events in phase 1, panel in phase 6 (recommended).
