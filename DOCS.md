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
supported USB camera) tick **Camera** to see the live stream. If the printer does
not report a camera, use **Try the printer's camera port**, or enter any MJPEG
stream URL (for example from a separate webcam server). "Upload & print"
opens Monitor automatically.

## Filament spools and labels

A filament preset ("Generic PETG") describes a kind of plastic. A **spool** is
the roll on your shelf. Add spools under the **Filament** tab with their brand,
colour, material and their own nozzle and bed temperatures.

Selecting a spool — from that tab, or the **Spool** row in the settings panel —
overrides the preset's two temperatures for the slice. Everything else about the
material (flow ratio, fan, pressure advance, volumetric limit) stays with the
preset, because that is where that knowledge belongs. The first-layer
temperatures keep the preset's own offset, so PLA still runs its bed 5 °C hotter
for layer one.

The spool records how much filament is left. A print sent to the printer while
that spool is in use is booked against it automatically; for a print carried
over on a USB stick there is a button to book the last slice by hand.

### Printing a label

If you run the [LabelForge](https://github.com/wilco20004/LabelForge) add-on with
a Brother QL printer, the Filament tab can print a label for a spool. Enter
LabelForge's LAN IP address and port (8095 by default) and load its templates.

Design the template in LabelForge, not here. Use these variables in its text
fields — anything else prints blank, and the slicer warns you before it does:

`name`, `brand`, `material`, `color`, `color_hex`, `nozzle_temp`, `bed_temp`,
`temps`, `weight`, `used`, `remaining`, `remaining_pct`, `id`, `purchased`,
`notes`, `link`.

Give the template's **image an override variable** (any name). The slicer fills
it with a QR code and a colour patch drawn to that block's exact pixel size.

Two things are worth knowing when laying the template out:

- **Give the image block room.** The QR is drawn at a whole number of pixels per
  module. Below 3 px a module it becomes unreliable, and the slicer says so
  before you print. An image block about 260 x 100 px is comfortable for a link
  like `http://192.168.1.4:8099/#spool=K7M2QX`; a shorter QR prefix needs less.
- **A text field that wraps runs past its own height.** LabelForge wraps text to
  the field's width and keeps going downwards, so a long value will overwrite
  whatever you placed below it. Leave room for two lines where a value might
  need them.

The colour patch is a dither, not a block of colour, and that is deliberate: a
mono QL printer keeps whatever is darker than about 70 % brightness and throws
the rest away, so a flat colour would print as a solid black block or as nothing
at all, and a navy spool would look exactly like a black one. The dither prints
as a tone whose darkness matches the filament. The hue itself is carried by the
`color` and `color_hex` text.

### Scanning a label

Set **QR prefix** to this page's own address ending in `#spool=` — for example
`http://192.168.1.4:8099/#spool=` — and the QR on each label becomes a link.
Scanning it with a phone opens the slicer with that spool already selected.
Leave the prefix blank and the QR just holds the spool id.

## Notes

- The add-on has no options; its only state is the shared settings file in `/data`.
- Direct access on port 8099 is optional; Ingress works without exposing it.
- Slicing speed depends on the device you open the page on, not on the Home
  Assistant host.
