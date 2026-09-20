# Flashforge Slicer

A complete FDM slicer for the **Flashforge Adventurer 5M and 5M Pro** that runs
entirely in the browser. Load a model, place it on the bed, slice, preview the
toolpaths layer by layer and download G-code ready for the printer. No server,
no install: the slicing engine runs in a Web Worker on your device and nothing
is uploaded anywhere. Works on phones and tablets too.

Run it as a static site, as a Docker container, or as a Home Assistant add-on.

## Features

- **Input**: STL (binary/ASCII), 3MF (including components and multiple build items), OBJ. Drag-and-drop or file picker, several objects per plate.
- **Placement**: move, rotate (X/Y/Z), scale, duplicate; **auto-arrange** packs parts largest-first around the bed centre with clearance for skirt/brim, rotates a part 90° when that is the only way it fits and tells you which parts do not fit; models always sit on the bed; out-of-bounds objects are flagged.
- **Slicing** (Clipper-based geometry engine):
  - walls (configurable loop count and order), top/bottom shell detection, bridge detection over air or support
  - **variable width walls**: a feature too thin for another nominal loop is measured and divided into the number of beads that fit, each widened or narrowed to fill it exactly, with an odd bead laid down its centreline — so a 1.05 mm rib is three 0.35 mm beads rather than two 0.42 mm ones and a sliver, and a rib thinner than one line prints instead of disappearing
  - gap fill for whatever the walls and infill still leave, and optional ironing of top surfaces
  - sparse infill: grid, rectilinear, lines, triangles, concentric — with density and angle
  - tiny sparse regions filled solid, infill/wall overlap, elephant-foot compensation
  - skirt and brim
  - automatic supports: **tree (organic)** branches that grow down from sampled tips, merge, avoid the model and land on the bed or the model, with a dense roof under the overhang; or classic grid supports — both with threshold angle, XY/Z gaps and interface layers
  - seam control: aligned, nearest, rear, random
- **G-code for the Adventurer 5M**:
  - the exact start/end sequences and machine limits from the official OrcaSlicer Flashforge profiles (centre-origin bed −110…110 mm, 220 mm Z, Klipper flavour, relative extrusion)
  - per-feature speeds and accelerations, volumetric-speed cap, retraction, Z-hop, pressure advance
  - fan control and minimum-layer-time slow-down per filament
  - Orca-compatible `HEADER_BLOCK`, 140×110 PNG thumbnail block (shown in the printer's file browser), `M73` progress, `;TYPE:` / `;LAYER_CHANGE` markers and a `CONFIG_BLOCK` with every setting
  - print-time estimate from a trapezoidal motion planner with junction slow-down; filament length / weight
- **Preview**: 3D toolpath view coloured by feature type, layer slider (arrow keys work too), travel moves toggle.
- **Profiles**: Adventurer 5M and 5M Pro with 0.25 / 0.4 / 0.6 / 0.8 mm nozzles; PLA, HS PLA, Silk PLA, PETG, ABS, ASA, TPU; quality presets from 0.08 mm to 0.56 mm. Any setting can be overridden; overrides are highlighted. Settings and the saved printer persist in the browser, and on the server when run as the Docker image / Home Assistant add-on so all your devices share them.
- **Filament spools**: record the actual rolls on the shelf — brand, colour name and hex, material, their own nozzle and bed temperatures, and how much is left. Selecting a spool overrides the preset's temperatures for the slice and leaves flow, fan and pressure advance with the material preset; filament used is booked against the spool when a print is sent.
- **Spool labels** via [LabelForge](https://github.com/wilco20004/LabelForge): the slicer draws the label's image itself — a QR code beside a dithered colour patch — and posts it with the text values to a LabelForge add-on on the LAN. Scanning a label opens the slicer with that spool selected.
- **Monitor** (Docker / Home Assistant versions): live status of the saved printer — progress, layer, remaining time, temperatures, speed and fan — with pause / resume / cancel, LED light control and the printer's camera stream (Adventurer 5M Pro built-in camera, or a supported USB camera on the 5M), all relayed by the server.
- **Send to printer** (Docker / Home Assistant versions):
  - *Flashforge LAN API* (port 8898, firmware 2.6.6+): upload, or upload and start printing, with optional bed levelling — the same API Orca-Flashforge uses.
  - *Moonraker* for a 5M running the community Klipper mod.
  - The nginx that serves the app relays these requests (`/printer/<ip>/…` → `http://<ip>:8898/…`, private LAN addresses only), so the browser never talks to the printer directly. A page served from plain static hosting such as GitHub Pages cannot send to the printer: browsers block an HTTPS page from calling a plain-HTTP LAN device, and the printer does not answer CORS preflights. The app detects this and says so; download the G-code there instead.

## Running it

**Home Assistant add-on** — in Home Assistant go to *Settings → Add-ons → Add-on
Store → ⋮ → Repositories* and add `https://github.com/wilco20004/flashforge-slicer`.
Install **Flashforge Slicer**, start it and open **Slicer** from the sidebar. It is
served via Ingress; port 8099 can optionally be exposed for direct access.
`config.yaml`, `Dockerfile`, `nginx.conf` and `DOCS.md` make up the add-on.

**Docker**

```bash
docker compose up -d                 # http://<host>:8099
# or
docker build -t flashforge-slicer . && docker run -d -p 8099:8099 flashforge-slicer
```

The image is nginx serving the static build (about 10 MB). Settings and the saved
printer are kept in `/data` (`./data` with the compose file) and shared by every
device that opens the slicer.

**Development / static hosting**

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
npm test             # unit tests for the slicing engine, G-code and arrange
```

`dist/` is a plain static site, so it can be hosted anywhere. The included
GitHub Actions workflow publishes it to GitHub Pages on every push to `main`
once Pages is enabled (Settings → Pages → Source: *GitHub Actions*, one time):
https://wilco20004.github.io/flashforge-slicer/

## How it works

```
model file ──▶ TriangleMesh ──▶ (transform, merge) ──▶ Web Worker
                                                          │
   slice.ts     plane/triangle intersection → oriented segments → closed loops → Clipper polygons
   engine.ts    supports (treeSupport.ts) · top/bottom shells · walls (walls.ts) · infill · skirt/brim · path ordering
   gcode.ts     speeds/accel · extrusion maths · retraction/Z-hop · fan · time estimate · header/thumbnail
                                                          │
                                        gcode + preview segments ◀─┘
```

- `src/geometry/` — STL / 3MF / OBJ parsers and mesh helpers
- `src/slicer/` — the engine (`slice`, `polygons`, `walls`, `medial`, `gapFill`, `infill`, `treeSupport`, `engine`, `gcode`, `worker`)
- `src/profiles/` — machine, filament and process presets (values taken from OrcaSlicer's Flashforge profiles), and physical spools (`spools`)
- `src/printer/` — Flashforge LAN API and Moonraker upload clients
- `src/label/` — spool labels: QR encoding (`qr`), the one-bit label image (`spoolArt`), the LabelForge client (`labelforge`) and the spool-to-template mapping (`spoolLabel`)
- `src/ui/` — React UI; `src/preview/` — thumbnail rendering
- `tests/` — Vitest suite (slicing geometry, shells, supports, adhesion, G-code structure, time estimate, arrange, spools and labels)

## Limitations / roadmap

- Tree supports use circular branch cross-sections on 2-D layers (no support painting, no "build plate only" mode yet); arrange works on bounding boxes, not exact outlines.
- Variable width walls measure each connected region and give it one bead width, rather than letting the width vary along a single bead as a Voronoi skeleton (Arachne) would; a region whose thickness changes sharply is resolved a loop at a time instead.
- No arc fitting and no variable layer height.
- Single extruder / single filament per print (the 5M has one extruder anyway).
- LAN upload from a browser depends on the printer firmware's CORS behaviour (see above).
- Spool labels were checked against LabelForge's own renderer and brother_ql's conversion, including reading the QR back off the converted image, but not against a physical Brother QL printer.
- The time estimate uses Klipper-like kinematics but not the printer's exact pressure-advance/smoothing behaviour; expect it to be within roughly 10 %.

## License

MIT. Machine, filament and process values are derived from the
[OrcaSlicer](https://github.com/SoftFever/OrcaSlicer) Flashforge system profiles.
