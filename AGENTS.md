# AGENTS.md

## Project Overview

This repository contains `arcli`, a TypeScript-based ARCA billing CLI that is being refactored from a single-purpose script into an open source terminal application.

Current state:

- The project is early-stage and still centered around [src/index.ts](/Users/lcsgrz/Documents/GZSoft/AFIP/src/index.ts).
- The long-term goal is a modular CLI focused on ARCA voucher workflows.
- The currently installed ARCA SDK is `@arcasdk/core`.

Near-term supported business scope:

- Factura `A`, `B`, `C`
- Nota de credito `A`, `B`, `C`
- Nota de debito `A`, `B`, `C`
- Factura de credito electronica `A`, `B`, `C`
- Nota de credito electronica `A`, `B`, `C`
- Nota de debito electronica `A`, `B`, `C`

## Tech Stack

- TypeScript with ESM
- Node.js
- Yarn
- ESLint
- Prettier
- `@arcasdk/core`

## Repository Layout

Current structure:

- `src/index.ts`: current executable entry point and billing flow prototype
- `src/config.ts`: ARCA context prototype
- `src/certificados/`: certificate material currently committed in source form

Current direction:

- `src/cli/`: CLI parsing and command entry points
- `src/modules/`: business modules by domain
- `src/services/`: adapters around `@arcasdk/core`
- `src/lib/`: shared utilities
- `src/ui/`: terminal UI primitives, components and presenters
- unit tests colocated in `src/**/__tests__/`

UI import convention:

- Outside `src/ui`, prefer importing from the public UI barrels (`src/ui`, `src/ui/primitives`, `src/ui/components`, `src/ui/presenters`) instead of deep file paths.
- Inside `src/ui`, prefer direct file imports to keep dependencies explicit and avoid accidental circular references.

When restructuring, prefer small focused files and keep business logic out of the argument parser.

## Setup Commands

- Install dependencies: `yarn install`
- Run the CLI in development: `yarn dev --ayuda`
- Type-check: `yarn typecheck`
- Lint check: `yarn lint:eslint`
- Auto-fix lint issues: `yarn lint:eslint:fix`
- Check formatting: `yarn lint:prettier`
- Format files: `yarn lint:prettier:fix`

## Development Workflow

- Package manager is `yarn`; do not mix lockfiles or switch package managers.
- `yarn test` runs the real Vitest suite.
- Prefer incremental refactors over giant rewrites. Keep the CLI runnable after each meaningful step.
- Before adding new dependencies, check whether `@arcasdk/core` or the existing toolchain already covers the need.

## Coding Guidelines

- Use TypeScript `strict` mode patterns.
- Prefer explicit, validated input handling for all user-provided values.
- Keep CLI parsing separate from ARCA service calls and business rules.
- Avoid hardcoding CUITs, certificate contents, ticket paths, sales points, or voucher defaults in reusable modules.
- Prefer pure functions in `lib` and `modules` where possible.
- Model voucher types and CLI flags with typed constants or discriminated unions instead of scattered magic numbers.
- Keep output human-friendly by default, but design for a future `--json` mode.

## Security and Secrets

- Do not commit real certificates, private keys, tokens, or `.env` secrets.
- The current committed certificate files should be treated as migration debt and removed from source control during the hardening phase.
- Any future config system should resolve secrets from environment variables and/or explicit file paths outside source code.
- Be careful when logging ARCA responses; avoid exposing sensitive credentials or raw certificate material.

## Testing Instructions

Current state:

- Unit tests live colocated with source files under `src/**/__tests__/`.
- Before introducing major refactors, add tests for any logic that becomes reusable.

Expected direction:

- Keep unit tests close to the module they verify.
- Add integration-style tests around ARCA client adapters using mocks or fixtures when needed.
- Keep network-dependent tests isolated and clearly marked.

Before finalizing significant changes, run:

- `yarn typecheck`
- `yarn lint:eslint`
- `yarn lint:prettier`

## Documentation

Before changing user-facing behavior, review the relevant docs in `/docs`:

- `docs/mental-model.md`
- `docs/cli-reference.md`
- `docs/input-output.md`
- `docs/usage-patterns.md`
- `docs/troubleshooting.md`
- `docs/validation-rules.md`

These files describe the public behavior of the CLI from different angles. Keep them aligned when commands, flags, JSON, or execution flow change.

## Refactor Guardrails

- Do not expand the supported business scope beyond the voucher families listed above unless explicitly requested.
- Favor a stable CLI contract over clever abstractions.
- Treat the CLI contract as public and stable: commands, flags, config keys, and JSON formats should not change silently.
- If a new command shape would break the planned user-facing syntax, pause and document the tradeoff before changing it.
- Preserve a simple user experience: fast commands, clear help, minimal required flags.

## Open Source Readiness Checklist

When preparing the repository for public use, prioritize:

- Removing committed secrets and certificate material
- Making `package.json` publish-ready
- Adding a proper `bin` entry for the CLI
- Writing a user-facing `README.md`
- Adding examples for common voucher flows
- Defining license, versioning, and release workflow

## Pull Request / Change Guidelines

- Keep changes focused and logically grouped.
- Update docs when command behavior or setup changes.
- Do not silently change the CLI contract.
- If a task introduces architectural decisions, record them in docs before or alongside the implementation.

## Notes for Agents

- This project is in active redesign. Validate the current structure before assuming a planned path already exists.
- Treat the current implementation as a prototype, not as architecture to scale blindly.
- If the user asks for planning first, do not jump into implementation. Align on command design, module boundaries, security handling, and packaging before coding.
