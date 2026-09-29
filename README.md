# Nudge

A super-simple Windows reminder app.

Add one or more reminders (e.g. "Drink water"). At random times within a
configurable interval, a fullscreen takeover pops up on top of everything
else with the reminder text. There's a short grace period before the
Confirm button unlocks - no other way to dismiss it.

## Scheduled runs

Alongside the random reminders, and able to run at the same time. A run is
started from a template: pick one, adjust it, press **Start run**. It lives until
its entries are done. Templates are saved runs, not a calendar - there is no
recurrence.

An entry's time is either a clock time (`14:30`, today) or an offset from the
row above it (`+1h`, `+90m`, `+1h30m`, `+2min`); the first row's offset counts
from the moment the run started, so `+0` there is the very start. A run started
in the morning with `12:00`, `+1h`, `+1h` nudges at 12:00, 13:00 and 14:00, and
changing the first row moves the rest. Because order matters, rows are dragged
into place. One template ships with the app: four placeholder steps at `+0`,
`+1h`, `+1h`, `+1h`.

Every takeover - random or scheduled, from any number of overlapping runs - goes
through one queue and the screen shows one at a time. An item waits behind the
takeover on screen, but if it has not been shown within a minute of its moment it
**burns**: dropped silently, never shown late. The same rule covers the app being
closed or the machine asleep. There is no catch-up.

A run entry's takeover carries one small line of context, `2 of 4 · next 14:30`.
What remains of each run is listed in the app window.

## Stack

Electron + React, built with `electron-vite`. Reminders and settings persist
to a local JSON file in the app's user data folder.

## Develop

Nudge depends on [**keel**](https://github.com/AidinD/keel), the shared layer under
the suite, linked from the filesystem — so it has to be checked out **next to**
this repo:

```
Tools/
├── nudge/
└── keel/
```

```bash
git clone https://github.com/AidinD/keel ../keel
npm install
npm run dev
```

Without the sibling checkout `npm install` still **exits 0** — npm links
`file:../keel` to a dangling symlink and says nothing. What fails is the first
import: `npm run icon` and `npm run release` die with `ERR_MODULE_NOT_FOUND`. keel
is a devDependency; electron-vite inlines what the app uses rather than resolving
it at runtime.

## Build a Windows installer

```
npm run dist
```

## Publish a release

```
npm run release
```

Cleans, builds, packages, and uploads a GitHub release through electron-builder.
Installed copies check for it once at startup and install it on quit; the
settings window offers a restart when one is waiting.

Releases before 0.1.3 were uploaded by hand and carry no `latest.yml`, so copies
installed from those cannot update themselves - install 0.1.3 manually once.

## The app icon

`npm run icon` redraws `resources/icon.png` and the multi-size `resources/icon.ico`
from the header mark in `NudgeMark.tsx`. The output is committed; run it after
changing the mark so the two stay one drawing.

The PNG and ICO writers and the distance-field primitives come from `keel/icon`,
shared with the rest of the suite; what is left in `scripts/generate-icon.mjs` is
Nudge's geometry and Nudge's colour. Migrating produced byte-identical output,
which is the check keel asks for — if it ever does not, the geometry moved too.
