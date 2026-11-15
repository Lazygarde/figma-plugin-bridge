# Figma to Android rules

- When the user gives a Figma link, a node id (`12:34`, or `node-id=12-34` in a URL) or says "the selected frame", use the `figma-to-compose` skill.
- Read design data only through the `figma_*` tools. Never guess colors, sizes or spacing from a screenshot when `figma_get_node` can return them.
- Never hardcode colors, spacing, radius or text styles that are bound to a Figma variable or style. Look the token up in the repo's `design/figma-tokens.json` (and `design/figma-components.json` for components). If a token or component is not mapped, say so and ask, instead of inventing one.
- Reuse existing project components before writing new UI.
- A screen is not done until it builds and has been compared with the Figma export (see the skill's verify reference).
