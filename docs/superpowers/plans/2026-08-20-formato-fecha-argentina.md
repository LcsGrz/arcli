# Formato Fecha Argentina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all billing date inputs accept flexible Argentine date format with optional current month and year.

**Architecture:** Keep date parsing centralized in `BillingService.normalizeDate`, so CLI flags and JSON input share the same behavior. ARCA payloads keep using `YYYYMMDD` internally.

**Tech Stack:** TypeScript, Vitest, Commander, Zod.

---

### Task 1: Billing Date Parsing

**Files:**

- Modify: `src/modules/billing/billing.service.ts`
- Test: `src/modules/billing/__tests__/billing.service.test.ts`

- [x] Add tests for `DD-MM-YYYY`, `DD/MM/YYYY`, `DD-MM`, and `DD/MM`.
- [x] Add tests for `D`, `DD`, `D-M`, `DD/M`, and `D/M/YY`.
- [x] Add a test proving `YYYY-MM-DD` is rejected.
- [x] Update `normalizeDate` to parse only Argentine day-first formats.
- [x] Use the current system year when the year is omitted.
- [x] Use the current system month and year when the month and year are omitted.
- [x] Resolve two-digit years as `20YY`.
- [x] Run the focused billing service tests.

### Task 2: CLI Text, Docs, And Examples

**Files:**

- Modify: `src/cli/commands/billing.command.parser.ts`
- Modify: `src/modules/examples/examples.ts`
- Modify: `docs/validation-rules.md`
- Modify: `docs/input-output.md`

- [x] Update help text to advertise `D`, `DD`, `D-M`, `DD/MM`, `D-M-YY`, and full-year variants.
- [x] Update generated examples from ISO dates to Argentine dates.
- [x] Update docs to remove `YYYY-MM-DD` from accepted input.
- [x] Run formatting, type-check, and focused tests.
