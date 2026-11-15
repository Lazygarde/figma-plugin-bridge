<!-- figma-to-android:begin -->
## Figma to Compose

UI is implemented from Figma through the `figma-to-compose` skill (plugin `figma-to-android`).

- Token map: `design/figma-tokens.json` (Figma variable name -> Kotlin token). Do not hardcode colors, spacing, radius or typography that have a token.
- Component map: `design/figma-components.json` (Figma component/variant -> Composable). Reuse before writing new UI.
- Screen registry: `design/screens.json` (Figma node id -> file -> status). Update it when a screen is done.
- TODO: where UI code lives (module/package), e.g. `feature/<name>/ui`.
- TODO: theme entry points (e.g. `AppTheme.colors`, `AppTheme.spacing`, `AppTypography`) and the shadow/gradient helpers.
- TODO: screenshot test command and the devices/font scales this project must support.
<!-- figma-to-android:end -->
