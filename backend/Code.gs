/**
 * PackMate backend — Google Apps Script web app.
 *
 * Everything private lives in YOUR Google Drive, never in the public website code:
 *   - "PackMate Data" spreadsheet: Members (roster + access codes), Checklists,
 *     Announcements, Expenses, ExpenseLog, Reflections.
 *   - "Sikkim Tour Photos" folder: shared photos/PDFs.
 *   - "PackMate Receipts" folder (created automatically, never shared): expense receipts.
 *
 * Access control is enforced HERE, on Google's servers:
 *   - Each traveller has a personal access code (Members sheet, column accessCode).
 *   - Students can read only their own ticket/berth record.
 *   - Faculty (role = faculty) can read the full roster and create/edit announcements and expenses.
 *
 * Deploy: Deploy → Manage deployments → Edit → Version: New version → Deploy
 * (Execute as: Me, Who has access: Anyone). The URL stays the same.
 */
const SHEET_ID = '1_UL1YypD6KjUCeSUeKzmQzusts6BFft0HQgFL1xRgm4'; // "PackMate Data (PRIVATE)" spreadsheet
const PHOTO_FOLDER_ID = '1UIJHap4MtmpyN4ynVB84GftdsqUMnVwv';
const TZ = 'Asia/Kolkata';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const MAX_UPLOADS_PER_DAY = 80;
const MAX_FAILED_LOGINS = 40; // across everyone, per 10 minutes
const ANN_CATEGORIES = ['Reporting time', 'Railway', 'Packing', 'Itinerary', 'Transport', 'Emergency', 'General'];
const ANN_PRIORITIES = ['normal', 'important', 'urgent'];
const EXP_CATEGORIES = ['Transport', 'Accommodation', 'Food', 'Entry tickets', 'Medical', 'Miscellaneous'];
const PHOTO_TAGS = ['Bandel / Train', 'NJP', 'Ravangla', 'Namchi', 'Pelling', 'Falakata / Return', 'Group photo', 'Other'];

const TABLES = {
  Members: ['sl', 'name', 'role', 'sem', 'ageSex', 'mobile', 'onPnr', 'onSeat', 'retPnr', 'retSeat', 'note', 'accessCode', 'active'],
  Checklists: ['sl', 'data', 'updatedAt'],
  Announcements: ['id', 'title', 'message', 'category', 'priority', 'publishedAt', 'updatedAt', 'expiresAt', 'author'],
  Expenses: ['id', 'kind', 'description', 'category', 'amount', 'date', 'recordedBy', 'receiptId', 'createdAt', 'updatedAt'],
  ExpenseLog: ['at', 'by', 'action', 'id', 'before', 'after'],
  Reflections: ['id', 'sl', 'name', 'role', 'text', 'shared', 'updatedAt']
};

// ---------------------------------------------------------------- entry points

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'public';
    if (action !== 'public') throw new Error('Unknown action');
    return json({ ok: true, announcements: activeAnnouncements() });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Bad request' });
  }
  const handler = ACTIONS[req.action];
  if (!handler) return json({ ok: false, error: 'Unknown action' });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json({ ok: false, error: 'Server is busy, please try again' });
  }
  try {
    const me = authenticate(req.code);
    if (handler.faculty && me.role !== 'faculty') throw new Error('Only faculty can do this');
    return json(Object.assign({ ok: true }, handler.run(req, me)));
  } catch (err) {
    return json({ ok: false, error: err.message, authFailed: err.authFailed === true });
  } finally {
    lock.releaseLock();
  }
}

const ACTIONS = {
  'login': { run: (req, me) => ({ me: publicMember(me, true) }) },
  'roster': { faculty: true, run: () => ({ members: members().filter(m => m.active).map(m => publicMember(m, true)) }) },

  'checklist.get': { run: (req, me) => getChecklist(me) },
  'checklist.save': { run: (req, me) => saveChecklist(me, req) },

  'ann.list': { faculty: true, run: () => ({ announcements: table('Announcements').map(formatAnnouncement) }) },
  'ann.save': { faculty: true, run: (req, me) => saveAnnouncement(req, me) },
  'ann.delete': { faculty: true, run: (req) => { deleteRow('Announcements', req.id); return {}; } },

  'photos.list': { run: (req, me) => ({ photos: listPhotos(me), tags: PHOTO_TAGS }) },
  'photos.upload': { run: (req, me) => { uploadPhoto(req, me); return { photos: listPhotos(me) }; } },
  'photos.like': { run: (req, me) => { likePhoto(req.id, me); return { photos: listPhotos(me) }; } },
  'photos.update': { run: (req, me) => { updatePhoto(req, me); return { photos: listPhotos(me) }; } },
  'photos.delete': { run: (req, me) => { deletePhoto(req.id, me); return { photos: listPhotos(me) }; } },

  'exp.list': { run: (req, me) => listExpenses(me) },
  'exp.save': { faculty: true, run: (req, me) => { saveExpense(req, me); return listExpenses(me); } },
  'exp.delete': { faculty: true, run: (req, me) => { deleteExpense(req.id, me); return listExpenses(me); } },
  'exp.receipt': { run: (req) => ({ dataUrl: receiptDataUrl(req.id) }) },
  'exp.log': { faculty: true, run: () => ({ log: table('ExpenseLog').reverse() }) },

  'refl.list': { run: (req, me) => ({ reflections: listReflections(me) }) },
  'refl.save': { run: (req, me) => { saveReflection(req, me); return { reflections: listReflections(me) }; } },
  'refl.delete': { run: (req, me) => { deleteReflection(req.id, me); return { reflections: listReflections(me) }; } }
};

// ---------------------------------------------------------------- authentication

function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function members() {
  return table('Members').map(m => Object.assign(m, {
    sl: Number(m.sl),
    role: String(m.role).toLowerCase().indexOf('faculty') >= 0 ? 'faculty' : 'student',
    active: String(m.active).toLowerCase() !== 'no' && String(m.active).toLowerCase() !== 'false'
  }));
}

function authenticate(code) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('failedLogins') || 0);
  if (fails >= MAX_FAILED_LOGINS) throw authError('Too many wrong codes. Please wait 10 minutes and try again.');
  const wanted = normaliseCode(code);
  const me = wanted.length >= 6 && members().find(m => m.active && normaliseCode(m.accessCode) === wanted);
  if (!me) {
    cache.put('failedLogins', String(fails + 1), 600);
    throw authError('Access code not recognised. Please check it with your faculty coordinator.');
  }
  return me;
}

function authError(message) {
  const err = new Error(message);
  err.authFailed = true;
  return err;
}

// Never returns the access code
function publicMember(m, withTicket) {
  const out = { sl: m.sl, name: m.name, role: m.role, sem: m.sem };
  if (withTicket) {
    ['ageSex', 'mobile', 'onPnr', 'onSeat', 'retPnr', 'retSeat', 'note'].forEach(k => { out[k] = String(m[k] || ''); });
  }
  return out;
}

// ---------------------------------------------------------------- checklists

function getChecklist(me) {
  const row = table('Checklists').find(r => Number(r.sl) === me.sl);
  return row ? { data: JSON.parse(row.data || 'null'), updatedAt: Number(row.updatedAt) || 0 } : { data: null, updatedAt: 0 };
}

function saveChecklist(me, req) {
  const data = JSON.stringify(req.data || null);
  if (data.length > 40000) throw new Error('Checklist is too large');
  const updatedAt = Number(req.updatedAt) || Date.now();
  upsertRow('Checklists', 'sl', { sl: me.sl, data: data, updatedAt: updatedAt });
  return { updatedAt: updatedAt };
}

// ---------------------------------------------------------------- announcements

function formatAnnouncement(a) {
  return {
    id: String(a.id), title: String(a.title), message: String(a.message), category: String(a.category),
    priority: String(a.priority), publishedAt: Number(a.publishedAt) || 0, updatedAt: Number(a.updatedAt) || 0,
    expiresAt: Number(a.expiresAt) || 0, author: String(a.author)
  };
}

function activeAnnouncements() {
  const now = Date.now();
  return table('Announcements').map(formatAnnouncement).filter(a => !a.expiresAt || a.expiresAt > now);
}

function saveAnnouncement(req, me) {
  const title = clean(req.title, 120);
  const message = clean(req.message, 2000);
  if (!title || !message) throw new Error('Title and message are required');
  const now = Date.now();
  const existing = req.id ? table('Announcements').find(a => String(a.id) === String(req.id)) : null;
  if (req.id && !existing) throw new Error('Announcement not found');
  upsertRow('Announcements', 'id', {
    id: existing ? existing.id : Utilities.getUuid(),
    title: title,
    message: message,
    category: ANN_CATEGORIES.indexOf(req.category) >= 0 ? req.category : 'General',
    priority: ANN_PRIORITIES.indexOf(req.priority) >= 0 ? req.priority : 'normal',
    publishedAt: existing ? Number(existing.publishedAt) : now,
    updatedAt: now,
    expiresAt: Number(req.expiresAt) > 0 ? Number(req.expiresAt) : '',
    author: me.name
  });
  return { announcements: table('Announcements').map(formatAnnouncement) };
}

// ---------------------------------------------------------------- photos

function photoFolder() {
  return DriveApp.getFolderById(PHOTO_FOLDER_ID);
}

// Checks the first bytes of the file so a renamed .exe can't pretend to be a photo
function sniffType(bytes) {
  const b = i => bytes[i] & 0xff;
  const ascii = (from, to) => String.fromCharCode.apply(null, bytes.slice(from, to).map(x => x & 0xff));
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(ascii(8, 12))) return 'image/heic';
  return '';
}

function decodeUpload(req, maxBytes) {
  let bytes;
  const m = String(req.dataUrl || '').match(/^data:[\w+.\/-]*;base64,(.+)$/);
  if (m) {
    bytes = Utilities.base64Decode(m[1]);
  } else if (/^https:\/\//.test(req.imageUrl || '')) {
    const res = UrlFetchApp.fetch(req.imageUrl, { followRedirects: true, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Could not download that image URL');
    bytes = res.getBlob().getBytes();
  } else {
    throw new Error('No file received');
  }
  if (bytes.length > maxBytes) throw new Error('File is too large (max ' + Math.round(maxBytes / 1048576) + ' MB)');
  const type = sniffType(bytes);
  if (!type) throw new Error('Only JPG, PNG, WebP, GIF, HEIC photos and PDFs are allowed');
  return { bytes: bytes, type: type };
}

function readMeta(file) {
  let meta = {};
  try {
    meta = JSON.parse(file.getDescription() || '{}');
  } catch (e) {}
  if (!Array.isArray(meta.likedBy)) meta.likedBy = [];
  // Photos from the first gallery version stored likes as a plain number
  if (typeof meta.likes === 'number') {
    meta.legacyLikes = meta.likes;
    delete meta.likes;
  }
  return meta;
}

function writeMeta(file, meta) {
  file.setDescription(JSON.stringify(meta));
}

function listPhotos(me) {
  const photos = [];
  const files = photoFolder().getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const mime = file.getMimeType();
    if (!/^(image\/|application\/pdf$)/.test(mime) || file.isTrashed()) continue;
    const meta = readMeta(file);
    const created = file.getDateCreated();
    photos.push({
      id: file.getId(),
      type: mime === 'application/pdf' ? 'pdf' : 'image',
      url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600',
      uploader: String(meta.uploader || 'Unknown'),
      caption: String(meta.caption || ''),
      tag: String(meta.tag || ''),
      date: String(meta.dateISO || Utilities.formatDate(created, TZ, 'yyyy-MM-dd')),
      likes: meta.likedBy.length + (Number(meta.legacyLikes) || 0),
      likedByMe: meta.likedBy.indexOf(me.sl) >= 0,
      memoryBook: meta.memoryBook === true,
      canEdit: canEditPhoto(meta, me),
      mine: Number(meta.uploaderSl) === me.sl,
      created: created.getTime()
    });
  }
  photos.sort((a, b) => b.created - a.created);
  return photos;
}

function findPhoto(id) {
  const files = photoFolder().getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getId() === String(id) && !file.isTrashed()) return file;
  }
  throw new Error('Photo not found');
}

function canEditPhoto(meta, me) {
  return me.role === 'faculty' || Number(meta.uploaderSl) === me.sl;
}

function uploadPhoto(req, me) {
  const props = PropertiesService.getScriptProperties();
  const counterKey = 'uploads_' + me.sl + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  const count = Number(props.getProperty(counterKey) || 0);
  if (count >= MAX_UPLOADS_PER_DAY) throw new Error('Daily upload limit reached (' + MAX_UPLOADS_PER_DAY + ' files). Try again tomorrow.');

  const upload = decodeUpload(req, MAX_UPLOAD_BYTES);
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' }[upload.type];
  const baseName = clean(req.fileName, 80).replace(/\.[^.]*$/, '').replace(/[\\\/:*?"<>|]/g, '_') || 'photo';
  const blob = Utilities.newBlob(upload.bytes, upload.type, Date.now() + '-' + baseName + ext);
  const file = photoFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  writeMeta(file, {
    v: 2,
    uploader: me.name,
    uploaderSl: me.sl,
    caption: clean(req.caption, 140),
    tag: PHOTO_TAGS.indexOf(req.tag) >= 0 ? req.tag : '',
    dateISO: /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    memoryBook: req.memoryBook === true,
    likedBy: []
  });
  props.setProperty(counterKey, String(count + 1));
}

function likePhoto(id, me) {
  const file = findPhoto(id);
  const meta = readMeta(file);
  const i = meta.likedBy.indexOf(me.sl);
  if (i >= 0) meta.likedBy.splice(i, 1); else meta.likedBy.push(me.sl);
  writeMeta(file, meta);
}

function updatePhoto(req, me) {
  const file = findPhoto(req.id);
  const meta = readMeta(file);
  if (!canEditPhoto(meta, me)) throw new Error('You can only edit your own photos');
  if (req.caption !== undefined) meta.caption = clean(req.caption, 140);
  if (req.tag !== undefined) meta.tag = PHOTO_TAGS.indexOf(req.tag) >= 0 ? req.tag : '';
  if (req.memoryBook !== undefined) meta.memoryBook = req.memoryBook === true;
  writeMeta(file, meta);
}

function deletePhoto(id, me) {
  const file = findPhoto(id);
  if (!canEditPhoto(readMeta(file), me)) throw new Error('You can only delete your own photos');
  file.setTrashed(true); // stays in Drive's bin for 30 days
}

// ---------------------------------------------------------------- expenses

function receiptFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RECEIPT_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder('PackMate Receipts (private)');
  props.setProperty('RECEIPT_FOLDER_ID', folder.getId());
  return folder;
}

function formatExpense(x) {
  return {
    id: String(x.id), kind: String(x.kind), description: String(x.description), category: String(x.category),
    amount: Number(x.amount) || 0, date: String(x.date), recordedBy: String(x.recordedBy),
    hasReceipt: !!x.receiptId, createdAt: Number(x.createdAt) || 0, updatedAt: Number(x.updatedAt) || 0
  };
}

function listExpenses() {
  return { entries: table('Expenses').map(formatExpense), categories: EXP_CATEGORIES };
}

function saveExpense(req, me) {
  const amount = Math.round(Number(req.amount) * 100) / 100;
  if (!(amount > 0 && amount < 10000000)) throw new Error('Enter a valid amount in rupees');
  const description = clean(req.description, 200);
  if (!description) throw new Error('Description is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date || '')) throw new Error('Enter a valid date');
  const kind = req.kind === 'collection' ? 'collection' : 'expense';
  const existing = req.id ? table('Expenses').find(x => String(x.id) === String(req.id)) : null;
  if (req.id && !existing) throw new Error('Entry not found');

  let receiptId = existing ? String(existing.receiptId || '') : '';
  if (req.receiptDataUrl) {
    const upload = decodeUpload({ dataUrl: req.receiptDataUrl }, MAX_RECEIPT_BYTES);
    receiptId = receiptFolder().createFile(Utilities.newBlob(upload.bytes, upload.type, 'receipt-' + Date.now())).getId();
  }
  const now = Date.now();
  const row = {
    id: existing ? existing.id : Utilities.getUuid(),
    kind: kind,
    description: description,
    category: kind === 'collection' ? 'Collection' : (EXP_CATEGORIES.indexOf(req.category) >= 0 ? req.category : 'Miscellaneous'),
    amount: amount,
    date: req.date,
    recordedBy: existing ? existing.recordedBy : me.name,
    receiptId: receiptId,
    createdAt: existing ? Number(existing.createdAt) : now,
    updatedAt: now
  };
  upsertRow('Expenses', 'id', row);
  logExpense(me, existing ? 'edit' : 'add', row.id, existing, row);
}

function deleteExpense(id, me) {
  const existing = table('Expenses').find(x => String(x.id) === String(id));
  if (!existing) throw new Error('Entry not found');
  deleteRow('Expenses', id);
  logExpense(me, 'delete', id, existing, null);
}

function logExpense(me, action, id, before, after) {
  appendRow('ExpenseLog', {
    at: Date.now(), by: me.name, action: action, id: id,
    before: before ? JSON.stringify(formatExpense(before)) : '',
    after: after ? JSON.stringify(formatExpense(after)) : ''
  });
}

function receiptDataUrl(id) {
  const entry = table('Expenses').find(x => String(x.id) === String(id));
  if (!entry || !entry.receiptId) throw new Error('No receipt for this entry');
  const blob = DriveApp.getFileById(String(entry.receiptId)).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

// ---------------------------------------------------------------- memory book reflections

function listReflections(me) {
  return table('Reflections')
    .filter(r => me.role === 'faculty' || Number(r.sl) === me.sl || r.shared === true || String(r.shared) === 'TRUE')
    .map(r => ({
      id: String(r.id), sl: Number(r.sl), name: String(r.name), role: String(r.role), text: String(r.text),
      shared: r.shared === true || String(r.shared) === 'TRUE', updatedAt: Number(r.updatedAt) || 0,
      mine: Number(r.sl) === me.sl
    }));
}

function saveReflection(req, me) {
  const text = clean(req.text, 1000);
  if (!text) throw new Error('Please write something first');
  const existing = table('Reflections').find(r => Number(r.sl) === me.sl);
  upsertRow('Reflections', 'id', {
    id: existing ? existing.id : Utilities.getUuid(),
    sl: me.sl, name: me.name, role: me.role, text: text, shared: req.shared === true, updatedAt: Date.now()
  });
}

function deleteReflection(id, me) {
  const existing = table('Reflections').find(r => String(r.id) === String(id));
  if (!existing) throw new Error('Not found');
  if (me.role !== 'faculty' && Number(existing.sl) !== me.sl) throw new Error('You can only delete your own reflection');
  deleteRow('Reflections', id);
}

// ---------------------------------------------------------------- spreadsheet helpers

function sheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  // An imported roster CSV lands in the first tab under another name: adopt it as "Members"
  if (!sh && name === 'Members') {
    const first = ss.getSheets()[0];
    if (first && String(first.getRange(1, 1, 1, 1).getValues()[0][0]) === 'sl') {
      first.setName('Members');
      sh = first;
    }
  }
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function table(name) {
  const values = sheet(name).getDataRange().getValues();
  const headers = values.shift().map(String);
  return values.filter(r => r.some(v => v !== '')).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i]; });
    return obj;
  });
}

// A leading apostrophe stores text as text: stops formula injection (=IMPORTXML…) and date auto-conversion
function cell(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v === undefined || v === null ? '' : v);
  return s === '' ? '' : "'" + s;
}

function rowValues(name, obj) {
  const headers = sheet(name).getRange(1, 1, 1, sheet(name).getLastColumn()).getValues()[0].map(String);
  return headers.map(h => cell(obj[h]));
}

function appendRow(name, obj) {
  sheet(name).appendRow(rowValues(name, obj));
}

function upsertRow(name, key, obj) {
  const sh = sheet(name);
  const values = sh.getDataRange().getValues();
  const col = values[0].map(String).indexOf(key);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][col]) === String(obj[key])) {
      sh.getRange(r + 1, 1, 1, values[0].length).setValues([rowValues(name, obj)]);
      return;
    }
  }
  appendRow(name, obj);
}

function deleteRow(name, id) {
  const sh = sheet(name);
  const values = sh.getDataRange().getValues();
  const col = values[0].map(String).indexOf('id');
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][col]) === String(id)) {
      sh.deleteRow(r + 1);
      return;
    }
  }
  throw new Error('Not found');
}

// ---------------------------------------------------------------- utilities

function clean(s, max) {
  return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor (select "setup" → Run) to create the sheet tabs and check access. */
function setup() {
  Object.keys(TABLES).forEach(sheet);
  photoFolder();
  receiptFolder();
  Logger.log('Members found: ' + members().length);
}
