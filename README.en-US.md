

# PicLite

> License: GPL-3.0-or-later. Parts of the design and marked implementations for desktop automation capabilities are adapted from [FuzzyIdeas/Clop](https://github.com/FuzzyIdeas/Clop). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for detailed attribution.

![PicLite 图轻](public/og.png)

[![Build desktop apps](https://github.com/amiaoapp/PicLite/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/amiaoapp/PicLite/actions/workflows/release-desktop.yml)
[![GitHub release](https://img.shields.io/github/v/release/amiaoapp/PicLite?display_name=tag)](https://github.com/amiaoapp/PicLite/releases)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-43853d)](https://nodejs.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.11-24C8DB)](https://v2.tauri.app/)

PicLite is a local-first, self-hostable image and GIF compression workspace, supporting Web, Windows, macOS, and Linux. It can preview the output size in real-time before execution, and compress files to your exact requirements using continuous quality and dimension controls.

[Try Online](https://piclite-image.zwistidjaa331.chatgpt.site) · [Download Desktop App](https://github.com/amiaoapp/PicLite/releases) · [Report Issues](https://github.com/amiaoapp/PicLite/issues)

![PicLite 压缩、水印与导出界面](docs/images/piclite-workspace.png)

## Features

- Drag-and-drop, multi-file selection, and clipboard paste import; the desktop app optionally monitors the clipboard, automatically compressing newly copied images with current parameters and pasting the result back
- The desktop app copies the actual compressed file rather than a decoded bitmap, maintaining the true small file size of JPEG / WebP / PNG when pasted as an attachment
- Lossless metadata stripping and encoding optimization for JPG / PNG
- Format conversion between JPG / PNG / WebP, with continuous quality adjustment from 1–100%
- Frame-by-frame compression for animated GIFs, preserving animations while continuously controlling palette quality and dimensions
- Proportional scaling from 0.1–100%, stepwise halving, max width/height limits, and prevention of upscaling small images
- Every slider adjustment re-tests compression from the original image, displaying the real output size, pixel dimensions, and before/after quality comparison before execution
- Three preview modes: Compare / Original / Result, with mouse wheel zoom, drag-to-pan, fit-to-window, and 1:1 actual pixel inspection
- Smart anti-inflation: If a candidate result ends up larger after scaling, encoding quality is automatically reduced; the original image is kept if it still cannot be made smaller
- Text watermark: Natively reads and explicitly loads system fonts or imported font files, supporting angle, font size, opacity, 0–100% non-linear tiling density, free positioning, and drop shadows
- Four export modes: Download, Overwrite Source, Rename in Same Folder, and Fixed Folder
- The desktop app uses Tauri 2 + Rust for native handling of file selection, clipboard, export, and folder monitoring
- Readability-first responsive desktop layout: Panels and font sizes scale synchronously with window size; Windows 125% / 150% DPI and Retina displays are no longer incorrectly treated as compact mode
- Automatic high-DPI UI density, full Light / Dark / System theme support, with layout tightening only when approaching the minimum window size
- Resident only in the system tray / macOS menu bar: No icon in the taskbar or Dock; continues monitoring after the main window is closed or minimized
- Optional auto-start on boot; silently enters the tray after login without proactively popping up the main window
- Configurable global hotkeys: Show main window, import clipboard image, open floating compression dock
- Floating results in the bottom-right corner: Compact / Full styles; after compression, clipboard monitoring, or folder monitoring yields results, you can continue adjusting parameters, preview, copy, and locate files
- Local result gallery: Retains compression previews, sizes, pixel dimensions, local file paths, and image hosting links, allowing re-copying, locating, or uploading
- Desktop optional upload to generic S3 / MinIO, WebDAV, Cloudflare R2, Alibaba Cloud OSS, FTP, or SFTP; configurations and credentials can be saved to the current system user's PicLite config directory
- Automatically restores previous quality, scaling, watermark, and monitoring settings, and supports saving and deleting custom compression presets
- Desktop-specific app settings: Default output rules, fixed directories, extensions, overwrite confirmation, tray behavior, and about page
- Desktop app automatically checks GitHub Releases and prompts for updates; the web version detects the current OS and guides users to download the corresponding client
- Docker self-hosting and cross-platform automated builds via GitHub Actions

Images are processed locally in the browser or desktop client by default and are never uploaded to PicLite servers. Result images are only sent to your configured storage service when you actively click "Upload to Image Host"; the desktop app can save credentials to the current user's PicLite config directory based on your actions, without writing to web `localStorage` or syncing to PicLite servers. Due to browser permission restrictions, continuous folder monitoring and image hosting uploads are only available in the desktop client.

## Download Desktop App

Download the corresponding files from [GitHub Releases](https://github.com/amiaoapp/PicLite/releases):

| OS | Architecture | File |
| --- | --- | --- |
| Windows | x64 | NSIS Installer `.exe` or `.msi` |
| macOS | Apple Silicon（M1/M2/M3/M4…） | `arm64.dmg` |
| macOS | Intel | `x64.dmg` |
| Linux | x64 | `x86_64.AppImage` or `amd64.deb` |
| Linux | arm64 | `arm64.AppImage` or `arm64.deb` |

The desktop app is based on Tauri and no longer bundles a full Chromium engine; Windows uses system WebView2, macOS uses WebKit, and Linux uses WebKitGTK. Package sizes will vary depending on the platform, SFTP encryption libraries, and packaging format. Please refer to the Releases page for actual sizes.

Current macOS packages use ad-hoc signing and are not notarized with an Apple Developer ID. On first launch, if the system prompts that the developer cannot be verified, please confirm the open action in "System Settings → Privacy & Security". For official public distribution, configuring Apple Developer ID signing and notarization is recommended.

### Tray & Floating Compression Dock

After launching the desktop app, PicLite only shows an icon in the Windows system tray, macOS menu bar, or Linux status area, and does not retain an icon in the Windows taskbar or macOS Dock. Left-click restores the main window, right-click opens the floating compression dock, toggles quick presets, themes, and UI density, starts or stops folder monitoring, and fully quits the app. You can also enable auto-start on boot and record global hotkeys in App Settings.

Standard system tray APIs lack unified file drag-and-drop events across Windows, macOS, and Linux, so PicLite uses the tray menu to summon a floating compression dock that is always on top and has no taskbar icon. After compression, clipboard monitoring, or folder monitoring yields results, a result card expands in the bottom-right corner of the current screen; quality, dimensions, and JPG / PNG / WebP / Original format options are recalculated from the original image every time, supporting undo, preview, copy compressed file, locate file, and auto-collapse after 0–120 seconds.

### Image Host Upload & Gallery

In the desktop app's "App Settings → Image Host Upload", select generic S3 / MinIO, WebDAV, Cloudflare R2, Alibaba Cloud OSS, FTP, or SFTP, fill in the service address, remote directory, and public access URL, then click "Save to Local". The upload button in the top-right of the workspace and "Upload to Image Host" in the gallery will upload the current compressed result and copy the image link upon success.

- WebDAV uses HTTPS + Basic Auth; forcing HTTPS on the server side is recommended.
- Generic S3 uses Signature V4; Path-style can be disabled for AWS S3, while MinIO and most self-hosted compatible services typically require it enabled.
- R2 uses S3 Signature V4; Region is usually set to `auto`.
- OSS uses AccessKey signing; it is recommended to create a sub-account for PicLite with write permissions only to the specified Bucket.
- FTP is a plaintext protocol and is only recommended for trusted intranets; use SFTP for public networks.
- SFTP validates the system `~/.ssh/known_hosts`; before first use, run `ssh username@server` in a terminal and verify the server fingerprint.

Upload configurations and credentials are written to the current system user's PicLite config directory upon saving; Unix systems use file permissions readable/writable only by the current user. Gallery data is stored in the local WebView's IndexedDB; "Remove" only deletes gallery records and will not delete actual files or remote objects.

## Deploy on Server

Recommended: Ubuntu 22.04/24.04, Docker Compose, Nginx, and HTTPS. The server only serves the page; images are still processed locally in the visitor's browser.

![PicLite 服务器部署结构](docs/images/deployment.svg)

### Method 1: Single-command deployment with `docker run`

Suitable for servers that prefer launching directly with Docker commands. There are no pre-built public container images in the repository yet, so first build a local image from source:

```bash
git clone https://github.com/amiaoapp/PicLite.git /opt/piclite
cd /opt/piclite
docker build --pull -t piclite:local .
docker run -d \
  --name piclite \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  piclite:local
```

Check status, health checks, and logs:

```bash
docker ps --filter name=piclite
docker inspect --format '{{.State.Health.Status}}' piclite
docker logs --tail=100 piclite
curl -I http://127.0.0.1:3000
```

Update code and rebuild the container:

```bash
cd /opt/piclite
git pull --ff-only origin main
docker build --pull -t piclite:local .
docker rm -f piclite
docker run -d --name piclite --restart unless-stopped -p 127.0.0.1:3000:3000 piclite:local
```

Stop, restart, or completely remove the container:

```bash
docker stop piclite
docker start piclite
docker rm -f piclite
```

The port is only bound to `127.0.0.1`. Please continue using the Nginx and HTTPS configuration below to serve externally.

### Method 2: Docker Compose (Recommended for long-term maintenance)

#### 1. Prepare the Server

First, log in to the server via SSH:

```bash
ssh your_username@server_ip
```

Install Git and Nginx:

```bash
sudo apt update
sudo apt install -y git nginx
```

Follow the [Official Docker Ubuntu Installation Guide](https://docs.docker.com/engine/install/ubuntu/) to install Docker Engine, and follow the [Compose Plugin Guide](https://docs.docker.com/compose/install/linux/) to install `docker compose`. Verify after installation:

```bash
docker --version
docker compose version
```

If the current user lacks Docker permissions, you can temporarily use `sudo docker ...`, or follow the official Docker documentation to add the user to the `docker` group and log in again.

#### 2. Download PicLite

```bash
sudo mkdir -p /opt/piclite
sudo chown "$USER":"$USER" /opt/piclite
git clone https://github.com/amiaoapp/PicLite.git /opt/piclite
cd /opt/piclite
```

#### 3. Build and Start

```bash
docker compose up -d --build
docker compose ps
```

`docker-compose.yml` defaults to exposing the service only to the server's local `127.0.0.1:3000` to prevent bypassing Nginx and directly exposing the app. Check locally on the server first:

```bash
curl -I http://127.0.0.1:3000
docker compose logs --tail=100 piclite
```

If the status is `200`, PicLite is running normally.

#### 4. Bind Domain

First, add an `A` record at your domain registrar pointing to the server's public IP. Then, copy the Nginx template from the repository:

```bash
cd /opt/piclite
sed 's/piclite.example.com/piclite.yourdomain.com/g' deploy/nginx/piclite.conf \
  | sudo tee /etc/nginx/sites-available/piclite >/dev/null
sudo ln -s /etc/nginx/sites-available/piclite /etc/nginx/sites-enabled/piclite
sudo nginx -t
sudo systemctl reload nginx
```

Replace `piclite.yourdomain.com` in the command with your actual domain. If `/etc/nginx/sites-enabled/piclite` already exists, there is no need to create the symlink again.

#### 5. Enable HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d piclite.yourdomain.com
```

After completion, visit `https://piclite.yourdomain.com`. Browser capabilities like clipboard access, font loading, and folder writes typically require HTTPS or localhost, so HTTPS should be enabled for production deployments.

#### 6. Update Version

To apply new code releases in the future, simply run on the server:

```bash
cd /opt/piclite
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
docker image prune -f
```

View logs and stop services:

```bash
docker compose logs -f piclite
docker compose down
```

PicLite does not save user images, nor does it have a database or persistent directory, so backing up image data is unnecessary; only back up your modified Nginx, domain, and deployment configurations.

### Method 3: Node.js + systemd

When not using Docker, install Node.js 24 (minimum 22.13) on the server, then run:

```bash
sudo mkdir -p /opt/piclite
sudo chown "$USER":"$USER" /opt/piclite
git clone https://github.com/amiaoapp/PicLite.git /opt/piclite
cd /opt/piclite
npm ci
npm run build
node dist/standalone/server.js
```

For production environments, you can use the systemd service included in the repository. Verify that `/usr/bin/node` is the correct Node.js path, then run:

```bash
sudo useradd --system --home /opt/piclite --shell /usr/sbin/nologin piclite || true
sudo chown -R piclite:piclite /opt/piclite
sudo cp /opt/piclite/deploy/systemd/piclite.service /etc/systemd/system/piclite.service
sudo systemctl daemon-reload
sudo systemctl enable --now piclite
sudo systemctl status piclite
```

Nginx and HTTPS configurations are the same as the Docker method.

### One-click server update with GitHub Actions (Optional)

The `Deploy web app to server` workflow in the repository can execute `git pull` and `docker compose up` via SSH. In your GitHub repository, go to `Settings → Secrets and variables → Actions` and add:

| Secret | Content |
| --- | --- |
| `SERVER_HOST` | Server IP or domain |
| `SERVER_USER` | SSH username |
| `SERVER_PATH` | Project directory, e.g., `/opt/piclite` |
| `SERVER_SSH_KEY` | Full text of the SSH private key used by GitHub Actions |
| `SERVER_KNOWN_HOSTS` | SSH host key of the server |

`SERVER_KNOWN_HOSTS` can be generated in a trusted network using the command below, verify the server fingerprint, and then save it:

```bash
ssh-keyscan -H your_server_ip
```

After setup, open `Actions → Deploy web app to server → Run workflow` in the repository. The workflow defaults to not automatically deploying on every commit to prevent accidental operations; click manually when needed.

## Run Web Version Locally

Requires Node.js 24 (minimum 22.13):

```bash
git clone https://github.com/amiaoapp/PicLite.git
cd PicLite
npm install
npm run dev
```

Open `http://localhost:3000`.

## Run Desktop Version Locally

First, install [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) and Rust. Windows requires Microsoft C++ Build Tools and WebView2, Linux requires WebKitGTK, and macOS requires Xcode Command Line Tools. Then run:

```bash
npm ci
npm run desktop:dev
```

Tauri will automatically launch a dedicated Vite renderer and Rust backend. The official installer has the UI built-in and can run offline; no separate web development server is needed.

## Build for Windows, macOS, and Linux

First, install dependencies:

```bash
npm ci
```

Then run on the corresponding system:

```bash
# Windows: NSIS Installer + MSI
npm run desktop:build:win

# macOS: Specify architecture, outputs DMG
npm run desktop:build:mac:arm64
npm run desktop:build:mac:x64

# Linux: Specify architecture
npm run desktop:build:linux:arm64
npm run desktop:build:linux:x64
```

You can also run `npm run desktop:build` directly for the current system's default architecture. Artifacts are located at `src-tauri/target/<target>/release/bundle/`. Desktop apps should be built on the target OS; the repository's GitHub Actions use native Windows, macOS, and Linux runners.

### Auto-generate GitHub Release

After pushing a version tag, GitHub Actions will build five sets of desktop artifacts and automatically create a Release:

```bash
git tag v0.12.0
git push origin v0.12.0
```

To test builds without releasing a version, manually run `Actions → Build desktop apps → Run workflow` on GitHub. Files from manual runs will be saved in that workflow run's Artifacts.

## Compression Strategy

- **Lossless First**: Prioritizes stripping safely removable metadata and only accepts smaller results when no visual transformation occurs; otherwise, it keeps the original file.
- **Smart Balance**: Suitable for daily photos and web assets, balancing clarity and file size.
- **Smaller Size**: Reduces quality or uses PNG palettes, suitable for thumbnails and scenarios sensitive to loading performance.
- **Continuous Test Compression**: Minimum quality 1%, minimum size 0.1% (final dimensions not less than 1×1 pixels). Recodes from the original file every time to avoid cumulative degradation from repeated compression.
- **PNG Quality**: Uses color quantization to make the quality slider genuinely affect PNG file size while preserving the alpha channel.
- **GIF Quality**: Manual workspace regenerates 2–256 color palettes frame-by-frame; Rust auto-monitoring also preserves animations, adjusts dimensions, and quantizes colors.
- **Size & Volume Protection**: Typically only changes pixel dimensions; if the re-encoded file ends up larger than the original, it defaults to progressively finding smaller yet clearer encodings, keeping the original if it still cannot be reduced. Real-time results clearly indicate if automatic quality adjustment was triggered.
- **Preview Clarity**: Compare mode aligns results to the same visual size; switch to "Result" and click 1:1 to inspect downscaled images at actual pixels.

## Export Instructions

- **Browser Download**: Best compatibility, requires no folder permissions.
- **Overwrite Source**: Requires importing via the "Add Image" button and granting write permissions; to avoid extension/content mismatch, only allows keeping the original format.
- **Rename in Original Folder**: Desktop app automatically locates each source image's folder; web version requires manual authorization of the target folder.
- **Fixed Folder**: After selecting an output directory once, batch results are uniformly written with an editable filename suffix.

Auto-monitoring defaults to writing results to a `PicLite/` folder under the source directory, using the `-piclite` suffix, without overwriting source files.

## Project Structure

```text
app/                         Web UI and local real-time compression logic
desktop/                     Tauri-specific render entry and type-safe bridging
src-tauri/                   Rust backend, folder listening, system integration, and packaging config
deploy/nginx/                Nginx reverse proxy templates
deploy/systemd/              Node.js systemd service templates
.github/workflows/           Cross-platform builds, releases, server deployments
Dockerfile                   Web multi-stage production image
docker-compose.yml           Self-hosted startup and health checks
```

## Privacy Statement

The web version processes images locally using the browser's Canvas, WebCodecs, and File System APIs; the server only provides static resources and application code. The desktop version processes images locally via the system WebView and Rust backend, with no built-in image upload endpoints.
