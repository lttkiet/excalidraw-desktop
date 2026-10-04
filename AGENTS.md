# Repository Guidelines

## Project Structure & Module Organization

The React and TypeScript frontend lives in `src/`: `App.tsx` contains the main interface, `main.tsx` mounts it, and `styles.css` holds app styles. Frontend tests live beside the code (currently `src/App.test.tsx`). Static assets are in `assets/`. The Tauri desktop shell, Rust code, capabilities, icons, and packaging configuration are in `src-tauri/`. Build support scripts are in `scripts/`; `copy-excalidraw-fonts.mjs` stages editor fonts before development and builds.

## Build, Test, and Development Commands

- `npm install` installs JavaScript dependencies.
- `npm run dev` starts the Vite frontend locally; its pre-script copies Excalidraw fonts.
- `npm run tauri:dev` starts the desktop app and requires Rust plus the operating system's Tauri prerequisites.
- `npm test` runs the Vitest suite once in jsdom.
- `npm run build` runs TypeScript project checks and creates the Vite production bundle in `dist/`; fonts are copied first.
- `cd src-tauri && cargo fmt --check && cargo test --locked` checks Rust formatting and runs backend unit tests.
- `npm run tauri:build:windows`, `npm run tauri:build:ubuntu`, and `npm run tauri:build:opensuse` create platform-specific installers. Linux packages should be built on their target distribution; see `README.md` for supported baselines.

## Coding Style & Naming Conventions

Follow the existing TypeScript and React patterns: use 2-space indentation, semicolons, double-quoted strings, and function components. Use `PascalCase` for React components and `camelCase` for variables and functions. Keep styles in `src/styles.css` and name tests `*.test.ts` or `*.test.tsx`. No dedicated formatter or linter is configured, so keep changes consistent with nearby files.

## Testing Guidelines

Use Vitest with React Testing Library; the configured environment is jsdom. Add or update focused tests in `src/` for user-visible behavior, then run `npm test`. No coverage threshold is configured. Run `npm run build` to catch TypeScript and production-bundling issues, and run the Rust checks above when changing `src-tauri/`.

## Commit & Pull Request Guidelines

The available history contains one initialization commit, so it does not establish a durable commit convention. Use a short, imperative subject that describes the change (for example, `Preserve draft when opening a file`). For pull requests, explain the user-visible change, list relevant verification commands, link related issues when applicable, and include screenshots for visual changes. Call out platform-specific effects for Tauri or installer changes.

## Security & Configuration Tips

Keep Tauri permissions narrow and review changes to `src-tauri/capabilities/` and `src-tauri/tauri.conf.json`. Do not commit credentials or local build output.
