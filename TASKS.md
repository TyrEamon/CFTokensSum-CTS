# NewAPI Console Replica Tasks

## Goal

Build a standalone React/Vite web console inspired by `D:\Desktop\new-api` `/console`.

The result should look and behave like a compact NewAPI-style admin dashboard, but only keep the modules needed for CLIProxy/API usage analysis and model pricing management.

## Scope

- Keep:
  - Data dashboard
  - Usage logs
  - Model analytics
  - Model management and pricing
- Remove:
  - Token management
  - User ranking
  - Personal center
  - Wallet/top-up flows

## Pages

1. Data Dashboard
   - Greeting header
   - Account data card
   - Usage statistics card
   - Resource consumption card
   - Performance metrics card
   - Model data analytics chart with tabs
   - API information empty panel

2. Usage Logs
   - Search, provider, status, model filters
   - Dense log table
   - Token and cost columns

3. Model Management
   - Import models from local `/model`
   - Import models from JSON file
   - Paste JSON manually
   - Normalize common JSON formats
   - Edit model name, provider, group/tag, status
   - Edit input/output/cache price
   - Show pricing preview and estimated cost
   - Persist models in localStorage

## Data Assumptions

- Dashboard can run with demo data when no backend exists.
- `/model` import accepts common formats:
  - Array of strings
  - Array of objects with `id`, `name`, or `model`
  - OpenAI-style `{ data: [{ id: "..." }] }`
  - Object map `{ "model-name": {...} }`
- Prices are stored per 1M tokens.
- UI is deployed as a static Cloudflare front end; it does not add component-library load to the Galaxy CLIProxy container.

## Implementation Plan

- [x] Create project directory
- [x] Record this task file
- [x] Create `DESIGN.md`
- [x] Confirm NewAPI classic stack: React 18, Vite, VChart
- [x] Build Vite `index.html`
- [x] Build React dashboard in `src/main.jsx`
- [x] Build `src/styles.css`
- [x] Add VChart chart animations
- [x] Add model import normalization
- [x] Add localStorage persistence
- [x] Add responsive layout
- [x] Install dependencies
- [x] Run production build
- [x] Start local preview server
- [x] Verify dashboard screenshot
- [x] Clean temporary files before final handoff

## Reference Files

- `D:\Desktop\new-api\web\classic\src\components\dashboard\StatsCards.jsx`
- `D:\Desktop\new-api\web\classic\src\components\dashboard\ChartsPanel.jsx`
- `D:\Desktop\new-api\web\classic\src\components\dashboard\DashboardHeader.jsx`
- `D:\Desktop\new-api\web\classic\src\hooks\dashboard\useDashboardCharts.jsx`
- `D:\Desktop\new-api\web\classic\src\hooks\dashboard\useDashboardStats.jsx`
