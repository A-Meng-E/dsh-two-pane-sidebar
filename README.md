# dsh-two-pane-sidebar

A persistent **plugin rail** for [DeepSeek Harness](https://github.com/deepseek-ai) — it moves the
plugin navigation out of the main sidebar into a slim column of its own, leaving the sidebar to do
one job: new session, workspaces, sessions.

```
┌──────────────┬────────────────────┬─────────────────────┐
│  plugin rail │  sidebar           │  conversation       │
│  (52/208 px) │  new session       │                     │
│  ──────────  │  workspaces        │                     │
│  ▣ plugins   │    search          │                     │
│  ▣ market    │    ▣ workspace A   │                     │
│  ▣ tasks     │    ▣ workspace B   │                     │
│  ▣ skills    │  sessions          │                     │
│  …           │                    │                     │
└──────────────┴────────────────────┴─────────────────────┘
        ↑ drawn by this plugin        ↑ untouched, shipped SidebarRoot
```

The rail is **data-driven**: it renders whatever is registered in the host's `sidebar.panellist`
slot (`{ id, order, label, component }`). Install a plugin that registers a navigation entry and it
shows up here automatically — no code change, no configuration. Unregister it and it disappears.

This plugin is **client-only**. It installs no Host behaviour, makes no network requests, sends no
telemetry, and never touches your sessions or workspaces. Its entire state is one `localStorage`
key.

## Requirements

| | |
|---|---|
| Harness | DSH Desktop / Web **0.2.1-rc.2** (Windows, macOS, Linux) |
| Runtime | none — plain ESM, no build step, no dependencies |
| Compatibility | declares `engines.dsh = ">=0.2.1-rc.2 <0.3.0"`, see [Compatibility](#compatibility) |

## Install

Pick one. All three go through the Host's plugin manager, which writes the profile manifest, runs
`pnpm add`, and applies the bundle patch.

```bash
# 1. registry (once published)
plugin_manager install_bundle target=@A-Meng-E/dsh-two-pane-sidebar@0.2.0

# 2. release tarball — no npm account, a fixed immutable artifact
plugin_manager install_bundle target=https://github.com/A-Meng-E/dsh-two-pane-sidebar/releases/download/v0.2.0/dsh-two-pane-sidebar-0.2.0.tgz

# 3. straight from git
plugin_manager install_bundle target=git+https://github.com/A-Meng-E/dsh-two-pane-sidebar.git
```

Then **restart the app** (profile changes are not hot-reloaded) and reload the page.

> The spec is forwarded to `pnpm add`, so `file:` / `link:` local paths work too — that is how
> development installs work.

## Use

- Click a row to open that plugin's panel; the active row is highlighted with a left bar.
- Hover a row in the narrow rail for a themed tooltip.
- The arrow button at the bottom switches between **52 px (icons only)** and **208 px (icons +
  labels)**. It is in the same place in both widths, so it never jumps.
- The choice is stored in `localStorage["dsh.two-pane-sidebar.v2"]` and survives restarts.
- `prefers-reduced-motion` disables the width transition.

There is no mode to configure: the rail is always on, and the sidebar always keeps its own width
(whatever you last dragged it to). The rail reserves its space with a left padding on the frame, so
the conversation column gives up 52 px — the sidebar does not shrink.

## Uninstall

```bash
plugin_manager remove_bundle target=dsh-two-pane-sidebar
```

Or quit the app first, then delete the `dsh-two-pane-sidebar` line from
`~/.dsh/profiles/<profile>/package.json` and its entry from `dsh.profile.bundles`. Verify before
editing: editing profile files while the app is running can trip a hot-reload race in unrelated
built-in plugins.

Nothing is left behind except the `localStorage` key, which is inert.

## How it works

`client.js` is the whole thing (~670 lines, no dependencies):

1. registers a component into the host's frame-level `shell.overlay` slot;
2. locates the layout frame (`[data-shell-overlay]`.parentElement) and sets `padding-left` on it to
   reserve the rail's column — this is the only imperative DOM contact point, and it is reverted by
   the effect cleanup;
3. reads `sidebar.panellist` through `slots.entriesOfSlot()`, subscribes to slot and locale changes,
   and renders one row per entry;
4. renders each entry's own icon component directly (the host only injects `renderSlot` into entries
   that declare children, which this one does not), behind an error boundary so one broken icon
   cannot take the rail down;
5. copies the computed background/texture/text colour of the native sidebar column onto the rail, so
   third-party skins apply without any per-skin code;
6. hides the now-duplicated navigation list inside the native sidebar with one CSS rule.

Every host interaction is guarded: a missing service, slot, or DOM node degrades the rail instead of
breaking app boot.

## Compatibility

This plugin deliberately depends on host internals, all of which can change between Harness
releases:

| Depends on | Used for |
|---|---|
| `shell.overlay` slot | mounting the rail |
| `sidebar.panellist` slot + entry shape `{id, order, label, component}` | the rail's content |
| `[data-shell-overlay]` and its parent frame | reserving the column |
| `nav[class*="_panelList"]` (hashed class) | hiding the duplicated nav list |
| `[class*="sidebarCol"]` / `[class*="_root"]` (hashed class) | following the active skin |
| `@deepseek-ai/dsh-client-ui-primitives` → `Tooltip` | themed tooltips |
| `ctx.layout.selectPanel(id)` | opening a panel on click |

If an update breaks one of them the rail degrades or disappears; it does not corrupt data. The
checklist for re-verifying after a Harness upgrade is in
[docs/troubleshooting.md](docs/troubleshooting.md).

## Known limits

- Not a native second view container: the rail lives in the overlay layer and reserves space with
  padding. There is no draggable splitter, and the rail has exactly two widths.
- The conversation column loses 52 px; the host's `viewport < 1024` "narrow window" threshold
  therefore triggers 52 px earlier than before.
- A skin that paints somewhere other than the sidebar column's own element will not be followed —
  the rail falls back to the theme tokens for that skin.
- Icon components are rendered directly and must only depend on `{ size, active }`; anything else
  degrades to a neutral placeholder square.

## Development

```bash
# link the working copy into a profile, then restart the app
plugin_manager install_bundle target=link:/absolute/path/to/two-pane-sidebar
```

`link:` installs a symlink, so after that every edit to `client.js` is picked up by a page reload —
no build, no copy step. Locale metadata (`locale/*.json` `meta`) is read at boot and needs a restart.

Filter the browser console by `[two-pane-sidebar]`; every degraded path logs a warning there.

## License

MIT
