## 1.27.1 — Global automation and edit priority

- Shared Automatic / Manual / Custom processing, background crop finishing and protection for manual edits.
- Home attention, text assistant fallback and Today/coming-days giving, release and report suggestions; global after-upload defaults.
- Global target-link policy, single-day/date-range availability; Detailed People visibility and swipe-dismissible Home notice.
- **People by chat (add, rename, delete, list):** "add 3 people Asha, Bilal and Chen" (also "add 3 person khuram raseen and carlou"), "rename Asha to Asha K", "delete Bilal", "list people". Previewed first, approved on Home, undoable. Deleting a person never deletes phones: they move to Unassigned, and Undo gives them back. Autopilot can add or rename only if you allow "people"; deleting always asks. The chat now says "Not applied yet: waiting for your approval" for any request waiting on Home. **Fix:** a command the assistant understood but could not do (for example a target command before any people exist) was saved as "waiting for review" and showed a ready tick, so it looked done while nothing was set. It is now kept as a plain answer ("Nothing was changed, because ..."), and with no people it says "Add your people first".
- **Reject all waiting requests:** Home > Assistant review has a "Reject all N waiting" button (asks once, then rejects every waiting request; applied ones are not touched). Clarification requests also count toward the limit of 20, so this clears the limit in one tap.
- **One person's target by chat:** "set Maya's Flagship 1 target to 12", "set my Flagship 1 target to 10" or "set everyone's Flagship 1 target to 8". Previewed first (each person's before and after, and the total), applied only after approval (or by Autopilot if "Target splits" is allowed), Undo restores it. It uses the same function as Targets > Edit all, changes this month's target only, and never edits sold or achieved numbers. A sentence that names nobody, or that says divide/split/store target, still gets the older store-target question.
- **Voice for the assistant:** a Speak button in the assistant chat. Tap it, talk, tap Stop: the words appear as text in the question box with "Heard: ..." so you can read and fix them before Get answer. Speech is turned into text on the phone (Whisper tiny, English), free and offline after a one-time download of about 43 MB (with a notice first); the voice is never saved or sent anywhere, only the text. Spoken numbers become digits, "Fold 6" becomes "Fold6", and a mis-heard name is matched to the people in the app. Setting: ask right away after speaking (off by default); remove the model to free the space. Android asks for the microphone once.
- **WhatsApp reports by the assistant:** "prepare today's WhatsApp report" (also "make a daily WhatsApp report for the group", and inside routines or multi-step tasks) builds the daily report message and saves it as a prepared message on Home. It is never sent by the app: WhatsApp needs your own Send tap, then "I sent it". When a routine or Autopilot prepares it, an Android notification opens WhatsApp with the text filled in (the saved number, or the share sheet for a group). Autopilot may prepare it (kind "Prepare WhatsApp reports"); Undo removes the prepared message.
- **Timed routines (like Claude routines):** write "give phones by the limits every day at 9:00", "every weekday at 6pm ..." or "every Monday and Friday at 18:30 ...". It becomes a routine with a time and days that runs by itself at that time, once a day, in your assistant mode. It runs at its time only: more than 5 minutes late (changeable) it is skipped and logged as missed, never run at a strange hour. On Android a background helper (foreground service with a notification, turn-off button and Settings switch) keeps the app alive and an exact alarm wakes it at the due time; swiping the app away stops it and says so. Edit time and days, Run now, and run history are under Home → Routine learning. Multi-step routines now become tasks in every mode. New **Auto give** tool: "auto give" / "divide phones per person" previews the normal Give & share rules with each person's daily limits, and can run as a routine. Autopilot may now split targets by default (no manual step); warnings and removals still wait for you.
- **AI assistant tasks and modes:** one message with several steps ("store 4 Fold6, then give 4 Fold6 to Maya") becomes a task on Home → Tasks, run in order with progress, retries for stale data, Stop, and Undo for the whole task. Three modes in Settings: Assistant (approve each step), Copilot (approve once), Autopilot (only the kinds you allow, with a daily limit; never warnings, removals, sales, releases, messages or deletes). Only Settings can change the mode. Daily routines run as tasks in Autopilot. "Handover summary" lists the last 24 hours and what is waiting, offline. Every step keeps its receipt, Undo and History entry.
- **Shift Calendar to annual leave:** AL days in an imported roster now appear under Shifts as "Annual leave in the shift calendar" with the calculated effect (40 / (30 − 5) × 5 = 8, giving 32/44/44, store total unchanged). Saving records the leave only; targets still change only after the reviewed calculation. Days already entered by hand or already adjusted are never counted twice. Calendar days show an AL mark and its status.
- **Hide suggestions:** one switch hides every suggestion (chat chips, next steps, routines, Home forecast, leave proposals), with separate switches for chips and leave proposals, a Hide suggestions link in the small chat, and the chat command "hide suggestions" / "show suggestions". Warnings and approvals are never hidden.
- Guide: Reset is now described in Settings, and the calendar/target wording matches the global policy.
- IMEI calendar planned days with person/model quantities and proposed/approved/completed states; shift schedules remain separate.
- Android code 44, unchanged package IDs and signing for matching in-place upgrades.
- **Reports made by the assistant:** ask in the chat ("make a PowerPoint report for last month", "excel report for Asha", "simple notes of my targets") and open **Home → Make a report**. One press makes an Excel file (a sheet each for targets, people, month outlook, sales and stock), a PowerPoint file (title, key numbers, target bars, what to push and leave, people, sales and stock) or plain notes to copy, share or save as text. A finished report can be **downloaded** or **sent on WhatsApp**: the phone's share menu opens with the file (choose WhatsApp, then the chat), or WhatsApp opens with the notes ready. You press send in WhatsApp; the app cannot tell whether it was delivered. Built only from the numbers already in the app; no IMEI numbers or photos; nothing is changed. Tests: `scripts/test-report-builder.mjs`, assistant browser test.
- The assistant icon in the header is now a small face that shows what the assistant is really doing: checking your saved data, reading a file, working out an answer, paused while you edit, something ready for your review on Home, or something that could not be finished. Real activity only; with "reduce motion" nothing moves and each state keeps its own picture and words.
- The assistant no longer says a request was saved when 20 requests are already waiting on Home; it says nothing was changed and what to do.


# Changelog

What changed in each Android app / web release since 1.7. The web and the Android app are the same build; every version below was published together. Older notes: [1.6](RELEASE-1.6.md), [1.5](RELEASE-1.5.md), [1.4](RELEASE-1.4.md).

## Unreleased — 1.27.0 daily plans, Stored, calendars and target splitting
- Give & share has Give / Plan / Share. Home shows today's release decision, pending reports, true stock and editable upcoming days. Auto refreshes calculations; every release requires confirmation or a recorded off-day override.
- Scans stay safely pending until Use now / Store for now / Plan release is chosen. Optional live scan previews estimate release/store quantities without recording sales. Stored phones count in real unsold stock.
- Plans support percentages, percentage points, deadlines, milestones, stored percentages, fixed units, manual daily quantities, reserves, limits, days or month-end duration, and Not today recalculation.
- Saved Available / Not available calendars skip unavailable people automatically. Editable month and unavailability divisors feed calculations; manual transfer/release overrides warn and appear in History.
- Store targets auto-divide into editable promoter targets. AL uses target/(month days-AL days)*AL days with editable totals/shares:40/(30-5)*5=8 gives32/44/44 while keeping store120. Editing/cancelling reverses the previous adjustment; achieved sales and stock never change from target edits.
- Release confirmations count IMEIs once as sold; report inclusion can select all or quantities by segment. Unreported released IMEIs remain pending. Dated Auto/Manual drafts show match/mismatch and explicit future projections; report edits do not change real stock.
- Export includes stock statuses, plans, pending IMEIs, report comparisons, calendars/divisors, leave shares, history and retail backups. Pictures remain a separate export.
- Global ? Help opens interactive demo tutorials; first-time Home shows a setup checklist. Optional on-device AI runs a separately downloaded model, validates proposals and cannot execute sales. Physical-phone performance is not yet verified.
- Shift files interpret into editable calendar proposals; saved codes/times, overnight shifts, original-file viewing, day/week/month sharing and Home review reminders stay separate from the IMEI release calendar and daily upload counts.
- Final phone reports can be viewed and edited in the app. Per-person approval defaults prepare report/IMEI messages; ordinary WhatsApp requires a final Send tap, and opened is never treated as delivered.
- Tablets & accessories have an independent Daily OSR, editable final message and approved stock register connected to Home, Export, Backup and History. Report balances replace quantities without duplicate-import inflation; declared totals and stock differences are checked.
- Startup recovery resumes remaining saved native scan photos without replacing an active worker. Automatic local diagnostics, an exportable privacy-filtered error file, render recovery screen and performance guidance were added. Updates preserve package/signing and increase versionCode42→43.
- Upload-choice dialogs wait while photo/review/queue editors are open. Export now includes12 planning/report/stock/schedule/sharing categories; roster originals and photos are saved separately from the retail backup.

## Unreleased — audit fixes and visible target caps
- Screens open with their main content and one Show all button for secondary controls. Targets prioritises segment progress; segment cards list their models directly.
- More is consolidated into People & sharing, Models & segments, and Settings & backup. The model library shares one search and editor, includes saved and Samsung names, and saves edited names back to the scanner too. Source import, variants, catalogue maintenance and bulk actions remain available.
- Fixed a popup-history race when navigating from Settings to Backup. Modern Android Back handling now uses the platform callback while retaining the older Android path.
- Target overview cards and each person's row show their percentage cap. Remaining pieces and shared summaries name the effective percentage; finish dates stop at a common cap.
- Retail database failures show a persistent warning and retry button. Failed reads cannot masquerade as empty data; damaged scan data is preserved instead of crashing or being overwritten. Failed transactions roll back partial writes.
- Fixed concurrent laptop-scanner uploads overwriting the job manifest; invalid JSON now returns a clear client error.
- Shared report text opens Report on an empty app and replaces the previous shared text when the app is already open.
- Enlarged small controls in target editing, sharing, giving, person filtering and exports. Android asset copying removes stale web bundles before packaging.

## Unreleased — small assistant chat, search bar, replies you can scan
- **A round assistant button on every screen** (above the bottom bar) replaces the header icon. It opens a **small chat card**: "What do you want to do?", a box, and **suggestions taken from your own history** (what you ask often, the latest, saved questions; a few starters only when there is little history). Tapping a suggestion asks it straight away. "Open the full assistant" is one tap further.
- **Replies are laid out as a headline and a few short bullets** with the important numbers in bold; the small chat shows only the summary and the full text stays on Home. **"What next?" buttons under each answer now work**: tapping one asks that question.
- **Natural wording for the target split:** "change flagship 3 target to 12 and divide it to promoters" is understood, shown as a preview first (12 → 4, 4, 4), applied only when you approve, and undoable. Unclear wording is questioned, not guessed; a command that cannot be turned into a change says so and lists examples instead of showing an unrelated calculation. A report request can start with the file kind ("excel report for Asha").
- **Search bar** (magnifier in the header): type a screen, tool or setting (a small typo is fine) and tap it: Targets, Backup and data, Make a report, Edit all targets and sold, Give and share and more; saved questions appear too. With nothing typed it shows recent and popular places; if nothing matches it offers to ask the assistant.
- **Tests:** every question in a 44-question battery gets a saved entry and a visible reply, and the chat never approves, applies or submits anything (`scripts/test-assistant-coverage.mjs`, the assistant browser test, and a source check that only the Home review card's Approve button can apply a request). Also `test-assistant-suggestions`, `test-nav-search`.

## Unreleased — Undo popups leave by themselves
- The Undo popups ("Asha deleted. Undo", "3 duplicates archived…", "photo deleted…") now leave after **2 seconds** (the person-delete one used to stay 12 seconds, the others until Dismiss) and can be **swiped sideways** away sooner. While a finger is on a popup the clock waits, so Undo can still be pressed. Browser test: `scripts/e2e-undo-bar.mjs`.

## Unreleased — fixes: Edit all on a phone, restoring a backup
- **Edit all** is now a card per person with a labeled row per segment (name, Target, Sold, Levels) and an "Everyone together" card. On a phone the wide table lost the segment names.
- **Restoring a backup** now says which file and what is wrong ("is empty", "is not a RetailLens backup") instead of a vague message. A file saved a moment ago can read as empty at first, so an empty read is tried again a few times. The same file can be chosen again after a failed try.
- Backup reads show progress and distinguish a file that cannot be opened from an empty file. Choosing another backup cancels the earlier result so it cannot replace the new selection.

## Unreleased — Home: month outlook
- **Month outlook** on Home (everyone, or the person chosen): where the month most likely ends if sales keep the pace so far (sold and sold-not-submitted / days gone), and what to do with each segment: **Push these** (the next level is within reach if the pace goes up by at most 2 times), **Keep the pace**, **Hard to reach: focus elsewhere**, **Done: stop pushing** (the top level, or the segment's highest level, is reached). In the first 2 days of the month it only says what each next level needs. It is a guess from the pace so far, not a promise.

## Unreleased — Give and share: Auto give and limits per person
- **Suggest only / Auto give** switch on Give and share. In Auto give, phones without an owner are given by themselves when a scan finishes, with the same rules as the suggestions (my target first, then everyone under 70%, then toward 100%). Phones that need review, are held (Store only), repeated or have a bad number are never given automatically. Every automatic give is one entry in History (marked "automatic") and can be undone; an undone phone is not given again by itself.
- **Limits per person:** a minimum and a maximum phones a day, and "Leave out for now". The maximum counts what the person was already given today; what the limits leave over stays without an owner and is given on the next run (a late upload, or tomorrow). The minimum is filled before anyone is lifted toward 100%.

## Unreleased — Targets: pace, finish dates, highest level, Edit all, who an import is for
- **Pace in whole numbers.** "0.1/day" is gone. Targets, Today, the Everyone view and the shared summary now say "2 a day" or, under one a day, "1 every 3 days".
- **Finish dates.** Every segment and person shows when 70%, 100% and 120% are reached at this month's pace (sold so far / days gone): "100% by 24 Nov", "120% not by month end (needs 3 a day)", or "too early to tell" in the first days.
- **Highest level per segment.** Some segments stop at 100%: set **Highest level** in Edit levels (**Same for everyone** copies it). The app then shows "The top level here is 100%" instead of asking for 120%, and the example incentive counts that line at 100%. Last month's setting comes over with **Start from last month**.
- **Who an import is for.** A Promoter screenshot or pasted text is matched to a person from the name or ID printed on it, and a name you confirm once is remembered. If it is not sure, nobody is picked (it no longer defaults to the first person). Several screenshots, or several people in one pasted text, are checked on one screen. New **Paste text** button.
- **Edit all.** One screen with every person and every segment: type target (T) and sold (S) in each box, totals follow, **Copy to all** copies a column's target, **Levels** opens the segment.

## Unreleased — documentation and release signing
- README rewritten for accuracy: export before every update, archive (not delete) wording for crops and duplicates, a privacy line that names every place data can live, and one table of what each send method sends. Build, test, release and Render steps moved to DEVELOPERS.md; each code folder now has a README.
- The crop-review hint now says the original photo is archived, not deleted.
- The Android release workflow signs the APK with a permanent key when the four `IMEI_KEYSTORE_*` secrets are set (steps in DEVELOPERS.md); without them it builds the debug APK as before.

## Unreleased — fixes from a code review (Android and web)
- A colour taught for every model no longer overrides a model whose own colours already fit.
- A phone sold or held and later brought back keeps its place; a deleted phone no longer hides a later real scan of the same kind.
- Start from last month skips people who were deleted; Same as last month ignores levels-only lines.
- Held phones have a **Put back in stock** button. The Back button no longer gets stuck after a screen restore. The Sold prompt is faster with 1,000 phones.

## Unreleased — safety (Android and web)
- **Sales record:** it is no longer cut off at 5,000 sales when saving (the newest sales could have been counted twice). It now keeps up to 100,000.

## Unreleased — simpler menus and scan settings (Android and web)
- **Give and share** is one section in More with three tabs (Suggested, By model, Send) instead of three separate entries.
- **Unknown models:** a Delete button for each phone and for the whole group (with the usual are-you-sure question).
- **Catalog segment fix:** choosing a segment for a model now takes effect even when an older "this month only" choice existed (the menu used to jump back).
- **Scan settings:** one scan speed (Standard). In label tests Fast missed labels and Detailed was slower with the same results. Products in each photo is Auto, or 1 to 6.

## Unreleased — store only (Held), colour check before Sold (Android and web)
- **Store only:** a switch on the Scan screen. New scans are kept as **Held**: stored only, not in the report, targets, Sold or Home. Phones has a Held bar with **Release (share)**; sharing never changes the report or the data. A phone can also be set to Held in its Stock menu.
- **Colour check before Sold:** in the "Mark them as Sold?" prompt, phones with no colour show tap buttons (the model's colours), so the right colour comes off the report.

## Unreleased — after sending, Back button, today on Targets (Android and web)
- **After you send phones:** "You sent N phones. Mark them as Sold?" lists the models, colours and owners that will change. Mark as Sold takes the stock off the right colour in the report and adds to the owner's Sold, with Undo. Not now changes nothing. Can be turned off (Don't ask again).
- **Targets:** each segment and person shows what was sold today, and **Share summary: pieces per day** makes a text to copy and send.
- **Back button:** Back now goes to the screen before (Scan, Phones, Report, Targets...) and closes popups first. It only leaves the app from the first screen.
- **Fix:** a phone of a model that is not in the report, marked Sold and then taken back, no longer makes a new report line.

## Unreleased — less typing for colours and levels, per person on Targets, send from People (Android and web)
- **Colour names:** a built-in colour dictionary names short forms by itself (CRM = Cream, GRPH = Graphite...). The report has one Colour names list for the whole report: name a short form once and every line that uses it is filled in. The popup shows tap suggestions.
- **Levels and months:** Use suggested / Same as last month for levels, and Start from last month for targets (sold starts at 0).
- **Targets, Everyone view:** each segment line lists every person with what they still need and per day.
- **People:** each person has Send, Bluetooth / nearby and Numbers buttons next to Devices and Export.

## Unreleased — numbers that follow the phones by themselves (Android and web)
- **A phone marked Sold counts by itself:** the owner's Sold for that segment goes up (this month; a person with no target line for it gets one), and the Sold of the matching report line goes up. Marking it back to *In stock* takes the same numbers off. *Given* is not a sale: it only leaves the stock. A phone that is deleted keeps its sale. Phones marked Sold before this existed are taken as counted already.
- Together with scans going into the report (stock and colour counts follow the phones), the report, the targets and the stock now move together without typing. Everything is marked or announced ("2 sales added to the targets and the report").
- Target and Sold are typed or pasted (no − / + buttons); **Copy target to everyone** copies the target only, never Sold (it is each person's own).

## Unreleased — popup in the right place, typed numbers in Assign by model (Android and web)
- **Report popup fixed:** it was drawn half behind the bottom bar (the screen's entrance animation kept it in a layer under the bar). Animations no longer leave a layer behind, and the popup is drawn at the top level of the page. A browser test and an emulator check make sure the popup covers the bottom bar and fits inside the screen.
- **Assign by model:** the number of phones for each person is typed or pasted (digits only) instead of − / + buttons, and each person has **Copy to everyone**, which gives the same number to all as far as the phones go.
- Bigger "Manage people" button; the layout test now also opens the segment and Assign by model screens.

## Unreleased — typed targets (Android and web)
- **Targets, one segment:** Target and Sold are typed (paste works; only the digits count) instead of − / + buttons, and each person has **Copy target to everyone**, which copies the target number only (levels and sold stay each person's own). The segment screen is covered by the layout test at 320 to 411 px and large text.

## Unreleased — report popup, scans into the report, Home for everyone (Android and web)
- **Report line popup:** tapping a line opens a popup (not a card above the list) with Previous / Next, a short "How to fix this line" box, editable labels and colour names, + Add colour / remove, and **Match my scans**. **Save line** marks the line as *checked*: it leaves the to-check count even when it still differs from the scans (a new pasted report starts fresh). Fixed: lines with no stock were drawn 190 px tall.
- **Scanned phones go into the report by themselves:** phones scanned before pasting are taken as already in it; phones scanned (or taken out of stock, or deleted) after that change the matching line's colour count and stock, a new colour gets its own entry, a model the report does not list gets a new line. Lines say "+N from scans since you pasted". Sold is never touched.
- **+ Person:** make a person with a name on Phones (under the person chips) and on Scan, without leaving the screen.
- **Home looks at everyone:** an Everyone chip (the default) shows the overall percent, what is still needed per segment with all people added up, and who is under 70 %. A person chip narrows it to one person. Segment names of your own are used in these lines.
- Layout: the bottom bar stays on one row with large text; Home and Targets no longer run past the edge at "Extra large" text. The layout test checks text zoom 1.3 and has data on Home.

## Unreleased — colour themes and more motion (Android and web)
- **Colour themes:** Settings > Colour: Mint (as before), Ocean, Violet, Rose. Every green of the stylesheet is now a variable, so one choice recolours buttons, badges, bars and highlights everywhere. Remembered on the phone. The dark look stays.
- **Motion:** the bottom bar's highlight slides to the new button; list rows (phones, report, targets, More) arrive one after another; the ⋯ More menu is a bottom sheet on phones that springs up and can be dragged down to close.
- Not built: a light theme (the stylesheet has about a hundred fixed neutral colours), count-up numbers, loading shimmer.

## Unreleased — less noise, a little motion (Android and web)
- Removed the "STEP 01 / BULK UPLOAD" and "STEP 02 / EXPORT OPTIONS" decoration: Scan and Export have one title and a short line, like every other screen. Shorter help texts (background scanning, camera series) and a one-line footer.
- Short, quiet animations: a screen or a sheet eases in, a phone's details slide open, a pressed button gives a little, the active bottom button pops, progress bars grow. All off when the phone asks for reduced motion.
- The bottom bar spreads its buttons across the width in both modes. The layout test checks that too.

## Unreleased — Simple mode redesigned (Android and web)
**Simple mode is now three screens, like Detailed mode.** Bottom bar: **Scan, Phones, Send**.
- **Scan:** the upload controls and "New phones go to". When a scan finishes, Phones opens by itself.
- **Phones:** the same short list as Detailed mode (model and IMEI in groups, tap to open and edit; tick boxes and the selection bar only after **Select**). No retail extras.
- **Send:** Export Excel, Share phones, Send numbers, Download pictures, and Fix photos when some need it.
- No more "STEP 03 Scanned records" page with panels stacked on top of each other. People are still managed in the People panel at the top of Phones.
- New tests: `scripts/e2e-simple.mjs`, emulator scenario 22, and the layout test also runs in Simple mode (`SIMPLE=1 node scripts/e2e-layout.mjs`).

## Unreleased — RetailLens, version 3: a new interface (Android and web)
**Fewer places to go, one title per screen.** The bottom bar is **Home, Scan, Phones, Report, Targets, Export**; People, Gives, Segments, Catalog, Assign by model, Share, Backup and Settings are under the **⋯ More** button in the top bar.
- **One title per screen** (no repeated "Scanned records" card): Home, Phones, Report… each with a short status line.
- **Phones:** a short list. Each phone is two lines (model with storage, IMEI in groups); tap it to open colour, RAM, IMEI 2, segment, stock status and the edit fields (model, IMEI, serial, person) with Copy, Share, Download, View photo and Delete. Tick boxes and the selection bar only appear after **Select**. "New scans go to" moved to the Scan screen.
- **Home:** a person switcher; "Sell first for <name>" says whose target it is.
- **Report:** a line with no stock on either side is counted as "no stock", not as agreeing.
- **Catalog:** the segment dropdown always shows a value that can be picked.
- Tests updated for the new names (browser suites, emulator scenarios and Maestro flows).
- **Buttons and layout:** the Scan screen no longer runs past the right edge of the phone (large system text made its card too wide); small buttons on Home and the top bar are bigger. New layout test (`scripts/e2e-layout.mjs`) checks every screen at 320, 360 and 411 px.
- **Colours of each model:** type them once in Catalog (one line each: `Cream = CRM`), pick a colour for a phone from its model's colours, and name an unmatched report colour once (it is remembered for that model). "Grey" and "Gray" are one colour. Colours read from labels are offered automatically.

## Unreleased — RetailLens, version 2 (Android and web)
**Retail redone around one pasted report.** Tabs: Today, Report, Targets, Gives, Segments, Catalog, Data. The Stock tab, the Reports writer and the Sold automation are gone.
- **Report:** paste the store's WhatsApp report (`Model : sold/stock` and `(colour counts) names`). It is checked against the phones you scanned (model, storage, RAM, colour; phones marked sold or given do not count): every difference is described in words, abbreviations are resolved from the scanned phones, and an unknown name is matched once and remembered. Tap a line to fix the name, segment, sold, stock and colour counts (stock follows the colours). Copy it back out in your own layout with today's date; New day resets sold. Header, totals, other brands and shifts are kept as typed.
- **Segments:** your own list (Fold 1, Fold 2…): add, rename, reorder, delete, and tick the models in each. Records, Gives and Targets use it.
- **Targets:** tap a level (70, 80, 90, 100, 110, 120) and every segment line says how many pieces are still needed and per day; open a segment for each person (target, own sold count with +/−, pieces typed from the Promoter screen per level).
- **Gives:** one list of suggestions with Approve and Skip; history and Undo stay.
- **Catalog:** mark phones In stock / Sold / Given (only in-stock phones are compared with the report).
- Data written by version 1 is kept and still loads.

## Earlier — RetailLens version 1 (Android and web)
**IMEI Lens became RetailLens — "Scan. Sell. Track. Achieve."** IMEI Lens stays the scanning engine; the package id, signing and every saved record, picture and person are unchanged. New **Retail** tab (Detailed mode), seven sections:
- **Today:** what to sell first for my target (units per day, how many I hold, how many short), confirm a sale by searching an IMEI, sales waiting to be submitted to Samsung, stock alerts, a daily checklist (with your own items) and the uploads of the last days. A report shared to the app as text opens Reports.
- **Catalog:** editable models (name, report abbreviation, SKU / RAM / storage / colours, segment, a different segment for one month). A segment you change is remembered as a verified correction. Phones are sorted into **Flagship 1, 2, 3, Mid, Low, Tablet, Wearables** automatically (Records now has a Segment filter and badge; Bulk edit can set a segment, storage and colour).
- **Targets:** import a Samsung Promoter screenshot (read on the phone, offline) or type the numbers; achievement %, units left to reach 70 / 100 / 120 %, units needed per day and estimated incentives (example rates: edit them to your scheme). Sales submitted after the screenshot count as achieved; sold-but-not-submitted ones are shown as pending.
- **Gives:** a recommended allocation that reserves the units my selected target (70 / 100 / 120 %) needs first, then lifts everyone below 70 %, then others toward 100 %. It only proposes; you approve the lines you want, the history lists every allocation, and each can be undone.
- **Stock:** by model, storage and colour; a confirmed sale lowers it by itself and Undo brings it back; manual lines for opening stock; sales can be undone or moved to another person only with a written reason (audit trail).
- **Reports:** paste a WhatsApp report you sent before; the app learns its layout and writes the next one from your sales, stock, colour quantities, totals, activations, SC+, competitor sales and shifts. Lines it does not understand are kept as written.
- **Data:** backup (numbers, no pictures) and restore with undo, "go back" to any of the last 8 states, monthly history that is never deleted, audit trail.
Safety rules: a sale belongs to the phone's owner and a phone cannot be sold twice or without an owner; allocations are never applied without approval; nothing here changes a scan record except the owner of a phone you approve. Not built (needs a permission): watching the WhatsApp media folder. Photos shared to the app are scanned as before and listed by upload day.
- **Phone fixes found by the new tests:** a report shared to the app as text no longer crashes a cold start; photos shared in the instant after a scan ended are no longer lost (waiting photos now keep waiting while another scan is queued or running).
- Tests: `scripts/test-retail.mjs` (logic, synthetic data), `scripts/e2e-retail.mjs` (31 browser checks including the offline screenshot import). **Not verified:** the real phone, and your real Promoter screen and WhatsApp report formats (I had no samples; the parsers learn from yours).

## Unreleased — photo editor, Bulk edit photos, automatic retries, People tab (Android and web)
- **Fix photo moved into Crop / edit photo.** The review window's separate Fix photo group is gone. The photo editor has **Rotate left / right** on its bar (the boxes turn with the photo) and **Straighten** under More, next to zoom, pan and the crop boxes. The editor now uses nearly the whole screen on tablets and computers (all of it on phones).
- **Delete photo** (More, in the editor) for a picture that is not a label: the photo and its record leave IMEI Lens into the archive, with **Undo** (and Restore from the archive). Nothing on the phone's gallery is ever deleted.
- **Bulk edit photos** (review banner and review list): every photo that needs a look (including unknown models) in the floating editor, one at a time, with **Previous, Delete, Next** and progress such as "3 of 15 photos · 2 edited". Edits (boxes, turns) are kept while you move; on the last photo Next becomes **Finish**: only the edited photos are queued for rescanning (OCR and barcodes) in the background; unchanged photos stay in Review. Results that pass the checks are saved; the rest come back to Review. Closing or a restart keeps the boxes as a draft to Resume.
- **Auto Scan retries.** When a scan ends, each new photo it could not read (no IMEI or serial, or an unsure crop) is tried once more automatically in the background: labels are found, levelled and cut, and a crop with no valid IMEI is read again turned a quarter, three quarters and half way round (at most 3 extra reads, kept only when the checksum passes). A photo with no separate label is read whole. What still fails stays in Review (never deleted, never retried in a loop). Left out: labels cut off by the photo edge (retake prompt, never guessed), photos the auto-split already handles, crops, and confirmed records. Auto-detect and Rotate stay in the editor as manual overrides.
- **People tab** (replaces Unknown): add, rename and delete people, search by name or by a phone's IMEI, serial or model, see each person's device count and models, **Devices (N)** opens their phones in Records, **Export** saves only their phones. The Give tab links to it.
- **Unknown models** are no longer a tab: Records has an **Unknown model** filter (with the naming cards: name a model once for all its phones, fix a misread code) and a badge on each such row; the review list includes them with an "Unknown model" note.
- **Scan first.** The introductory banner is gone; on the Scan tab the scan controls come first and the status banners follow; tighter spacing on phones.
- **Rescans keep your corrections.** When one label is re-read from a record you confirmed or whose IMEI 1 already passes the checksum, your IMEI, IMEI 2, serial and model are kept; a different reading only flags the record for review. The queue's first tab is now called **Queued**.
- Tests: new browser test `scripts/e2e-photo-edit.mjs` (23 checks: bulk edit, rescan with auto-turn, keep-typed-numbers guard, delete/undo, interrupted session, Unknown filter, People tab, scan-first layout, automatic retry after a scan); unit tests for turning boxes and for the rescan guard. **Not verified:** the real phone.

## Unreleased — simpler crop screens (Android and web)
- **One Save button in the crop editor.** One photo: **Save all** reads the labels now and shows the check screen as before. Several photos (Bulk crop): **Save all** cuts them one by one in the background (a photo with no boxes is cut automatically) and the editor closes at once. **Save for later**, **Queue in background**, **Queue this photo & next**, **Process later** and **Queue all** are gone; the Queue panel stays reachable from the banner (its Process later tab only shows for photos set aside by an older version).
- **Closing never discards.** Closing the editor keeps your boxes as a draft you can Resume; the Save for later / Discard / Continue editing popup is gone.
- **Boxes are found for you.** A photo that opens with no boxes is searched for labels once, so you start with boxes to check instead of "0 labels". The bar is shorter: Draw, zoom, Undo, Delete (greyed until a box is selected) and Auto-detect; Redo, Select several and Select all are under **More**; Pan appears when zoomed in.
- **One way into the crop editor from a review:** the single **Crop / edit photo** button. The prompts ("Is this 1 device or N?", "Check the crop", "Retake this photo") keep only their decision buttons (1 device / Split automatically; Retake photo / Keep as is); the extra Crop each myself, Crop manually and Adjust crop buttons are removed.
- Tests: browser `scripts/e2e-studio.mjs` (12 checks) and `scripts/e2e-queue.mjs` rewritten for the single Save; emulator 03, 04, 10 and 17 updated. **Not verified:** the real phone.
## Unreleased — simpler review: one Save, a bulk list, fewer popups (Android and web)
- **Review dialog:** one **Save** button (saves, then moves to the next record; closes after the last). Previous / Next stay. Rotate and Straighten are under **Fix photo**; Download photo, Delete this record and the details are under **More**.
- **Nothing is lost when you leave:** closing the review (or the list) saves every edit. A half-typed IMEI keeps the old IMEI, flags the record and leaves a note instead of being thrown away. The Save / Discard popup is gone.
- **Bulk review list:** after a scan, records that need a look open in a fast list (IMEI 1 and Serial per row, edits autosave). **Accept N that look right** (valid IMEI, no duplicate, no flags) with **Undo**. The banner **Review all (N)** opens it again.
- **Archive hint:** a new record whose IMEI is already in the archive shows **Also in archive** (a soft hint; nothing is flagged or moved) with a **View archive** button.
- **Fewer popups and buttons:** duplicate / invalid notes are short messages; Archive duplicates acts at once with Undo; the Records table no longer has an extra Edit photo button; Share has the extras under **More ways to send**; the linked picture has one **Copy numbers** button; Give tab: *Who gets how many* and *Send one at a time* (renamed, both kept).
- Tests: `scripts/e2e-review.mjs` (9 checks), `scripts/e2e-bulk.mjs` (8 checks), `npm test` (11 suites), emulator tests 00 to 18 all pass on a freshly booted emulator. **Not verified:** the real phone.
## Unreleased — the phone camera app is the only camera (Android)
- **Take photo / Scan with camera now open the phone's own camera app.** The in-app live preview (small, wrong shape, often did not scan) is no longer used on the phone; the browser version keeps it.
- The camera writes the full-size photo straight into a private folder inside the app (never the gallery) and it is scanned by the same background scanner as chosen photos. A photo survives the app being closed while the camera is open.
- **After taking a photo** (setting under the camera button): keep taking photos, scanning each one while you shoot (default, so only the last photo is left to scan when you stop) / scan each photo right away / take several, then scan them together (**Scan now**, or **Discard waiting photos**, which deletes only this app's own unscanned camera photos).
- Clear messages for: camera permission refused, no camera app, cancelled camera, photo not saved. A photo with no IMEI is reported (to review / to retake), never hidden.
- Tests: JVM `CameraInboxTest` (9), `scripts/test-camera-mode.mjs`, emulator `18-camera-native`. **Not verified:** the real phone camera (POCO/HyperOS) returning the full-size photo.
## 1.26.0 — crop queue with statuses (Pending, Processing, Process later, Needs review, Completed)
**Root causes found in 1.24–1.25 (and fixed here):**
- *Settings did not reach queued photos.* The queue called the label detector with "Products in each photo = Auto, Standard" hard-coded and always ran every extra reading pass. Fixed: Scan speed and Products in each photo are read when each photo starts. Evidence (browser test): on a blurry pair Standard read 2 of 2 IMEIs and Fast 0 of 2; with 5 expected on a 4-box photo every crop is flagged "Found 4 of 5 products". Fast was not measurably quicker in the test (about 13 s in both): most of that time is starting the reader and finding the labels, which both modes do.
- *Failures disappeared.* A photo that could not be cut only raised a counter and stayed in your list with no reason, no retry and no way to find it. Now it is kept in the queue as **Needs review** with the reason, Retry, Crop myself and Quick edit.
- *"Review N" picked records by time*, so unrelated records scanned during the queue were included. Now a small log records which records each queued photo became; Needs review shows only those photos.
- *A single-product photo that already had its numbers* was counted as "left as it is". It is now **Completed** ("One product: kept as it is").
- *A finished photo could drop out of the queue without being replaced.* The queue entry was removed at once but the new records were saved about 0.35 s later; if the app was killed in between, the original stayed and the queue no longer listed it. Now the entry is removed from the saved queue only after the records are stored. Test: leaving the app the instant a photo finished, three times: each time the original was still there and still queued (it is read again on resume; nothing lost, nothing duplicated).
- *"Queue this photo & next" jumped to the first unqueued photo from the start*, not the next one. It now opens the next unfinished photo after the current one.
**New:**
- **Process later ⏭** in Crop Studio: keeps the photo's boxes, marks it, opens the next unfinished photo. Set-aside photos are not read until **Resume / Continue**, which includes them.
- **Queue panel** (banner → *Queue*): tabs Pending, Processing, Process later, Needs review, Completed with counts; per photo Later / Process now / Remove / Retry / Retry all / Crop myself / Quick edit / Approve; *Queue N photos that need cropping*; *Select N records for export* (turns on "selected only" in Export).
- The queue and the finished log survive a restart (ids, boxes, statuses only; never pictures). A photo that was being read when the app stopped is offered again as waiting.
**Tests:** `scripts/test-crop-queue.mjs` (statuses, later/resume, retry, duplicate prevention, restart recovery, log, Needs review/Completed); `scripts/e2e-queue.mjs` (browser, 15 checks incl. the kill-after-finish check). `npm test` 14 suites pass; review, Crop Studio and camera browser tests pass.
**Not done / not verified:** nothing ran on a phone (no device available); the queue still runs in the page (kept alive by the 1.25 notification) and Android may still pause it; the native SQLite + WorkManager queue is planned but not started (on hold by request).
## 1.25.0 — the crop queue keeps working when the app is minimized (Android)
**Android code changed (new APK).**
- While the background crop queue runs, the app shows an ongoing notification ("IMEI Lens is cropping photos · 3 of 12 done", progress bar, tap to open, **Pause**) and holds a wake lock, so Android does not stop it when you minimize the app or the screen turns off (new `QueueService`, foreground service of type media processing; bridge `queueStatus` / `queueStopRequested`). Pause in the notification pauses the queue; *Continue* in the app banner resumes it.
- The queue is still saved on the phone and offered for resuming if Android stops the app anyway.
- **Not verified:** this needs a physical phone (no phone or emulator here): the code compiles and the manifest/bridge are in the APK, but how long a given phone keeps the page running while minimized is untested; some makers' battery savers kill apps regardless (set IMEI Lens to "unrestricted" battery use). The page itself may run slower while minimized.
- **Next step (planned):** move cropping and reading into the phone's own scanner (like *Choose photos and scan*), which survives minimizing, locking and closing without any of these caveats.
## 1.24.0 — background crop queue, faster Crop Studio start, responsive Save all
- **Background crop queue (Bulk crop or Crop photo):** *Queue this photo & next →* sends the photo you just boxed to a queue and opens the next one; *Queue all in background (N)* queues every photo (photos with no boxes are cut automatically). The editor closes at once and the queue is read one photo at a time while you keep using the app. A banner shows "n of N done" with Pause / Continue and Cancel. Each original is replaced only after its crops were read; crops that are not certain are flagged, and a **Review N** button opens just those. A photo with no separate products found is left as it is (counted in the banner).
- **The queue survives closing the app:** record ids and box positions are kept on the phone; after a restart a banner offers **Resume** or **Discard** (it never starts reading silently). The queue runs on the page, so it pauses when the app is closed or in the background; the photo being read at that moment starts again.
- The Bulk crop list is fixed while the editor is open, so background replacements cannot shift it under you.
- **Why Save all felt slow and unresponsive:** the text reader (about 10 MB) was started only after tapping Save all, and several steps (cutting, straightening, barcode decoding, picture treatments) ran on the page's own thread back to back. The reader now starts when the editor opens, and the page yields between heavy steps.
- Tests: `scripts/test-crop-queue.mjs` (in `npm test`, now 14 suites) and `scripts/e2e-queue.mjs` (browser: queue all, editor closes at once, 3 photos read in the background, originals replaced, single photo kept, resume offer, discard).
- **Not verified:** not run on a physical phone; browser timing only.
## 1.23.0 — multi-product detection rebuilt around measured accuracy (web and Android)
**Why products were missed (root causes, found by measuring):** (1) the decision to "look closer" depended on the product count from the first whole-photo read, which is weakest exactly on photos with many labels (a 5-box stack: 0 of 5 IMEIs found, one record); (2) closer reads were cut from a shrunken copy; (3) the box-edge planner returned nothing when any seam was unclear, and could not handle two columns of boxes, so the whole photo became one record; (4) Crop Studio's Auto-detect was a second, weaker pipeline; (5) IMEI 2 from a neighbouring box could be attached to a product.
- **One look-closer stage for every source** (`lookCloser`): used by camera shots, uploads and Auto-detect. The product count also comes from the IMEI barcodes (two per label), the Model lines and the text size, not only the first read. Closer reads are tiles of the full-resolution photo (`gridTileRects`), up to 12 tiles.
- **Separation from label lines** (`src/seed-layout.ts`): one "Model : SM-…" line per product is a seed; seeds are split into columns (cut where the picture is emptiest), then rows between one label's last line and the next seed. Works for stacks, side by side and grids. Gives nothing rather than cut through text. Repeated labels on one box (main, "A", "B") stay one product; repeated IMEI rows are removed as before.
- **Phone-scanner photos get the web pipeline too:** a photo the background scanner could not split (one flagged record, several products) is re-read automatically after the scan with the same stages; the original record is replaced only when two or more crops were made and read. The review prompt has **Split automatically** and **Crop each myself**.
- **No field mixing:** IMEI 2 is kept only if it passes the checksum and, on Samsung labels, shares the six serial digits with IMEI 1. A photo with fewer products separated than counted flags every record for review.
- **Products in each photo / Scan speed** apply to camera and uploads (and to the phone scanner since 1.22).
- **Measured accuracy** (new `scripts/make-composites.mjs` + `scripts/eval-labeled.mjs`, real labeled label photos cut and stacked into 1/2/4/5/10/12-product photos with blur, glare, overlap and cut-off variants; 13 photos, 56 known IMEI 1): before 32% found; after **70% (Standard, Auto), 71% (count chosen), 70% (Detailed), 32% (Fast, by design: one pass)**. Per photo (Auto): 1 product 1/1; 2 products 2/2; 4 products 3/4; 5 products 4/5; 10 products 9/10; 12 products 9/12; light blur 2/4 and 1/2; glare 4/4; overlap 4/5; cut-off 1/1. Phone-scanner path (flagged photo split by the web stage): 10 → 9/10, 12 → 9/12. Fields mixed between products: **0**. Misread IMEIs that pass the checksum and are not on the label: 1–2 across the suite, always flagged for review.
- **Unit tests:** `scripts/test-seed-layout.mjs` (stacked, repeated lines, 2×3 grid with joined lines, side by side, tile grids, IMEI 2 pairing); `npm test` now 13 suites.
- **Known limits:** blur at sigma ≥ 2.2 is not read (flagged, not guessed): 0 of 6; an IMEI printed small and partly hidden at the top of a stack is the most common miss; (fixed in this release: Samsung serials never contain the letter O, so an O read is turned into 0; wrong serials in the labeled photos dropped from about a third to 1 of 24); a box whose Model line is not read merges into the box above (its numbers then appear as a flagged mix, never a silent one); the photos are composites of real labels, not physical 10-box shots; the native (Java) scanner and the phone itself were not run: no phone or emulator is available, so the Android timings are unmeasured (browser: 2–40 s per photo).
## 1.22.0 — one review sheet that fits, settings that apply everywhere, faster editing (web and Android)
**Android code changed (new APK):** background scanner settings, rotation no longer reloads the page.
- **Review sheet rebuilt.** The old sheet had a photo and a floating button panel that together covered about half the screen, so fields overlapped ("= Galaxy A57 5G" ran into the Serial label; IMEI 1 sat beside its box; the model name was cut off). Now: header, a scrolling body and a footer that sits below it (never on top). The photo is a compact preview (tap it to enlarge; *Zoom to label / Show full photo* and *Crop / edit photo* beside it). Five fields stacked with labels above (model, S/N, IMEI 1, IMEI 2, person); photo actions (Copy IMEI, Photo, Rotate left/right, Straighten) in one tidy row; footer: ← Previous · n of N · Next → / **Finish ✓**, then Save · Save & next. Leaving with unsaved changes still asks (Save all / Discard changes / Keep editing); delete still asks first.
- **Editing no longer freezes.** Root causes found: every keystroke re-rendered the whole 4,700-line page; the model picker re-sorted and drew every Samsung model on each render (and each time it opened); the phone decoded the full-size original while the review screen was opening. Fixes: text boxes keep their own text and update the page at low priority; the model list is built only when its content changes and shows 60 at a time (search or *Show more*); the original is loaded after the sheet is drawn and skipped if you move on.
- **Scan speed and Products in each photo now apply to *Choose photos and scan* (background) as well as the camera.** Both are remembered between sessions. Products in each photo goes to 12 in the phone's scanner too (tile plans for 7–12). Fewer products than expected are flagged for review ("1 device or N?") instead of being saved as one phone; in Auto, valid IMEI barcodes (two per label) also count as a hint.
- **Rotating the phone no longer reloads the app** (the Android activity handled rotation by restarting the page, which lost an unsaved edit). Added `configChanges` to the manifest.
- **Samsung names:** the model list no longer shows a storage size from the catalog ("Galaxy A57 5G 128GB (Unlocked)") for a phone whose label says 256 GB; the built-in name wins and catalog names are stripped of storage and carrier, as the records list already did.
- **IMEI paste:** pasting an IMEI with spaces or dashes ("350 357 925 907 537") was cut at 15 *characters*; it now keeps the first 15 digits.
- **Crop Studio:** Redo (Ctrl+Y / Ctrl+Shift+Z) next to Undo.
- **Tests:** new `scripts/e2e-review.mjs` (9 checks at phone size, with screenshots); `e2e-studio.mjs` now 11 checks (Redo). `npm test` unchanged and passing.
- **Not verified / still open:** nothing was run on a physical phone or emulator (none available on the build machine), so the native scanner changes compile and are code-reviewed but not measured; the layout was verified in headless Edge at 412×860. A crop that picks up the neighbouring label's IMEI 2 as IMEI 1 (seen in a screenshot of three stacked boxes) could not be reproduced without that photo and is not fixed; such records keep their review flag. Serial O/0 lookalikes (R5GL80LDKFM vs R5GL8OLDKFM) cannot be decided from the text alone and stay editable. The APK is debug-signed.
## 1.21.0 — camera advice, label counting, one crop editor (web and Android)
This release ships the web changes of 1.20.0 (Crop Studio, drafts, exit confirmation, OCR retry and IMEI repair) together with the Android app. **No new native (Java) code: the Android scanner is the one from 1.19.1.**
- **Camera that tells you what is wrong:** the camera screen measures sharpness, glare and darkness on a small copy of each frame (about 1.4 times a second) and shows advice (Sharp and clear / A little soft / Blurry / Glare / Too dark). The thresholds come from real label photos: readable photos score 250–830, blurred copies 2–10. After each shot the same check runs, followed by the count of readable IMEI barcodes.
- **Tap to focus:** tap the label on the camera screen; a ring shows where. It uses the camera's point-of-interest focus where the phone allows it and says so when it does not.
- **Better count of the products in a photo:** the label count also uses the S/N, storage (4GB | 128GB) and long model-code lines, so one misread “Model :” line no longer hides a label. *Products in each photo* now goes up to 12.
- **No quiet misses:** a photo that shows several labels but could not be split is flagged for review (“1 device or N?”) instead of being saved as one phone.
- **Unknown models:** after a scan the message tells you how many models are not in the catalog and sends you to the Unknown tab to confirm the names (kept as your own models, also after catalog updates).
- **Tests in a real browser** (not part of `npm test`, need Edge/Chrome and `npm run build`): `scripts/e2e-studio.mjs` (Crop Studio, 10 checks), `scripts/e2e-camera.mjs` (live advice, tap-to-focus and shot check with a real photo as the camera feed), `scripts/e2e-scan.mjs` (the real scan on photos in `test-photos`, with an accuracy summary), `scripts/eval-frame-quality.mjs` (the blur/dark thresholds on real photos).
- **Not done / not verified:** OpenCV and perspective (keystone) correction were not added: the ML Kit and in-app image treatments already cover tilt, and OpenCV would add tens of MB that could not be tested without a phone. Native Android camera (CameraX) was not added: the in-app camera runs in the WebView. Nothing was run on a physical phone or an Android emulator (none available on the build machine); measured numbers come from a desktop browser. One known weakness: the IMEI repair step can produce a checksum-valid IMEI 2 that is not what the label says; those records are flagged for review.

## 1.20.0 — Crop Studio, safer IMEI reading, drafts (web app only; the APK is not rebuilt)
- **Crop Studio:** one compact editor (full screen on phones, a popup on desktop). Draw a box per label; the count in the header is the number of boxes, there is no count step. Move, resize (corner handles), delete (×), Select several / Select all, Undo, zoom (1×–4×) and Pan. **Auto-detect** adds boxes it finds (it never doubles a box you already have, and it now levels tilted photos first).
- **Many photos at once:** thumbnail strip, **Save all (N crops, M photos)** and **Save for later**. Boxes are saved as a draft on this phone/computer; a banner offers **Resume** or **Discard** after a reload.
- **Exit confirmation:** closing with unsaved work asks **Save for later / Discard / Continue editing**. The Back button does the same.
- **Original removed after a crop:** each crop becomes its own record with its own IMEI, serial, model and the same person. The full photo is not copied into the crops and its stored copy is released. The check screen warns before this happens. Your gallery is never touched.
- **No mixing between products:** every box is read on its own; the model is taken from the crop's own text first, and an old record's IMEI/serial is only inherited for a single-product, single-crop split. The same IMEI found in two boxes is flagged.
- **More accurate reading:** extra picture treatments (contrast, sharpening, even light, black/white, inverted) in several passes; Luhn check on every IMEI; lookalike letters (O/0, I/1, S/5, B/8…) repaired; digits voted across passes; a repaired number is only accepted when exactly one fix matches a known model prefix, and is still flagged. Weak labels are read again automatically (up to 4 passes) and, when still uncertain, shown with a ⚠ and “Did you mean” choices for manual review. Nothing is guessed silently.
- **Build fix:** the OCR engine files are copied into the build again (they were missing from published builds since 1.19).
- **Known limits:** very blurry + tilted + low-contrast photos may need manual typing (they are flagged, not guessed); the Android app still keeps its native copy until the next APK; tests use generated photos, not a physical camera.

## 1.19.1 — the background scanner looks closer for missed products
- **Choose photos and scan** counts the "Model : SM-…" labels it can see. When that is more than the products it found, it reads the photo again in overlapping pieces (halves, thirds, 2×2 or 3×2) and separates the products again. The same idea as the in-app scanner's tiled re-read.
- Sharing: the *Share {person}* pop-up and the Share tab both stay (the pop-up is for hand-picked selections, the Share tab for whole people).

## 1.19.0 — the background scanner reads barcodes and levels tilted photos
- **Choose photos and scan** (the Android background scanner) now reads the label barcodes (ML Kit barcode scanning, on the phone). Each barcode is paired with the "IMEI 1" / "IMEI 2" text printed under it; when exactly one fits, its exact number is used, so OCR misreads of IMEI 1 are corrected. Barcode-confirmed records show it in the confidence score.
- **Tilted photos are levelled** before the products are separated (angle of the text lines, 2–20°). The levelled photo is kept only if the text really became straighter and nothing was lost.
- **Model codes edited in the records list** now teach the learning too (when you leave the field), not only review saves.
- The app is about 9 MB larger (25.8 → 35.2 MB) because the barcode reader bundles its model so it works offline.

## 1.18.1 — audit: one scan path, one catalog, consistent duplicates
- **One way to scan gallery photos in the Android app:** *Choose photos and scan* (the phone's own text reader, keeps running in the background). The browser drop zone and *Quick scan … while open* are gone from the app; the website keeps its browser upload. Simple mode's *Choose photos* now uses the same background scan on Android (it used the browser scanner before). Photos left in the queue after a failed camera scan still show with a scan button.
- **Samsung catalog in one place:** the catalog panel moved from the scan screen into **Settings → Downloaded Samsung catalog → Official product details**. It no longer downloads the catalog a second time when the app opens, and its name box (a duplicate of Check catalog's edit) is gone. Both use one download routine.
- **Duplicates use one rule everywhere:** editing an IMEI in the records list or saving in review now warns when the IMEI exists in *any* earlier scan, matching the Duplicate flag and Remove duplicates (before, only the same upload or the latest batch was checked).
- **Background scans learn too:** model corrections and repeated model references now also apply to results from *Choose photos and scan*.
- Removed unused code (an old IMEI reader, unused share/section helpers, an unused Google sign-in helper, a scan-time text region that was computed and never used, a model-series count recalculated on every screen update).
- New regression tests for duplicates across scans.

## 1.18.0 — confidence score, learning from corrections
- **Confidence score** for every record (0–100, high / medium / low) shown at the top of the review window; hover for the reasons (checksum valid, barcode confirmed, IMEI 2, serial, catalog match, crop, duplicate). A record with no IMEI never scores above 45.
- **Learns from verified corrections:** when you change a model code in review (for example a misread `SM-A1O5F` to `SM-A165F`), the same misread is fixed automatically in later scans on this phone.
- **Repeated model references:** an unverified model code that is one character away from a code seen on at least two other phones is corrected to it. Models already named from the Samsung catalog are never changed.
- Fixed: a misread model code with a letter where a digit belongs was not recognised as a code.
- New automated tests for the score and the learning.

## 1.17.1 — sideways and tilted multi-product photos
- **Orientation check** now runs whenever the first read is weak (not only when nothing is read) and turns the photo only when another angle clearly reads better. Sideways photos with stray digits are no longer left sideways.
- **The whole photo is levelled** (tilt of about 2.5° or more) before the products are located, not only the crops afterwards.
- **Automatic product count:** with *Products in each photo* on Auto, the number of “Model : SM-…” lines is used as the expected count, so photos with several labels are re-read in enlarged tiles.
- Measuring scripts for real photos in `test-photos` (`scripts/eval-multi-*.mjs`, not part of `npm test`); more tests for the new decisions.

## 1.17.0 — better detection of several products in one photo
- **Scan → Products in each photo** (Auto, 1–6). When fewer products are found than you chose, the photo is read again in overlapping, enlarged tiles (text and barcodes) and the results are merged, then split again. Photos that still come up short are counted in the finished message; ones that cannot be split are marked for review with the expected count.
- **Automatic straightening:** every crop is levelled (tilt of about 1–15° is detected from the text lines and undone) before it is read and saved.
- **Review → Straighten** button levels the whole photo and its crop.
- **Camera check:** after each shot the camera says how many IMEI barcodes were readable and warns when fewer than the expected products are readable.
- New automated test for tilt estimation, tile plans and merging.

## 1.16.0 — welcome, tutorials, steadier review
- **First launch / new version:** a dialog shows the features and improvements once. It is also in **Settings → Help → What’s new**.
- **Tutorials** for everything (scanning, camera, review, crop, people, unknown models, WhatsApp/Bluetooth, One by one, save and export, duplicates, settings, reset) in **Settings → Help → Tutorials**.
- Credit now reads **Carlou Joseph Barnes**, with a troll picture, in the welcome dialog and Settings.
- **Review window:** the picture stays fixed at the top while you scroll. The typing section (model, serial, IMEI 1) and a second group (person, IMEI 2) fold up and down.

## 1.15.1 — cleaner review
- Removed the Samsung Promoter note and link from the review window (More details).

## 1.15.0 — remove duplicates
- **Duplicates are now found across all scans**, not only the latest batch: any 15-digit IMEI that appears more than once is flagged.
- New **Duplicates** filter chip (with a count) and a **Remove duplicates** button next to the status filters. It asks first, keeps **one copy of every IMEI** (the most complete: serial, known model, valid, saved crop, then the earliest) and deletes the rest with their pictures. **Undo** is offered for a few seconds.

## 1.14.1 — one tap in One by one
- **One by one:** the main button is now **Download image + copy IMEI & next**. One tap saves the picture, copies IMEI 1 and goes to the next phone. The separate Copy IMEI button is gone; Copy S/N stays.

## 1.14.0 — clean pictures, text size
- Pictures sent or saved (WhatsApp, Bluetooth, Save to my phone, One by one) have **no text written on them**. They are resized to 1600 px and sharpened with a little extra contrast. The numbers stay in the caption and `numbers.txt`.
- The tick-box *Also write the IMEI / serial on each picture* is gone.
- Scanning and review: the Zoom/Full photo button, the camera countdown and the thumbnail remove buttons no longer sit on top of pictures; the photo area is taller and clearer.
- **Settings → Text size**: Small, Normal, Large, Extra large, remembered on the phone.

## 1.13.0 — choose the save folder once
- **One by one** and **Save to my phone** ask for a folder **once** (Android keeps the permission) and then save without asking, into `IMEI-<person>` inside it.
- Saving again **replaces** the earlier numbered pictures and `numbers.txt` automatically. Saving only "the rest" keeps the pictures already saved; `numbers.txt` always lists every phone.
- **Settings → Where files are saved** shows the folder, with Change folder and Forget this folder.

## 1.12.2 — faster, more reliable sending
- A send that was started and never finished no longer blocks the next one (the app used to refuse with "finish the current save").
- Pictures are shared as images (`image/*`) instead of "any file".
- Pictures go to the app as their own data in large pieces; the button shows *Preparing 8 of 40…* then *Sending 28 of 40…*.
- Writing the IMEI/serial on every picture is now off by default (it was the slow part; the caption carries the numbers) and stays available as a tick-box.

## 1.12.1 — Settings always reachable, one build everywhere
- On phones about 360 px wide and under, the header pushed **Settings** off the screen. The logo text now hides first and the buttons shrink.
- **Reset** is always available (it also clears results the app still has saved).
- Settings shows `Version X (commit) · Web / Android app`, written by the build, so the website and the app can be compared.
- Downloads are numbered in picture order with the IMEI: `001-352099001761002.jpg`. Saving the rest keeps each picture's place in the whole list.
- CI fix: the catalog lookup now reads its stored lists safely.

## 1.12.0 — one send, one caption; one by one; save to my phone
- **WhatsApp:** all pictures in one send with **one caption** listing every IMEI and serial once, in picture order. Over 30 pictures the app asks how many arrived and continues from there.
- **One by one** (per person): large picture and numbers, Copy IMEI / S/N, Download & next, Back, Skip, remembered position, Download all remaining.
- **Save to my phone** (per person): a folder with the pictures and a `numbers.txt`.

## 1.11.0 — Bluetooth fallback, review drafts
- The app checks whether WhatsApp is installed and works; if not (or WhatsApp took fewer pictures than sent) a pop-up offers **Bluetooth**, which sends the pictures with IMEI/serial written on them plus `numbers.txt`.
- Review: changes are kept while you move between pictures; after the last picture (or on close) a pop-up asks **Save all / Discard / Keep editing**.
- Review: every button is in **one floating bar**; warnings (bad IMEI, duplicate, checksum, failed send) **pop up** with OK.

## 1.10.x — built for 1000 photos
- **1.10.0:** batches up to **1000 photos**. The page reads the scan in slices, so 1000 records load in seconds. Saved pictures are kept at 1800 px. **Settings → What this app can handle** lists what works, what has a limit and what is not possible, with estimates for this phone. Excel/Word warn before too many pictures go inside one file. Long text goes through the phone's share menu.
- **1.10.1:** the **Unknown** tab lists the phones under each unknown model, with suggestions (misread code, similar models), fix-the-code and pick-the-model-for-all. **Settings → Check catalog** opens the downloaded Samsung catalog in a big dialog (search, edit, delete, add, restore; kept across catalog updates). The review question floats above the Save bar. Credit line *by CJB*.

## 1.9.x — adaptive speed, Unknown, sharing
- **1.9.0:** adaptive scan speed with **Auto / Turbo / Balanced / Safe**, the phone is measured (cores, memory, heat, battery saver); scanning several photos at once; the first OCR pass is reused (no double reading); results are saved in batches. **Reset** button. **Unknown** tab. Bluetooth / nearby share.
- **1.9.3:** device model drop-down with catalog and **add a model**; sideways or upside-down photos are retried at 90°/270°/180°; the preview opens on the phone box.
- **1.9.4:** model chooser in a big dialog; **Check models** dialog in Settings.
- **1.9.5:** share photos **from other apps into IMEI Lens**; scanning starts automatically.

## 1.8.0 and 1.7.0
- Compact header on phones, launcher icon, Android 15 edge-to-edge handling, release build settings. Review preview opens zoomed on the label. Settings gained Scan speed and bulk model names.
