# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-10-21

First packaged release. The rail is now a permanent fixture of the layout instead of a
three-state mode switch.

### Added

- Persistent plugin rail rendered from the host's `sidebar.panellist` registry — new navigation
  entries appear without any change to this plugin.
- Icon-only (52 px) and icon + label (208 px) widths, with a single toggle button at the bottom of
  the rail and the choice persisted in `localStorage`.
- Themed tooltips via the host's `Tooltip` primitive (`portal: true`, so the rail's `overflow: hidden`
  cannot clip them); falls back to the native `title` attribute when the primitive is unavailable.
- Per-entry error boundary: a failing icon component degrades to a neutral placeholder instead of
  taking down the rail.
- Skin following: the rail copies the native sidebar column's background, texture and text colour at
  runtime and re-syncs on theme/skin changes, so third-party skins apply with no per-skin code.
- `prefers-reduced-motion` support.

### Changed

- Registration goes through `slots.inject(slotName, () => slots.register(...))`, and all wiring runs
  in a child fiber derived from `ctx.inject(['slots'], …)`; entry options are limited to
  `{ name, id, order }`. A failure can now only cost the panel, never app boot.
- `inject` narrowed to `['slots', 'locale']`; `layout` is resolved opportunistically at call time.
- Icons are rendered from the entry's own component, because the host only injects `renderSlot` into
  entries that declare children.
- Row foreground colour uses `inherit` and hover/active backgrounds use
  `color-mix(in srgb, currentColor …)`, so contrast follows whatever the active skin defines.
- Locale strings and the plugin-page title/description now live in `locale/*.json`.

### Removed

- The three display modes (both / rail only / sidebar only), the top-bar mode control, the
  `sidebar.footer.action` fallback button, the `Ctrl+Alt+1/2` shortcuts and the narrow-window
  degradation.
- Startup synchronisation through `ctx.layout.toggleSidebar()`, which reset a user-dragged sidebar
  width to the 280 px default on every boot.

### Fixed

- App failed to boot (`web boot: 1 entry did not activate`) because the slot was registered without
  the `inject` wrapper — the error is no longer possible: `apply` never throws.
- Blank icons in the rail.
- Light background / dark text rail under dark skins.

## [0.1.0] — 2026-10-20

Internal development build. Not published; superseded by 0.2.0.
