# Planty Slicer

A complete 3D print slicer for the **Flashforge Adventurer 5M and 5M Pro** that
runs entirely in your browser. This add-on only hosts the static web app; all
slicing happens on the device you open it from (phone, tablet or PC), and no
model data ever leaves your browser.

## Setup

1. Install the add-on and start it.
2. Open **Slicer** from the sidebar (Ingress) or use the "Open Web UI" link.
3. Drop an STL, 3MF or OBJ file onto the bed (or tap **Open model**), arrange,
   pick a filament and quality preset, then **Slice plate**.
4. Check the layer preview, then **Download** the `.gcode` and copy it to the
   printer via USB, or upload it over the LAN (see below).

Settings, presets and any overrides you make are remembered per browser.

## Sending prints to the printer

- **Flashforge LAN API** (firmware 2.6.6 or newer): enter the printer's IP, its
  serial number and the check code shown under *Settings → Network* on the
  printer, then use **Upload** or **Upload & print**. Your browser talks to the
  printer directly, so both must be on the same network. Some firmware versions
  block browser requests (CORS); if uploads fail while the printer is reachable,
  download the file instead.
- **Moonraker**: for a 5M running the community Klipper mod. Add this add-on's
  URL to `cors_domains` in `moonraker.conf`.

## Notes

- The add-on stores nothing: there is no configuration and no data folder.
- Direct access on port 8099 is optional; Ingress works without exposing it.
- Slicing speed depends on the device you open the page on, not on the Home
  Assistant host.
