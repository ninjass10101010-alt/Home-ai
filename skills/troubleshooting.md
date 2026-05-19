# 🔧 Skill: Troubleshooting & Common Errors

If something goes wrong, consult this list before making random code changes.

## 1. The PocketBase Singleton Rule
**Symptom:** The chat history clears when navigating between pages, or real-time data stops updating.
**Cause:** The PocketBase client lost its WebSocket connection.
**Fix:** Verify that `src/lib/pocketbase.ts` uses the `globalThis` singleton pattern AND sets `autoCancellation(false)`. Never remove `autoCancellation(false)`.

## 2. Duplicate Declarations
**Symptom:** `npm run build` fails with `Block-scoped variable already declared`.
**Cause:** You declared a variable like `const currentDate` twice in the same scope in `route.ts`.
**Fix:** Remove the duplicate declaration.

## 3. Stale Files on NAS
**Symptom:** `Type error: Property 'X' does not exist on type 'never'` for a file that looks perfectly fine locally.
**Cause:** The NAS contains an old, obsolete version of the file (e.g. `src/components/WeatherWidget.tsx` vs `src/components/ui/WeatherWidget.tsx`).
**Fix:** Delete the old file on the NAS directly using `ssh` and `rm`, then trigger a rebuild.

## 4. UI Clipping / Hidden Elements
**Symptom:** Modal buttons are cut off on small screens.
**Cause:** Fixed-position modals without height limits.
**Fix:** Add `max-h-[90vh] overflow-y-auto` to the modal container's `className`.

## 5. Old Data Displaying Instead of New Data
**Symptom:** "I added a meal but it didn't show up on the dashboard."
**Cause:** The PocketBase query is sorting ascending by date (`sort: "date"`) without filtering out past dates, so it pulls the oldest records in the database.
**Fix:** Add a filter for the current date in the PocketBase query: `filter: date >= "YYYY-MM-DD"`.
