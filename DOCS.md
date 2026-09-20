# Flashforge Slicer

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

Settings, presets, overrides and the saved printer are stored by the add-on (in its
`/data` folder), so every phone, tablet or PC that opens the slicer shares them.

## Sending prints to the printer

- **Flashforge LAN API** (firmware 2.6.6 or newer): enter the printer's IP, its
  serial number and the check code shown under *Settings → Network* on the
  printer, then use **Test**, **Upload** or **Upload & print**. The add-on relays
  the request to the printer, so the Home Assistant host must be able to reach
  the printer's IP on port 8898 (LAN mode enabled on the printer). Only private
  LAN addresses are accepted by the relay.
- **Moonraker**: for a 5M running the community Klipper mod. Enter its IP and
  port (default 7125); the add-on relays the upload the same way.

## Watching a print

Once a printer has been tested and saved, the **Monitor** tab shows its live
status: progress, current layer, remaining and elapsed time, nozzle and bed
temperatures, speed and fan. From there you can pause, resume or cancel the
print and toggle the LED light. On an Adventurer 5M Pro (or a 5M with a
supported USB camera) tick **Camera** to see the live stream. "Upload & print"
opens Monitor automatically.

## Notes

- The add-on has no options; its only state is the shared settings file in `/data`.
- Direct access on port 8099 is optional; Ingress works without exposing it.
- Slicing speed depends on the device you open the page on, not on the Home
  Assistant host.
