# Changelog

All notable changes to the Apex Editor extension are documented here.
This file starts at the current release; earlier history predates it.

## 0.3.2

- Fixed: **One org lookup at a time.** Opening the panel, running code and switching the
  shared org in another Skrety plugin could each spawn their own `sf org list` at the same
  moment — and a losing duplicate could flash a spurious "failed to list orgs" error even
  though the list loaded fine. Concurrent callers now share a single in-flight lookup.

## 0.3.1

- Fixed: **No more silent failures.** A panel click or a command (run, org pick, new tab)
  that hit an error could previously do nothing at all, with no message anywhere. Every
  failure now shows an error notification with a **Show Output** button and is logged to
  the output channel.

## 0.3.0

- Run Apex straight from the editor: execute the current `.apex` file or just
  the selected lines (editor title button + keybinding).
- Safer runs: unrecognized orgs are treated as production and always ask for
  confirmation; results are shown even when the panel is closed.
- Status-bar org indicator with a PROD badge; Run / New Tab buttons in the
  panel title bar.
- The selected org is now shared with the other Skrety Salesforce extensions —
  switch once, it applies everywhere.
- Fixes: cancel and timeout now cover debug-log setup; no more double runs from
  a stacked confirmation dialog; undo works after Tab-indent and snippet
  insert; sf CLI detection on Windows.

## 0.2.2

- Add a branded extension icon — shown on the Marketplace listing and the editor panel.

## 0.2.1

- Internal packaging and tooling cleanup. No functional changes.

## 0.2.0

- Multi-tab Apex editor for Salesforce with quick anonymous Apex execution
  against any authenticated org.
