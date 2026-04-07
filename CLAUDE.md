# CLAUDE.md — Walletim Codebase Guide

## Project Overview

**Walletim** is a Hebrew-language Progressive Web App (PWA) for managing digital gift cards and vouchers. It is a **zero-dependency, zero-build-step** vanilla JavaScript application with optional GitHub Gist cloud sync.

- Single-page app with hash-based routing
- Fully offline-capable via Service Worker
- RTL (right-to-left) Hebrew UI
- No backend — localStorage for persistence, GitHub Gist API for optional sync

---

## Repository Structure

```
/
├── index.html      # All HTML screens and templates
├── app.js          # All application logic (~999 lines)
├── styles.css      # All styles with CSS variables
├── manifest.json   # PWA manifest (Hebrew, RTL, dark theme)
├── sw.js           # Service Worker (cache-first strategy)
└── icons/
    └── icon.svg    # Maskable app icon (SVG)
```

There is no `package.json`, no build tool, and no dependencies. All three main files (`index.html`, `app.js`, `styles.css`) are production-ready as-is.

---

## Development Workflow

### Starting a local server

```bash
python -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000/` in a browser.

### No build step

Edit files directly. Reload the browser. For Service Worker changes, use **DevTools → Application → Service Workers → "Update on reload"** or hard-refresh (Ctrl+Shift+R).

### Clearing cached state

Service Worker cache key: `walletim-v2`
localStorage keys: `walletim_cards`, `walletim_sync`

---

## Architecture

### App initialization (`app.js`)

The `init()` function is called on `DOMContentLoaded` and runs in sequence:

```
loadFromStorage()   → Load cards and sync config from localStorage
wireEvents()        → Attach all event listeners
handleRoute()       → Render the current screen based on URL hash
fetchAndMerge()     → Background sync from GitHub Gist (if configured)
registerServiceWorker() → Enable offline support
```

### Hash-based routing

All screens are driven by `window.location.hash`. `handleRoute()` parses the hash and calls the relevant render function.

| Hash            | Screen               | Render Function         |
|-----------------|----------------------|-------------------------|
| `#list`         | Voucher list (default) | `renderList()`        |
| `#card/:id`     | Voucher detail       | `renderDetail(id)`      |
| `#add`          | Add voucher form     | `renderForm(null)`      |
| `#edit/:id`     | Edit voucher form    | `renderForm(id)`        |
| `#settings`     | Settings / sync      | `renderSettings()`      |
| `#paste`        | Smart text paste     | `renderPaste()`         |

### State

Single `state` object in `app.js`:

```javascript
state = {
  cards: [],          // Array of voucher objects
  sync: {             // GitHub Gist sync config
    pat: '',          // Personal access token
    gistId: '',       // Gist ID
    lastSynced: null  // ISO timestamp
  },
  route: {            // Current screen
    screen: '',
    id: ''
  },
  extracted: []       // Pending cards from paste screen
}
```

### Data model (card object)

```javascript
{
  id: string,           // UUID or timestamp-based unique ID
  brandName: string,    // Voucher brand/store name
  cardNumber: string,   // Raw digits (formatted on display)
  expiry: string,       // "MM/YY"
  cvv: string,
  balance: number,      // Current balance in NIS
  notes: string,        // Optional free text
  link: string,         // Optional URL
  transactions: [       // Purchase history
    { id, amount, note, createdAt }
  ],
  createdAt: string,    // ISO 8601
  updatedAt: string     // ISO 8601 (used for sync conflict resolution)
}
```

---

## Key Conventions

### Code organization (`app.js` sections)

Sections are separated by ASCII divider comments:

```javascript
/* ─── A. Constants ─────────────────────────────────────── */
/* ─── B. State ─────────────────────────────────────────── */
/* ─── C. Storage Layer ──────────────────────────────────── */
/* ─── D. Router ─────────────────────────────────────────── */
/* ─── E. UI Helpers ─────────────────────────────────────── */
/* ... F through K: screen renderers and event handlers ... */
/* ─── L. Bootstrap ──────────────────────────────────────── */
```

Keep new logic in the appropriate section. Do not intermix concerns.

### Naming conventions

- `camelCase` for all variables and functions
- `UPPER_SNAKE_CASE` for constants (e.g., `LS_CARDS`, `GIST_API`, `SYNC_DEBOUNCE`)

### Security

- Always use `escapeHtml(str)` before injecting any user-provided text into `innerHTML`
- Never build HTML strings with unescaped user input
- GitHub PAT is stored in localStorage and sent only to `api.github.com`

### CSS conventions

- Design tokens as CSS variables: `--color-*`, `--space-*`, `--radius-*`, `--font-*`
- BEM-inspired class names: `.voucher-card__field`, `.card-list-item`
- State classes: `.hidden`, `.show`, `.copied`, `.error`, `.syncing`, `.synced`
- Button classes: `.primary-btn`, `.secondary-btn`, `.danger-btn`
- Use `font-size: 16px` on all inputs — prevents iOS auto-zoom

### RTL / Hebrew

- The entire UI is `dir="rtl"` and `lang="he"`
- Numeric fields (card number, CVV, amount) must explicitly use `dir="ltr"`
- Format currency with `formatBalance()` which uses Hebrew locale (`he-IL`) and ₪

---

## Important Functions Reference

| Function | Purpose |
|---|---|
| `generateId()` | Create unique card/transaction ID |
| `escapeHtml(str)` | Sanitize user input before inserting into DOM |
| `formatCardNumber(raw)` | Format digits as `XXXX XXXX XXXX XXXX` |
| `maskCardNumber(formatted)` | Hide all but last 4 digits |
| `formatBalance(amount)` | Format as Hebrew locale currency (₪) |
| `formatDateTime(iso)` | Format timestamp to Hebrew locale string |
| `showToast(msg)` | Display auto-dismissing notification |
| `copyToClipboard(text, btn)` | Copy text with visual confirmation |
| `parseVoucherText(text)` | Extract card fields from SMS/email text via regex |
| `mergeCards(remoteCards)` | Merge local and remote cards (last-write-wins by `updatedAt`) |
| `syncToGist()` | Write card data to GitHub Gist |
| `fetchAndMerge()` | Fetch Gist and merge with local state |
| `scheduleSyncDebounce()` | Debounce sync (2000ms) after any state mutation |
| `persistCards()` | Save `state.cards` to localStorage |
| `persistSync()` | Save `state.sync` to localStorage |
| `exportJSON()` | Download backup JSON file |
| `importJSON(e)` | Import and merge from JSON file |

---

## Service Worker

- Cache name: `walletim-v2` — increment this when deploying breaking changes
- Strategy: cache-first, falling back to network
- GitHub API (`api.github.com`) is explicitly excluded from caching
- On activation, old cache versions are deleted automatically
- An "Update Now" banner appears in-app when a new Service Worker is waiting

To force an update during development: DevTools → Application → Service Workers → click "skipWaiting" or "Update".

---

## GitHub Gist Sync

- User provides a GitHub PAT with `gist` scope via the Settings screen
- On first sync, a new private Gist named `walletim-backup.json` is created
- Gist ID is stored in `localStorage` and can be shared across devices
- Conflict resolution: last write wins, keyed on `card.updatedAt`
- Sync is debounced (2 seconds) after mutations; also triggered on page visibility restore

---

## Testing

No test framework is configured. Testing is manual:

1. Run locally with `python -m http.server 8000`
2. Test across Chrome, Safari (iOS), and Firefox
3. Test PWA install via browser's "Add to Home Screen"
4. Test offline by toggling DevTools → Network → "Offline"
5. Test Service Worker update by incrementing cache name and reloading
6. Test GitHub sync with a real PAT in a sandboxed Gist

---

## Deployment

No build step. Static file hosting only.

**To deploy:**
1. Copy `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`, `icons/` to any static host
2. Ensure HTTPS (required for Service Workers and PWA install)
3. No environment variables or server configuration needed

Compatible hosts: GitHub Pages, Vercel, Netlify, Cloudflare Pages.

---

## Git Conventions

- Branch naming: `claude/<feature>` for AI-assisted work
- Commit messages: imperative mood, clear scope (e.g., `fix: prevent XSS in notes field`)
- `main` is the production branch
