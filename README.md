# Excalidraw Desktop

An offline drawing app built with Tauri and the Excalidraw editor. Drawings use the standard `.excalidraw` file format. The app keeps a local recovery draft and never writes it over the drawing file until you save.

## Development

Install Node.js and Rust, plus the native [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system, then run:

```powershell
npm install
npm run tauri:dev
```

## Build installers

On Windows, build the MSI installer:

```powershell
npm run tauri:build:windows
```

On Ubuntu, install Tauri's system dependencies and build a Debian package plus AppImage:

```bash
npm run tauri:build:ubuntu
```

On openSUSE, install Tauri's system dependencies and build the RPM package:

```bash
npm run tauri:build:opensuse
```

On openSUSE Tumbleweed, the GTK development packages are `gtk3-devel` and `webkitgtk3-devel`:

```bash
sudo zypper install gtk3-devel webkitgtk3-devel
```

The Linux release baselines are Ubuntu 24.04 LTS (amd64) and openSUSE Leap 16.0 (x86_64). The Debian package and AppImage are built on Ubuntu; the RPM is built on openSUSE Leap. Build Linux packages on the target distribution; Tauri recommends using the oldest supported base system to keep glibc requirements compatible. The RPM needs WebKitGTK 4.1 (`libwebkit2gtk-4_1-0`).
