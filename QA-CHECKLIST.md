# QA / Fix Notes

## Fixed in this build

- [x] Firebase database URL kept on `asia-southeast1`
- [x] Room-code collision protection
- [x] Anonymous auth readiness gating
- [x] Firebase `.info/connected` status
- [x] `onDisconnect` player cleanup
- [x] Host migration after host leaves/disconnects
- [x] Turn recovery after current-turn player disconnects
- [x] Transaction-based dice claim
- [x] Persistent dice/no-move auto-pass
- [x] Correct token ownership on click
- [x] Token stacking
- [x] Four-colour finish cell
- [x] Better player/turn UI
- [x] Invite/share link
- [x] Defensive Realtime Database rules
- [x] Removed the GitHub Actions Pages workflow so it does not conflict with the branch-based Pages setup

## Validation performed

- JavaScript syntax check: PASS
- `database.rules.json` JSON validation: PASS
- Firebase config contains the supplied regional database URL
- ZIP excludes the uploaded repository `.git` history

## Remaining limitation

A static GitHub Pages + Firebase client can be hardened but cannot make dice generation and every game transition fully server-authoritative. For a public competitive game, use trusted Cloud Functions/backend validation.
