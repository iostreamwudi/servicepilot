# ServicePilot — Light Cloud Console

## Direction

ServicePilot uses a restrained, professional and information-dense enterprise cloud-console language. The system borrows interaction density and visual order from mature cloud products while retaining ServicePilot’s own identity, copy, icons and workflows.

## Foundations

- Application background: `#f7f8fb`
- Secondary navigation: `#f5f6fa`
- Primary surface: `#ffffff`
- Subtle surface: `#fafafe`
- Primary text: `#1f2329`
- Secondary text: `#4e5969`
- Tertiary text: `#86909c`
- Default border: `#e7e9ef`
- Strong border: `#d9dce5`
- Primary: `#665ce5`
- Primary hover: `#574dd8`
- Selected surface: `#f0efff`
- Success: `#00a870`
- Warning: `#ff7d00`
- Danger: `#f53f3f`

## Typography

Use legal local system fonts only: `PingFang SC`, `Microsoft YaHei`, Apple and Segoe UI fallbacks. Body and table text use 13px/20px at weight 400. Page titles use 16px/24px at weight 600. Section titles use 14px/22px at weight 600. Numeric data uses tabular figures.

## Density and geometry

Spacing follows a strict 4px base scale: 4, 8, 12, 16, 20, 24 and 32px. Default controls are 32px high. The global header is 48px. Secondary navigation is 160px wide. Buttons and inputs use 4px radius; containers use 4–6px radius. Cards do not cast shadows; hierarchy comes from borders and surface contrast.

## Interaction

Primary actions use a solid purple fill. Selected rows and menu items use a pale purple surface. Hover changes only color, background or border. State transitions last 100–180ms. No gradients, ambient glow, blur, decorative motion, scale or vertical hover movement. `prefers-reduced-motion` disables all non-essential transitions.

## Permission semantics

Permissions apply only to named individuals. View and modify are distinct, and modify implies view. Direct configuration overrides inherited permissions. Inherited permissions remain read-only until explicitly converted to direct configuration. Conflicts always include text; color alone is never the only signal.
