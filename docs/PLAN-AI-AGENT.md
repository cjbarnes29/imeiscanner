# Plan: conversational AI agent for AI LENS (target 1.29.0)

Goal: an LLM-powered assistant that understands typos, half sentences, follow-ups and "it / him / the same" without fixed phrases, calls the app's real modules through validated tools, plans several steps, previews and asks before every change, supports clarification, undo and history, and falls back to the existing offline assistant. Free providers first. Nothing changes the data without a person pressing Approve.

## Design in one picture
```
message -> [conversation memory + masked data snapshot] -> LLM (JSON only)
   -> reply            : plain answer (no change)
   -> clarify          : one question, with tap-able choices
   -> read tools (<=3) : run locally on the real data, results go back to the LLM
   -> plan (<=8 steps) : each step = a TOOL CALL {tool, args}
tool call -> schema check -> resolve names/models locally -> compile to the assistant's own command
          -> existing guard + preview (+ blockers/warnings) -> a Task (review state)
person: Approve step / Approve all / Reject  -> existing runner -> verified save -> audit log -> Undo
```
The model never touches data. Tools are the only door, and they end in the same preview -> approve -> verify -> undo path as typed commands (including press-and-hold / CONFIRM for removals).

## Parts
1. **Providers** (`agent/providers.ts`): Gemini (free key), OpenRouter (free `:free` models), Groq (free tier); one OpenAI-style adapter + the Gemini adapter; test button; model auto-pick; timeouts; plain error messages; daily budget.
2. **Tools** (`agent/tools.ts`): one entry per module operation (people, calendar/leave, targets, gives/moves, stock, reports, WhatsApp report, routines, settings) with an argument schema, validation against real data, and a compiler to the assistant's command wording. Read tools (stock, person, targets, leave, people, routines, report status, recent history) run locally and return masked data. No tool can add phones by IMEI (the model never sees IMEIs).
3. **Agent loop** (`agent/agent.ts`): strict JSON protocol, bounded loop, untrusted-data labelling, injection and size limits, hedge/question rule (a "what if", "maybe" or question can never become a change), plan -> Task, never Autopilot for AI plans.
4. **Memory** (`agent/convo.ts`): last turns kept on the phone (IMEIs removed, 24 h, clearable), plus the existing opt-in notes; the model sees them with names masked. Resolves "do the same for Bilal", "make it 5", "undo that".
5. **UI**: Settings > AI agent (provider, key, mode "AI first" or "only when unsure", share names, memory, clear); chat shows the plan with per-step preview and Approve step / Approve all / Reject / Undo; clarification chips; history in the existing history card.
6. **Fallback**: AI off, no key, no internet, rate limit, bad answer -> the offline assistant answers, with a one-line note.

## Safety rules (each has a test)
- No tool mutates directly. All changes go through preview + Approve + verified save; removals keep press-and-hold / CONFIRM.
- AI plans never auto-run (even in Autopilot); at most "approve the whole plan once".
- Questions, what-ifs, maybes, negations and hedged sentences never become changes.
- Unknown tools, bad arguments, unknown people/models, more than 8 steps, or text in data that tries to give instructions are refused.
- Only counts and targets leave the phone; no IMEIs, photos or files; people appear as "Person A" unless sharing is on; names hidden in free text too.
- Key only in this phone's local storage (never in backups, exports, logs, receipts).

## Tests before release
Unit (scripted fake LLM): typos, fragments, follow-ups, clarification, read-then-plan, multi-step, every tool, every refusal, injection attempts, provider adapters and errors. Browser end-to-end with a simulated provider. Android WebView check (offline fallback, off-by-default, no calls when off). 102-command regression and safety suites unchanged. Live provider check needs your own key (not possible without one).

## Not in scope
Cloud sync, reading other apps/files, adding stock by IMEI through the AI, sending WhatsApp messages (reports are only prepared).

## Status (built on branch `ai/agent-1.29`, version 1.29.0 (49); local only, nothing pushed or released)
- Built as planned: providers (Gemini, OpenRouter free models, Groq), 26 write tools + 4 read tools, agent loop with strict JSON protocol, conversation memory, plan -> ordinary task (never Autopilot), chat plan card (Approve next step / Approve all / Reject / Undo), clarification chips, settings card, offline fallback, daily limit of 60 requests.
- Verified: `npm test` (incl. `test-ai-agent.mjs`: settings, memory, 3 provider request shapes and errors, every tool compiled and understood by the real assistant, scripted-model scenarios with typos, follow-ups, clarification, read-then-plan, multi-step, refusals and injection attempts), build, 4 browser suites (assistant suite drives the agent through the real UI against a simulated provider), 102-command regression identical to main 84d19b7, safety suites unchanged, language benchmark unchanged, Android WebView check 21 of 21 on a fresh test-app install (includes the agent with a simulated provider).
- NOT verified: a live call to a real provider (needs the owner's own key; CORS from the web view is expected to work for Gemini and OpenRouter and Groq but is only confirmed by the in-app "Test & save key" button).
- Known limits: nicknames that are not a whole name (for example "ash" for "Asha") are not masked before sending; free plans may let the provider use what is sent; the AI cannot add phones by IMEI, send WhatsApp messages or read other apps; Google marks the generateContent request format "legacy" (still supported).
- Test-script fixes made on the way (not app bugs): the Android check now closes a fresh app's welcome dialog, reads the database without creating it, and treats a missing field as equal to an empty default.
