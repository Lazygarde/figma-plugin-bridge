---
name: figma-to-compose
description: Implement or update Android Jetpack Compose UI from a Figma design. Use when the user provides a Figma link, a Figma node id, or refers to the selected/open Figma frame, or asks to compare a Compose screen with its design. Reads design data live from Figma Desktop through the figma_* MCP tools (figma-to-android bridge).
---

# Figma to Compose

## Prerequisites

1. Call `figma_ping`. It must return the open file name.
   - If it fails: ask the user to open the file in **Figma Desktop**, run **Plugins > Development > Design Live Bridge** and keep its window open (green dot = connected). The bridge process itself starts automatically.
2. The project should have `design/figma-tokens.json` and `design/figma-components.json` (created by `init-repo.sh`). If they are missing, tell the user and continue without token mapping.

## Workflow

1. **Locate the node.** Node id from the user or link (`node-id=12-34` becomes `12:34`). If none is given, use the selection (`figma_get_selection`). To browse: `figma_get_pages`, then `figma_get_metadata` with a page id and small `depth`.
2. **Survey cheaply.** `figma_get_metadata` (depth 2-3) to see the layer tree and sizes. Split big screens into sections and handle one section at a time.
3. **Get the reference image.** `figma_export_image` (scale 2). Look at it before reading JSON.
4. **Get details.** `figma_get_node` with the smallest useful `depth`. Variables are resolved by default: aliases carry a token `name`, and `variables` holds per-mode values and `codeSyntax`.
5. **Fetch assets.** If there are image fills (`imageRef`, `IMAGE` paints) use `figma_list_image_fills` then `figma_export_image_fills`. Icons/vectors: `figma_export_image` with `format: "SVG"` on the icon node.
6. **Map to the project.** Tokens through `design/figma-tokens.json`, components through `design/figma-components.json`. Prefer an existing composable. Read [layout-mapping](references/layout-mapping.md) for layout and responsive rules.
7. **Write the code.** Follow the repo's architecture and naming (see its `AGENTS.md`).
8. **Verify.** Follow [verify](references/verify.md). Do not stop at "it compiles".
9. **Update `design/screens.json`** (node id, file, status) if the project keeps it.

## Reading Figma JSON: the traps

Read [reading-figma](references/reading-figma.md) before interpreting `figma_get_node`. The most common mistakes:

- `fills` and `strokes` are listed **bottom to top**: the **last** entry is visible on top. A white variable-bound fill followed by a brown fill means the text is brown.
- Skip anything with `visible: false` (hidden icons are common in component instances).
- Prefer a bound variable (`boundVariables`, with resolved `name`) over the raw value.
- Layers can be stacked inside each other (a button inside a content layer, each with its own radius and fill). Decide which layer actually paints.
- Image fills are only a reference. Fetch the file, and apply `scaleMode`, `imageTransform` and `blendMode`.

## Keep token use low

- `figma_get_metadata` before `figma_get_node`; use `depth` and fetch per section.
- Do not paste whole JSON back to the user. Summarize.
- Reuse the export folder instead of exporting the same node twice.

## Definition of done

- Code builds.
- Compared with the Figma export at the design size (see verify).
- No hardcoded value that has a token; unmapped tokens/components reported to the user.
- Text, long text and large font scale do not break the layout.
