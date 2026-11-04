# Money Tracker

A lightweight, mobile-first personal money tracker for Philippine peso balances across BDO, BPI, GCash, GoTyme, MariBank, OwnBank, RCBC, Wise, and On-hand cash.

Built with semantic HTML, vanilla CSS, native JavaScript modules, IndexedDB and Bootstrap 5.3.8 CSS from the official CDN. No frameworks, bundlers, runtime packages, or external data services.

## Run locally

Serve the repository with a static HTTP server (for example, `python3 -m http.server 8000`) and open `http://localhost:8000` in a modern browser. Serving over HTTP/HTTPS is necessary for service workers and reliable module loading. It can be hosted on any static HTTPS site, including GitHub Pages.

## Features

- Dashboard with total holdings, current-month cash-in and cash-out totals, alphabetically sorted bank balances, and On-hand cash.
- Header-free screens with a bottom navigation that hides when scrolling down and reappears when scrolling up.
- Direction-aware page transitions: new detail screens slide in from the right, while returning to a shallower screen slides the current screen out to the right. Animations respect reduced-motion preferences.
- Click any dashboard balance or summary to see transaction details.
- **Settings → Initialize → Banks** to set each bank balance, and **Settings → Initialize → On-hand** for physical cash.
- Cash-in/cash-out forms with source, amount, and date (today by default).
- Atomic IndexedDB account/transaction writes. Cash-out cannot exceed the selected source balance.
- Ledger sorted by transaction date (newest first), including traceable initialization or correction adjustments.
- Local-first data persistence and a service worker that caches core application files after the first successful visit. Bootstrap styling comes from its CDN when online; custom CSS provides usable offline styling.

## Data model

IndexedDB database `money-tracker` uses `accounts` and `transactions` stores. Money is stored as integer **centavos**, not floating-point pesos. Initialization entries are recorded as balance adjustments, excluded from monthly cash-in and cash-out totals. The monthly totals use the recorded transaction **date** in the browser's local calendar.

Everything is stored on your device in your browser profile. Private or incognito browsing, clearing site data, or browser storage eviction may remove records. The application does not sync across devices.

## Project structure

- `index.html` — application shell.
- `css/styles.css` — mobile-first interface and Bootstrap fallbacks.
- `js/db.js` — IndexedDB access and transactional balance rules.
- `js/app.js` — navigation, rendering, forms, and UI events.
- `sw.js` — offline app-shell caching.
- `manifest.webmanifest` and `icons/icon.svg` — installable app metadata and icon.

Inspired by the mobile-first palette and card style of the [Bulsa Wallet reference project](https://github.com/jayrodgalaus/bulsawallet); no source code or additional libraries from that project are included.
