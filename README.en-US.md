# PicLite

A local-first image optimiser for content creators and developers, available on Windows, macOS, Linux, and as a self-hosted web app.

[中文](README.md) · [Desktop downloads](https://github.com/amiaoapp/PicLite/releases) · [Web demo](https://amiaoapp.github.io/PicLite/) · [Plugin development](docs/PLUGIN_DEVELOPMENT.en-US.md) · [Issues](https://github.com/amiaoapp/PicLite/issues)

![PicLite workspace](public/og.png)

## Highlights

- Import, convert, optimise, and proportionally resize JPEG / JFIF, PNG, WebP, and GIF files
- Automatically compare candidate formats and choose a smaller result with limited visual loss
- Before/after preview, actual output size, continuous quality and scale controls, and text watermarks
- Limit output to 200 KB, 100 KB, 50 KB, or a custom size using measured quality and dimension adjustments
- Import an entire folder recursively; large batches use the same low-memory queue
- Clipboard monitoring, global shortcuts, watched folders, and a local result library
- Clop-inspired floating results with copy, preview, undo, further downscaling, and format switching, plus clear success or failure feedback in the lower-left status area
- Configurable result limit, stacked/list layouts, and automatic dismissal
- Optionally exclude floating results from system screenshots and recordings on macOS and Windows; third-party capture tools may choose not to honor OS protection
- Replace, rename beside the source, or export to a fixed folder with scheduled cleanup
- Upload to WebDAV, S3/R2, OSS, FTP, or SFTP image hosts
- Load local HTML/JavaScript or URL workbench plugins; the library and folder watcher can also be toggled independently
- Tauri 2 + Rust desktop apps; images stay on your device by default

### Built-in plugin: Batch rename

Batch rename lives on its own plugin page. It extracts regex captures from ancestor folders at any depth, supports zero-padding and templates, and previews conflicts before applying changes. Folder monitoring can reuse the same parent-folder naming rules.

### Floating-window workflow

The desktop app can open its floating window from a global shortcut, copied image, dropped file, or the local image picker, without opening the full workbench first. After the smart first pass, hover over the preview to copy, preview, reveal, undo, downscale again, switch formats, add a watermark, or upload. Floating results are draggable and resizable, support cycling stacks and expanded lists, result limits and automatic dismissal, and let you choose up to six action buttons in Settings.

### Multi-task folder monitoring

Add and save tasks directly on the Folder Monitor page. Independent folders such as A, B, and C can run at the same time, each with its own format, quality, scale, dimensions, output location, naming rule, completion notification, and floating-result preference. Tasks take effect immediately and are restored after restart; PicLite must remain running, though it can be minimised to the tray.

## Download

Get the latest installers from [GitHub Releases](https://github.com/amiaoapp/PicLite/releases):

- Windows x64 / ARM64: `.exe`, `.msi`, or portable `.zip`
- macOS Apple Silicon / Intel: `.dmg`
- Linux x64 / ARM64: `.AppImage` or `.deb`

The current macOS builds use ad-hoc signing. On first launch, macOS may require approval in System Settings → Privacy & Security.

## Web and Docker

The [GitHub Pages demo](https://amiaoapp.github.io/PicLite/) is a static, install-free build. Images are processed locally in your browser and are not uploaded to a server. Use the desktop app for the system tray, global shortcuts, persistent clipboard monitoring, and watched folders.

For a LAN deployment, custom domain, or your own service endpoint, use the GHCR image. The default service port is `3456`.

### Docker Compose (recommended)

```bash
git clone https://github.com/amiaoapp/PicLite.git
cd PicLite
docker compose pull
docker compose up -d
```

Upgrade, inspect status, and follow logs:

```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
docker compose logs -f piclite
```

Create a `.env` file in the project directory to change the bind address, host port, or image tag:

```dotenv
PICLITE_BIND=0.0.0.0
PICLITE_PORT=3456
PICLITE_TAG=1.6.1
```

To build from the current source tree instead:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Docker Run

```bash
docker run -d \
  --name piclite \
  -p 3456:3456 \
  --restart unless-stopped \
  ghcr.io/amiaoapp/piclite:latest
```

Open `http://SERVER_IP:3456`. Both the GitHub Pages and Docker web builds include the compression workspace; browser security restrictions prevent system-tray, global-shortcut, and persistent folder-monitoring features.

For a reverse proxy, forward your domain to `http://127.0.0.1:3456`. Caddy example:

```caddyfile
piclite.example.com {
  reverse_proxy 127.0.0.1:3456
}
```

## Development

Requires Node.js 22.13+, stable Rust, and the Tauri 2 system dependencies for your target platform.

```bash
npm install
npm run dev
npm run desktop:dev
```

Test and build:

```bash
npm test
npm run desktop:build
```

## Create a workbench plugin

### Built-in plugin: Batch image rename

Open **Settings → Batch rename** and choose a root folder. This built-in plugin is enabled by default and can be disabled under **Settings → Plugins**. PicLite scans images recursively, searches ancestor folder names up to the selected root, and stops at the first matching parent.

- `A/A1/A11/【1-1】A111/A1111/photo.jfif` becomes `0101_photo.jfif` with the default rule.
- Numeric captures are zero-padded (`1-1 → 0101`, `11-1 → 1101`) without truncating longer values.
- Use `(风景|人物)` with `{1}_{name}` for Chinese words, or `([A-Za-z]+)` with `{1}_{name}` for English words.
- `{1:initial}` keeps the first initial; `{1:initials}` turns `New York` into `NY`.
- Templates also support `{code}`, `{name}`, `{ext}`, `{folder}`, `{match}`, `{1}`, `{2}`, `{index}`, and `{index:03}`. Review the preview before applying; unmatched files and existing targets are reported and never overwritten.

PicLite plugins are no longer embedded with an `iframe`. The desktop app fetches HTML/CSS/JavaScript and mounts it in a trusted workbench runtime, avoiding `X-Frame-Options` failures and allowing a custom tab name. Install only code you trust.

A minimal plugin is a single HTML file:

```html
<!doctype html>
<meta charset="utf-8">
<main id="tool">
  <h1>My image tool</h1>
  <button id="ready">Done</button>
</main>
<script>
  document.querySelector("#ready").onclick = () => {
    window.PicLitePlugin.post("ready", { ok: true });
  };
</script>
```

Open Settings → Plugins to import `.html`, `.js`, or `manifest.json`, or enter a custom name and HTTPS URL for the desktop app to fetch. Manifest example:

```json
{
  "nameZh": "封面设计大师",
  "nameEn": "Banner Maker",
  "url": "https://example.com/plugin/"
}
```

See the full [plugin development guide](docs/PLUGIN_DEVELOPMENT.en-US.md) for the runtime API, asset URL rules, and publishing notes.

## Privacy and licence

Optimisation runs locally in the browser or desktop app. Files leave your device only when you explicitly upload them to a storage provider you configured.

PicLite is licensed under [GPL-3.0-or-later](LICENSE). Its desktop automation workflow is inspired by and adapted from the GPL-licensed [FuzzyIdeas/Clop](https://github.com/FuzzyIdeas/Clop) project. PicLite does not use the Clop trademark. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


### Version 1.6: watch tasks and naming

Batch rename is now a built-in plugin (Settings → Batch rename). It searches ancestors up to the selected root and supports numeric padding, Chinese/English words, `{1:initial}` and `{1:initials}`. For example, `A/A1/A11/【1-1】A111/A1111/photo.jfif` becomes `0101_photo.jfif`. Preview detects existing targets and unrelated files are left alone.

Settings → Images saves independent watch tasks with individual formats, sizes, output locations, naming and system notifications. Non-overlapping roots run concurrently and resume when PicLite starts. Keep PicLite running, including in the tray. Choose whether to skip images that already meet the format and size requirements; folder naming still applies when enabled. Originals are preserved and generated outputs are excluded from watching.

JFIF uses the JPEG codec throughout import, compression and renaming. EPUB archives must be extracted separately. Windows x64 and ARM64 portable ZIPs store settings and cache in `PicLite-Data` beside the executable while `portable.txt` exists. WebView2 Runtime is required.
