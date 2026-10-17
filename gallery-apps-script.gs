/**
 * Sikkim Tour Photo Gallery — Google Apps Script backend.
 *
 * Photos are saved as image files in the Google Drive folder below.
 * Each file's description holds its caption, uploader, likes and date as JSON.
 *
 * Setup: script.google.com → New project → paste this file →
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone →
 * copy the Web app URL into GALLERY_API_URL in index.html.
 */
const FOLDER_ID = '1UIJHap4MtmpyN4ynVB84GftdsqUMnVwv'; // "Sikkim Tour Photos" folder
const MAX_BYTES = 4 * 1024 * 1024;

function doGet() {
  return json({ ok: true, photos: listPhotos() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'upload') {
      uploadPhoto(req);
    } else if (req.action === 'like') {
      likePhoto(req.id);
    } else {
      throw new Error('Unknown action');
    }
    return json({ ok: true, photos: listPhotos() });
  } catch (err) {
    return json({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function uploadPhoto(req) {
  let blob;
  const m = String(req.dataUrl || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (m) {
    blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1]);
  } else if (/^https?:\/\//.test(req.imageUrl || '')) {
    // Copy the linked image into Drive so it keeps working even if the link dies
    blob = UrlFetchApp.fetch(req.imageUrl, { followRedirects: true }).getBlob();
    if (!/^image\//.test(blob.getContentType())) throw new Error('That URL is not an image');
  } else {
    throw new Error('No image received');
  }
  if (blob.getBytes().length > MAX_BYTES) throw new Error('Image is too large (max 4 MB)');

  blob.setName('photo-' + Date.now());
  const file = getFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  file.setDescription(JSON.stringify({
    uploader: clean(req.uploader),
    caption: clean(req.caption),
    likes: 0,
    date: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy')
  }));
}

function likePhoto(id) {
  const files = getFolder().getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getId() === id) {
      const meta = readMeta(file);
      meta.likes = (meta.likes || 0) + 1;
      file.setDescription(JSON.stringify(meta));
      return;
    }
  }
  throw new Error('Photo not found');
}

function listPhotos() {
  const photos = [];
  const files = getFolder().getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!/^image\//.test(file.getMimeType()) || file.isTrashed()) continue;
    const meta = readMeta(file);
    photos.push({
      id: file.getId(),
      url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600',
      uploader: meta.uploader || 'Unknown',
      caption: meta.caption || file.getName(),
      likes: meta.likes || 0,
      date: meta.date || Utilities.formatDate(file.getDateCreated(), 'Asia/Kolkata', 'd MMM yyyy'),
      created: file.getDateCreated().getTime()
    });
  }
  photos.sort((a, b) => b.created - a.created);
  return photos;
}

function readMeta(file) {
  try {
    return JSON.parse(file.getDescription() || '{}');
  } catch (e) {
    return {};
  }
}

function getFolder() {
  return DriveApp.getFolderById(FOLDER_ID);
}

function clean(s) {
  return String(s || '').trim().slice(0, 120);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
