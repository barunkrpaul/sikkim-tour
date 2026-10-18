# PackMate — Srikrishna College Sikkim Tour 2026

Tour companion for the Computer Science Department's educational tour to Ravangla, Namchi and Pelling
(18–21 November 2026). Live site: https://barunkrpaul.github.io/sikkim-tour/

## How it is built

| Part | Where it runs | What it holds |
| --- | --- | --- |
| `index.html`, `assets/` | GitHub Pages (public) | Itinerary, emergency contacts, checklist, map, weather — **no personal data** |
| `backend/Code.gs` | Google Apps Script web app (your Google account) | Checks access codes and returns only what each person may see |
| "PackMate Data (PRIVATE)" spreadsheet | Your Google Drive (private) | Roster, PNRs, berths, phone numbers, access codes, checklists, announcements, expenses, reflections |
| "Sikkim Tour Photos" folder | Your Google Drive | Shared photos/PDFs (files are link-viewable; only logged-in travellers get the list) |
| "PackMate Receipts (private)" folder | Your Google Drive (created automatically, never shared) | Expense receipts |

No API keys or passwords are in this repository. The web-app URL in `assets/app.js` is not a secret —
every private action is checked on Google's servers against the traveller's access code.

## Access codes

Each traveller has a personal code in the `accessCode` column of the private spreadsheet.

* Send each person **only their own code** (e.g. a private WhatsApp message). Don't post the list in a group.
* Students see only their own ticket and berth. Faculty (role contains "Faculty") see the full roster and
  can manage announcements and expenses.
* To block someone, type `no` in their `active` column. To issue a new code, edit their `accessCode`.
* After 40 wrong codes in 10 minutes, logins pause for 10 minutes (brute-force protection).

## Updating the backend (after changing `backend/Code.gs`)

1. Open your project at https://script.google.com and replace all code with `backend/Code.gs`. Save.
2. Choose the `setup` function in the toolbar and click **Run** once (approve the new permissions:
   Sheets, Drive). It creates the extra tabs and checks the roster.
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
   Keep *Execute as: Me* and *Who has access: Anyone*. The URL stays the same.

## Updating the website

Upload the changed files to the repository (Add file → Upload files, or `git push`).
GitHub Pages republishes within a minute or two.

If you add new Tailwind classes to `index.html` or `assets/app.js`, rebuild the stylesheet:

```
npm install
npm run build:css
```

If you change the itinerary, regenerate `itinerary.pdf` (open the site → Itinerary → Print → Save as PDF)
and bump `CACHE` in `sw.js` (e.g. `packmate-v2`) so phones fetch the new files.

## Offline use

The site installs a service worker that keeps the public pages — itinerary, emergency contacts, checklist —
available without a connection. A logged-in traveller's own ticket details are kept on their own device.
Announcements, weather, photos and expenses need a connection; when offline the page says so and shows the
time of the last saved copy.

## Third-party services

* Google Apps Script / Drive / Sheets — free with a Google account.
* OpenStreetMap tiles (map) and Open-Meteo (weather) — free, no key, called from the visitor's browser.
* Google Fonts (Inter, Playfair Display).
