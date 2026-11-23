# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The project's instructions live in `AGENTS.md` and apply here in full: the
layout, the architecture, the checks, the snapshot guard, the save rules and
the commit style. This file only adds what is specific to Claude Code.

@AGENTS.md

## Claude Code specifics

- `./tools/check-syntax.sh` fails inside the Claude Code sandbox ("Operation
  not permitted"); run it with the sandbox disabled.
- `.claude/launch.json` defines the dev server for the preview pane
  (`voxelcraft` on 8010, `voxelcraft-8000` on 8000). If the port is already
  taken by this repo's own server, navigate the pane to it instead of starting
  another.
- The preview pane keeps its own localStorage per port. Before running the
  snapshot guard there, check for a save under `SAVE_KEY` (from `src/save.js`) and back
  it up if it matters.
