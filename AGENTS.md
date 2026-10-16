# Repository Guidelines

## Project Structure & Module Organization

Snipvia is a screenshot AI desktop scaffold, currently prioritizing macOS. Windows has a basic adapter only. Product plans live in:

- `README.md`: project overview, scope, and development entry point.
- `docs/PRD.md`: requirements, product boundaries, and acceptance targets.
- `docs/TECHNICAL_DESIGN.md`: architecture, security, storage, and platform design.
- `docs/ROADMAP.md`: milestones and release gates, starting with M0 feasibility validation.
- `docs/UI_DESIGN_LANGUAGE.md`: the two required UI languages and their implementation patterns.

Use `src/main/` for privileged services, `src/main/storage/` for credentials and local history, `src/main/platform/` for platform adapters, `src/preload/` for narrow IPC bridges, `src/renderer/src/` for UI, and `src/shared/` for schemas and types. Tests live in `tests/unit/` and `tests/integration/`.

## Build, Test, and Development Commands

Use Node.js 24.15.x and pnpm 11.1.3. Run `pnpm install --frozen-lockfile`, `pnpm electron:install`, then `pnpm dev`. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before submitting changes. `pnpm test:smoke` builds and checks actual Electron windows using a mock provider. `pnpm build` compiles; `pnpm package` creates an unsigned application directory. Pin dependencies and commit the lockfile.

## Coding Style & Naming Conventions

Keep existing documentation in Simplified Chinese, with descriptive Markdown headings, relative links, and fenced examples. Clearly distinguish planned capabilities from verified behavior.

ESLint and strict TypeScript are configured; no formatter is installed. Use two-space indentation, PascalCase types/interfaces and React components, and camelCase functions/variables. Preserve lowercase feature-directory names such as `capture/`.

## UI Design Languages

Follow `docs/UI_DESIGN_LANGUAGE.md` for every renderer UI change. Screenshot schedule, screenshot chat, history, and future task surfaces use the workspace language and the shared `WorkspaceHeader`. Preferences, permissions, and provider configuration use the settings language: grouped rows with labels and descriptions on the left and controls on the right. Do not introduce a third page shell without updating the design document and explaining the product need.

## Testing Guidelines

Use Vitest `*.test.ts` unit tests and Playwright Electron `*.spec.ts` integration tests. No coverage threshold is established. Smoke tests must use temporary storage and synthetic screenshots.

Prioritize coordinate conversion, time zones, ICS, deduplication, and IPC validation. Mock AI cancellation, interrupted streams, and malformed JSON. Record real-device permission and mixed-DPI checks on both platforms. Treat PRD metrics as acceptance targets, not existing results.

## Commit & Pull Request Guidelines

Git metadata is absent, so historical commit conventions cannot be verified. Use imperative messages, for example `docs: clarify M0 capture validation`.

PRs should describe the change, reference the relevant milestone or issue, and report validation and unresolved platform limitations. Include screenshots for UI changes and update related design documents when scope changes.

## Security & Configuration

Never commit API keys, signing credentials, or private screenshots. Keep privileged operations and credentials in the main process, validate IPC and model outputs, and upload only the selected crop. User confirmation must precede saving extracted events; ICS export must not be described as calendar synchronization.
