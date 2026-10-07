# 🇮🇳 Ludo India — Online Multiplayer

A polished 2–4 player Indian-style Ludo game for GitHub Pages + Firebase Realtime Database.

## What was fixed in this version

- Better mobile/desktop UI with Indian game-style board
- Live Firebase connection indicator
- Safer room creation with collision protection
- Room invite/share link
- Copy room code
- Automatic player presence using Firebase `onDisconnect`
- Host automatically transfers when the host leaves/disconnects
- Turn automatically recovers if the current-turn player disconnects
- Dice double-roll protection using Firebase transactions
- Persistent dice state so refreshes don't silently lose a turn
- Automatic pass when no token can move
- Correct token-click ownership (you cannot accidentally move another player's token)
- Token stacking so multiple tokens on one square remain visible
- Four-colour finish area
- Better player/turn indicators
- More defensive Firebase Database Rules
- GitHub Pages friendly static deployment

> This is still a client-side Firebase game. The rules are hardened for a friends/private game, but a determined user with browser developer tools can still manipulate client-side game logic. For a competitive/public game, move dice generation and complete move validation to a trusted backend/Cloud Functions.

---

## 1. Firebase setup

Open the Firebase Console and make sure the same project is used by `firebase-config.js`.

Enable:

1. **Authentication → Sign-in method → Anonymous → Enable**
2. **Realtime Database → Create Database**
3. Realtime Database → **Rules** → paste `database.rules.json` → **Publish**

### Important database URL

If your database is in `asia-southeast1`, your config must contain:

```js
databaseURL: "https://YOUR_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app"
```

Do not replace this with a generic `firebaseio.com` URL when Firebase tells you the database lives in another region.

---

## 2. Firebase web config

Open:

```text
firebase-config.js
```

The current project config is already filled in for the supplied Firebase project.

If you move this game to another Firebase project, replace:

- `apiKey`
- `authDomain`
- `databaseURL`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

A Firebase Web App config is meant to be used in client-side code. Do not put a Firebase Admin SDK private key in this file.

---

## 3. Run locally

Because the project uses browser ES modules, do not open `index.html` with `file://`.

Use VS Code Live Server, or:

```bash
python -m http.server 5500
```

Then open:

```text
http://localhost:5500
```

---

## 4. GitHub Pages

Upload the project files to the **root of your `main` branch**:

```text
index.html
style.css
app.js
firebase-config.js
database.rules.json
README.md
.gitignore
```

Then:

**GitHub → Repository → Settings → Pages**

Use:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Save.

Your site will normally be:

```text
https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/
```

---

## 5. How friends play

1. Open the website.
2. Host enters name and chooses 2/3/4 players.
3. Click **Room बनाएं**.
4. Copy/share the room code.
5. Friends open the same website and join using the code.
6. When all seats are filled, host clicks **Start Game**.
7. Each player gets a fixed colour/seat.

If someone closes their browser or loses connection, Firebase presence removes their player entry and another connected player can automatically recover the host/turn.

---

## 6. Rules in this build

- Roll 6 to bring a token out.
- Move by the dice value.
- Landing on an opponent on a non-safe square captures it.
- 6 gives an extra turn.
- Capture gives an extra turn.
- Three consecutive sixes end the turn.
- Exact roll is required to reach the final home.
- First player to get all four tokens home wins.
- Safe/star cells cannot be captured.

Different physical Ludo boards use slightly different rules, so this is an Indian-style casual implementation.

---

## 7. If Firebase shows a 404 / different-region warning

Check `firebase-config.js`.

For the supplied Firebase project the Realtime Database URL is:

```text
https://ludo-star-2f7f9-default-rtdb.asia-southeast1.firebasedatabase.app
```

Also verify:

```text
Authentication → Anonymous = Enabled
Realtime Database = Created
Realtime Database → Rules = Published
```

After changing config, refresh with:

```text
Ctrl + Shift + R
```


## V7 changes
- Red start cell is `cell-7-2`; all player start cells are aligned to the first playable cell after each corner.
- Moving tokens are larger; home tokens remain four rounded-square slots.
- Firebase `onDisconnect().remove()` was removed so screen lock/background disconnect does not remove a player. Players leave only via the Leave button.
- Captures broadcast a 3-second full-screen `AA GAYA SWAD` animation to everyone in the room.
