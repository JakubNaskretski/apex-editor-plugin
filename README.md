# Apex Editor

A lightweight VS Code extension for running ad-hoc anonymous Apex against any
authenticated Salesforce org, in the bottom panel next to the Terminal.

## Features

- **Multi-tab editor** — each tab keeps its own Apex source and persists across
  VS Code restarts (per workspace), with Apex syntax highlighting and Tab/Shift+Tab
  indentation.
- **Snippet suggestions** — type a prefix (e.g. `sd` → `System.debug`) for an
  inline completion popup; navigate with the arrow keys and insert with Tab or
  Enter. Extend it with your own snippets via `apexEditor.customSnippets`.
- **Org switcher** — pick any org already authenticated with the Salesforce CLI
  (`sf`); the default org is pre-selected on first launch.
- **Production-run safeguard** — orgs are tagged prod/sandbox/scratch; a `[PROD]`
  badge and a confirmation dialog guard against accidentally running against a
  production org (toggle with `apexEditor.confirmProductionRun`).
- **One-click execution** — Run button or `Ctrl+Enter` / `Cmd+Enter` executes
  the active tab as anonymous Apex; runs are cancellable, and a compile error
  jumps the caret to the offending line.
- **Structured debug log viewer** — execution logs are parsed and displayed with
  per-category filter checkboxes (USER_DEBUG, SOQL, DML, EXCEPTION, SYSTEM).
- **Automatic trace flags** — a `DEVELOPER_LOG` trace flag is created for your
  user before each run if one isn't already active, so you always get full logs
  without manual setup.
- **Bottom-panel console** — opens as an "Apex Editor" tab in the bottom panel
  area (next to Terminal / Output), so editor, output and logs sit together.

## Requirements

- VS Code `^1.105.0`
- [Salesforce CLI (`sf`)](https://developer.salesforce.com/tools/salesforcecli)
  installed and on your `PATH`, with at least one authenticated org
  (`sf org login web`).

## Usage

1. Authenticate at least one org: `sf org login web`
2. Open the "Apex Editor" tab in the bottom panel (next to Terminal / Output).
3. Select your target org from the dropdown.
4. Write Apex in the editor and press **Run** (or `Cmd+Enter`).
5. Results and debug logs appear in the panels below.

## Commands

| Command | Description |
|---------|-------------|
| `Apex: Execute Active Script` | Run the current tab against the selected org. |
| `Apex: Select Org` | Quick-pick an authenticated org. |
| `Apex: New Script Tab` | Open a new empty tab. |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `apexEditor.executeTimeoutMs` | `60000` | Timeout (ms) for anonymous Apex execution. |
| `apexEditor.apiVersion` | `60.0` | Salesforce API version for Tooling API calls. |
| `apexEditor.confirmProductionRun` | `true` | Confirm before running against a production org. |
| `apexEditor.customSnippets` | `[]` | Your own editor snippets, merged over the built-ins. |

## License

[MIT](./LICENSE)
