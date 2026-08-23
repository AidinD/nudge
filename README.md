# Nudge

A super-simple Windows reminder app.

Add one or more reminders (e.g. "Drink water"). At random times within a
configurable interval, a fullscreen takeover pops up on top of everything
else with the reminder text. There's a short grace period before the
Confirm button unlocks - no other way to dismiss it.

## Stack

Electron + React, built with `electron-vite`. Reminders and settings persist
to a local JSON file in the app's user data folder.

## Develop

```
npm install
npm run dev
```

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

`node scripts/generate-icon.mjs` redraws `resources/icon.png` and the multi-size
`resources/icon.ico` from the header mark in `NudgeMark.tsx`. The output is
committed; run it after changing the mark so the two stay one drawing.
