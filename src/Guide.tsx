import { useState } from 'react';
import { useBackLayer } from './back-layer';
import { APP_VERSION } from './version';

export const SEEN_KEY = 'imei-lens-seen-version-v1';
export const hasSeenWhatsNew = () => { try { return localStorage.getItem(SEEN_KEY) === APP_VERSION; } catch { return true; } };
export const markWhatsNewSeen = () => { try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch { /* ignore */ } };

/** A friendly green troll, drawn here (no outside picture needed). */
export function TrollImage({ size = 88 }: { size?: number }) {
  return <svg className="troll-image" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="A grinning troll">
    <path d="M60 6c-8 10-6 18-2 24-10-4-16-14-14-24 6 4 8 10 10 14-2-6 0-12 6-14z" fill="#3b7a3a" />
    <circle cx="60" cy="68" r="46" fill="#7ccf6a" stroke="#2f6b2e" strokeWidth="4" />
    <ellipse cx="17" cy="66" rx="9" ry="14" fill="#7ccf6a" stroke="#2f6b2e" strokeWidth="4" />
    <ellipse cx="103" cy="66" rx="9" ry="14" fill="#7ccf6a" stroke="#2f6b2e" strokeWidth="4" />
    <ellipse cx="42" cy="56" rx="12" ry="14" fill="#fff" stroke="#2f6b2e" strokeWidth="3" />
    <ellipse cx="78" cy="56" rx="12" ry="14" fill="#fff" stroke="#2f6b2e" strokeWidth="3" />
    <circle cx="45" cy="58" r="5" fill="#111" /><circle cx="75" cy="58" r="5" fill="#111" />
    <path d="M30 42l22 6M90 42l-22 6" stroke="#2f6b2e" strokeWidth="5" strokeLinecap="round" />
    <ellipse cx="60" cy="74" rx="11" ry="9" fill="#5fb44f" stroke="#2f6b2e" strokeWidth="3" />
    <path d="M26 86c10 20 58 20 68 0-14 8-54 8-68 0z" fill="#fff" stroke="#2f6b2e" strokeWidth="3" strokeLinejoin="round" />
    <path d="M40 90v8M52 92v9M64 92v9M76 90v8" stroke="#2f6b2e" strokeWidth="2.5" />
  </svg>;
}

/** The author line with the troll. */
export function AuthorCredit() {
  return <div className="author-credit"><TrollImage size={64} /><div><strong>Carlou Joseph Barnes</strong><small>IMEI Lens · made by Carlou Joseph Barnes</small></div></div>;
}

const NEW_ITEMS = [
  ['Barcodes in background scans', 'Choose photos and scan now reads the label barcodes and uses the exact IMEI from them, and levels tilted photos before separating the products.'],
  ['Confidence and learning', 'Each record shows how sure the app is (high, medium, low) in the review window. Correct a model code once and the app fixes the same misread next time.'],
  ['Several products in one photo', 'Choose how many products are in each photo (Scan tab). If fewer are found, the app reads the photo again in enlarged pieces. Tilted crops are straightened automatically, and the camera tells you right after a shot if barcodes are missing.'],
  ['Clean pictures', 'Pictures you send or save have no text written on them. They are resized, sharpened and a little clearer. The IMEI and serial go in the caption and in numbers.txt.'],
  ['One tap in One by one', 'Download image + copy IMEI & next saves the picture, copies IMEI 1 and goes to the next phone.'],
  ['Remove duplicates', 'Repeated IMEIs are found across all your scans. Use the Duplicates chip to see them and Remove duplicates to keep one copy of each (with Undo).'],
  ['Text size', 'Settings → Text size makes the whole app smaller or bigger.'],
  ['Choose the save folder once', 'One by one and Save to my phone ask for a folder only once and then save without asking.'],
  ['Built for 1000 photos', 'Scan up to 1000 photos in one batch, in the background, with a speed that adapts to your phone.'],
] as const;

type Topic = { title: string; steps: string[] };
export const TUTORIALS: Topic[] = [
  { title: 'Scan photos of labels', steps: ['Open the Scan tab.', 'Tap Choose photos (or drop them in) and pick the pictures of the phone boxes or labels. On Android you can pick up to 1000.', 'Tap Scan. A progress bar shows how many are done. You can keep using the phone; scanning continues in the background.', 'When it finishes, open the Records tab to see every phone with its IMEI, serial and model.'] },
  { title: 'Scan with the camera', steps: ['On the Scan tab tap Scan with camera and allow camera permission.', 'Keep the whole label in the frame, close enough to read. Use Zoom, Brightness and the flashlight if the light is poor.', 'Tap Capture. Tap Take another for more photos (up to 50), then Scan all.', 'If the live camera is blurry, tap Phone camera to use your phone camera app instead.'] },
  { title: 'Check and fix a record', steps: ['In Records, tap a phone to open the review.', 'Compare the picture with the IMEI, serial and model. Edit anything that is wrong; the app checks the IMEI digits for you.', 'If the picture is tilted, tap Straighten under the photo.', 'Tap Save, or Save & next to continue. Use Previous / Next to move between phones.', 'Records marked Needs review are the ones the app was not sure about. Use the Needs review chip to see only those.'] },
  { title: 'Several products in one photo (automatic)', steps: ['On the Scan tab, set Products in each photo (2, 3, 4…). Leave it on Auto if it varies.', 'Set Scan speed to Detailed for crowded photos.', 'If fewer products than you chose are found, the app reads the photo again in enlarged, overlapping pieces to find the rest.', 'Each product becomes its own record with its own crop. Tilted crops are straightened automatically.', 'After scanning, the message tells you how many photos had fewer products than expected. Open those and use Adjust crop or Straighten.', 'In the camera, a Check line appears after each shot: how many IMEI barcodes were readable. Retake if it is lower than expected.', 'Best photos: even light, no glare, a visible gap between boxes, phone held parallel to the boxes. For 5 or more, take two photos.'] },
  { title: 'Several phones in one photo (crop)', steps: ['Open the record and tap Adjust crop, then Start cropping. (Or tap Auto-detect: the app counts the labels and draws the boxes for you.)', 'Drag around one label and tap Add box. Repeat for every label. There is no count to enter: the number of boxes is the number of products.', 'Under the photo each box is listed (Box 1, Box 2…). Tap ✎ to move or resize a box (drag inside it to move, drag a corner to resize), or ✕ to delete it.', 'Tap Process: every box is read at once. Check each IMEI and model, then Save.', 'Each product becomes its own record with its own picture. The original photo is removed from the app (your gallery is never touched).', 'To stop half way, close the window and choose Save for later. Your boxes come back when you open the record or tap Continue in the banner above the records.'] },
  { title: 'Give phones to people (Give tab)', steps: ['Open the Give tab and add a person (a name).', 'Select phones in Records, then choose the person to move them to.', 'Tap a person to see only their phones, share them, or export them. Everyone shows all phones.', 'Deleting a person lets you choose what happens to their phones. Undo is offered for a few seconds.'] },
  { title: 'Unknown models', steps: ['Open the Unknown tab to see phones whose model has no name.', 'Under each unknown code you get suggestions (a similar code) and the phones using it.', 'Fix the code, or pick the model for all of them at once.', 'In Settings → My Samsung models you can add your own names, or import a list.'] },
  { title: 'Send pictures: WhatsApp and Bluetooth', steps: ['Open the Share tab and choose a person (or everyone).', 'Tap Send all pictures by WhatsApp. All pictures go in one send with one caption listing every IMEI and serial in order.', 'WhatsApp takes about 30 at a time. After sending, say how many arrived; the app remembers and continues from there.', 'If WhatsApp is missing or fails, use Send by Bluetooth. It also sends a numbers.txt.'] },
  { title: 'One by one', steps: ['Share tab → One by one for a person.', 'You see a big picture with the IMEI and serial.', 'Tap Download image + copy IMEI & next. It saves the picture, copies IMEI 1 and moves on. Paste the IMEI where you need it.', 'Copy S/N copies the serial. Back and Skip move around. Download all remaining saves the rest to a folder.', 'The first time, Android asks you to pick a folder. After that it saves without asking.'] },
  { title: 'Save to my phone and export', steps: ['Share tab → Save to my phone makes a folder with numbered pictures and a numbers.txt listing every phone.', 'Saving again replaces the earlier files in the same folder.', 'Export tab: download Excel, CSV or a photo gallery. Use the search and filters to choose what goes in.', 'Large exports with many pictures show a warning first.'] },
  { title: 'Find and remove duplicates', steps: ['If any IMEI appears more than once, a Duplicates chip appears in Records.', 'Tap it to see only the repeated ones.', 'Tap Remove duplicates and confirm. One copy of each IMEI stays (the most complete one).', 'Tap Undo in the bar that appears if you change your mind.'] },
  { title: 'Settings and text size', steps: ['Open Settings from the top bar.', 'Text size makes the whole app smaller or bigger.', 'Phone scanning power lets you choose Auto, Turbo, Balanced or Safe speed (Android).', 'Where files are saved shows the folder; Change folder or Forget this folder.', 'Check catalog lets you search, edit and restore the Samsung model list.'] },
  { title: 'Reset and privacy', steps: ['Reset (trash button in the top bar) deletes every record and photo after you confirm. Export first if you need them.', 'Everything stays on your phone. IMEI numbers are sensitive: do not share exports or photos publicly.', 'Uninstalling the app removes its records, so export before you reinstall.'] },
];

function Overlay({ title, onClose, id, children }: { title: string; onClose: () => void; id: string; children: React.ReactNode }) {
  useBackLayer(true, onClose, id);
  return <div className="modal-backdrop guide-backdrop"><section className="modal guide-modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-head"><h2>{title}</h2><button className="subtle-btn" onClick={onClose}>Close</button></div>
    {children}
  </section></div>;
}

export function WhatsNewDialog({ onClose, onTutorials, first = false }: { onClose: () => void; onTutorials?: () => void; first?: boolean }) {
  return <Overlay title={first ? 'Welcome to IMEI Lens' : 'What’s new'} onClose={onClose} id="whats-new">
    <p className="settings-help">Version {APP_VERSION}. Scan labels, check the IMEIs, and send or save the pictures with their numbers.</p>
    <ul className="guide-list">{NEW_ITEMS.map(([name, text]) => <li key={name}><b>{name}</b><span>{text}</span></li>)}</ul>
    <AuthorCredit />
    <div className="settings-actions">
      {onTutorials && <button className="subtle-btn" onClick={onTutorials}>How to use everything</button>}
      <button className="primary" onClick={onClose}>Got it</button>
    </div>
  </Overlay>;
}

export function TutorialsDialog({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(0);
  return <Overlay title="Tutorials" onClose={onClose} id="tutorials">
    <p className="settings-help">Tap a topic to see the steps.</p>
    <div className="guide-topics">{TUTORIALS.map((topic, index) => <div key={topic.title} className={`guide-topic${open === index ? ' open' : ''}`}>
      <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}>{index + 1}. {topic.title}</button>
      {open === index && <ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>}
    </div>)}</div>
  </Overlay>;
}
