# Planty Slicer — browser-based slicer for the Flashforge Adventurer 5M

A complete FDM slicer that runs entirely in the browser: load a model, place it on
the bed, slice, preview the toolpaths layer by layer, and download G-code ready
for a **Flashforge Adventurer 5M or 5M Pro**. No server, no install — the slicing
engine runs in a Web Worker on your machine and nothing is uploaded anywhere.

## Features

- **Input**: STL (binary/ASCII), 3MF (including components and multiple build items), OBJ. Drag-and-drop or file picker, several objects per plate.
- **Placement**: move, rotate (X/Y/Z), scale, duplicate; **auto-arrange** packs parts largest-first around the bed centre with clearance for skirt/brim, rotates a part 90° when that is the only way it fits and tells you which parts do not fit; models always sit on the bed; out-of-bounds objects are flagged.
- **Slicing** (Clipper-based geometry engine):
  - walls (configurable loop count and order), top/bottom shell detection, bridge detection over air or support
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
- **Profiles**: Adventurer 5M and 5M Pro with 0.25 / 0.4 / 0.6 / 0.8 mm nozzles; PLA, HS PLA, Silk PLA, PETG, ABS, ASA, TPU; quality presets from 0.08 mm to 0.56 mm. Any setting can be overridden; overrides are highlighted and persist in the browser.
- **Send to printer** (optional):
  - *Flashforge LAN API* (port 8898, firmware 2.6.6+): upload, or upload and start printing, with optional bed levelling — the same API Orca-Flashforge uses. The browser can only reach it if the printer answers CORS preflight requests; if it does not, download the file and print via USB or Orca-Flashforge.
  - *Moonraker* for a 5M running the community Klipper mod (add the page's origin to `cors_domains`).

## Running it

```bash
npm install                    # from the repository root
npm run dev:slicer             # http://localhost:5173
npm run build:slicer           # static site in slicer/dist
npm run test:slicer            # unit tests for the slicing engine and G-code
```

The build is a plain static site (`slicer/dist`), so it can be hosted anywhere —
`.github/workflows/slicer-pages.yml` publishes it to GitHub Pages on pushes to `main`
once Pages is enabled for the repository (Settings → Pages → Source: *GitHub Actions*).

## How it works

```
model file ──▶ TriangleMesh ──▶ (transform, merge) ──▶ Web Worker
                                                          │
   slice.ts     plane/triangle intersection → oriented segments → closed loops → Clipper polygons
   engine.ts    supports (treeSupport.ts) · top/bottom shells · walls · infill · skirt/brim · path ordering (per layer)
   gcode.ts     speeds/accel · extrusion maths · retraction/Z-hop · fan · time estimate · header/thumbnail
                                                          │
                                        gcode + preview segments ◀─┘
```

- `src/geometry/` — STL / 3MF / OBJ parsers and mesh helpers
- `src/slicer/` — the engine (`slice`, `polygons`, `infill`, `engine`, `gcode`, `worker`)
- `src/profiles/` — machine, filament and process presets (values taken from OrcaSlicer's Flashforge profiles)
- `src/printer/` — Flashforge LAN API and Moonraker upload clients
- `src/ui/` — React UI; `src/preview/` — thumbnail rendering
- `tests/` — Vitest suite (slicing geometry, shells, supports, adhesion, G-code structure, time estimate)

## Limitations / roadmap

- Tree supports use circular branch cross-sections on 2-D layers (no support painting, no "build plate only" mode yet); arrange works on bounding boxes, not exact outlines.
- No gap fill for walls thinner than the wall count, no ironing, no arc fitting, no variable layer height.
- Single extruder / single filament per print (the 5M has one extruder anyway).
- LAN upload from a browser depends on the printer firmware's CORS behaviour (see above).
- The time estimate uses Klipper-like kinematics but not the printer's exact pressure-advance/smoothing behaviour; expect it to be within roughly 10 %.
