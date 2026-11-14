import { useEffect, useState } from 'react';
import { orderPhotos, parseReport, photoStatus, retakePhotos, summaryLine, type ReportSummary, type ScanReportData } from './scan-report';
import { issueText, type LabelIssueKind } from './label-issue';

type ReportBridge = { scanReport?: () => string; rescanNeeded?: (personId: string) => number };

/**
 * Under the background-scan progress line: what the scan found, in numbers that add up, and a list of every photo with its outcome.
 * Failed photos and photos with a product without an IMEI can be scanned again from here; nothing is deleted.
 */
export function ScanReport({ bridge, summary, status, personId, onMessage }: {
  bridge?: ReportBridge; summary?: ReportSummary; status: string; personId: string; onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ScanReportData | null>(null);
  const running = status === 'queued' || status === 'processing';
  const line = summary ? summaryLine(summary) : '';
  // The per-photo list is only fetched while it is open (it can be long); it refreshes as the scan advances.
  useEffect(() => {
    if (!open || !bridge?.scanReport) return;
    setData(parseReport(bridge.scanReport()));
  }, [open, bridge, summary?.photos, summary?.products, summary?.failed, status]);
  if (!bridge?.scanReport || !summary) return null;
  if (!line && !summary.needRescan) return null;
  const grouped = data ? orderPhotos(data) : { current: [], older: [] };
  const needRescan = summary.needRescan;
  const retake = data ? retakePhotos(data) : [];
  return (
    <div className="scan-report">
      {line && <p className="scan-report-line">{line}</p>}
      <div className="scan-report-actions">
        <button type="button" className="subtle-btn" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? 'Hide scan report' : 'Show scan report'}</button>
        {needRescan > 0 && !running && bridge.rescanNeeded && (
          <button type="button" className="subtle-btn" onClick={() => {
            const queued = bridge.rescanNeeded!(personId);
            onMessage(queued ? `Scanning ${queued} photo${queued === 1 ? '' : 's'} again (failed or without an IMEI). Existing records are kept.` : 'No photos need a new scan.');
          }}>Scan {needRescan} photo{needRescan === 1 ? '' : 's'} again</button>
        )}
      </div>
      {open && (
        <div className="scan-report-list">
          {!data && <p>Loading the report…</p>}
          {retake.length > 0 && (
            <div className="scan-report-retake" role="group" aria-label="Photos to retake">
              <p className="scan-report-sub">Retake {retake.length === 1 ? 'this photo' : `these ${retake.length} photos`}</p>
              {retake.map(photo => <p key={`retake-${photo.uri || photo.name}`}><strong>{photo.name}</strong>: {issueText(photo.retakeKind as LabelIssueKind, photo.retakeSide, photo.retakeMissing, photo.retakeDigits).text}</p>)}
              <button type="button" className="subtle-btn" onClick={() => { void navigator.clipboard?.writeText(retake.map(photo => photo.name).join('\n')).then(() => onMessage('Photo names copied.'), () => onMessage('Could not copy the names.')); }}>Copy the photo names</button>
              <small>Your original photos and the records made from them are kept; a new photo is added next to them.</small>
            </div>
          )}
          {data && grouped.current.length === 0 && <p>No photos in this scan yet.</p>}
          {grouped.current.map(photo => <ReportRow key={photo.uri || photo.name} photo={photo} />)}
          {grouped.older.length > 0 && <>
            <p className="scan-report-sub">Earlier photos that still need a new scan ({grouped.older.length})</p>
            {grouped.older.map(photo => <ReportRow key={`old-${photo.uri || photo.name}`} photo={photo} />)}
          </>}
        </div>
      )}
    </div>
  );
}

function ReportRow({ photo }: { photo: ReturnType<typeof orderPhotos>['current'][number] }) {
  const status = photoStatus(photo);
  return (
    <div className={`scan-report-row tone-${status.tone}`}>
      <strong>{photo.name}</strong>
      <span>{status.label}</span>
      {photo.duplicates.length > 0 && <small>Already in your records: {photo.duplicates.map(d => d.imei).join(', ')}</small>}
      {photo.emptyRepeats.length > 0 && <small>The earlier record of this photo is kept; no second empty copy was added.</small>}
      {photo.supersedes.length > 0 && <small>IMEIs were read this time. The earlier record(s) without an IMEI are kept.</small>}
      {photo.needsRescan && <small>Can be scanned again{photo.scans && photo.scans > 1 ? ` (scanned ${photo.scans} times)` : ''}.</small>}
    </div>
  );
}
