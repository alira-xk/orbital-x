---
version: alpha
name: "ORBITAL-X"
description: "A dense, telemetry-first spacecraft mission-control interface shaped by flight displays and orbital plotting instruments."
colors:
  void: "#101315"
  background: "#101315"
  surface: "#161A1D"
  surfaceRaised: "#20262A"
  border: "#394249"
  text: "#F1F0EB"
  textMuted: "#B4BEC5"
  textDim: "#929FA8"
  signal: "#9EBED6"
  orbit: "#D7DEE3"
  nominal: "#8FC7AD"
  warning: "#E5BA78"
  high: "#E5A27B"
  critical: "#ED9690"
typography:
  interface:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
  telemetry:
    fontFamily: "IBM Plex Mono, Cascadia Mono, Consolas, monospace"
rounded:
  DEFAULT: "0.375rem"
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.75rem"
spacing:
  control: "0.25rem"
  panel: "1rem"
  section: "1.5rem"
  page: "1.5rem"
components:
  panel:
    radius: "0.375rem"
    border: "#394249"
  button:
    radius: "0.375rem"
  chart:
    grid: "#2B3237"
    liveLine: "#9EBED6"
  status:
    nominal: "#8FC7AD"
    warning: "#E5BA78"
    critical: "#ED9690"
---

# ORBITAL-X Design System

## Overview

### Creative North Star

ORBITAL-X is an engineering flight-operations workspace inspired by the restraint of aerospace mission software, not a replica of NASA or SpaceX branding. Charcoal surfaces, warm white typography, quiet blue plots, and an asymmetrical mission overview establish the approved September 13 direction. No glow, fake instrument codes, fabricated health scores, or movie-HUD decoration.

### Product context and register

- **Audience and primary job:** Flight controllers and spacecraft engineers need to understand ORBITAL-X1's current state, recent behavior, and subsystem relationships quickly.
- **Target market and evidence:** English-language portfolio demonstration based on the project brief and `.claude/PROJECT_CONTEXT.md`; no region-specific behavior is required.
- **Locale and language policy:** English UI, UTC mission timestamps, locale-aware long timestamps only when they add clarity.
- **Usage scene:** Repeated desktop monitoring with occasional tablet and phone access; dense information is expected, but the primary hierarchy must survive narrow screens.
- **Register:** Product interface.
- **Memorable signature:** The orbital instrument—a telemetry-driven 3D Earth, orbit, trail, and spacecraft whose subsystem selection synchronizes the analytical charts.
- **Restraint:** Service health, range controls, cards, and labels stay quiet so the orbital instrument and abnormal data carry the emphasis.
- **Anti-references:** Avoid neon cyberpunk decoration, generic rounded SaaS cards, fake HUD reticles, glassmorphism blur, and ornamental scan lines. They reduce signal-to-noise and make the mission data feel simulated rather than operational.
- **Token ownership/runtime mapping:** Model B: `frontend/src/index.css` root variables own runtime colors and fonts. Tailwind aliases reference those variables rather than copying values. This file mirrors the accepted palette. `colors.background/void` map to `--bg-primary`, surface to `--bg-secondary`, surfaceRaised to `--bg-tertiary`, text roles to `--text-*`, signal to `--accent-blue`, and status roles to `--status-*`. Three.js materials and existing subsystem marker colors are scene-specific visualization values.

## Colors

The base moves from `void` through `background`, `surface`, and `surfaceRaised`; borders establish hierarchy without shadows. `signal` identifies selection and live data, while `orbit` is reserved for orbital geometry. Status colors are semantic and must always be paired with text or an icon. Analytical plots use the signal token; metric names and units distinguish series. Subsystem colors in the domain catalog remain available to the 3D selection markers, not as an application-wide rainbow.

## Typography

Locally bundled IBM Plex Sans/Segoe UI carries interface copy. IBM Plex Mono/Cascadia Mono carries telemetry, timestamps, coordinates, units, and abbreviated subsystem identifiers. Labels use concise sentence case or established spacecraft abbreviations; uppercase is limited to short instrument labels. Numeric output uses tabular figures.

## Layout

Desktop pairs a concise mission overview with the orbital trajectory, followed by subsystem navigation and full-width, two-column analytical charts. Below 900px subsystem controls form two rows; below 560px the overview and charts stack. Document scrolling remains natural, with no hidden panels or controls.

## Elevation & Depth

Hierarchy comes from tonal layers, border contrast, and the 3D scene itself. Static panels do not cast shadows. Selected controls use a solid light surface or an underline; no glow or blur.

## Shapes

Controls and panels use small, instrument-like radii. Status dots and orbital bodies are naturally circular. Avoid making every metric a pill; pills are reserved for connection and compact state indicators.

## Components

### Foundational visual states

Interactive controls have visible hover, pressed, selected, disabled, busy, and `focus-visible` states. Focus uses a high-contrast signal ring. Loading, empty, stale, disconnected, and error states reserve the same content footprint where practical. Reduced motion stops ambient rotation and animated transitions without removing current-state information.

### Buttons and actions

Range and subsystem selectors are native buttons with stable geometry. Primary selection uses signal color plus a shape/border change. Destructive intent is not part of Phase 4.

### Navigation and data display

The mission header shows identity, UTC, live connection, and the latest frame age. Subsystem buttons act as an accessible single-selection control. Charts provide textual current/min/max summaries so the canvas/SVG is not the only data representation. Service readiness remains available in a compact diagnostics panel.

### Forms and overlays

Phase 4 has no data-entry workflow or modal overlay. Tooltips supplement chart values and 3D subsystem markers, but essential state remains visible without hover.

Phase 7 extends incident detail with one bordered AI-investigation panel. It reuses existing incident action, status, error, typography, spacing, and responsive contracts; model confidence is always paired with text and retrieved evidence sources.

Phase 8 adds one incident-scoped recovery panel. Command selection uses a native select because platform popup behavior is accepted; authorization is stated in text and enforced by the backend. Risk, approval state, execution result, and critical two-person requirements remain visible without color or hover.

Phase 9 adds an incident-scoped recorded-operations panel. Its signature is the existing orbital instrument driven by historical frames, with a native scrubber and quiet chronological event rail. Replay remains visually and behaviorally distinct from live telemetry and never mutates mission state.

### Iconography

Lucide is canonical at 16–20px with consistent stroke width. Icons reinforce labels and never replace unfamiliar subsystem names.

### Motion

Motion communicates live telemetry: the spacecraft moves along its orbit, the trail advances, and charts accept new samples. Transitions are brief and interruptible. `prefers-reduced-motion` freezes ambient motion and removes nonessential easing.

### Content and data visualization

Earth uses locally bundled NASA Blue Marble geographic imagery, with restrained directional lighting and a thin atmospheric edge. Do not replace it with a wireframe or untextured abstract globe. The imagery and lighting are illustrative, not live weather or a current solar-position model. Attribution lives in `frontend/public/textures/README.md`.

Copy is terse, operational, and specific. Metric names and units come from the backend catalog. Historical charts use real PostgreSQL data; live WebSocket frames append and deduplicate by timestamp. No fabricated incident, anomaly, or benchmark data appears.

## Do's and Don'ts

- **Do:** Make the current spacecraft state and data freshness understandable before decorative detail.
- **Do:** Keep subsystem selection synchronized across the 3D scene, metric summaries, and charts.
- **Don't:** imitate a movie HUD with arbitrary grids, crosshairs, or meaningless codes.
- **Don't:** use animation, color, or hover as the only way to communicate state.
