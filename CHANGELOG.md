# Changelog

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
