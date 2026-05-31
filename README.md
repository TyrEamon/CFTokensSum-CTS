# CFTokensSum CTS

React/Vite console inspired by `QuantumNous/new-api` `web/classic` `/console`.

## Run

```powershell
cd D:\Desktop\newapi-console-replica
npm install
npm run dev
```

Then visit the Vite URL, normally:

```text
http://127.0.0.1:5177/
```

## Cloudflare Worker + D1

This project is a full Cloudflare Worker app:

- Vite builds the static dashboard into `dist`
- Worker serves the dashboard assets
- Worker APIs read/write D1
- Worker Cron pulls CLIProxyAPI usage queue every 5 minutes

### Required Cloudflare setup

1. Create a D1 database, for example `cftokenssum-cts`.
2. Deploy this repo as a **Worker**, not a plain Pages-only static site.
3. In the Worker settings, add a D1 binding:

```text
Variable name: DB
D1 database: cftokenssum-cts
```

4. Add Worker runtime variables:

```text
CLIPROXY_BASE_URL=https://your-cliproxy-domain.example.com
USAGE_QUEUE_COUNT=500
CLIPROXY_MODELS_PATH=/v1/models
```

Optional auth variables if your CLIProxy management endpoint requires headers:

```text
CLIPROXY_API_KEY=your-token
CLIPROXY_AUTH_HEADER=X-Custom-Header: value
CLIPROXY_HEADERS_JSON={"X-Another-Header":"value"}
ADMIN_TOKEN=long-random-token
```

CLIProxyAPI must enable in-memory usage aggregation, otherwise `/v0/management/usage-queue?count=500` will have nothing useful to collect.

The Worker creates the D1 tables automatically on first API/cron run. The SQL is also kept in `migrations/0001_init.sql` for reference.

## What It Uses

- React 18
- Vite
- `@visactor/react-vchart` for NewAPI-like animated charts
- `lucide-react` icons
- Local CSS for the dark console shell

## Model Import

The Model Management page supports:

- Fetching CLIProxy `/v1/models` through the Worker endpoint `/api/cliproxy-models`
- Fetching your own direct model endpoint when needed
- JSON file import
- Paste JSON import
- Manual model creation
- Local price editing

Prices are configured per 1M tokens and saved to D1 through `/api/models`. If the Worker or D1 API is unavailable, edits only live in the current page memory and are not persisted.

## Login Behavior

- Public visitors can only see the data dashboard.
- First login creates a username and PBKDF2 password hash in D1.
- Browser auth uses an HttpOnly `cts_session` cookie; username/password hashes are not stored in `localStorage`.
- Logged-in users can open model management, usage logs, and personal information.
- This is a front-end access gate only. For real public protection, put Cloudflare Access in front of the site.
