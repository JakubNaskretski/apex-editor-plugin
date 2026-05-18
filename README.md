# Apex Editor

A lightweight VS Code extension for running ad-hoc anonymous Apex against any
authenticated Salesforce org, with a multi-tab scratch editor.

## Features

- **Multi-tab editor** in the Activity Bar — each tab keeps its own Apex
  source and persists across VS Code restarts (per workspace).
- **Org switcher** — pick any org already authenticated with the Salesforce
  CLI (`sf`); the selection is remembered globally and the default org is
  pre-loaded on first run.
- **One-click execution** — Run button (or `Ctrl+Enter` / `Cmd+Enter` in the
  editor) executes the active tab as anonymous Apex and renders the result
  (compile errors, exceptions, debug log) inline.

## Requirements

- VS Code `^1.105.0`
- [Salesforce CLI (`sf`)](https://developer.salesforce.com/tools/salesforcecli)
  installed and on your `PATH`, with at least one authenticated org
  (`sf org login web`).

## Commands

| Command | Description |
|---------|-------------|
| `Apex: Execute Active Script` | Run the current tab's code against the selected org. |
| `Apex: Select Org` | Quick-pick an authenticated org. |
| `Apex: New Script Tab` | Open a new empty tab. |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `apexEditor.executeTimeoutMs` | `60000` | Timeout for anonymous Apex execution. |
| `apexEditor.apiVersion` | `60.0` | Salesforce API version (reserved for future REST calls). |

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
npm install
npm run compile
# F5 in VS Code -> Extension Development Host
```

## License

[MIT](./LICENSE)
