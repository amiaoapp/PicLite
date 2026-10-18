# PicLite

**Keep the detail. Lose the weight.**

A local image and animation workbench for compression, comparison, conversion, resizing and batch naming.

[Desktop downloads](https://github.com/amiaoapp/PicLite/releases) · [Web demo](https://amiaoapp.github.io/PicLite/) · [中文](README.md) · [MCP setup](docs/MCP.md)

![PicLite Studio](docs/images/studio-light.jpg)

This README describes the current source. Published binaries and the hosted demo may use an earlier revision.

## What you can do

- Compare real JPEG, WebP and PNG encodes and export the smallest valid candidate. Transparent images skip JPEG.
- Batch compress, resize, set a target file size, and watermark images and GIFs while preserving animation.
- Use dedicated format conversion, resize/enlarge, parent-folder naming and local gallery tools.
- On desktop, automate clipboard and folder workflows, use global shortcuts and keep results in a floating window.
- Extend the workbench with trusted HTML/JavaScript plugins or call local image tools through MCP.

## Desktop and browser

Windows, macOS and Linux packages are available in [Releases](https://github.com/amiaoapp/PicLite/releases). Browser and Docker editions process images locally in the visitor's browser and export through browser downloads or authorized file access.

Choose **Classic** or **Studio** from the top-right Interface style control. Classic remains the default. Switching appearance preserves the current queue, settings and results; both layouts use the original processing code. All four colour palettes and light/dark/system modes remain available.

Dedicated conversion, resize and batch naming plugins, continuous monitoring, global shortcuts and floating windows use the desktop client. The browser retains its existing compression workbench. Direct file writes require browser File System Access support and explicit permission.

## Docker

```bash
docker run -d --name piclite -p 3456:3456 \
  --restart unless-stopped ghcr.io/amiaoapp/piclite:latest
```

Open `http://localhost:3456`. To build the current source:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

No image-directory mount is required. The container serves the application; the browser processes images. Use HTTPS for browser capabilities that require a secure context.

## Develop

Node.js 22.13+ is required. Desktop builds also need Rust stable and Tauri 2 platform dependencies.

```bash
npm ci
npm run dev
npm run desktop:dev
npm test
npm run pages:build
```

## Agents, plugins and license

Run `piclite --mcp` for the built-in stdio server. Compatible MCP clients can inspect and process local images. ChatGPT uses an HTTPS MCP bridge; see the [MCP guide](docs/MCP.md).

Import trusted local HTML/JavaScript plugins in Settings. URL plugins are subject to browser CORS rules. [Plugin development guide](docs/PLUGIN_DEVELOPMENT.en-US.md).

Images remain local unless you explicitly upload them to a configured service. PicLite is [GPL-3.0-or-later](LICENSE), with desktop workflows adapted from [Clop](https://github.com/FuzzyIdeas/Clop). See [third-party notices](THIRD_PARTY_NOTICES.md), including UI dependencies and the generated decorative photograph.
