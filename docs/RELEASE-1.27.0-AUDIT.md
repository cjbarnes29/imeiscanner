# RetailLens 1.27.0 — release audit

Date:2026-11-18. Application source: [11432a7](https://github.com/cjbarnes29/imeiscanner/commit/11432a7c7fbab1e7bd9c01bdb47a744acfbc316f), branch `ux/photo-editor`. Later documentation/verification-tool changes do not change the APK source. [GitHub prerelease and downloads](https://github.com/cjbarnes29/imeiscanner/releases/tag/retaillens-test-11432a7).

## Delivered behavior

Reviewed daily release planning, Auto/Manual future quantities, true unsold phone stock, partial IMEI reporting, target caps/store splitting and editable availability redistribution are connected to Home and Give & share. Shift-file proposals, saved code/time calendars and original-file viewing are separate from scheduled IMEI releases and daily uploads. Final phone messages can be edited in Report. Tablets/accessories OSR has a separate approved stock register; importing the same balances twice never doubles stock. Approval-based report/message preparation still requires the user's final Send tap in WhatsApp. Local diagnostics and saved-job recovery never send telemetry or confirm sales.

## Checks observed

| Check | Result |
| --- | --- |
| Full npm test | Passed, including43 new planning/calendar/report/stock groups and diagnostics privacy/restart checks |
| TypeScript / production web build | Passed |
| Original retail browser suite |51 checks passed |
| Photo editor / crop recovery browser suite |23 checks passed; typed fields, retry once, archive/undo, saved draft resume, people tools and popup deferral |
| Simple mode |5 checks passed |
| Release planner browser flow | Reservation, daily confirmation, partial report, true stock, horizons/manual quantities, persistence and tutorial isolation passed |
| Workforce browser flow | Store120→40/40/40→32/44/44, calendar, unavailable cancel/override+History,12 exports and reload passed |
| Schedules/accessories/recovery browser flow | CSV Blob/proposal/approval/ID edit/overnight codes/source viewer/week+month sharing/separate calendars, snapshot stock, mismatch warning, mocked group share/Home/reload/recovery passed |
| Storage failure browser audit |4 groups passed: round trip/rollback, read/write failures, damaged data |
| Layout |360px at130% text size, all tested summary/detail screens and Settings passed |
| Android JVM suite |178 tests,0 failures/errors; native compilation passed |
| Privacy | Local0 new private-data hits; staged CI0 unlisted valid IMEIs |
| APK web assets | All46 dist files matched both APKs byte-for-byte (gzip packaging accounted for); embedded source stamp11432a7 |
| In-place emulator update | `adb install -r` succeeded for isolated `.phonetest`, retaining1 synthetic record including photo/IMEI/model plus saved retail audit sentinel. New recovery bridge and native startup health passed |

## APK identity and update compatibility

Both debug-signed builds keep the existing signing configuration and certificate SHA256 `f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27`, matching the previous local test APK. Android versionCode increases42→43.

| Asset | Package | Bytes | SHA256 |
| --- | --- | --- | --- |
| RetailLens-Test-1.27.0-11432a7.apk |com.imeilens.scanner.phonetest |50268404 |94bafd7444923b20e2d7bac69439c8989bdca502296f2860e01c8edb1af17bee |
| RetailLens-1.27.0-11432a7.apk |com.imeilens.scanner |50268388 |2e0551a00f40a05a55962f3ac12fb29c8d3c797a0bb3c89e04be8d7ea23afa52 |

Choose the APK matching the installed app, then install as an update. Do not uninstall or clear app data. A build signed with a different certificate cannot update that installation. Only the isolated emulator test package was installed during validation; the real app and its data were not touched.

The release also includes SHA256SUMS.txt, a self-contained HTML gallery and ZIP with18 actual app screenshots using demo data. Original user attachments and reports are excluded from public artifacts.

All5 public asset URLs were downloaded successfully with HTTP200 and expected byte counts. Both downloaded APK SHA256 hashes matched the table above.

## Remaining limitations for continuation

- Physical-phone memory/heat/force-stop recovery and real WhatsApp delivery were not tested. Android must be reopened after a force stop. A few photos since the last saved disk checkpoint may be scanned again; duplicate checks apply. Lost source-file access may require reselecting originals. Unsaved browser file selections cannot survive termination.
- Native recovery availability was exercised through the new bridge and pure resume guards; the restart UI was also tested with a browser bridge stand-in. This is not a real-device interrupted-batch endurance test.
- CSV roster import received end-to-end coverage. XLSX and image/OCR share the reviewed parser flow but have not received equivalent device/file-layout coverage. Unknown or ambiguous data must remain editable and blocked from approval until resolved.
- Local AI downloaded and ran in a browser smoke test but returned invalid structured output, which was rejected. It is optional/experimental and never executes sales. Phone compatibility is unverified.
- npm audit remains6 dependency paths:2 moderate via ExcelJS/uuid and4 high paths for picomatch ReDoS through Vite/fdir/tinyglobby. These are documented rather than hidden with unsafe dependency downgrades. Vite was upgraded6.4.6. Large-bundle/Gradle deprecation warnings remain.
- Retail backups preserve state/record references, not original photo or roster Blobs. Save originals separately. Diagnostics contain technical summaries, not inventory backups. Accessory quantities are report-derived balances, not serial-number stock verification.

Use [the continuation handoff](HANDOFF-RELEASE-PLANNING.md) for exact user decisions, module ownership and test/build commands.
