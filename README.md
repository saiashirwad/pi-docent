# pi-docent

Guided code tours that actually onboard you to a feature — generated once by the
agent from the real code, replayed forever for free.

A *docent* is the museum guide who walks you through the exhibit. This extension
makes your coding agent write the tour, then gets out of the way.

## Why not pi-compass?

pi-compass "tours" are filename heuristics — a file list with guessed
descriptions, no code ever read. pi-docent tours are written by the LLM after it
explores the feature, must cite real file/line ranges (validated on save), and
play back interactively with the live code on screen.

## Usage

| Command | What happens |
|---|---|
| `/tour` | Pick from saved tours and play it |
| `/tour auth` | Play the saved "auth" tour, or ask the agent to build it |
| `/tour auth --refresh` | Regenerate from current code |
| `/tour auth how sessions persist` | Extra focus hint for generation |

You can also just ask in plain words — "build me a tour of the billing webhooks"
— the agent knows about `save_tour`.

### Player keys

- `→` / `enter` / `space` / `n` — next step (past the last step exits)
- `←` / `p` — previous step
- `a` — ask the agent about the current step (prefills your editor with the
  step's file:lines so you just type the question)
- `q` / `esc` — quit

## How it works

1. **Generate (one agent run, uses tokens).** `/tour <topic>` sends the agent a
   structured exploration prompt. It reads the actual code, then calls the
   `save_tour` tool with 5–10 ordered steps (file, line range, plain-language
   explanation). The tool rejects steps whose files/lines don't exist, so the
   model can't hallucinate references — it gets the errors back and retries.
2. **Store.** Tours are JSON in `.pi/docent/` inside the project — commit them
   to share with your team. Each step records a content hash and an anchor line.
3. **Replay (zero tokens).** The player reads files live from disk with syntax
   highlighting. If a file changed since generation, the step re-anchors itself
   when it can (unique anchor line found) or shows a warning when it can't.

## Install

Already installed — this directory is auto-discovered by pi
(`~/.pi/agent/extensions/*/index.ts`). Edit and `/reload` to iterate.

Requires pi ≥ 0.80 (`@earendil-works` scope). No npm install needed at runtime;
pi aliases its own packages for extensions.
