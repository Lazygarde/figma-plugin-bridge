# Verify the implementation

Goal: compare what you built with the Figma export, fix differences, and stop after a bounded number of rounds.

## Loop

1. Reference: the PNG from `figma_export_image` (scale 2 is a good default).
2. Render the composable at the design size without a device:
   - Use the project's existing screenshot tooling if it has any (Paparazzi, Roborazzi, Compose Preview Screenshot Testing).
   - Otherwise use the Android CLI skills available in the environment to render `@Preview` functions (see `android-cli` / `compose-preview` skills).
3. Compare. Look at both images. If the project has an image diff script, use it first and only read the diff image when the score is below the threshold.
4. Fix the largest visible differences first: layout and sizes, then color and typography, then shadow, gradient and images.
5. Repeat at most **3 rounds**. Report what remains different.

## Matrix (responsive check)

Render the same screen with:

- small phone (about 360 x 640), normal phone (about 411 x 891), tablet (if supported)
- font scale 1.0, 1.3, 2.0
- dark mode if the app supports it
- RTL if the app supports it

There is no Figma reference for these. Check by rules instead: no clipped text, nothing overflows or overlaps, nothing important is hidden behind insets, touch targets stay at least 48dp.

## What to report

- Which Figma node was implemented and which files changed.
- Differences left (and why), and any token/component that was not mapped.
- Which sizes/font scales were checked.

## Notes

- Differences from font rendering, anti-aliasing and image scaling are normal; do not chase single pixels.
- Shadows, blends and stacked gradients are where differences usually remain. Check them in the zoomed-in export.
