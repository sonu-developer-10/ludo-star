# QA V5

- Visible star cells now match the supplied reference board: track indices 9, 22, 35, 48.
- Start cells remain capture-protected without rendering a star: indices 0, 13, 26, 39.
- Capture logic uses both star-safe cells and protected start cells.
- Board rendering only adds the visible `.safe` class to the four reference star cells.
- Existing single-valid-token automatic movement is preserved.

## V6 board-entry fix
- Red start: track 0 -> [7,1]
- Green start: track 12 -> [1,8]
- Yellow start: track 25 -> [8,15]
- Blue start: track 38 -> [15,8]
- Star/safe cells remain track 9, 22, 35, 48.
- Base exit on a 6 resolves to progress 0, therefore to the player's own coloured start cell.
