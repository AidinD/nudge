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
