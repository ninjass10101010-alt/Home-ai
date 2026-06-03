## TODO

- [x] Fix `/api/hermes/chat` action type + payload shape mismatch in `src/app/chat/page.tsx`
  - [x] Expand `ActionCard.type` to include OpenRouter action types (e.g. `add_task`, `add_event`, etc.)
  - [x] Update `executeAction()` to support `action.data` when `action.detail` is missing
  - [ ] Translate OpenRouter types into existing local behaviors (insert/update DB/localStorage)
  - [x] Improve fallbacks for `title/detail/emoji`
- [ ] Clean up duplicate `useEffect` block that deletes `q` from the URL
- [ ] Run `npm run lint` and `npm run build` to verify

