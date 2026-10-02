# Glyphs

Turn any picture into a quiet, flat app icon: one line weight, one colour, in the same hand as the gray home-screen set. An installable, offline-capable PWA built with the [style guide](https://github.com/chattedomestique/styleguide) (compiled files vendored in `styleguide/`).

## What it does

1. **Add pictures**: tap the upload button, drop files on the preview, or paste. Add several and flip between them (the strip under the preview).
2. **Shape**: read the shape from transparency, dark or light parts, or whatever differs from the corner colour; threshold, smoothing, simplify, swap.
3. **Line**: draw it *Solid*, as an *Outline*, as *Lines* (inner edges), or *Outline and lines*. One width everywhere with round ends, measured as a share of the icon (the gray set is about 2.2%). The outline can sit on the edge, inside or outside.
4. **Place**: size, across, down, turn, flip. Drag the preview, pinch to resize, arrow keys to nudge. *Snap to guides* clicks to the centre, the centre of weight and the 10% / 20% margins; *Nudge in steps* rounds to 1%, 2.5% or 5%. *Centre by weight* and *Fit safe zone* buttons. Preview as square, iOS or circle, with optional guides and Android's maskable safe zone.
5. **Colour**: mark and tile colour (picker, hex, quick swatches), each with opacity; turn the tile off for a see-through PNG; *cut the mark out of the tile*; baked corner radius.
6. **Presets**: seven built from the gray icons, plus your own: save, update, rename, duplicate, delete, export and import as JSON. Each thumbnail is your current picture drawn in that preset. Choose whether applying a preset also takes its size and placement, and its shape settings.
7. **Save**: PNG at 1024, 512, 180 or 120 px, this picture or all of them. On iOS it opens the share sheet (Save Image / Save to Files). Undo and redo cover every change.

Pictures stay on the device; nothing is uploaded. Settings and presets are kept in `localStorage`; the pictures themselves are not kept between visits.

## How it works

`engine.js` reads the picture into a yes/no mask, converts that to a signed distance field, and draws solid, outline or line strokes from the distance, so a line has the same width everywhere at any size. The preview works at 400 px and exports at 640 or 1024. `app.js` is the interface; `app.css` holds the few things the style guide does not have; `sw.js` is the guide's offline-shell worker.

## Run it

Any static server (service workers need http or https):

```
npx serve .
```

On GitHub Pages it works from a sub-path, since every URL is relative. Bump `VERSION` in `sw.js` whenever you change a cached file.

`node tools/make-icons.mjs` re-renders the app's own icons with the engine (needs `playwright-core` and a Chromium).

## Not verified

Tested in Chromium on Linux (390 px phone and 1200 px desktop viewports). Not run on Safari or an iPhone: the share sheet, standalone safe areas and Home Screen install are unchecked. Touch pinch is implemented but was only exercised with a mouse.
