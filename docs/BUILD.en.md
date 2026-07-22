# Building the desktop app

[한국어](BUILD.md) · **English**

The desktop app (Electron) is a thin shell: you enter a server address and it opens the Accord UI.
Building produces a distributable executable (Windows portable exe / macOS zip) in `dist/`.

> There are no prebuilt binaries in Releases yet — the project still updates too often for release
> builds to keep up. Build from source with the steps below, or skip the app entirely and open the
> server address in Chrome.

## Requirements

| For | You need |
|---|---|
| Everything | Node.js 18+, and `npm install` once in the repository root |
| Windows build | Windows with .NET Framework 4.x `csc.exe` (included with Windows) |
| macOS build | macOS (arm64) |

> `npm install` fetches development dependencies (electron, electron-builder). Running the server
> does not need them.

Once, before building:

```bash
npm install
```

---

## 1. One-click scripts

### Windows portable exe (on Windows)

**Double-click `scripts/win/build-windows.bat`.**

It compiles `native/windows-process-loopback/Program.cs` (the per-application audio capture helper)
with .NET `csc.exe`, then builds an x64 portable exe with electron-builder.
Output: **`dist/Accord Windows x64 Portable.exe`**

### macOS app (on macOS)

**Double-click `scripts/mac/build-mac.command`.**

Builds an arm64 zip. Output: **`dist/Accord Mac arm64.zip`**

---

## 2. Manual commands

From the repository root:

### Windows

```bash
npm run build:win
```

### macOS

```bash
npm run build:mac
```

Both leave their output in `dist/`. Run `node scripts/prune-dist.js` if you want to clean up
intermediate artifacts.

---

## Verification

```bash
npm run check   # scripts/check-v2.js — static checks + regression review
```

## Versioning rules

- **Server version**: `VERSION` in `server.js` (n.n.n)
- **Client version**: `CLIENT_VERSION` in `public/app.js` — a **plain integer** (1, 2, 3 …) so it is
  not confused with the server version. `version` in `package.json` stays in `"N.0.0"` form because
  electron-builder requires semver, and its major number must match `CLIENT_VERSION`
  (`npm run check` verifies this).
- When client code under `public/` changes, bump the server version too, since the server ships that code.
