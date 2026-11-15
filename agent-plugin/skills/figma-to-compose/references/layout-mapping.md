# Layout and responsive mapping

## Auto layout to Compose

| Figma | Compose |
|---|---|
| `layoutMode: VERTICAL` | `Column` |
| `layoutMode: HORIZONTAL` | `Row` |
| No `layoutMode` (free layout) | `Box` with alignment. Use offsets only for decoration. |
| `itemSpacing` | `Arrangement.spacedBy(...)` |
| `paddingLeft/Right/Top/Bottom` | `Modifier.padding(...)` (use the token) |
| `primaryAxisAlignItems` | `Arrangement` of the main axis (`MIN` start, `CENTER`, `MAX` end, `SPACE_BETWEEN`) |
| `counterAxisAlignItems` | `Alignment` of the cross axis |
| `layoutSizingHorizontal: FILL` | `Modifier.fillMaxWidth()` (in a `Row`: `Modifier.weight(1f)`) |
| `layoutSizingHorizontal: HUG` | `wrapContentWidth()` (default) |
| `layoutSizingHorizontal: FIXED` | `Modifier.width(x.dp)` |
| `layoutSizingVertical: HUG` | `wrapContentHeight()`; use `heightIn(min = x.dp)` for a minimum |
| `layoutGrow: 1` | `Modifier.weight(1f)` |
| `clipsContent` | `Modifier.clip(shape)` |

## Responsive rules

- The design shows one size (usually phone). Everything else comes from these rules.
- Do not use a fixed height for anything that holds text. Use `heightIn(min = ...)`.
- Prefer `FILL` and `weight` over fixed widths. Fixed sizes only for icons, avatars, images with a known size.
- Screens with more content than the viewport must scroll (`LazyColumn`, or `verticalScroll`). Check the design for a fixed bottom bar and keep it outside the scrolling area.
- Handle insets: `WindowInsets.systemBars` / `safeDrawing`, IME for forms.
- Text uses `sp` and must survive font scale 1.3 and 2.0: wrap, do not clip. Set `maxLines`/`overflow` only where the design shows truncation.
- Touch targets at least 48dp even when the visual is smaller.
- Tablets/foldables: use `WindowSizeClass`. Only add expanded layouts when the project supports them or the design has an expanded frame; otherwise limit the content width and center it.
- Long, short, empty and error states: handle them even if the design shows only one.

## Screen types (starting point; adapt to the project)

- **List/feed:** `LazyColumn`, stable keys, content padding for insets.
- **Form:** scrollable column, IME padding, primary button pinned at the bottom.
- **Detail:** scrollable, header image with a fixed aspect ratio instead of a fixed height.
- **Dialog / bottom sheet:** max width on large screens, content scrolls if it does not fit.
- **Onboarding / full screen art:** images use `ContentScale` and aspect ratio; keep text on a safe area.

## Units

- Figma px map to `dp` for sizes and `sp` for text, 1:1.
- Use project tokens when a value is bound to a variable.
