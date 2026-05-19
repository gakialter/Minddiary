# v1.9.3 - Tag Style Enhancements

## Highlights
- Expanded tag styles with colors, emoji / short-symbol icons, display variants, and preset texture patterns.
- TagManager now supports creating and editing tag style fields in the same tag-management flow.
- Editor and SearchPanel now render tags through the shared TagBadge presentation for consistent styled tag display.

## Compatibility
- SQLite tags table migration remains backward-compatible while adding icon / variant / pattern fields.
- Browser fallback continues to support legacy tag data and applies compatible defaults for older saved tags.

## Security Boundary
- Custom tag artwork remains intentionally constrained.
- Image upload, remote images, custom SVG, and local file paths are not supported.
- Custom patterns are limited to emoji / short-symbol icons plus preset CSS textures.

## Follow-up Fixes
- Empty tag names now show a validation error.
- Updating a tag that does not exist now throws instead of silently succeeding.
- Editor tag buttons restore a visible focus-visible keyboard focus state.

## Validation
- npm.cmd install --package-lock-only
- npm.cmd run typecheck
- npm.cmd test -- --run
- npm.cmd run build
- npm.cmd run test:e2e
- git diff --check
