/* PackMate — Srikrishna College CS Department, Sikkim Tour 2026 */
'use strict';

// Google Apps Script web app (see backend/Code.gs). Not a secret: every private
// action is checked on the server against the traveller's personal access code.
const API_URL = 'https://script.google.com/macros/s/AKfycbwBhOheb84TTzpqXLIzj4BMx0N7JWB20W4cZO3scK_BLcTQsAG2ksWcZkJRPPMpOxeQ/exec';
const TZ = 'Asia/Kolkata';
const LEGACY_CHECKLIST_KEY = 'packmate_sikkim_cs_tour_2026_v10';

// Confirmed timings from the tour plan (IST)
const EVENTS = [
  { at: '2026-11-17T18:58:00+05:30', title: '27575 Vande Bharat SL departs Bandel Jn', short: 'Departure from Bandel Jn' },
  { at: '2026-11-18T01:40:00+05:30', title: 'Arrival at New Jalpaiguri Jn (NJP)', short: 'Arrive NJP' },
  { at: '2026-11-21T12:55:00+05:30', title: '13142 Teesta Torsha Express departs Falakata', short: 'Return train from Falakata' },
  { at: '2026-11-22T03:35:00+05:30', title: 'Arrival at Sealdah', short: 'Arrive Sealdah' }
];
const TOUR_START = Date.parse(EVENTS[0].at);
const TOUR_END = Date.parse(EVENTS[EVENTS.length - 1].at);

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// localStorage can throw (private mode, in-app browsers, blocked cookies) — fall back to memory
const store = (() => {
  const memory = {};
  let available = true;
  try {
    const k = '__packmate_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
  } catch (e) {
    available = false;
  }
  return {
    available,
    get(key) {
      try { return available ? localStorage.getItem(key) : (memory[key] ?? null); } catch (e) { return memory[key] ?? null; }
    },
    set(key, value) {
      memory[key] = value;
      try { if (available) localStorage.setItem(key, value); } catch (e) { /* quota or blocked: memory copy still works */ }
    },
    remove(key) {
      delete memory[key];
      try { if (available) localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
    getJSON(key) {
      try { return JSON.parse(this.get(key) || 'null'); } catch (e) { return null; }
    },
    setJSON(key, value) { this.set(key, JSON.stringify(value)); }
  };
})();

function fmtDateTime(ms) {
  return new Date(ms).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDate(isoDate) {
  return new Date(isoDate + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // yyyy-mm-dd
}

function rupees(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

let toastTimer;
function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-96 z-[70] rounded-xl px-4 py-3 text-sm font-medium shadow-xl ' +
    (kind === 'error' ? 'bg-rose-700 text-white' : 'bg-forest text-ivory');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), kind === 'error' ? 7000 : 3500);
}

// ------------------------------------------------------------------ API

class ApiError extends Error {
  constructor(message, authFailed) {
    super(message);
    this.authFailed = authFailed;
  }
}

// text/plain keeps this a "simple" CORS request, which Apps Script accepts
async function api(action, payload = {}) {
  if (!navigator.onLine) throw new ApiError('You are offline. Please try again when you have a connection.');
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action, code: session.code, ...payload }) });
  } catch (e) {
    throw new ApiError('Could not reach the PackMate server. Check your connection and try again.');
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new ApiError('The server sent an unexpected reply. Please try again.');
  }
  if (!data.ok) {
    if (data.authFailed && session.code) logout(true);
    throw new ApiError(data.error || 'Request failed', data.authFailed);
  }
  return data;
}

async function apiPublic() {
  const res = await fetch(API_URL + '?action=public');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ------------------------------------------------------------------ session

const SESSION_KEY = 'packmate_session';
const session = { code: '', me: null };

function loadSession() {
  const saved = store.getJSON(SESSION_KEY) || JSON.parse(sessionStorageGet(SESSION_KEY) || 'null');
  if (saved && saved.code && saved.me) Object.assign(session, saved);
}

function sessionStorageGet(key) {
  try { return sessionStorage.getItem(key); } catch (e) { return null; }
}

function saveSession(remember) {
  const data = JSON.stringify({ code: session.code, me: session.me });
  if (remember) store.set(SESSION_KEY, data);
  else {
    store.remove(SESSION_KEY);
    try { sessionStorage.setItem(SESSION_KEY, data); } catch (e) { /* memory only */ }
  }
}

function isFaculty() {
  return session.me && session.me.role === 'faculty';
}

async function login(code, remember) {
  session.code = code.trim();
  try {
    const data = await api('login');
    session.me = data.me;
    saveSession(remember);
    afterAuthChange();
    toast(`Welcome, ${session.me.name}!`);
  } catch (err) {
    session.code = '';
    session.me = null;
    throw err;
  }
}

function logout(expired) {
  // The saved session holds the ticket details used offline; removing it removes them
  session.code = '';
  session.me = null;
  store.remove(SESSION_KEY);
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  afterAuthChange();
  if (expired) toast('Your access code is no longer valid. Please log in again.', 'error');
}

function afterAuthChange() {
  renderDashboard();
  checklist.switchProfile();
  renderAnnouncementsAdmin();
  gallery.reset();
  expenses.reset();
  memory.reset();
  lazyLoadMemberSections();
}

// ------------------------------------------------------------------ countdown & next event

function renderCountdown() {
  const now = Date.now();
  const label = $('#countdownLabel');
  const clock = $('#countdownClock');
  const text = $('#countdownText');
  const sub = $('#countdownSub');
  if (now < TOUR_START) {
    let s = Math.floor((TOUR_START - now) / 1000);
    const parts = [['days', Math.floor(s / 86400)], ['hrs', Math.floor((s %= 86400) / 3600)], ['min', Math.floor((s %= 3600) / 60)], ['sec', s % 60]];
    clock.innerHTML = parts.map(([u, v]) => `<div class="min-w-[3.5rem]"><div class="text-3xl sm:text-4xl font-bold text-ivory tabular-nums">${String(v).padStart(2, '0')}</div><div class="text-[11px] uppercase tracking-wider text-ivory/70 font-sans">${u}</div></div>`).join('');
    text.textContent = `${parts[0][1]} days ${parts[1][1]} hours ${parts[2][1]} minutes until departure`;
    label.textContent = 'Countdown to departure';
    sub.textContent = 'Bandel Jn • 17 Nov 2026 • 6:58 pm IST';
  } else if (now < TOUR_END) {
    label.textContent = 'The tour is under way';
    clock.innerHTML = '<div class="text-2xl font-bold text-ivory">Have a safe journey!</div>';
    text.textContent = 'The tour is under way';
    sub.textContent = 'Check Announcements for the latest updates from faculty.';
  } else {
    label.textContent = 'Tour completed';
    clock.innerHTML = '<div class="text-2xl font-bold text-ivory">Welcome back home!</div>';
    text.textContent = 'The tour is complete';
    sub.textContent = 'Relive it in the Photo Gallery and Memory Book.';
  }

  const next = EVENTS.find(e => Date.parse(e.at) > now);
  $('#nextEventTitle').textContent = next ? next.title : 'Tour completed';
  $('#nextEventTime').textContent = next ? fmtDateTime(Date.parse(next.at)) + ' IST' : 'Arrived Sealdah, 22 Nov 2026';
}

// ------------------------------------------------------------------ announcements

let announcements = [];

async function loadAnnouncements() {
  const cached = store.getJSON('packmate_ann_cache');
  if (cached) {
    announcements = cached.items;
    renderAnnouncements(cached.fetchedAt, true);
  }
  try {
    const data = isFaculty() ? await api('ann.list') : await apiPublic();
    announcements = data.announcements;
    const fetchedAt = Date.now();
    if (!isFaculty()) store.setJSON('packmate_ann_cache', { items: announcements, fetchedAt });
    renderAnnouncements(fetchedAt, false);
  } catch (err) {
    if (!cached) $('#annList').innerHTML = '<p class="text-sm text-gray-600">Announcements could not be loaded right now.</p>';
    $('#annStatus').textContent = cached ? `Could not refresh — showing announcements saved on ${fmtDateTime(cached.fetchedAt)}.` : 'Could not reach the server.';
  }
}

function renderAnnouncements(fetchedAt, fromCache) {
  const now = Date.now();
  const rank = { urgent: 0, important: 1, normal: 2 };
  const list = announcements
    .filter(a => isFaculty() || !a.expiresAt || a.expiresAt > now)
    .sort((a, b) => (rank[a.priority] - rank[b.priority]) || b.publishedAt - a.publishedAt);
  const styles = {
    urgent: 'border-rose-300 bg-rose-50',
    important: 'border-amber bg-amber/10',
    normal: 'border-forest/15 bg-ivory'
  };
  const chips = {
    urgent: '<span class="chip bg-rose-700 text-white">Urgent</span>',
    important: '<span class="chip bg-amber text-forest-dark">Important</span>',
    normal: ''
  };
  $('#annList').innerHTML = list.length ? list.map(a => {
    const expired = a.expiresAt && a.expiresAt <= now;
    return `
      <article class="rounded-xl border p-4 ${styles[a.priority] || styles.normal} ${expired ? 'opacity-60' : ''}">
        <div class="flex flex-wrap items-center gap-2">
          ${chips[a.priority] || ''}
          <span class="chip bg-white border border-forest/15 text-forest">${esc(a.category)}</span>
          ${expired ? '<span class="chip bg-gray-200 text-gray-800">Expired — hidden from students</span>' : ''}
        </div>
        <h3 class="mt-2 font-sans font-bold text-base text-charcoal">${esc(a.title)}</h3>
        <p class="mt-1 text-sm whitespace-pre-line">${esc(a.message)}</p>
        <p class="mt-2 text-xs text-gray-600">Posted ${fmtDateTime(a.publishedAt)}${a.updatedAt > a.publishedAt + 60000 ? ` • edited ${fmtDateTime(a.updatedAt)}` : ''} • ${esc(a.author)}${a.expiresAt ? ` • ${expired ? 'expired' : 'until'} ${fmtDateTime(a.expiresAt)}` : ''}</p>
        ${isFaculty() ? `<div class="mt-3 flex gap-2 no-print"><button type="button" class="btn-ghost btn-sm" data-ann-edit="${esc(a.id)}">Edit</button><button type="button" class="btn-danger btn-sm" data-ann-delete="${esc(a.id)}">Delete</button></div>` : ''}
      </article>`;
  }).join('') : '<p class="text-sm text-gray-600">No announcements at the moment.</p>';
  $('#annStatus').textContent = fetchedAt ? `${fromCache ? 'Saved copy from' : 'Updated'} ${fmtDateTime(fetchedAt)}` : '';

  const urgent = list.filter(a => a.priority === 'urgent' && !(a.expiresAt && a.expiresAt <= now));
  const banner = $('#urgentBanner');
  banner.hidden = !urgent.length;
  banner.innerHTML = urgent.length ? `<div class="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 text-sm"><p><strong>Urgent:</strong> ${esc(urgent[0].title)}${urgent.length > 1 ? ` (+${urgent.length - 1} more)` : ''}</p><a href="#announcements" class="underline font-semibold">Read now</a></div>` : '';
}

function renderAnnouncementsAdmin() {
  $('#annNewBtn').hidden = !isFaculty();
  loadAnnouncements();
}

function toLocalInput(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
}

function editAnnouncement(id) {
  const a = announcements.find(x => x.id === id) || { category: 'General', priority: 'normal' };
  const cats = ['Reporting time', 'Railway', 'Packing', 'Itinerary', 'Transport', 'Emergency', 'General'];
  openForm(id ? 'Edit announcement' : 'New announcement', `
    <div><label class="label" for="fTitle">Title</label><input id="fTitle" class="field" maxlength="120" required value="${esc(a.title || '')}" /></div>
    <div><label class="label" for="fMessage">Message</label><textarea id="fMessage" class="field min-h-[120px]" maxlength="2000" required>${esc(a.message || '')}</textarea></div>
    <div class="grid grid-cols-2 gap-2">
      <div><label class="label" for="fCategory">Category</label><select id="fCategory" class="field">${cats.map(c => `<option ${c === a.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div><label class="label" for="fPriority">Priority</label><select id="fPriority" class="field">${['normal', 'important', 'urgent'].map(p => `<option value="${p}" ${p === a.priority ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></div>
    </div>
    <div><label class="label" for="fExpires">Hide after (optional, IST)</label><input id="fExpires" type="datetime-local" class="field" value="${toLocalInput(a.expiresAt)}" /></div>
  `, async () => {
    const expires = $('#fExpires').value;
    const data = await api('ann.save', {
      id: id || '',
      title: $('#fTitle').value,
      message: $('#fMessage').value,
      category: $('#fCategory').value,
      priority: $('#fPriority').value,
      expiresAt: expires ? Date.parse(expires + ':00+05:30') : 0
    });
    announcements = data.announcements;
    renderAnnouncements(Date.now(), false);
    toast('Announcement published');
  });
}

async function deleteAnnouncement(id) {
  const a = announcements.find(x => x.id === id);
  if (!a || !confirm(`Delete the announcement “${a.title}”? This cannot be undone.`)) return;
  try {
    await api('ann.delete', { id });
    announcements = announcements.filter(x => x.id !== id);
    renderAnnouncements(Date.now(), false);
    toast('Announcement deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ------------------------------------------------------------------ generic form dialog

function openForm(title, fieldsHtml, onSubmit, submitLabel = 'Save') {
  const dlg = $('#formDialog');
  $('#formDialogTitle').textContent = title;
  $('#formDialogFields').innerHTML = fieldsHtml;
  $('#formDialogError').textContent = '';
  $('#formDialogSubmit').textContent = submitLabel;
  dlg._onSubmit = onSubmit;
  dlg.showModal();
  const first = $('input, textarea, select', dlg.querySelector('#formDialogFields'));
  if (first) first.focus();
}

async function submitFormDialog(e) {
  e.preventDefault();
  const dlg = $('#formDialog');
  const form = $('#formDialogForm');
  if (!form.reportValidity()) return;
  const btn = $('#formDialogSubmit');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    await dlg._onSubmit();
    dlg.close();
  } catch (err) {
    $('#formDialogError').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ------------------------------------------------------------------ dashboard

function ticketCard(kind, m) {
  const onward = kind === 'onward';
  return `
    <div class="rounded-xl p-4 border ${onward ? 'bg-ivory border-forest/20' : 'bg-amber/10 border-amber/40'}">
      <div class="flex flex-wrap justify-between items-center gap-2">
        <span class="text-xs font-bold uppercase tracking-wider ${onward ? 'text-forest' : 'text-amber-dark'}">${onward ? 'Onward • Tue 17 Nov 2026' : 'Return • Sat 21 Nov 2026'}</span>
        <span class="font-mono text-sm bg-white px-2 py-0.5 rounded border border-forest/15">PNR ${esc(onward ? m.onPnr : m.retPnr) || '—'}</span>
      </div>
      <p class="mt-2 font-semibold">${onward ? '27575 Vande Bharat SL • Third AC (3A)' : '13142 Teesta Torsha Express • Sleeper (SL)'}</p>
      <p class="text-sm text-gray-700">${onward ? 'Bandel Jn 18:58 → New Jalpaiguri Jn 01:40 (18 Nov)' : 'Falakata 12:55 → Sealdah 03:35 (22 Nov)'}</p>
      <div class="mt-3 pt-3 border-t border-forest/10 flex flex-wrap justify-between items-center gap-2">
        <span class="text-sm">Coach &amp; berth: <strong class="text-lg text-forest">${esc(onward ? m.onSeat : m.retSeat) || 'Not assigned'}</strong></span>
        <span class="chip bg-emerald-100 text-emerald-900">CNF</span>
      </div>
    </div>`;
}

let roster = null;

function renderDashboard() {
  const me = session.me;
  $('#loginForm').hidden = !!me;
  $('#logoutBtn').hidden = !me;
  const box = $('#dashContent');
  box.hidden = !me;
  if (!me) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <div class="flex flex-wrap items-center gap-3">
      <div class="w-12 h-12 rounded-full bg-forest text-ivory flex items-center justify-center font-serif font-bold text-lg" aria-hidden="true">${esc(me.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
      <div>
        <p class="font-serif font-bold text-xl text-forest">${esc(me.name)}</p>
        <p class="text-sm text-gray-700">${me.role === 'faculty' ? 'Faculty coordinator' : 'Student'}${me.sem && me.sem !== 'Faculty' ? ' • ' + esc(me.sem) : ''} • Traveller #${esc(me.sl)}</p>
      </div>
    </div>
    ${me.note ? `<div class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="note"><strong>Important for you:</strong> ${esc(me.note)}</div>` : ''}
    <div class="grid md:grid-cols-2 gap-3">${ticketCard('onward', me)}${ticketCard('return', me)}</div>
    <nav aria-label="Dashboard shortcuts" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <a href="#checklist" class="btn-ghost">My checklist</a>
      <a href="#announcements" class="btn-ghost">Announcements</a>
      <a href="#itinerary" class="btn-ghost">Itinerary</a>
      <a href="#emergency" class="btn-ghost">Emergency</a>
      <a href="#gallery" class="btn-ghost">Photo gallery</a>
      <a href="#expenses" class="btn-ghost">Expenses</a>
      <a href="#memory" class="btn-ghost">Memory book</a>
      <a href="#map" class="btn-ghost">Map</a>
    </nav>
    ${me.role === 'faculty' ? `
      <div class="rounded-xl border border-forest/15 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-serif font-bold text-lg text-forest">Group roster &amp; berths (faculty only)</h3>
          <button type="button" id="rosterLoad" class="btn-ghost btn-sm">${roster ? 'Refresh' : 'Show roster'}</button>
        </div>
        <div id="rosterBox" class="mt-3 overflow-x-auto relative"></div>
      </div>` : ''}
    <p class="text-xs text-gray-600">Your ticket details are saved on this device so they work offline on the train. “Log out on this device” removes them.</p>
  `;
  if (roster) renderRoster();
}

async function loadRoster() {
  const btn = $('#rosterLoad');
  btn.disabled = true;
  try {
    roster = (await api('roster')).members;
    renderRoster();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

function renderRoster() {
  const box = $('#rosterBox');
  if (!box || !roster) return;
  box.innerHTML = `
    <table class="w-full text-sm text-left min-w-[640px]">
      <caption class="sr-only">Group roster</caption>
      <thead><tr class="text-forest border-b border-forest/15">
        <th scope="col" class="py-2 pr-2">#</th><th scope="col" class="py-2 pr-2">Name</th><th scope="col" class="py-2 pr-2">Sem</th>
        <th scope="col" class="py-2 pr-2">Mobile</th><th scope="col" class="py-2 pr-2">Onward (B2)</th><th scope="col" class="py-2">Return (S2)</th>
      </tr></thead>
      <tbody class="divide-y divide-forest/10">${roster.map(m => `
        <tr class="${m.role === 'faculty' ? 'bg-forest/5' : ''}">
          <td class="py-2 pr-2">${esc(m.sl)}</td>
          <td class="py-2 pr-2 font-semibold">${esc(m.name)}${m.note ? ` <span class="chip bg-rose-100 text-rose-900" title="${esc(m.note)}">note</span>` : ''}</td>
          <td class="py-2 pr-2">${esc(m.sem)} ${m.ageSex ? `<span class="text-gray-600">(${esc(m.ageSex)})</span>` : ''}</td>
          <td class="py-2 pr-2">${m.mobile ? `<a class="text-himalaya-dark font-semibold underline" href="tel:+91${esc(m.mobile)}">${esc(m.mobile)}</a>` : '<span class="text-rose-800">Pending</span>'}</td>
          <td class="py-2 pr-2">${esc(m.onSeat)} <span class="text-gray-600 font-mono text-xs">${esc(m.onPnr)}</span></td>
          <td class="py-2">${esc(m.retSeat)} <span class="text-gray-600 font-mono text-xs">${esc(m.retPnr)}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// ------------------------------------------------------------------ checklist

const CHECK_CATEGORIES = [
  { id: 'docs', name: 'Travel documents', tab: 'docs' },
  { id: 'clothing', name: 'Clothing & warm wear (4°C to 12°C)', tab: 'packing' },
  { id: 'health', name: 'Medicines & personal care', tab: 'packing' },
  { id: 'electronics', name: 'Electronics & chargers', tab: 'packing' },
  { id: 'footwear', name: 'Footwear', tab: 'packing' },
  { id: 'other', name: 'Other essentials', tab: 'packing' }
];

// Item ids are kept from the earlier version so saved progress carries over
const CHECK_ITEMS = [
  { id: 'd2', cat: 'docs', name: 'Srikrishna College identity card (mandatory)', qty: 1 },
  { id: 'd1', cat: 'docs', name: 'Original government photo ID (Voter ID / Aadhaar / PAN / Driving Licence)', qty: 1 },
  { id: 'd3', cat: 'docs', name: 'Photocopies of photo ID & 2 passport-size photos (for Sikkim permits / hotels)', qty: 2 },
  { id: 'd4', cat: 'docs', name: 'Digital / printed train tickets (Coach B2 onward & Coach S2 return)', qty: 1 },
  { id: 'dx1', cat: 'docs', name: 'Checked that the name on my ticket matches my photo ID (see My Dashboard notes)', qty: 1 },
  { id: 'dx2', cat: 'docs', name: 'Faculty emergency numbers saved in phone and written on paper', qty: 1 },
  { id: 'd5', cat: 'docs', name: 'Printed Principal approval letter & 22-member roster', qty: 1, roles: ['faculty'] },

  { id: 'w1', cat: 'clothing', name: 'Heavy down jacket / windproof winter jacket', qty: 1 },
  { id: 'w2', cat: 'clothing', name: 'Thermal innerwear sets (upper & lower)', qty: 2 },
  { id: 'w3', cat: 'clothing', name: 'Sweaters / fleece hoodies / pullovers', qty: 2 },
  { id: 'w4', cat: 'clothing', name: 'Daytime T-shirts / shirts / kurtas & jeans / trousers', qty: 4 },
  { id: 'w5', cat: 'clothing', name: 'Light blanket / warm shawl (needed on the non-AC return sleeper, S2)', qty: 1 },
  { id: 'w6', cat: 'clothing', name: 'Woollen cap (beanie), muffler & warm gloves', qty: 1 },
  { id: 'w7', cat: 'clothing', name: 'Woollen & cotton socks', qty: 4 },

  { id: 'h1', cat: 'health', name: 'Motion sickness medicine for winding hill roads (as advised by your doctor)', qty: 2 },
  { id: 'h2', cat: 'health', name: 'Paracetamol, antacids, cold tablets, ORS packets & band-aids', qty: 1 },
  { id: 'h3', cat: 'health', name: 'Personal regular medicines (if any) + prescription', qty: 1 },
  { id: 't1', cat: 'health', name: 'Cold cream / moisturiser & lip balm (dry hill weather)', qty: 1 },
  { id: 't2', cat: 'health', name: 'Face wash, sunscreen & face mist', qty: 1 },
  { id: 't3', cat: 'health', name: 'Toothbrush, toothpaste, comb & deodorant', qty: 1 },
  { id: 't4', cat: 'health', name: 'Paper soap, hand sanitiser & wet wipes (train journey)', qty: 2 },
  { id: 't5', cat: 'health', name: 'Quick-dry towel', qty: 1 },

  { id: 'e1', cat: 'electronics', name: 'Smartphone + wall charger & charging cable', qty: 1 },
  { id: 'e2', cat: 'electronics', name: 'Power bank (10,000–20,000 mAh)', qty: 1 },
  { id: 'e3', cat: 'electronics', name: '3-pin multi-plug splitter (shared train sockets)', qty: 1 },
  { id: 'e4', cat: 'electronics', name: 'Earphones / headphones', qty: 1 },
  { id: 'e5', cat: 'electronics', name: 'Tablet / camera (optional)', qty: 1 },

  { id: 'w8', cat: 'footwear', name: 'Comfortable walking sneakers / shoes with good grip', qty: 1 },
  { id: 'f2', cat: 'footwear', name: 'Room slippers / sandals', qty: 1 },

  { id: 'o1', cat: 'other', name: 'Small backpack for day trips', qty: 1 },
  { id: 'o2', cat: 'other', name: 'Rain protection — compact umbrella or raincoat', qty: 1 },
  { id: 'd6', cat: 'other', name: 'Cash in small denominations + UPI on phone', qty: 1 },
  { id: 'h4', cat: 'other', name: 'Reusable water bottle / hot water flask', qty: 1 },
  { id: 'h5', cat: 'other', name: 'Small padlock & chain for luggage (return sleeper S2)', qty: 2 },
  { id: 'h6', cat: 'other', name: 'Dry snacks / biscuits for evening boarding at Bandel Jn', qty: 2 }
];

const checklist = (() => {
  let data = emptyData();
  let tab = 'packing';
  let filter = 'all';
  let syncTimer = null;
  let syncState = '';

  function emptyData() {
    return { packed: {}, qty: {}, custom: [], removed: [], updatedAt: 0 };
  }

  function profileKey() {
    return 'packmate_checklist_' + (session.me ? 'member_' + session.me.sl : 'guest');
  }

  // Saved data is never trusted blindly: anything malformed is dropped, defaults always come back
  function sanitise(raw) {
    const clean = emptyData();
    if (!raw || typeof raw !== 'object') return clean;
    if (raw.packed && typeof raw.packed === 'object') {
      Object.keys(raw.packed).forEach(k => { if (raw.packed[k] === true) clean.packed[k] = true; });
    }
    if (raw.qty && typeof raw.qty === 'object') {
      Object.keys(raw.qty).forEach(k => {
        const n = Math.round(Number(raw.qty[k]));
        if (n >= 1 && n <= 99) clean.qty[k] = n;
      });
    }
    if (Array.isArray(raw.custom)) {
      clean.custom = raw.custom
        .filter(c => c && typeof c.name === 'string' && c.name.trim() && CHECK_CATEGORIES.some(cat => cat.id === c.cat))
        .slice(0, 100)
        .map(c => ({ id: String(c.id || 'c' + Math.random().toString(36).slice(2)), cat: c.cat, name: c.name.trim().slice(0, 100), qty: 1 }));
    }
    if (Array.isArray(raw.removed)) clean.removed = raw.removed.filter(id => typeof id === 'string');
    clean.updatedAt = Number(raw.updatedAt) || 0;
    return clean;
  }

  // One-time import from the old single-browser checklist (before per-student checklists)
  function migrateLegacy() {
    const old = store.getJSON(LEGACY_CHECKLIST_KEY);
    if (!old || !Array.isArray(old.categories)) return null;
    const migrated = emptyData();
    const seen = new Set();
    const catMap = { 'docs-tickets': 'docs', 'winter-clothing': 'clothing', electronics: 'electronics', toiletries: 'health', 'health-train': 'other' };
    old.categories.forEach(cat => {
      (Array.isArray(cat.items) ? cat.items : []).forEach(item => {
        if (!item || !item.id) return;
        seen.add(item.id);
        if (String(item.id).startsWith('custom-')) {
          migrated.custom.push({ id: item.id, cat: catMap[cat.id] || 'other', name: String(item.name || '') });
        }
        if (item.packed === true) migrated.packed[item.id] = true;
        if (Number(item.qty) >= 1) migrated.qty[item.id] = Number(item.qty);
      });
    });
    // Items the user had deleted stay deleted (only ids that existed in the old list)
    const oldDefaults = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'e1', 'e2', 'e3', 'e4', 'e5', 't1', 't2', 't3', 't4', 't5', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    migrated.removed = seen.size ? oldDefaults.filter(id => !seen.has(id)) : [];
    migrated.updatedAt = Date.now();
    return sanitise(migrated);
  }

  function items() {
    const role = session.me ? session.me.role : 'student';
    const defaults = CHECK_ITEMS.filter(i => !data.removed.includes(i.id) && (!i.roles || i.roles.includes(role)));
    return defaults.concat(data.custom.map(c => ({ ...c, custom: true }))).map(i => ({
      ...i, qty: data.qty[i.id] || i.qty, packed: data.packed[i.id] === true
    }));
  }

  function load() {
    let saved = store.getJSON(profileKey());
    if (!saved && !session.me) {
      saved = migrateLegacy();
      if (saved) store.setJSON(profileKey(), saved);
    }
    if (!saved && session.me) {
      // First login on this device: start from the guest list so earlier ticks aren't lost
      saved = store.getJSON('packmate_checklist_guest') || migrateLegacy();
    }
    data = sanitise(saved);
  }

  function save() {
    data.updatedAt = Date.now();
    store.setJSON(profileKey(), data);
    if (session.me) scheduleSync();
    else syncState = store.available ? 'Saved on this device only. Log in to sync across your devices.' : 'Your browser is blocking storage — ticks will be lost when you close this page.';
    render();
  }

  function scheduleSync() {
    syncState = 'Saving…';
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushToServer, 1200);
  }

  async function pushToServer() {
    if (!session.me) return;
    const snapshot = JSON.parse(JSON.stringify(data));
    try {
      await api('checklist.save', { data: snapshot, updatedAt: snapshot.updatedAt });
      syncState = `Synced to your account • ${fmtDateTime(Date.now())}`;
    } catch (err) {
      syncState = navigator.onLine ? `Not synced: ${err.message}` : 'Saved on this device. Will sync when you are back online.';
    }
    renderSync();
  }

  async function pullFromServer() {
    if (!session.me) return;
    try {
      const remote = await api('checklist.get');
      if (remote.data && remote.updatedAt > (data.updatedAt || 0)) {
        data = sanitise({ ...remote.data, updatedAt: remote.updatedAt });
        store.setJSON(profileKey(), data);
        syncState = `Synced from your account • ${fmtDateTime(Date.now())}`;
      } else if (!remote.data || remote.updatedAt < data.updatedAt) {
        await pushToServer();
      } else {
        syncState = `Synced to your account • ${fmtDateTime(remote.updatedAt)}`;
      }
    } catch (err) {
      syncState = 'Saved on this device. Could not reach the server to sync.';
    }
    render();
  }

  function switchProfile() {
    clearTimeout(syncTimer);
    load();
    syncState = session.me ? 'Checking your synced checklist…' : (store.available ? 'Saved on this device only. Log in to sync across your devices.' : 'Your browser is blocking storage — ticks will be lost when you close this page.');
    $('#checkOwner').textContent = session.me ? `Checklist for ${session.me.name}` : 'Guest checklist on this device';
    render();
    pullFromServer();
  }

  function renderSync() {
    $('#checkSync').textContent = syncState;
  }

  function render() {
    const all = items();
    const done = all.filter(i => i.packed).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    $('#statTotal').textContent = all.length;
    $('#statDone').textContent = done;
    $('#statLeft').textContent = all.length - done;
    $('#statPct').textContent = pct + '%';
    $('#checkBarFill').style.width = pct + '%';
    $('#checkBar').setAttribute('aria-valuenow', pct);
    renderSync();

    $$('[data-tab]').forEach(b => {
      const active = b.dataset.tab === tab;
      b.setAttribute('aria-selected', active);
      b.className = 'btn btn-sm ' + (active ? 'bg-forest text-ivory' : 'bg-forest/5 text-forest hover:bg-forest/10');
      const tabItems = all.filter(i => CHECK_CATEGORIES.find(c => c.id === i.cat).tab === b.dataset.tab);
      b.textContent = `${b.dataset.tab === 'docs' ? 'Travel documents' : 'Packing'} (${tabItems.filter(i => i.packed).length}/${tabItems.length})`;
    });
    $$('[data-filter]').forEach(b => {
      b.className = 'px-3 min-h-[44px] text-sm font-semibold ' + (b.dataset.filter === filter ? 'bg-forest text-ivory' : 'bg-ivory text-charcoal hover:bg-forest/10');
      b.setAttribute('aria-pressed', b.dataset.filter === filter);
    });

    const cats = CHECK_CATEGORIES.filter(c => c.tab === tab);
    $('#checkAddCat').innerHTML = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const query = $('#checkSearch').value.trim().toLowerCase();
    $('#checkPanel').innerHTML = all.length === 0
      ? '<p class="md:col-span-2 text-sm text-gray-700">Every item has been removed. Use “Reset” to restore the recommended list.</p>'
      : cats.map(cat => {
        const catItems = all.filter(i => i.cat === cat.id);
        const shown = catItems.filter(i => (!query || i.name.toLowerCase().includes(query)) &&
          (filter === 'all' || (filter === 'packed') === i.packed));
        const catDone = catItems.filter(i => i.packed).length;
        return `
          <div class="rounded-xl border border-forest/15 bg-ivory overflow-hidden print-break">
            <div class="px-4 py-3 bg-forest/5 border-b border-forest/10">
              <div class="flex justify-between items-center gap-2">
                <h3 class="font-serif font-bold text-forest">${esc(cat.name)}</h3>
                <span class="text-xs font-semibold text-gray-700">${catDone}/${catItems.length}</span>
              </div>
              <div class="mt-2 h-1.5 rounded-full bg-forest/10 overflow-hidden"><div class="h-full bg-forest" style="width:${catItems.length ? Math.round(catDone / catItems.length * 100) : 0}%"></div></div>
            </div>
            <ul class="p-2 space-y-1">${shown.length ? shown.map(i => `
              <li class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white">
                <input id="ci-${esc(i.id)}" type="checkbox" class="w-5 h-5 shrink-0 accent-forest" data-check="${esc(i.id)}" ${i.packed ? 'checked' : ''} />
                <label for="ci-${esc(i.id)}" class="flex-1 text-sm cursor-pointer ${i.packed ? 'line-through text-gray-600' : ''}">${esc(i.name)}${i.custom ? ' <span class="chip bg-himalaya/15 text-himalaya-dark">mine</span>' : ''}</label>
                <span class="flex items-center gap-1 no-print">
                  <button type="button" class="w-8 h-8 rounded-lg border border-forest/20 bg-white" data-qty="${esc(i.id)}" data-delta="-1" aria-label="Fewer ${esc(i.name)}">−</button>
                  <span class="text-xs font-semibold w-6 text-center" aria-label="Quantity">×${i.qty}</span>
                  <button type="button" class="w-8 h-8 rounded-lg border border-forest/20 bg-white" data-qty="${esc(i.id)}" data-delta="1" aria-label="More ${esc(i.name)}">+</button>
                  <button type="button" class="w-8 h-8 rounded-lg text-gray-500 hover:text-rose-700" data-remove="${esc(i.id)}" aria-label="Remove ${esc(i.name)}">✕</button>
                </span>
              </li>`).join('') : '<li class="px-2 py-4 text-center text-sm text-gray-600">Nothing to show here.</li>'}
            </ul>
          </div>`;
      }).join('');

    if (all.length && done === all.length) $('#checkSync').textContent = 'Everything is ready — have a great trip! ' + syncState;
  }

  function bind() {
    $('#checkPanel').addEventListener('change', e => {
      const id = e.target.dataset.check;
      if (!id) return;
      if (e.target.checked) data.packed[id] = true; else delete data.packed[id];
      save();
      const box = document.getElementById('ci-' + id);
      if (box) box.focus();
    });
    $('#checkPanel').addEventListener('click', e => {
      const qtyBtn = e.target.closest('[data-qty]');
      const removeBtn = e.target.closest('[data-remove]');
      if (qtyBtn) {
        const id = qtyBtn.dataset.qty;
        const item = items().find(i => i.id === id);
        data.qty[id] = Math.min(99, Math.max(1, item.qty + Number(qtyBtn.dataset.delta)));
        save();
      } else if (removeBtn) {
        const id = removeBtn.dataset.remove;
        const custom = data.custom.find(c => c.id === id);
        if (custom) data.custom = data.custom.filter(c => c.id !== id);
        else data.removed.push(id);
        delete data.packed[id];
        save();
      }
    });
    $$('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    $$('[data-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
    $('#checkSearch').addEventListener('input', render);
    $('#checkAddForm').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#checkAddName').value.trim();
      if (!name) return;
      data.custom.push({ id: 'c' + Date.now().toString(36), cat: $('#checkAddCat').value, name: name.slice(0, 100), qty: 1 });
      $('#checkAddName').value = '';
      save();
    });
    $('#checkReset').addEventListener('click', () => {
      if (!confirm('Reset your checklist? All ticks and your own items will be cleared, and removed items will come back.')) return;
      data = emptyData();
      save();
      toast('Checklist reset');
    });
  }

  return { bind, switchProfile, render };
})();

// ------------------------------------------------------------------ gallery

const MAX_UPLOAD_MB = 20;
const PHOTO_TAGS = ['Bandel / Train', 'NJP', 'Ravangla', 'Namchi', 'Pelling', 'Falakata / Return', 'Group photo', 'Other'];

const gallery = (() => {
  let photos = [];
  let status = 'idle';
  let selected = [];
  let lbIndex = 0;
  let visible = [];

  function reset() {
    photos = [];
    status = session.me ? 'idle' : 'locked';
    $('#uploadOpenBtn').hidden = !session.me;
    $('#galFilters').hidden = !session.me;
    render();
  }

  async function load() {
    if (!session.me || status === 'loading') return;
    status = 'loading';
    render();
    try {
      photos = (await api('photos.list')).photos;
      status = 'ready';
    } catch (err) {
      status = 'error';
      $('#galGrid').dataset.error = err.message;
    }
    render();
  }

  function filtered() {
    const d = $('#galDate').value;
    const t = $('#galTag').value;
    const who = $('#galWho').value;
    return photos.filter(p => (!d || p.date === d) && (!t || p.tag === t) &&
      (who === 'all' || (who === 'mine' && p.mine) || (who === 'memory' && p.memoryBook)));
  }

  function renderFilters() {
    const dates = [...new Set(photos.map(p => p.date))].sort();
    const keepD = $('#galDate').value;
    const keepT = $('#galTag').value;
    $('#galDate').innerHTML = '<option value="">All dates</option>' + dates.map(d => `<option value="${esc(d)}" ${d === keepD ? 'selected' : ''}>${esc(fmtDate(d))}</option>`).join('');
    $('#galTag').innerHTML = '<option value="">All places</option>' + PHOTO_TAGS.map(t => `<option ${t === keepT ? 'selected' : ''}>${esc(t)}</option>`).join('');
  }

  function render() {
    const grid = $('#galGrid');
    const msg = text => `<p class="col-span-full py-10 text-center text-sm text-gray-700">${text}</p>`;
    if (status === 'locked') {
      grid.innerHTML = msg('Tour photos are private to travellers. <a class="underline font-semibold text-forest" href="#dashboard">Log in with your access code</a> to view and share them.');
      return;
    }
    if (status === 'loading' || status === 'idle') {
      grid.innerHTML = Array.from({ length: 6 }, () => '<div class="aspect-square rounded-xl bg-forest/10 animate-pulse"></div>').join('');
      return;
    }
    if (status === 'error') {
      grid.innerHTML = msg(`Could not load photos: ${esc(grid.dataset.error)} <button type="button" class="underline font-semibold" data-gal-retry>Try again</button>`);
      return;
    }
    renderFilters();
    visible = filtered();
    if (!photos.length) {
      grid.innerHTML = msg('No photos yet. Be the first to share a memory!');
      return;
    }
    if (!visible.length) {
      grid.innerHTML = msg('No photos match these filters.');
      return;
    }
    grid.innerHTML = visible.map((p, i) => `
      <figure class="group rounded-xl overflow-hidden border border-forest/10 bg-ivory flex flex-col">
        <button type="button" class="relative aspect-square bg-forest/10 overflow-hidden" data-open="${i}" aria-label="View ${esc(p.caption || 'photo')} full screen">
          <img src="${esc(p.url)}" alt="${esc(p.caption || (p.type === 'pdf' ? 'PDF document' : 'Tour photo'))}${p.tag ? ' — ' + esc(p.tag) : ''}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'absolute inset-0 flex items-center justify-center text-sm text-gray-600',textContent:'Preview not ready yet'}))" />
          ${p.type === 'pdf' ? '<span class="absolute top-2 left-2 chip bg-rose-700 text-white">PDF</span>' : ''}
          ${p.memoryBook ? '<span class="absolute top-2 right-2 chip bg-amber text-forest-dark" title="In memory book">★</span>' : ''}
        </button>
        <figcaption class="p-2.5 text-xs flex-1 flex flex-col gap-1">
          <span class="font-semibold text-sm text-charcoal line-clamp-2">${esc(p.caption || 'Untitled')}</span>
          <span class="text-gray-600">${esc(p.uploader)} • ${esc(fmtDate(p.date))}${p.tag ? ' • ' + esc(p.tag) : ''}</span>
          <span class="mt-auto pt-1 flex items-center justify-between gap-1">
            <button type="button" class="btn btn-sm ${p.likedByMe ? 'bg-rose-100 text-rose-800' : 'bg-white border border-forest/15'}" data-like="${esc(p.id)}" aria-pressed="${p.likedByMe}" aria-label="${p.likedByMe ? 'Unlike' : 'Like'} photo, ${p.likes} likes">♥ ${p.likes}</button>
            ${p.canEdit ? `<span class="flex gap-1"><button type="button" class="btn-ghost btn-sm" data-edit="${esc(p.id)}">Edit</button><button type="button" class="btn-danger btn-sm" data-delete="${esc(p.id)}" aria-label="Delete photo">Delete</button></span>` : ''}
          </span>
        </figcaption>
      </figure>`).join('');
  }

  // ---- upload

  function mimeOf(file) {
    if (file.type) return file.type;
    if (/\.pdf$/i.test(file.name)) return 'application/pdf';
    if (/\.(heic|heif)$/i.test(file.name)) return 'image/heic';
    return '';
  }

  function addFiles(list) {
    const files = Array.from(list);
    // JPG/PNG/WebP are shrunk before upload, so larger originals are fine; other files must already fit the limit
    const limit = f => (/^image\/(jpeg|png|webp)$/.test(mimeOf(f)) ? 100 : MAX_UPLOAD_MB) * 1048576;
    const ok = files.filter(f => /^(image\/|application\/pdf$)/.test(mimeOf(f)) && f.size <= limit(f));
    const bad = files.filter(f => !ok.includes(f));
    selected = selected.concat(ok);
    if (bad.length) toast('Skipped (not a photo/PDF, or too large): ' + bad.map(f => f.name).join(', '), 'error');
    renderFiles();
  }

  function renderFiles() {
    $('#fileList').innerHTML = selected.map((f, i) => `
      <li class="flex items-center gap-2 rounded-lg bg-forest/5 px-3 py-1.5">
        <span aria-hidden="true">${mimeOf(f) === 'application/pdf' ? '📄' : '🖼️'}</span>
        <span class="flex-1 truncate">${esc(f.name)}</span>
        <span class="text-xs text-gray-600">${(f.size / 1048576).toFixed(1)} MB</span>
        <button type="button" class="w-8 h-8 text-gray-600 hover:text-rose-700" data-unselect="${i}" aria-label="Remove ${esc(f.name)}">✕</button>
      </li>`).join('');
    $('#upSubmit').textContent = selected.length > 1 ? `Upload ${selected.length} files` : 'Upload';
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsDataURL(file);
    });
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('cannot decode'));
      img.src = src;
    });
  }

  // Photos are resized to max 1600 px JPEG (~300 KB); GIF, PDF and HEIC are sent unchanged
  async function prepare(file, maxSide = 1600) {
    const mime = mimeOf(file);
    const original = (await readDataUrl(file)).replace(/^data:[^;,]*/, 'data:' + mime);
    if (/^image\/(jpeg|png|webp)$/.test(mime) || (mime.startsWith('image/') && mime !== 'image/gif')) {
      try {
        const img = await loadImg(original);
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.82);
      } catch (e) { /* browser can't decode (e.g. HEIC on Android) — upload the original */ }
    }
    if (file.size > MAX_UPLOAD_MB * 1048576) throw new Error(`larger than ${MAX_UPLOAD_MB} MB`);
    return original;
  }

  async function upload(e) {
    e.preventDefault();
    if (!selected.length) {
      toast('Choose or drop at least one photo or PDF first.', 'error');
      return;
    }
    const btn = $('#upSubmit');
    btn.disabled = true;
    $('#upProgress').hidden = false;
    const failed = [];
    let saved = 0;
    for (let i = 0; i < selected.length; i++) {
      const f = selected[i];
      $('#upProgressText').textContent = `Uploading ${i + 1} of ${selected.length}: ${f.name}`;
      $('#upBar').style.width = Math.round((i / selected.length) * 100) + '%';
      try {
        const res = await api('photos.upload', {
          dataUrl: await prepare(f), fileName: f.name, caption: $('#upCaption').value,
          tag: $('#upTag').value, date: $('#upDate').value, memoryBook: $('#upMemory').checked
        });
        photos = res.photos;
        saved++;
      } catch (err) {
        failed.push({ f, message: err.message });
      }
    }
    $('#upBar').style.width = '100%';
    btn.disabled = false;
    selected = failed.map(x => x.f);
    renderFiles();
    status = 'ready';
    render();
    if (failed.length) {
      $('#upProgressText').textContent = `${saved} saved. Not saved: ` + failed.map(x => `${x.f.name} (${x.message})`).join('; ');
      toast(`${failed.length} file(s) were NOT saved — see the upload window.`, 'error');
    } else {
      $('#uploadDialog').close();
      $('#upProgress').hidden = true;
      $('#upCaption').value = '';
      toast(`${saved} file(s) saved to the tour gallery.`);
    }
  }

  // ---- actions

  async function act(action, payload, okMessage) {
    try {
      photos = (await api(action, payload)).photos;
      render();
      if (okMessage) toast(okMessage);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function edit(id) {
    const p = photos.find(x => x.id === id);
    openForm('Edit photo', `
      <div><label class="label" for="fCap">Caption</label><input id="fCap" class="field" maxlength="140" value="${esc(p.caption)}" /></div>
      <div><label class="label" for="fTag">Place</label><select id="fTag" class="field"><option value="">—</option>${PHOTO_TAGS.map(t => `<option ${t === p.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <label class="flex items-start gap-2 text-sm"><input id="fMem" type="checkbox" class="mt-1 w-4 h-4 accent-forest" ${p.memoryBook ? 'checked' : ''} /> Include in the Tour Memory Book (everyone recognisable has agreed)</label>
    `, async () => {
      photos = (await api('photos.update', { id, caption: $('#fCap').value, tag: $('#fTag').value, memoryBook: $('#fMem').checked })).photos;
      render();
      toast('Photo updated');
    });
  }

  // ---- lightbox

  function openLb(i) {
    lbIndex = i;
    showLb();
    $('#lightbox').showModal();
  }

  function showLb() {
    const p = visible[lbIndex];
    if (!p) return;
    const isPdf = p.type === 'pdf';
    $('#lbImg').hidden = isPdf;
    $('#lbPdf').hidden = !isPdf;
    $('#lbImg').src = isPdf ? '' : p.url;
    $('#lbImg').alt = p.caption || 'Tour photo';
    $('#lbPdf').src = isPdf ? `https://drive.google.com/file/d/${encodeURIComponent(p.id)}/preview` : 'about:blank';
    $('#lbOpen').href = `https://drive.google.com/file/d/${encodeURIComponent(p.id)}/view`;
    $('#lbCaption').textContent = p.caption || 'Untitled';
    $('#lbMeta').textContent = `${p.uploader} • ${fmtDate(p.date)}${p.tag ? ' • ' + p.tag : ''}`;
    $('#lbCount').textContent = `${lbIndex + 1} / ${visible.length}`;
    $('#lbPrev').hidden = lbIndex === 0;
    $('#lbNext').hidden = lbIndex === visible.length - 1;
  }

  function bind() {
    $('#uploadOpenBtn').addEventListener('click', () => {
      $('#upTag').innerHTML = '<option value="">—</option>' + PHOTO_TAGS.map(t => `<option>${esc(t)}</option>`).join('');
      if (!$('#upDate').value) $('#upDate').value = todayIST();
      $('#upProgress').hidden = true;
      $('#uploadDialog').showModal();
    });
    $('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
    const zone = $('#dropZone');
    ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('bg-forest/10'); }));
    ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.remove('bg-forest/10'); }));
    zone.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    document.addEventListener('paste', e => {
      if (!$('#uploadDialog').open) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    $('#fileList').addEventListener('click', e => {
      const b = e.target.closest('[data-unselect]');
      if (b) { selected.splice(Number(b.dataset.unselect), 1); renderFiles(); }
    });
    $('#uploadForm').addEventListener('submit', upload);

    $('#galGrid').addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.open !== undefined) openLb(Number(t.dataset.open));
      else if (t.dataset.like) act('photos.like', { id: t.dataset.like });
      else if (t.dataset.edit) edit(t.dataset.edit);
      else if (t.dataset.delete && confirm('Delete this photo from the gallery? It will be moved to the Drive bin.')) act('photos.delete', { id: t.dataset.delete }, 'Photo deleted');
      else if (t.dataset.galRetry !== undefined) load();
    });
    ['#galDate', '#galTag', '#galWho'].forEach(s => $(s).addEventListener('change', render));

    $('#lbPrev').addEventListener('click', () => { lbIndex--; showLb(); });
    $('#lbNext').addEventListener('click', () => { lbIndex++; showLb(); });
    $('#lightbox').addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' && lbIndex > 0) { lbIndex--; showLb(); }
      if (e.key === 'ArrowRight' && lbIndex < visible.length - 1) { lbIndex++; showLb(); }
    });
    $('#lightbox').addEventListener('close', () => { $('#lbPdf').src = 'about:blank'; });
  }

  return { bind, reset, load, prepare, getPhotos: () => photos };
})();

// ------------------------------------------------------------------ expenses

const expenses = (() => {
  let entries = [];
  let categories = ['Transport', 'Accommodation', 'Food', 'Entry tickets', 'Medical', 'Miscellaneous'];
  let status = 'idle';

  function reset() {
    entries = [];
    status = session.me ? 'idle' : 'locked';
    $('#expAddBtn').hidden = !isFaculty();
    $('#expLogBtn').hidden = !isFaculty();
    $('#expExportBtn').hidden = !session.me;
    render();
  }

  async function load() {
    if (!session.me || status === 'loading') return;
    status = 'loading';
    render();
    try {
      const data = await api('exp.list');
      entries = data.entries;
      categories = data.categories;
      status = 'ready';
    } catch (err) {
      status = 'error';
      $('#expBody').dataset.error = err.message;
    }
    render();
  }

  function totals() {
    const spent = entries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
    const collected = entries.filter(e => e.kind === 'collection').reduce((s, e) => s + e.amount, 0);
    const byCat = {};
    entries.filter(e => e.kind === 'expense').forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    return { spent, collected, byCat };
  }

  function render() {
    const box = $('#expBody');
    if (status === 'locked') {
      box.innerHTML = '<p class="py-6 text-center text-sm text-gray-700">Group accounts are visible to travellers only. <a class="underline font-semibold text-forest" href="#dashboard">Log in</a> to view them. Only faculty can add or change entries.</p>';
      return;
    }
    if (status !== 'ready') {
      box.innerHTML = status === 'error'
        ? `<p class="py-6 text-center text-sm text-gray-700">Could not load expenses: ${esc(box.dataset.error)}</p>`
        : '<div class="h-32 rounded-xl bg-forest/10 animate-pulse"></div>';
      return;
    }
    const t = totals();
    const maxCat = Math.max(1, ...Object.values(t.byCat));
    const sorted = entries.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    box.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-xl bg-ivory border border-forest/10 p-4"><p class="eyebrow">Total spent</p><p class="font-serif font-bold text-2xl text-forest">${rupees(t.spent)}</p></div>
        <div class="rounded-xl bg-ivory border border-forest/10 p-4"><p class="eyebrow">Collected</p><p class="font-serif font-bold text-2xl text-forest">${t.collected ? rupees(t.collected) : '—'}</p>${t.collected ? '' : '<p class="text-xs text-gray-600">No collections recorded</p>'}</div>
        <div class="rounded-xl bg-ivory border border-forest/10 p-4"><p class="eyebrow">Balance</p><p class="font-serif font-bold text-2xl ${t.collected - t.spent < 0 ? 'text-rose-800' : 'text-forest'}">${t.collected ? rupees(t.collected - t.spent) : '—'}</p>${t.collected ? '' : '<p class="text-xs text-gray-600">Needs collections to calculate</p>'}</div>
      </div>
      ${Object.keys(t.byCat).length ? `
      <h3 class="mt-5 font-sans text-sm font-bold uppercase tracking-wider">By category</h3>
      <ul class="mt-2 space-y-2">${Object.entries(t.byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `
        <li class="text-sm"><div class="flex justify-between"><span>${esc(c)}</span><span class="font-semibold">${rupees(v)}</span></div>
        <div class="h-2 rounded-full bg-forest/10 overflow-hidden mt-1"><div class="h-full bg-himalaya" style="width:${Math.round(v / maxCat * 100)}%"></div></div></li>`).join('')}
      </ul>` : ''}
      <h3 class="mt-5 font-sans text-sm font-bold uppercase tracking-wider">History</h3>
      ${sorted.length ? `<div class="mt-2 overflow-x-auto relative"><table class="w-full text-sm min-w-[560px]">
        <caption class="sr-only">Expense history</caption>
        <thead><tr class="text-left text-forest border-b border-forest/15"><th scope="col" class="py-2 pr-2">Date</th><th scope="col" class="py-2 pr-2">Description</th><th scope="col" class="py-2 pr-2">Category</th><th scope="col" class="py-2 pr-2 text-right">Amount</th><th scope="col" class="py-2"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody class="divide-y divide-forest/10">${sorted.map(e => `
          <tr>
            <td class="py-2 pr-2 whitespace-nowrap">${esc(fmtDate(e.date))}</td>
            <td class="py-2 pr-2">${esc(e.description)}<div class="text-xs text-gray-600">Recorded by ${esc(e.recordedBy)}</div></td>
            <td class="py-2 pr-2">${e.kind === 'collection' ? '<span class="chip bg-emerald-100 text-emerald-900">Collection</span>' : esc(e.category)}</td>
            <td class="py-2 pr-2 text-right font-semibold whitespace-nowrap ${e.kind === 'collection' ? 'text-emerald-800' : ''}">${e.kind === 'collection' ? '+' : ''}${rupees(e.amount)}</td>
            <td class="py-2 whitespace-nowrap text-right">
              ${e.hasReceipt ? `<button type="button" class="btn-ghost btn-sm" data-receipt="${esc(e.id)}">Receipt</button>` : ''}
              ${isFaculty() ? `<button type="button" class="btn-ghost btn-sm" data-exp-edit="${esc(e.id)}">Edit</button><button type="button" class="btn-danger btn-sm" data-exp-delete="${esc(e.id)}">Delete</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="mt-2 text-sm text-gray-700">No entries recorded yet.</p>'}
    `;
  }

  function edit(id) {
    const e = entries.find(x => x.id === id) || { kind: 'expense', category: categories[0], date: todayIST() };
    openForm(id ? 'Edit entry' : 'Add entry', `
      <div><label class="label" for="fKind">Type</label><select id="fKind" class="field"><option value="expense" ${e.kind === 'expense' ? 'selected' : ''}>Expense (money spent)</option><option value="collection" ${e.kind === 'collection' ? 'selected' : ''}>Collection (money received)</option></select></div>
      <div><label class="label" for="fDesc">Description</label><input id="fDesc" class="field" maxlength="200" required value="${esc(e.description || '')}" /></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label" for="fAmt">Amount (₹)</label><input id="fAmt" type="number" inputmode="decimal" min="0.01" step="0.01" class="field" required value="${e.amount || ''}" /></div>
        <div><label class="label" for="fDate">Date</label><input id="fDate" type="date" class="field" required value="${esc(e.date)}" /></div>
      </div>
      <div><label class="label" for="fCat">Category (expenses)</label><select id="fCat" class="field">${categories.map(c => `<option ${c === e.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div><label class="label" for="fReceipt">Receipt photo (optional${e.hasReceipt ? ' — replaces the current one' : ''})</label><input id="fReceipt" type="file" accept="image/*,application/pdf" class="field" /></div>
      <p class="text-xs text-gray-600">Every add, edit and delete is recorded in the change log.</p>
    `, async () => {
      const file = $('#fReceipt').files[0];
      const data = await api('exp.save', {
        id: id || '',
        kind: $('#fKind').value,
        description: $('#fDesc').value,
        amount: Number($('#fAmt').value),
        date: $('#fDate').value,
        category: $('#fCat').value,
        receiptDataUrl: file ? await gallery.prepare(file, 1400) : ''
      });
      entries = data.entries;
      render();
      toast('Entry saved');
    });
  }

  async function remove(id) {
    const e = entries.find(x => x.id === id);
    if (!confirm(`Delete “${e.description}” (${rupees(e.amount)})? The deletion is recorded in the change log.`)) return;
    try {
      entries = (await api('exp.delete', { id })).entries;
      render();
      toast('Entry deleted');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function showReceipt(id) {
    try {
      const { dataUrl } = await api('exp.receipt', { id });
      const w = window.open();
      if (w) {
        w.document.title = 'Receipt';
        const el = w.document.createElement(dataUrl.startsWith('data:application/pdf') ? 'iframe' : 'img');
        el.src = dataUrl;
        el.style.cssText = 'max-width:100%;width:100%;height:100vh;border:0;object-fit:contain';
        w.document.body.style.margin = '0';
        w.document.body.appendChild(el);
      } else {
        toast('Allow pop-ups to view receipts.', 'error');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function showLog() {
    try {
      const { log } = await api('exp.log');
      const describe = j => { try { const x = JSON.parse(j); return `${x.description} — ${rupees(x.amount)} (${x.category}, ${x.date})`; } catch (e) { return ''; } };
      openForm('Expense change log', log.length ? `<ol class="space-y-2 text-sm max-h-[50vh] overflow-y-auto">${log.map(l => `
        <li class="rounded-lg bg-ivory p-2"><strong>${esc(l.action)}</strong> by ${esc(l.by)} • ${fmtDateTime(Number(l.at))}
          ${l.before ? `<div class="text-xs text-gray-700">Before: ${esc(describe(l.before))}</div>` : ''}
          ${l.after ? `<div class="text-xs text-gray-700">After: ${esc(describe(l.after))}</div>` : ''}</li>`).join('')}</ol>` : '<p class="text-sm">No changes yet.</p>', async () => {}, 'Close');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function exportCsv() {
    const rows = [['Date', 'Type', 'Description', 'Category', 'Amount (INR)', 'Recorded by']]
      .concat(entries.map(e => [e.date, e.kind, e.description, e.category, e.amount, e.recordedBy]));
    // Leading = + - @ are neutralised so the file is safe to open in Excel
    const csv = rows.map(r => r.map(v => {
      let s = String(v);
      if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `packmate-expenses-${todayIST()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function bind() {
    $('#expAddBtn').addEventListener('click', () => edit(''));
    $('#expLogBtn').addEventListener('click', showLog);
    $('#expExportBtn').addEventListener('click', exportCsv);
    $('#expBody').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.expEdit) edit(b.dataset.expEdit);
      else if (b.dataset.expDelete) remove(b.dataset.expDelete);
      else if (b.dataset.receipt) showReceipt(b.dataset.receipt);
    });
  }

  return { bind, reset, load, totals: () => totals() };
})();

// ------------------------------------------------------------------ memory book

const TOUR_DAYS = [
  ['2026-11-17', 'Day 0 — Departure from Bandel Jn'],
  ['2026-11-18', 'Day 1 — NJP to Ravangla, Buddha Park'],
  ['2026-11-19', 'Day 2 — Namchi & on to Pelling'],
  ['2026-11-20', 'Day 3 — Pelling exploration'],
  ['2026-11-21', 'Day 4 — Return journey'],
  ['2026-11-22', 'Arrival at Sealdah']
];

const memory = (() => {
  let reflections = [];
  let status = 'idle';

  function reset() {
    reflections = [];
    status = session.me ? 'idle' : 'locked';
    $('#memPrintBtn').hidden = !session.me;
    render();
  }

  async function load() {
    if (!session.me || status === 'loading') return;
    status = 'loading';
    render();
    try {
      const [refl] = await Promise.all([api('refl.list'), gallery.getPhotos().length ? null : gallery.load()]);
      reflections = refl.reflections;
      status = 'ready';
    } catch (err) {
      status = 'error';
    }
    render();
  }

  function render() {
    const box = $('#memBody');
    if (status === 'locked') {
      box.innerHTML = '<p class="py-6 text-center text-sm text-gray-700">The memory book is private to travellers. <a class="underline font-semibold text-forest" href="#dashboard">Log in</a> to read and add to it.</p>';
      return;
    }
    if (status !== 'ready') {
      box.innerHTML = status === 'error' ? '<p class="text-sm text-gray-700">Could not load the memory book. Please try again later.</p>' : '<div class="h-32 rounded-xl bg-forest/10 animate-pulse"></div>';
      return;
    }
    const photos = gallery.getPhotos().filter(p => p.memoryBook && p.type === 'image');
    const mine = reflections.find(r => r.mine);
    const shared = reflections.filter(r => r.shared);
    const faculty = shared.filter(r => r.role === 'faculty');
    const students = shared.filter(r => r.role !== 'faculty');
    const dayBlocks = TOUR_DAYS.map(([d, title]) => [d, title, photos.filter(p => p.date === d)]).filter(b => b[2].length);
    const otherPhotos = photos.filter(p => !TOUR_DAYS.some(([d]) => d === p.date));

    const quote = r => `<blockquote class="rounded-xl bg-ivory border border-forest/10 p-4 print-break"><p class="text-sm whitespace-pre-line">“${esc(r.text)}”</p><footer class="mt-2 text-xs font-semibold text-forest">— ${esc(r.name)}</footer></blockquote>`;
    const photoGrid = list => `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">${list.map(p => `
      <figure class="print-break"><img src="${esc(p.url)}" alt="${esc(p.caption || 'Tour photo')}" referrerpolicy="no-referrer" class="w-full aspect-[4/3] object-cover rounded-lg" />
      <figcaption class="text-xs mt-1 text-gray-700">${esc(p.caption)}${p.tag ? ' • ' + esc(p.tag) : ''}</figcaption></figure>`).join('')}</div>`;

    box.innerHTML = `
      <div class="text-center py-4 print-break">
        <p class="eyebrow">Srikrishna College • Department of Computer Science</p>
        <p class="font-serif font-bold text-3xl text-forest mt-1">Our Himalayan Journey</p>
        <p class="text-sm text-gray-700">Sikkim Educational Tour • 17–22 November 2026 • Ravangla, Namchi &amp; Pelling</p>
      </div>

      <form id="reflForm" class="rounded-xl border border-forest/15 p-4 space-y-2 no-print">
        <label for="reflText" class="label">${mine ? 'Your reflection' : 'Add your reflection'} ${isFaculty() ? '(shown as a faculty message)' : ''}</label>
        <textarea id="reflText" class="field min-h-[90px]" maxlength="1000" placeholder="What will you remember most about this tour?">${esc(mine ? mine.text : '')}</textarea>
        <label class="flex items-center gap-2 text-sm"><input id="reflShared" type="checkbox" class="w-4 h-4 accent-forest" ${mine && mine.shared ? 'checked' : ''} /> Show my reflection in the memory book (otherwise only you and faculty can see it)</label>
        <div class="flex gap-2"><button type="submit" class="btn-primary btn-sm">Save reflection</button>${mine ? `<button type="button" class="btn-danger btn-sm" data-refl-delete="${esc(mine.id)}">Delete</button>` : ''}</div>
      </form>

      ${faculty.length ? `<h3 class="mt-6 font-serif font-bold text-xl text-forest">Messages from the faculty</h3><div class="mt-2 grid gap-2">${faculty.map(quote).join('')}</div>` : ''}
      ${dayBlocks.map(([d, title, list]) => `<h3 class="mt-6 font-serif font-bold text-xl text-forest">${esc(title)}</h3><p class="text-xs text-gray-600">${esc(fmtDate(d))}</p>${photoGrid(list)}`).join('')}
      ${otherPhotos.length ? `<h3 class="mt-6 font-serif font-bold text-xl text-forest">More memories</h3>${photoGrid(otherPhotos)}` : ''}
      ${students.length ? `<h3 class="mt-6 font-serif font-bold text-xl text-forest">Student reflections</h3><div class="mt-2 grid sm:grid-cols-2 gap-2">${students.map(quote).join('')}</div>` : ''}
      ${!photos.length && !shared.length ? '<p class="mt-4 text-sm text-gray-700">Nothing in the memory book yet. Photos appear here when the uploader ticks “Include in the Tour Memory Book”, and reflections when their author chooses to share them.</p>' : ''}
      ${isFaculty() ? `<p class="mt-4 text-xs text-gray-600 no-print">Faculty view: you can see unshared reflections in the list below; they are not printed.</p>
        ${reflections.filter(r => !r.shared).map(r => `<div class="mt-2 rounded-lg bg-gray-100 p-2 text-xs no-print"><strong>${esc(r.name)}</strong> (not shared): ${esc(r.text)} <button type="button" class="underline" data-refl-delete="${esc(r.id)}">Delete</button></div>`).join('')}` : ''}
    `;
  }

  function bind() {
    $('#memBody').addEventListener('submit', async e => {
      if (e.target.id !== 'reflForm') return;
      e.preventDefault();
      try {
        reflections = (await api('refl.save', { text: $('#reflText').value, shared: $('#reflShared').checked })).reflections;
        render();
        toast('Reflection saved');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    $('#memBody').addEventListener('click', async e => {
      const b = e.target.closest('[data-refl-delete]');
      if (!b || !confirm('Delete this reflection?')) return;
      try {
        reflections = (await api('refl.delete', { id: b.dataset.reflDelete })).reflections;
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  return { bind, reset, load };
})();

// ------------------------------------------------------------------ map

// Approximate coordinates; links search Google Maps by name for accurate directions
const PLACES = [
  { name: 'Bandel Jn (BDC)', lat: 22.919, lng: 88.383, kind: 'station', day: '17 Nov', text: 'Onward train 27575 departs 18:58.' },
  { name: 'New Jalpaiguri Jn (NJP)', lat: 26.683, lng: 88.442, kind: 'station', day: '18 Nov', text: 'Arrival 01:40, then road transfer to Ravangla.' },
  { name: 'Ravangla', lat: 27.305, lng: 88.364, kind: 'town', day: '18 Nov', text: 'Overnight stay (hotel to be announced).' },
  { name: 'Buddha Park (Tathagata Tsal), Ravangla', lat: 27.289, lng: 88.359, kind: 'sight', day: '18 Nov', text: '130-foot statue of Buddha.' },
  { name: 'Namchi', lat: 27.166, lng: 88.363, kind: 'town', day: '19 Nov', text: 'Morning visit en route to Pelling.' },
  { name: 'Char Dham, Namchi', lat: 27.147, lng: 88.350, kind: 'sight', day: '19 Nov', text: 'Pilgrimage complex near Namchi.' },
  { name: 'Samdruptse Hill, Namchi', lat: 27.183, lng: 88.377, kind: 'sight', day: '19 Nov', text: 'Hilltop statue of Guru Padmasambhava.' },
  { name: 'Pelling', lat: 27.300, lng: 88.238, kind: 'town', day: '19–21 Nov', text: 'West Sikkim base for sightseeing.' },
  { name: 'Pelling Skywalk', lat: 27.302, lng: 88.230, kind: 'sight', day: '19 Nov', text: 'Glass skywalk near Pelling.' },
  { name: 'Rabdentse Ruins', lat: 27.293, lng: 88.262, kind: 'sight', day: '19 Nov', text: 'Ruins of the former royal capital.' },
  { name: 'Kanchenjunga Falls', lat: 27.364, lng: 88.249, kind: 'sight', day: '20 Nov', text: 'Waterfall north of Pelling.' },
  { name: 'Falakata', lat: 26.523, lng: 89.204, kind: 'station', day: '21 Nov', text: 'Return train 13142 departs 12:55.' },
  { name: 'Sealdah', lat: 22.567, lng: 88.370, kind: 'station', day: '22 Nov', text: 'Arrival 03:35.' }
];

let mapInstance = null;
let mapBounds = {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function mapsLink(p) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + ', ' + (p.kind === 'station' ? 'railway station, India' : 'Sikkim'));
}

function renderPlaceList() {
  $('#placeList').innerHTML = PLACES.map(p => `
    <li class="rounded-lg bg-ivory border border-forest/10 px-3 py-2 flex items-center justify-between gap-2">
      <span><span class="font-semibold">${esc(p.name)}</span><span class="block text-xs text-gray-600">${esc(p.day)} • ${esc(p.text)}</span></span>
      <a class="btn-ghost btn-sm shrink-0" href="${mapsLink(p)}" target="_blank" rel="noopener" aria-label="Open ${esc(p.name)} in Google Maps">Maps ↗</a>
    </li>`).join('');
}

async function initMap() {
  if (mapInstance) return;
  const box = $('#mapCanvas');
  if (!navigator.onLine) {
    box.textContent = 'The map needs an internet connection. The list of places below still works offline.';
    return;
  }
  box.textContent = 'Loading map…';
  try {
    if (!document.querySelector('link[href$="leaflet.css"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'assets/vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
    }
    if (!window.L) await loadScript('assets/vendor/leaflet/leaflet.js');
  } catch (err) {
    box.textContent = 'The map could not be loaded. Use the Google Maps links below instead.';
    return;
  }
  box.textContent = '';
  box.classList.remove('flex', 'items-center', 'justify-center');
  const L = window.L;
  L.Icon.Default.imagePath = 'assets/vendor/leaflet/images/';
  mapInstance = L.map(box, { scrollWheelZoom: false, tap: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(mapInstance);
  const colour = { station: '#173F35', town: '#547C91', sight: '#7D5A16' };
  PLACES.forEach(p => {
    L.circleMarker([p.lat, p.lng], { radius: p.kind === 'sight' ? 7 : 9, color: '#fff', weight: 2, fillColor: colour[p.kind], fillOpacity: 1 })
      .addTo(mapInstance)
      .bindPopup(`<strong>${esc(p.name)}</strong><br>${esc(p.day)} — ${esc(p.text)}<br><em>Approximate location</em><br><a href="${mapsLink(p)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>`);
  });
  const pt = n => { const p = PLACES.find(x => x.name.startsWith(n)); return [p.lat, p.lng]; };
  L.polyline([pt('Bandel'), pt('New Jalpaiguri')], { color: '#173F35', weight: 4 }).addTo(mapInstance).bindTooltip('Train 27575 — booked');
  L.polyline([pt('Falakata'), pt('Sealdah')], { color: '#173F35', weight: 4 }).addTo(mapInstance).bindTooltip('Train 13142 — booked');
  L.polyline([pt('New Jalpaiguri'), pt('Ravangla'), pt('Namchi'), pt('Pelling'), pt('Falakata')], { color: '#7D5A16', weight: 3, dashArray: '8 8' })
    .addTo(mapInstance).bindTooltip('Road transfers — planned (straight-line sketch, not the actual road)');
  mapBounds.sikkim = L.latLngBounds(PLACES.filter(p => p.lat > 27).map(p => [p.lat, p.lng])).pad(0.15);
  mapBounds.route = L.latLngBounds(PLACES.map(p => [p.lat, p.lng])).pad(0.05);
  mapInstance.fitBounds(mapBounds.sikkim);
}

// ------------------------------------------------------------------ weather (Open-Meteo, no API key)

const WEATHER_PLACES = [
  { name: 'Ravangla', lat: 27.305, lng: 88.364 },
  { name: 'Namchi', lat: 27.166, lng: 88.363 },
  { name: 'Pelling', lat: 27.300, lng: 88.238 }
];
const WMO = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };

async function loadWeather() {
  const body = $('#weatherBody');
  const meta = $('#weatherMeta');
  const cached = store.getJSON('packmate_weather');
  body.innerHTML = '<div class="h-40 rounded-xl bg-forest/10 animate-pulse md:col-span-3"></div>';
  try {
    if (!navigator.onLine) throw new Error('offline');
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_PLACES.map(p => p.lat).join(',') +
      '&longitude=' + WEATHER_PLACES.map(p => p.lng).join(',') +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Asia%2FKolkata&forecast_days=7';
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let data = await res.json();
    if (!Array.isArray(data)) data = [data];
    if (data.length !== WEATHER_PLACES.length || !data[0].daily) throw new Error('unexpected response');
    const fetchedAt = Date.now();
    store.setJSON('packmate_weather', { data, fetchedAt });
    renderWeather(data, fetchedAt, false);
  } catch (err) {
    if (cached) {
      renderWeather(cached.data, cached.fetchedAt, true);
    } else {
      body.innerHTML = '<p class="md:col-span-3 text-sm text-gray-700">Weather is unavailable right now. Please try again later.</p>';
      meta.textContent = '';
    }
  }
}

function renderWeather(data, fetchedAt, stale) {
  $('#weatherBody').innerHTML = data.map((w, i) => `
    <div class="rounded-xl border border-forest/10 bg-ivory p-4">
      <h3 class="font-serif font-bold text-lg text-forest">${esc(WEATHER_PLACES[i].name)}</h3>
      ${w.current ? `<p class="mt-1"><span class="text-3xl font-bold">${Math.round(w.current.temperature_2m)}°C</span> <span class="text-sm text-gray-700">${esc(WMO[w.current.weather_code] || '')}</span></p>` : ''}
      <ul class="mt-3 space-y-1 text-sm">${w.daily.time.map((d, j) => `
        <li class="flex justify-between gap-2"><span>${new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })}</span>
        <span class="text-gray-700">${esc(WMO[w.daily.weather_code[j]] || '')}</span>
        <span class="font-semibold whitespace-nowrap">${Math.round(w.daily.temperature_2m_min[j])}–${Math.round(w.daily.temperature_2m_max[j])}°C</span>
        <span class="text-himalaya-dark whitespace-nowrap" title="Chance of rain">☂ ${w.daily.precipitation_probability_max[j] ?? '—'}%</span></li>`).join('')}
      </ul>
    </div>`).join('');
  $('#weatherMeta').textContent = `${stale ? 'Could not refresh — showing forecast saved' : 'Last updated'} ${fmtDateTime(fetchedAt)} IST.`;
}

// ------------------------------------------------------------------ page plumbing

function lazyLoadMemberSections() {
  if (!session.me) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      if (entry.target.id === 'gallery') gallery.load();
      if (entry.target.id === 'expenses') expenses.load();
      if (entry.target.id === 'memory') memory.load();
    });
  }, { rootMargin: '300px' });
  ['#gallery', '#expenses', '#memory'].forEach(s => io.observe($(s)));
}

function printSection(name) {
  if (name === 'itinerary') $$('#itinerary details').forEach(d => { d.open = true; });
  document.documentElement.dataset.print = name;
  window.print();
}

function bindPage() {
  const menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', () => {
    const open = $('#mobileNav').hidden;
    $('#mobileNav').hidden = !open;
    menuBtn.setAttribute('aria-expanded', open);
  });
  $('#mobileNav').addEventListener('click', e => {
    if (e.target.closest('a')) { $('#mobileNav').hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  });

  $$('[data-print-section]').forEach(b => b.addEventListener('click', () => printSection(b.dataset.printSection)));
  window.addEventListener('afterprint', () => { delete document.documentElement.dataset.print; });
  $$('[data-expand]').forEach(b => b.addEventListener('click', () => {
    const all = $$(`#${b.dataset.expand} details`);
    const open = all.some(d => !d.open);
    all.forEach(d => { d.open = open; });
    b.textContent = open ? 'Collapse all' : 'Expand all';
  }));

  // Dialog close buttons and click-outside
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => {
      if (e.target.closest('[data-close]') || e.target === d) d.close();
    });
  });
  $('#formDialogForm').addEventListener('submit', submitFormDialog);

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#accessCode').value;
    $('#loginError').textContent = '';
    if (code.replace(/[^a-z0-9]/gi, '').length < 6) {
      $('#loginError').textContent = 'Please enter your full access code.';
      return;
    }
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      await login(code, $('#rememberMe').checked);
      $('#accessCode').value = '';
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Open my dashboard';
    }
  });
  $('#logoutBtn').addEventListener('click', () => {
    if (confirm('Log out on this device? Your ticket details saved here for offline use will be removed. Your checklist stays synced to your account.')) logout(false);
  });
  $('#dashContent').addEventListener('click', e => { if (e.target.id === 'rosterLoad') loadRoster(); });

  $('#annNewBtn').addEventListener('click', () => editAnnouncement(''));
  $('#annList').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && b.dataset.annEdit) editAnnouncement(b.dataset.annEdit);
    if (b && b.dataset.annDelete) deleteAnnouncement(b.dataset.annDelete);
  });

  $$('[data-map-view]').forEach(b => b.addEventListener('click', async () => {
    await initMap();
    if (mapInstance) mapInstance.fitBounds(mapBounds[b.dataset.mapView]);
  }));
  $('#weatherRefresh').addEventListener('click', loadWeather);

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      if (entry.target.id === 'map') initMap();
      if (entry.target.id === 'weather') loadWeather();
    });
  }, { rootMargin: '200px' });
  io.observe($('#map'));
  io.observe($('#weather'));

  const updateOnline = () => { $('#offlineBanner').hidden = navigator.onLine; };
  window.addEventListener('online', () => { updateOnline(); loadAnnouncements(); });
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

function start() {
  loadSession();
  bindPage();
  checklist.bind();
  gallery.bind();
  expenses.bind();
  memory.bind();
  renderPlaceList();
  renderCountdown();
  setInterval(renderCountdown, 1000);
  afterAuthChange();

  // Refresh the member's details quietly (e.g. berth changes made by faculty)
  if (session.code && navigator.onLine) {
    api('login').then(d => { session.me = d.me; saveSession(!!store.get(SESSION_KEY)); renderDashboard(); }).catch(() => {});
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', start);
