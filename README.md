# Portfolio Dashboard — Setup Guide

## What you got

| File | Purpose |
|---|---|
| `dashboard.html` | The admin panel (password-gated, add/edit/delete items, export) |
| `data.json` | The data file your live site reads. Starts empty. |
| `dynamic-loader.js` | Runs on every page load — fetches `data.json` and prepends new items into your existing Research and News sliders so newest appears first. |
| `script.js` | **Patched** — init now awaits the dynamic loader before building sliders. |
| `index.html` | **Patched** — loads `dynamic-loader.js` before `script.js`. |

## Files to copy into your repo

Replace your current `script.js` and `index.html`. Add the three new files (`dashboard.html`, `data.json`, `dynamic-loader.js`) at the same root level.

```
your-repo/
├── index.html          ← REPLACED
├── script.js           ← REPLACED
├── styles.css          (unchanged)
├── dashboard.html      ← NEW
├── data.json           ← NEW (empty arrays)
├── dynamic-loader.js   ← NEW
└── images/             (unchanged)
```

## Daily workflow — adding a new Research project or News item

1. **Open** `https://your-site.com/dashboard.html` (or open the file locally).
2. **Enter password** — the default is `bibek2026`. (Change it — see below.)
3. **Pick a tab** — Research or News.
4. **Fill the form** — title, description, optional link, upload image(s).
5. **Click "Add Item"** — it appears at the top of the list (newest first).
6. **Click "Export data.json"** — a `data.json` file downloads.
7. **Replace** the `data.json` file in your repo with the downloaded one.
8. **Commit & push** to GitHub. Live in seconds.

## How the "newest first" guarantee works

- The dashboard prepends every new item to the array (`unshift`).
- The loader prepends every loaded item into the slider's container.
- Result: dashboard items appear **before** the original hard-coded items, in the exact order you added them (most recent → oldest).

## Reordering existing items

Inside each item card on the dashboard, use the ↑ / ↓ buttons to manually move items. Then re-export `data.json`.

## Changing the password

The password is stored as a SHA-256 hash inside `dashboard.html`. To change it:

1. Open `dashboard.html` in your browser, log in once with `bibek2026`.
2. Open DevTools → Console.
3. Run: `sha256('your_new_password').then(h => console.log(h))`
4. Copy the printed hash.
5. Edit `dashboard.html`, find the line `const PASSWORD_HASH = '...'` and paste the new hash.
6. Also remove the line `|| pw === 'bibek2026'` (it's a setup-only fallback).
7. Save and commit.

## Importing existing items

If you ever want to migrate hard-coded slides from `index.html` into the dashboard system, click "Import" and pick a `data.json` you've shaped manually.

## Notes & limits

- Images are stored as base64 inside `data.json`. Keep individual images under ~500KB or `data.json` will balloon. For very large images, host them externally and paste the URL into the title field as part of your description (or extend the dashboard to accept URLs).
- The dashboard saves to `localStorage` automatically as you work, so you can come back later, edit, and export when ready.
- Password gate is **client-side** — anyone determined enough can read the file. It blocks casual visitors, not actual attackers. Don't put secrets in the dashboard.

## Troubleshooting

**New items don't appear on the live site?**
- Did you replace `data.json` in the repo (not just the dashboard's localStorage)?
- Hard-refresh the live site (Ctrl+Shift+R / Cmd+Shift+R).
- Check the browser console for fetch errors.

**Sliders look broken after adding items?**
- Make sure both `script.js` (patched) and `dynamic-loader.js` are deployed.
- Make sure `index.html` loads `dynamic-loader.js` BEFORE `script.js`.
