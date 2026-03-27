# Risved Design Tokens

Extracted from risved.com stylesheets. The product dashboard should use the same visual language.

## Colours

### CSS variables

```css
:root {
  --color-bg: #ece4df;
  --color-text: #2d1606;
  --color-shadow: #000;
  --color-purple-bg: #c6a7dc;
  --color-purple-text: #1d062d;
  --color-green-bg: #c3d392;
  --color-green-text: #232d06;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #201813;
    --color-text: #f9e1d2;
    --color-purple-bg: #38194d;
    --color-purple-text: #c6a7dc;
    --color-green-bg: #303913;
    --color-green-text: #c3d392;
    /* --color-shadow stays #000 */
  }
}
```

### Colour roles

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--color-bg` | `#ece4df` | `#201813` | Page background |
| `--color-text` | `#2d1606` | `#f9e1d2` | Primary text |
| `--color-shadow` | `#000` | `#000` | Drop shadows (constant in both modes) |
| `--color-purple-bg` | `#c6a7dc` | `#38194d` | Self-hosted card background |
| `--color-purple-text` | `#1d062d` | `#c6a7dc` | Self-hosted card text |
| `--color-green-bg` | `#c3d392` | `#303913` | Cloud card background |
| `--color-green-text` | `#232d06` | `#c3d392` | Cloud card text |

### Derived colours (not variables, computed inline)

| Pattern | Usage |
|---|---|
| `color-mix(in srgb, currentColor 15%, transparent)` | Borders, dividers, table row lines |
| `color-mix(in srgb, currentColor 25%, transparent)` | Code block background, inline code background |
| `color-mix(in srgb, currentColor 10%, transparent)` | Pricing card background |
| `color-mix(in srgb, var(--color-text) 75%, var(--color-bg))` | CTA button background |
| `color-mix(in srgb, var(--color-text) 50%, var(--color-bg))` | CTA button hover |

### Opacity levels

| Value | Usage |
|---|---|
| `0.75` | Body text (p, ul, ol), card descriptions, footer links |
| `0.5` | Kicker labels, footer column headings, nav links, small print |
| `0.25` | Card divider (hr) |

## Typography

### Font stacks

```css
--font-heading: 'BBH Hegarty', sans-serif;
--font-body: 'Mozilla Text', system-ui, sans-serif;
--font-mono: 'Cascadia Code', monospace;
```

### Fontsource packages

Install via `bun add` and import the specific weights:

```js
import '@fontsource/bbh-hegarty/400.css'
import '@fontsource/mozilla-text/500.css'
import '@fontsource/mozilla-text/700.css'
import '@fontsource/cascadia-code/400.css'
```

### Type scale

Base: `font-size: 14px` on `:root`.

| Element | Font | Size | Weight | Line-height | Margin |
|---|---|---|---|---|---|
| body | `--font-body` | 1rem (14px) | 500 | 1.5 | — |
| h1 | `--font-heading` | 3rem (42px) | 400 | 1 | 4rem 0 1rem |
| h1 (≥48rem viewport) | `--font-heading` | 4rem (56px) | 400 | 1 | 4rem 0 1rem |
| h2 | `--font-heading` | 2rem (28px) | 400 | 1 | 3rem 0 1rem |
| h3 | `--font-heading` | 1.5rem (21px) | 400 | 1 | 2rem 0 0.75rem |
| Hero h1 | `--font-heading` | 4rem (56px) | 400 | 1 | 4rem 0 1rem |
| Hero h1 (≥48rem) | `--font-heading` | 6rem (84px) | 400 | 1 | 4rem 0 1rem |
| Section h2 | `--font-heading` | 3rem (42px) | 400 | 1 | 0 0 2rem |
| p, ul, ol | `--font-body` | 1.25rem (17.5px) | 500 | 1.5 | 0 0 1.5rem |
| Lead paragraph | `--font-body` | 1.5rem (21px) | 500 | 1.5 | 0 0 1.5rem |
| strong | `--font-body` | inherit | 700 | inherit | — |
| code (inline) | `--font-mono` | 0.94444444em | 400 | inherit | — |
| code (block) | `--font-mono` | 1.21428571em | 400 | inherit | — |
| kicker/label | `--font-body` | 1.25rem (17.5px) | 700 | inherit | 0 0 0.5rem |
| footer column heading | `--font-body` | 0.875rem (12.25px) | 700 | 1 | 0 0 0.75rem |
| small print | `--font-body` | 0.875rem (12.25px) | 500 | 1.5 | — |
| price | `--font-heading` | 3rem (42px) | 400 | 1 | 0 0 1rem |

### Text styles

- Kickers/labels: `text-transform: uppercase`, `letter-spacing: 0.05em`, `opacity: 0.5`
- Body text: `opacity: 0.75`, `max-width: 48rem`
- Lead paragraph: same as body but `font-size: 1.5rem`
- Links: `color: inherit`, `text-decoration: none`
- Links hover: `text-decoration: underline`, `text-decoration-thickness: 2px`, `text-decoration-color: color-mix(in srgb, currentColor 25%, transparent)`, `text-underline-offset: 0.1em`

## Layout

| Token | Value |
|---|---|
| Content width | `width: min(80rem, 90vw)` |
| Content centering | `margin: 0 auto` |
| Body text max-width | `48rem` |
| Breakpoint | `48rem` (768px) |

## Spacing

| Value | Usage |
|---|---|
| `0.25rem` (3.5px) | CTA button vertical padding |
| `0.4rem` (5.6px) | Footer list item margin-bottom |
| `0.5rem` (7px) | CTA button horizontal padding, card h2 margin-bottom (0.5em), kicker margin-bottom, list item margin-bottom |
| `0.75rem` (10.5px) | Footer column heading margin-bottom, icon box gap |
| `1rem` (14px) | Nav gap, h3 to next element, back-link to h1 gap |
| `1.3rem` (18.2px) | Header vertical padding |
| `1.5rem` (21px) | Paragraph margin-bottom, code block padding (horizontal), list padding-left, footer column heading group gap, plan card gap |
| `2rem` (28px) | Card padding, card gap, card description margin-bottom, card CTA padding-top, section h2 margin-bottom, footer column grid gap, footer small-print padding-bottom |
| `4rem` (56px) | Section vertical spacing (h1 margin-top, hero margin-bottom, card section margin-bottom, content padding-bottom, footer cta margin-bottom) |
| `6rem` (84px) | Footer top padding |

## Radii

| Element | Radius |
|---|---|
| Cards (accent, pricing, plan) | `12px` |
| CTA button | `6px` |
| Code block | `8px` |
| Inline code | `4px` |

## Accent cards

Self-hosted (purple) and Cloud (green) cards. Each sets background and text from the colour variables. Dark mode inverts automatically via the CSS variables.

```css
.self-hosted {
  background-color: var(--color-purple-bg);
  color: var(--color-purple-text);
}

.cloud {
  background-color: var(--color-green-bg);
  color: var(--color-green-text);
}
```

Card structure:
- `border-radius: 12px`
- `padding: 2rem`
- `flex: 1 1 16rem` (two cards side by side, wrap on narrow screens)
- `gap: 2rem` between cards
- Card h2: `font-size: 2rem`, `margin: 0 0 0.5em`
- Card p: `font-size: 1.25rem`, `opacity: 0.75`, `margin: 0 0 2rem`
- Card hr: `border-top: 1px solid currentColor`, `opacity: 0.25`
- Card CTA link: `font-size: 1.25rem`, `padding: 2rem 0 0`

## Pricing cards

Same structure as accent cards but with neutral background:

```css
background-color: color-mix(in srgb, currentColor 10%, transparent);
```

## CTA button (header)

```css
font-size: 1rem;
font-weight: 700;
padding: 0.25rem 0.5rem;
border-radius: 6px;
background: color-mix(in srgb, var(--color-text) 75%, var(--color-bg));
color: var(--color-bg);
```

Hover: `background: color-mix(in srgb, var(--color-text) 50%, var(--color-bg))`

## Conventions

- Dark mode follows `prefers-color-scheme: dark`, no manual toggle
- `<meta name="color-scheme" content="light dark">` in `<head>` (required for SVG media queries in `<img>` tags)
- Muted text uses `opacity` rather than separate colour tokens
- No Tailwind CSS
- Semantic HTML (`article`, `section`, `aside`, `nav`) over generic `div`
