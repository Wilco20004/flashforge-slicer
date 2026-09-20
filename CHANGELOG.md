# Changelog

## 0.3.5

- **Print time estimate fixed.** The estimator treated every vertex of a
  polyline as a full stop (a sign error in the junction formula), so parts with
  curved or finely tessellated surfaces were reported many times slower than they
  print. The estimate, the printer's remaining-time display (`M73`) and the
  minimum-layer-time slow-down now follow Klipper's look-ahead planner: junction
  deviation from the square-corner velocity, centripetal limit and
  minimum-cruise-ratio smoothing. The G-code speeds themselves were already
  correct.
- **Outline simplification no longer flattens curves.** Clipper's greedy
  `CleanPolygons` let the error accumulate along an arc, so finely tessellated
  circles were reduced to ~6 mm chords (0.2 mm off the surface). Replaced with
  Douglas-Peucker bounded by the resolution setting (0.012 mm).

## 0.3.4

- **Camera works through Home Assistant Ingress.** Ingress strips the multipart
  boundary from the stream's Content-Type header, which made the browser's own
  MJPEG decoder give up after the first frame. The stream is now decoded in the
  page (frames cut by each part's Content-Length, or by JPEG markers), so it
  renders behind Ingress and any other proxy. Reconnects with backoff; falls back
  to polling still images if the stream keeps failing. Shows the live frame rate.
- Loopback addresses are accepted by the relay (camera or Moonraker on the same
  host as the container).

## 0.3.3

- **Camera reliability.** The printer's camera server restarts when told to start
  streaming and resets any connection that arrives in that moment. Monitor now
  waits a second after starting the stream and retries with backoff (up to five
  attempts) before reporting a failure, showing "Starting camera…" meanwhile.

## 0.3.2

- **Camera fix.** The stream is now requested with the exact URL the printer
  advertises (`/?action=stream`); the extra cache-busting parameter added before
  made the Flashforge camera server reject the request.
- When a stream fails, Monitor reports the HTTP status and content type it got
  back (or that nothing answered) instead of a bare error.

## 0.3.1

- **USB / external cameras.** When the printer does not advertise a camera, Monitor
  offers "Try the printer's camera port" (the firmware's port-8080 MJPEG stream a
  recognised USB camera appears on) and a field for any other MJPEG stream URL.
  The URL is saved with the printer and relayed like the built-in stream.

## 0.3.0

- **Monitor mode.** A third tab next to Prepare and Preview shows the live state
  of the saved printer: status, progress, current layer, remaining and elapsed
  time, nozzle/bed temperatures, speed, fan, filament and firmware, refreshed
  every 3 s while open (10 s in the background, paused when the tab is hidden).
  The tab itself shows the live percentage.
- **Camera.** On printers that report a camera (Adventurer 5M Pro built-in, or a
  supported USB camera on the 5M) the MJPEG stream is shown in Monitor mode,
  relayed by the server so it also works from HTTPS pages and Home Assistant
  Ingress. Stream start/stop and the LED light are controlled from the same view.
- **Job control.** Pause, resume and cancel (with confirmation) from Monitor mode.
- "Upload & print" switches to Monitor mode automatically.

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
