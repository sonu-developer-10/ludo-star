# Ludo India QA V4

- 52 unique shared-track cells validated.
- Red token route explicitly contains row 5 / column 7 (`[5,7]`).
- Four visible star/safe indices validated against the supplied reference as `9,22,35,48`; start cells remain protected separately.
- A single legal token auto-moves after a dice roll.
- Multiple legal tokens still require player selection.
- Capture and token movement are committed in one Firebase multi-location update.
- Exact finish remains position 57.
- No CSS token animation is used for selectable tokens.
