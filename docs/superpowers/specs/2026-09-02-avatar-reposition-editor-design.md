# Photo Avatar Reposition Editor — Design

**Date:** 2026-09-02
**Status:** Implemented
**Component:** `src/components/profile/AvatarPicker.tsx` + NEW `src/components/profile/PhotoCropEditor.tsx`

## Problem

Photo avatars were auto‑cropped to a centered square at upload. A portrait/landscape
photo got its face cut off or left tiny in the small circular avatars. Users want to
**choose where the crop view sits** (Facebook‑style) when adding a profile photo.

## Decisions

- **Interaction:** drag to pan + zoom (pinch on touch, mouse wheel on desktop, plus
  on‑screen − / + buttons). Zoom range 1× → 3×.
- **Placement:** the reposition step is a **full‑screen modal editor**.
- **Re‑editing:** the editor opens **only at upload time**. Once saved the avatar is a
  256px square, so the original can't be recovered for a later re‑crop.

## Approach

Custom (no new dependency), matching the repo's hand‑built CSS/motion convention and
keeping `AvatarPicker`'s public API (`value`, `onChange`, `fallbackEmoji`) unchanged.

## Data flow

```
file → validate (type/size ≤5MB) → resize to ≤1024px (aspect‑preserving data URL)
     → PhotoCropEditor(src) → user pans/zooms → Apply
     → 256×256 canvas crop (transform → source rect) → WebP data URL → onChange(...)
```

`Cancel` closes the editor with no change. Emoji selection / "Use emoji" clears any
pending crop. The existing `centerCropSquare` default is reused as the editor's initial
("reset") position, so its unit test stays valid.

## Crop math (PhotoCropEditor on Apply)

- Viewport side `V` (CSS px). Image natural `imgW × imgH`.
- `cover = max(V/imgW, V/imgH)`, displayed size = `imgW·cover·zoom × imgH·cover·zoom`.
- Image wrapper positioned centered; transform `translate(tx,ty) scale(cover·zoom)`
  with `transform-origin: center` (CSS: `left:50%; top:50%; marginLeft:-imgW/2;
  marginTop:-imgH/2`), so the image center sits at viewport center + (tx,ty).
- Drawn `left = (V − W)/2 + tx`, `top = (V − H)/2 + ty` where `W,H` are displayed px.
- Source rect: `sx = −left / (cover·zoom)`, `sy = −top / (cover·zoom)`,
  `src = V / (cover·zoom)`.
- Draw `sx,sy,src,src` → `0,0,256,256` on a canvas, export WebP @0.85.

## Clamping

- `minZoom = 1`, `maxZoom = 3`.
- Pan clamped so the image always covers the frame:
  `|tx| ≤ (W − V)/2`, `|ty| ≤ (H − V)/2` (guaranteed ≥ 0 at zoom ≥ 1).

## Testing

- `tests/unit/avatar-crop.test.ts` — already covers `centerCropSquare` (kept).
- Add mapping tests for the transform→source-rect helper (a pure `getCropSourceRect`
  function) so the canvas draw is verified without a browser.
