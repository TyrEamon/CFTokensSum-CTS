# NewAPI Console Replica Design

## Visual Theme & Atmosphere

Dark, dense, operational console inspired by NewAPI `/console`. The interface should feel like an admin cockpit: compact sidebar, strong greeting, rounded metric cards, low-contrast borders, neon chart accents, and high information density without becoming noisy.

## Color Palette & Roles

```css
--bg: #111216;
--sidebar: #111216;
--surface: #14151a;
--surface-2: #171922;
--surface-3: #202431;
--border: #282a33;
--border-soft: #20222a;
--text: #f8fafc;
--muted: #9ca3af;
--dim: #6b7280;
--blue: #3b82f6;
--cyan: #06b6d4;
--green: #31b853;
--yellow: #facc15;
--pink: #db2777;
--purple: #9333ea;
--orange: #f97316;
--danger: #ef4444;
```

## Typography Rules

- Use system UI with Chinese-capable fallback: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`.
- Use `tabular-nums` on all metrics and prices.
- Main greeting: 28px to 32px, strong weight.
- Card titles: 16px, strong weight.
- Tables and dense controls: 13px to 14px.
- No viewport-width font scaling.

## Component Stylings

- Sidebar:
  - Fixed desktop width around 205px.
  - Active item uses blue translucent pill background.
  - Section labels use small muted text.
- Cards:
  - 16px radius, 1px border, no heavy shadow.
  - Headers separated by subtle border.
  - Two KPI rows per card where useful.
- Icon circles:
  - 36px to 40px.
  - Functional colors only.
- Charts:
  - VChart rendering, dark gridlines, model color mapping, animated bar/line/pie transitions.
  - Tabs appear as slash-separated links like NewAPI.
- Tables:
  - Compact rows.
  - Sticky-ish visual header via muted surface.
  - Status chips with semantic colors.
- Modal:
  - Centered panel, dark overlay, JSON textarea, clear import actions.

## Layout Principles

- Desktop:
  - Sidebar + main content.
  - Four top metric cards in a 4-column grid.
  - Large chart panel plus right API information panel.
  - Lower grids for model pricing and logs.
- Tablet:
  - Sidebar becomes top horizontal rail.
  - Cards become 2-column.
- Mobile:
  - Single column.
  - Sidebar items wrap horizontally.
  - Tables scroll horizontally.

## Depth & Elevation

- Use border and background contrast instead of strong shadows.
- No decorative blobs, no bokeh, no marketing hero.
- Cards should feel embedded in a tool surface.

## Animation & Interaction

- NewAPI-like operational motion:
  - Page fade-in.
  - Card stagger entrance.
  - VChart grow/clip/radius chart appearance.
  - Count-up metric values.
  - Table/list row stagger.
  - Hover background/translate shifts.
  - Button refresh spin.
  - Modal overlay fade and panel scale.
- Respect `prefers-reduced-motion`.

## Do's And Don'ts

- Do match NewAPI's dark console density.
- Do keep all controls at least 44px touch target where clickable.
- Do make model import resilient to multiple JSON shapes.
- Do persist user-edited model prices locally.
- Do keep dashboard useful with demo data.
- Do use inline SVG icons, not emoji icons.
- Do avoid token/user-ranking/personal-center modules.
- Don't copy NewAPI source wholesale.
- Don't add landing-page sections.
- Don't use purple-blue gradient backgrounds.
- Don't use nested decorative cards.
- Don't expose secret/API keys in the UI.

## Responsive Behavior

- `>= 1200px`: full sidebar and 4-card dashboard.
- `768px - 1199px`: top card grid becomes 2 columns, chart/right panel stacks if needed.
- `< 768px`: sidebar becomes horizontal nav, all panels stack, tables get horizontal scroll.
