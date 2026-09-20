# Changelog

## 0.2.1

- **Settings follow you.** When run as the add-on or Docker image, presets,
  overrides and the saved printer are stored on the server (`/data`), so every
  phone, tablet or PC that opens the slicer shares them. The newer of the local
  and server copies wins on start. Static hosting keeps using browser storage.
- **Saved printer.** A successful *Test* saves the printer with its name,
  firmware and verification time; a *Forget* button clears it. Editing the IP,
  serial number or check code clears the verification until the next test.
- The settings panel shows where settings are being saved.

## 0.2.0

- **Send to printer now works from the add-on / Docker image.** The server relays
  uploads to the printer (`/printer/<ip>/…`, private LAN addresses only), so the
  browser no longer has to reach the printer directly. Static hosting (GitHub
  Pages) explains why sending is unavailable there instead of "Failed to fetch".
- Tree (organic) supports, now the default support type; grid supports remain.
- Auto arrange on the real 220 × 220 bed: largest part first, centre-out, 90°
  rotation fallback, clear warning for parts that do not fit.
- Phone-friendly layout.
- nginx listens on IPv4 only so the container starts without IPv6.

## 0.1.0

- First release: STL/3MF/OBJ import, walls, shells, infill, skirt/brim, grid
  supports, Adventurer 5M G-code with Orca-compatible header and thumbnail,
  layer preview, presets for 5M / 5M Pro and common filaments.
