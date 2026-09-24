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

### A template to start from

A 62 x 29 mm die-cut label (DK-11209), with the QR code and colour patch
stacked down the left and four lines of text beside them. Run this against
LabelForge once and the template appears in its list, ready to edit:

```bash
curl -X POST http://<labelforge-ip>:8095/api/templates \
  -H 'Content-Type: application/json' -d '{
  "name": "Filament spool 62x29",
  "label_size": "62x29",
  "image": { "data": "", "variable": "art", "x": 12, "y": 8, "width": 130, "height": 255 },
  "text_fields": [
    { "id": "name",  "x": 160, "y": 10,  "width": 524, "height": 96, "font_size": 40, "bold": true,  "align": "left", "text": "{{name}}" },
    { "id": "temps", "x": 160, "y": 112, "width": 524, "height": 44, "font_size": 34, "bold": false, "align": "left", "text": "{{temps}}" },
    { "id": "left",  "x": 160, "y": 160, "width": 524, "height": 40, "font_size": 30, "bold": false, "align": "left", "text": "{{remaining}} left · {{color_hex}}" },
    { "id": "ident", "x": 160, "y": 204, "width": 524, "height": 36, "font_size": 26, "bold": false, "align": "left", "text": "{{id}} · {{purchased}}" }
  ]
}'
```

The 130 x 255 image block gives the QR 4 px a module, comfortably above the
3 px floor, with the colour patch below it.

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

## Failure watch

The add-on watches the printer on its own schedule and can raise a Home
Assistant entity when something looks wrong. It runs inside the add-on, not in
the page, because the page stops polling the moment its tab is hidden — which is
exactly when a print is least supervised.

### What it can and cannot see

It reads the printer's own telemetry, so it catches:

- the nozzle or bed drifting away from its target and staying there
- an error code from the firmware
- a print that paused on its own (filament runout looks the same from here)
- a layer that has been going far longer than the slice predicted for it
- the printer going unreachable mid-print

**It cannot see the print itself.** Bed detachment, spaghetti, a layer shift, a
warped corner: when a part comes off the bed the firmware carries on extruding
into the air with correct temperatures, an advancing layer counter and no error,
and nothing in the telemetry says otherwise. Catching that needs a camera and a
trained model — this is not that, and it would be worse than useless to imply it
was. If you want detachment covered, run something like
[Obico](https://www.obico.io/) alongside.

### Setting it up

In the add-on's **Configuration** tab, fill in your MQTT broker — for the
Mosquitto add-on that is host `core-mosquitto`, port `1883`, and a Home
Assistant user's credentials. The broker password lives here rather than in the
settings the web UI writes, because the add-on serves that settings file to
anyone who can reach it.

The printer's address is not asked for twice: the watcher reads the one you
already saved under **Send to printer**.

Three entities appear in Home Assistant by MQTT discovery:

| entity | what it is |
| --- | --- |
| `binary_sensor.*_print_problem` | `problem` class; on whenever any rule is firing |
| `sensor.*_printer_state` | the printer's status, with everything else as attributes |
| `sensor.*_print_problem_summary` | the fault in a sentence, for a notification |

All three carry the same attributes, so an automation can read `faults`,
`layer`, `progress`, `nozzle`, `bed` and `file_name` off any of them. They go
*unavailable* rather than stale if the watcher stops, via a last will.

A notification automation is then the ordinary Home Assistant kind:

```yaml
automation:
  - alias: Print problem
    trigger:
      - platform: state
        entity_id: binary_sensor.adventurer_5m_print_problem
        to: "on"
        for: "00:01:00"
    action:
      - service: notify.mobile_app_phone
        data:
          title: Printer problem
          message: "{{ state_attr('binary_sensor.adventurer_5m_print_problem', 'summary') }}"
```

### Tuning it

Every threshold is an add-on option, because the right value depends on the
room: a draughty garage legitimately runs a bed a few degrees under target.

| option | default | meaning |
| --- | --- | --- |
| `nozzle_tolerance_c` | 15 | how far the nozzle may sit from target |
| `bed_tolerance_c` | 10 | the same for the bed |
| `temp_grace_seconds` | 120 | how long a deviation must last before it counts |
| `stall_factor` | 4 | multiple of a layer's predicted time before it counts as stalled |
| `stall_min_seconds` | 600 | ...but never less than this |
| `offline_seconds` | 120 | how long unreachable counts as a fault |
| `watch_poll_seconds` | 15 | how often to ask the printer |
| `watch_enabled` | true | switch the whole thing off |

The stall rule uses the per-layer times from the slice itself, recorded when you
press **Upload & print**, so a legitimately slow layer gets the time its own
prediction earns it. Print a file some other way and it falls back to the flat
`stall_min_seconds`.

Running under plain Docker the same settings are environment variables:
`MQTT_HOST`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `NOZZLE_TOLERANCE_C`, and so on.
With no broker set the watcher still runs and still shows its state on the
Monitor tab; it simply has nowhere to publish.

## Notes

- The add-on has no options; its only state is the shared settings file in `/data`.
- Direct access on port 8099 is optional; Ingress works without exposing it.
- Slicing speed depends on the device you open the page on, not on the Home
  Assistant host.
- Opened through Ingress the page leaves out its own title bar, since the
  panel header above it already names the add-on. Opened directly on port 8099
  it keeps the title, because nothing else is showing one.
