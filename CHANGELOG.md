# Changelog

## 0.5.0

- **Gap fill.** Where a feature is too narrow for another wall loop but too wide
  to ignore, the area was simply left empty: tapering ribs, the tips of wedges
  and the join between curved walls came out hollow. Each leftover sliver is now
  reduced to its centreline, by eroding it until it collapses, and printed once
  at the sliver's own width. On a 1x4 gridfinity-style test part this adds 25
  seconds and no measurable filament. Switch it off under Strength.
- **Ironing.** An optional second pass over the topmost surfaces that lays down a
  film rather than a bead, smoothing the finish. Off by default because it is
  slow: spacing, flow and speed are under Quality.
- Both stages reuse the connected-path work from 0.4.0, so ironing is a single
  continuous sweep rather than thousands of separate lines.

## 0.4.0

- **Prints are no longer dominated by travel.** Infill was emitted one clipped
  line at a time, so the head stopped, lifted, retracted, travelled and restarted
  between every line. A 1x4 gridfinity base came out with 2.1 km of travel and
  56,397 retractions against 256 m of actual extrusion, which is where the
  four-hour estimate came from. Infill lines are now joined into continuous
  zigzags wherever the connector stays inside the region, and the remaining
  paths are ordered by proximity instead of scan order. On an equivalent test
  part travel fell from 489 m to 65 m, retractions from 13,549 to 1,044, and the
  print time from 1h 23m to 45m, with the same amount of plastic.
- Supports and their interfaces are joined the same way.
- Infill stubs shorter than one line width are dropped: reaching them cost more
  than they deposited.
- The time estimate was checked against OrcaSlicer by re-timing Orca's own
  G-code with it: 1h 8m 45s against Orca's stated 1h 7m 48s, a 1.4% difference.

## 0.3.6

- **Fixed "Slicing worker crashed" after an add-on update.** Updating the add-on
  replaces every file on the server, including the content-hashed chunk that
  holds the slicing worker. A page left open from the previous version asked for
  its old chunk, got a 404 and failed at the moment Slice was pressed. The page
  now starts and handshakes the worker *before* handing it the model, so a worker
  that cannot load falls back to slicing in the page instead of losing the job.
  If the rest of the old build is gone too, the page reloads itself once.
- **Update notice.** The app checks the server's build stamp on load, when it
  comes back to the foreground and every ten minutes, and offers a Reload button
  when the add-on has been updated underneath it.
- The entry page is served with `Cache-Control: no-cache`, so a reload always
  picks up the new version.

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
