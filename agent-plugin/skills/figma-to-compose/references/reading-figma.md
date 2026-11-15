# Reading Figma JSON (figma_get_node output)

The output is Figma REST-compatible JSON for the node, plus `variables` (resolved tokens) at the top level.

## Painting order

- `fills` and `strokes` arrays go from the bottom layer to the top layer. The last visible paint is what you see.
- A paint with `visible: false` does not render. A node with `visible: false` does not render, including its children.
- `opacity` on a paint multiplies with the color alpha. `opacity` on the node applies to the whole subtree.
- `blendMode` other than `NORMAL` changes how the layer mixes with the ones below (for example `DARKEN`, `MULTIPLY`). Compose: `drawWithContent` with `Paint.blendMode`, or `Modifier.graphicsLayer(compositingStrategy = Offscreen)` plus a blend mode. Check the result against the export.

## Variables and styles

- Bound variable: `boundVariables.<property>` is a `VARIABLE_ALIAS`. With the default `resolveVariables`, it has a `name` (token). Details are in the top-level `variables` map: collection, type, values per mode, `codeSyntax`.
- A variable that could not be resolved shows `unresolved: true`. Do not guess its name: use the raw value, mark it as unmapped and tell the user.
- A text node with `styles.text` points to a text style. The style name is in the top-level `styles` map. Map the style, not individual font properties.
- When a bound variable and a raw value disagree, the variable is the source of truth.

## Instances

- `type: INSTANCE` is a component instance. `componentId` and the top-level `components` / `componentSets` give the component name and variant (for example `Type=Square, Size=Large, Style=Primary`). Look it up in `design/figma-components.json`.
- `overrides` lists the properties changed from the main component. Only those differ from the component default.
- Nested instances are common (button > content > label). Several layers can carry radius, fill and stroke. Work out which one is actually visible before copying values.

## Geometry

- `absoluteBoundingBox` is in canvas coordinates. Use width/height, not x/y, for sizes. Positions inside auto layout come from the layout, not the coordinates.
- `cornerRadius` is one value. `rectangleCornerRadii` is `[topLeft, topRight, bottomRight, bottomLeft]`.
- `clipsContent: true` means children are clipped to the frame bounds and radius.
- `strokeAlign` (`INSIDE`, `OUTSIDE`, `CENTER`) changes the visual size. Compose `border` is inside.

## Text

- `style.fontSize`, `lineHeightPx`, `letterSpacing` (px) and `fontWeight`. Compose uses `sp` for text. Line height must be set explicitly, and font padding should be off or trimmed, or the height will not match.
- `textAutoResize`: `HEIGHT` means fixed width, grows in height (wrapping). `WIDTH_AND_HEIGHT` means hug.
- `characters` is the text. Do not hardcode it if the project uses string resources.

## Effects

- `DROP_SHADOW`: `offset`, `radius` (blur), `spread`, `color`. `Modifier.shadow` (elevation) is not the same thing. Use the project's shadow helper if it exists.
- `INNER_SHADOW`: no Compose equivalent. Use the project's helper or draw it with `drawWithContent`.
- `LAYER_BLUR` / `BACKGROUND_BLUR`: `Modifier.blur` (API 31+); the background blur needs a different approach. Ask when it is needed.

## Gradients

- `GRADIENT_LINEAR`: `gradientStops` (color + position) and `gradientHandlePositions` (start, end, width handle in 0..1 node space). Convert handles to pixel start/end for `Brush.linearGradient`.
- Several fills can be stacked (gradient over gradient over image): reproduce in the same order with `drawBehind` layers or `Brush`es.

## Images

- `IMAGE` paints only hold an `imageRef`. Fetch the file with `figma_export_image_fills` (original image, without crop or blend).
- `scaleMode`: `FILL` (crop to cover), `FIT`, `TILE`, `STRETCH` (uses `imageTransform`).
- `imageTransform` can flip or scale the image. Verify visually; do not trust a guess.
