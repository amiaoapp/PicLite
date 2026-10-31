# UI preview 10

Version 2.0.2; macOS preview identity remains com.piclite.preview.

## Changes

- New floating requests focus their current result; completed imports/clipboard operations promote the newest completed retained result. Watcher results reset selection after preview load; an older asynchronous decode cannot steal focus from a later arrival. Browsing old results no longer pins the display when a new result arrives.
- Shared image tone sampler reads a downscaled canvas (at most 32px per axis), caches sources and guards asynchronous races. Light images receive dark overlay text and dark button surfaces with light glyphs; dark images receive light text/surfaces with dark glyphs. Preview pixels are not filtered or darkened.
- Settings switch "New floating window" persists immersive/classic choice across main and floating settings keys. Immersive keeps v9 cover view, single controls layer and short-window one-row actions. Classic restores filename, separate result card and hover actions with existing supported operations.
- Browser/Docker frontend has an in-page floating result using actual compressed queue results, clipboard, file download, compare, reprocess and next-result operations. Browser settings expose the same style switch and persist it. It cannot create a native desktop window outside the browser.

## Verification

- Desktop production renderer: new watcher result replaces display after manually browsing; 1–6 results keep one interactive layer; image raster pixels undimmed; actual footer pointer clicks; Next/list/stack/dismiss.
- White/black result image tests assert overlay text and button surfaces reverse appropriately; classic/immersive switches retain result data. Style settings synchronize and preserve compression preset. Tone tests cover luminance/alpha/cache/error/races/unmount.
- Docker-equivalent standalone web production service: actual image imports and compression, new completed results, adaptive colours, clipboard contains PNG image, actual downloaded compressed file, next and style switch/reload. Static Pages build, TypeScript, targeted lint, production server build and SSR/compression-policy tests pass.
- This host has no docker/podman/colima/container engine. Local standalone verification is not a container runtime test; Docker multiarchitecture build/publication is delegated to the existing GitHub workflow.
- Compression codec/quality ladder/algorithm and settings remain unchanged. Native quick-compression batch invocation remains intact; this release changes UI focus/presentation only.

Package signature, architecture, archive integrity and packaged MCP smoke checked at delivery. macOS preview is ad-hoc signed, not notarized. GitHub CI triggers do not imply artifacts/images are already available; preview desktop CI is not monitored after handoff.
