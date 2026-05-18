# v1.9.1 - Image Preview and Diary Search Fixes

## Highlights

- **Image Preview**: Diary attachments, search-result images, mistake-book images, mistake-edit images, and break-review images can now be clicked to open a larger preview.
- **Mistake Editing Flow**: Re-editing a mistake now scrolls back to the edit form and focuses the question field, reducing manual scrolling.
- **Blank Diary Search Cleanup**: Blank diary entries are filtered from search results, while non-empty entries with images or tags are preserved.
- **Search Result Deletion**: Diary entries can be deleted directly from search results with a confirmation step to prevent accidental deletion.

## Reliability

- Prevented transparent image-gallery overlays from blocking diary attachment thumbnail clicks.
- Added modal behavior improvements such as Escape close, backdrop close, close-button event isolation, and body scroll locking.
- Added request-race protection for enriched search results.
- Preserved existing local-first attachment and mistake-image storage paths.

## Validation

- `npm.cmd run typecheck`
- `npm.cmd test -- --run`
- `npm.cmd run build`
- `npm.cmd run test:e2e`
- `git diff --check`
