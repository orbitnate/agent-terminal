# Restore Agent Terminal From GitHub

Private backup repo: `https://github.com/orbitnate/agent-terminal`

This repo contains the local terminal supervisor app used to create visible terminal
sessions, launch Claude Code, read screens, approve gated actions, and send input.

## Restore

Clone the repo, install Node dependencies, then start the app from the restored folder.
The exact local secrets or app state are not stored in GitHub.

The important recovery commands are documented in `README.md`. In this PITWM workflow,
new Claude sessions should be launched in yolo mode with Opus 4.8 because Fable 5 is not
available.

## Not In GitHub

- Local session state.
- API tokens.
- User-specific Claude state.
- Runtime logs.

Those are intentionally local. The source code and operational notes are backed up.

