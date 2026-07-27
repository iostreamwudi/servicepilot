# ServicePilot — Dark Data Intelligence

## Direction

Enterprise data intelligence console for high-density resource and permission operations. The interface uses graphite navy surfaces, cold cyan-blue accents, precise borders, restrained ambient light, and tabular data typography.

## Semantic tokens

- Canvas: `#07111f`
- Surface 1: `#0b1727`
- Surface 2: `#101e31`
- Elevated: `#14253a`
- Primary text: `#e7eef8`
- Secondary text: `#91a2b8`
- Border: `rgba(133, 168, 206, 0.16)`
- Border strong: `rgba(92, 184, 255, 0.32)`
- Brand: `#4db8ff`
- Brand strong: `#25d1e9`
- Success: `#4cd6a0`
- Warning: `#e9b66b`
- Danger: `#ff7f8e`

Light mode maps the same semantic roles to cool white and slate surfaces; component code must never hardcode theme-specific colors.

## Type and density

- UI: Geist, PingFang SC, Microsoft YaHei.
- Data/code: Geist Mono with tabular figures.
- Body text: 13–14px; labels: 11–12px; page titles: 24–28px.
- Spacing follows a 4/8px rhythm. Dense workbench panels use 12–20px internal padding.

## Surfaces

Primary workbench panels use a 1px cold border, subtle inner highlight, and one tinted shadow. Avoid stacked card shadows. The selected critical metric may use the only continuous border accent on screen.

## Motion

- Micro feedback: 160ms
- State changes: 220ms
- Panels/content: 320ms
- Decorative loop: 10s minimum
- Hover translation: at most 2px
- Entry translation: at most 10px
- Animate only transform and opacity. Disable decorative and blur motion under `prefers-reduced-motion`.

## Permission semantics

Permissions apply only to named individuals. View and modify are distinct. Modify implies view. Direct configuration overrides inherited permissions. Inherited controls remain read-only until explicitly converted to direct configuration. Conflicts require a textual explanation; color alone is insufficient.
