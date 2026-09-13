# Betal design system

The product already has a palette. This document is the rulebook so onboarding — and
everything after it — cannot invent a second look.

The living proof is **`/betal/snid`** (staff only). A new control is illegal until it
renders there in rest, hover, focus, disabled and error. Tokens live in
[`app/src/styles/app.css`](../app/src/styles/app.css). Status colours are mapped only
in [`app/src/lib/status.ts`](../app/src/lib/status.ts).

## Surfaces

Navy, hue 284, chroma falling as lightness rises. Elevation is a background step,
not a drop shadow.

| Token | Role |
|---|---|
| `--color-surface-0` | App and wizard background |
| `--color-surface-1` | Sidebar, rail, cards, settings groups |
| `--color-surface-2` | Hover, inputs |
| `--color-surface-3` | Selected row, current step, selected choice card |
| `--color-surface-4` | Popovers, modals |
| `--color-line` / `--color-line-strong` | Hairlines |

There is no light theme.

## Ink

| Token | Role |
|---|---|
| `--color-ink` | Primary reading, amounts, current step |
| `--color-ink-secondary` | Body, row text |
| `--color-ink-muted` | Labels, hints, meta |
| `--color-ink-faint` | Counts, timestamps, "Goymt" |

## Lime, once

`--color-accent` (`#7AD966` / `oklch(0.801 0.177 140.2)`) is used **once per screen**:

- the primary button
- the `:focus-visible` ring (already global)
- completed ticks (step, checklist, requirement)
- the active nav icon

It is not a fill for cards, banners, rails, or selected rows. A selected
`.choice-card` is `surface-3` plus a lime **hairline**. A current wizard step is ink
on `surface-3`, not a lime bar.

## Type

| Face | Where |
|---|---|
| Inter (variable) + `tnum` | The interface, and **every number** |
| Poppins Light / Bold | Brand only — wordmark-adjacent display |

Wizard labels, field text, step names and amounts are Inter. Poppins does not appear
on a form.

## Status

Payments and operations have more states than three brand colours. Components never
pick a red or amber ad hoc. They take a `StatusDescriptor` from `status.ts`.

Onboarding states reuse those tones. They do not add hues.

| Application state | Tone | Label |
|---|---|---|
| `draft` | pending | Uppskot |
| `screening` | processing | Skoðan |
| `collecting` | paused | Skjøl vantar |
| `signing` | processing | Undirskriva |
| `pack_ready` | success | Pakkin er tilbúgvin |
| `submitted` | processing | Sent |
| `approved` | success | Góðkent |
| `rejected` | failed | Avvíst |
| `routed` | refunded | Flutt |

`collecting` and `routed` are aliases of existing tones, not new colours.

## Wizard chrome

`.wizard` / `.wizard-main` / `.wizard-foot` — dedicated document, no app sidebar and
no permanent step rail. Like Revolut Business, one task sits in a centered column;
the header carries quiet `3/8 · Eigarar` progress and the portal checklist is the
overview. The fixed footer lines up with the form instead of spanning an empty canvas.

Astro wrappers: `WizardLayout`, `StepNav`, `Field`, `ChoiceCard`, `YesNo`, `Dropzone`,
`Checklist`. Pages do not paste inline label styles. Binary KYB questions use `YesNo`,
not a pair of full-height choice cards. Long industry catalogues stay behind
“Onnur vinnugrein” — the three common Faroese verticals stay on the first screen.

## Hard rules

1. One focus treatment: `:focus-visible` → accent ring.
2. One primary button per screen.
3. Every number is Inter + `tnum`.
4. Status colour only through `StatusTone`.
5. No new hues, no light theme, no Poppins on labels.
