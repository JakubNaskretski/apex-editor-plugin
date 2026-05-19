# Apex Editor

A lightweight VS Code extension for running ad-hoc anonymous Apex against any
authenticated Salesforce org — available both in the Activity Bar sidebar and
the bottom panel (next to Terminal).

## Features

- **Multi-tab editor** — each tab keeps its own Apex source and persists across
  VS Code restarts (per workspace).
- **Org switcher** — pick any org already authenticated with the Salesforce CLI
  (`sf`); the default org is pre-selected on first launch.
- **One-click execution** — Run button or `Ctrl+Enter` / `Cmd+Enter` executes
  the active tab as anonymous Apex.
- **Structured debug log viewer** — execution logs are parsed and displayed with
  per-category filter checkboxes (USER_DEBUG, SOQL, DML, EXCEPTION, SYSTEM).
- **Automatic trace flags** — a `DEVELOPER_LOG` trace flag is created for your
  user before each run if one isn't already active, so you always get full logs
  without manual setup.
- **Two panel locations** — use the ⚡ icon in the Activity Bar for a sidebar
  panel, or open the "Apex Editor" tab in the bottom panel area (next to
  Terminal / Output).

## Requirements

- VS Code `^1.105.0`
- [Salesforce CLI (`sf`)](https://developer.salesforce.com/tools/salesforcecli)
  installed and on your `PATH`, with at least one authenticated org
  (`sf org login web`).

## Usage

1. Authenticate at least one org: `sf org login web`
2. Open the Apex Editor from the Activity Bar (⚡) or the bottom panel.
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

## License

[MIT](./LICENSE)
