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

## Cloudflare Pages

Use **Cloudflare Dashboard -> Workers & Pages -> Pages -> Create application -> Connect to Git**.

- Repository: `TyrEamon/CFTokensSum-CTS`
- Framework preset: `Vite`
- Root directory: leave empty
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `22` is fine; `18+` also works

No runtime environment variables are required for the static dashboard.

## What It Uses

- React 18
- Vite
- `@visactor/react-vchart` for NewAPI-like animated charts
- `lucide-react` icons
- Local CSS for the dark console shell

## Model Import

The Model Management page supports:

- Fetching your own `/model` or `/models` endpoint
- JSON file import
- Paste JSON import
- Manual model creation
- Local price editing

Prices are stored per 1M tokens in `localStorage`.

## Login Behavior

- Public visitors can only see the data dashboard.
- First login creates a local username/password in browser `localStorage`.
- Logged-in users can open model management, usage logs, and personal information.
- This is a front-end access gate only. For real public protection, put Cloudflare Access in front of the site.
