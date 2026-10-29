# Leaderboards

A game module can rank its users: the longest winning streak in a word game, the fastest Sudoku, the most puzzles solved this week. Tavora keeps the boards on its service with each user's Tavora account, so your module needs no server and never handles a sign-in. Every call is in the [protocol](../reference/protocol.md#connectors) and [manifest](../reference/manifest.md#leaderboards) references.

Needs Tavora 0.21.92 or newer, so set `minTavora` to at least `0.21.92`.

## Declare the boards

```json
"minTavora": "0.21.92",
"permissions": { "network": [], "connectors": ["leaderboards"] },
"leaderboards": {
  "boards": [
    { "id": "daily", "name": "Daily streak", "kind": "streak", "daily": true },
    { "id": "fastest-easy", "name": "Fastest easy solve", "kind": "score", "order": "low", "unit": "s" },
    { "id": "solved", "name": "Puzzles solved", "kind": "total" }
  ]
}
```

Pick the kinds that fit your game; most use one or two.

| Kind | Takes | Ranks by | For example |
| --- | --- | --- | --- |
| `streak` | won or lost | the best winning streak, then the current one | a word game's streak; with `daily`, one game per day and a missed day ends it |
| `score` | a number | each user's best, highest or with `"order": "low"` lowest | the fastest solve, a high score |
| `total` | a number, 0 or more | the sum | puzzles solved (send `1` per game), points collected |
| `average` | a number | the mean, highest or lowest, after `minGames` games | the average solve time, guesses per word |
| `rate` | won or lost | the share of games won, after `minGames` games | the win rate |

- Every board has a `name` users see, for example in their Tavora profile. Translate it in `translations.<language>.boards`.
- `unit` (score, total and average) is shown after the number, such as `s`.
- `minGames` (average and rate, default 10) keeps one lucky game off the top.
- Separate modes get separate boards: one per difficulty, or daily apart from unlimited.
- Every board can be read for **today, this week, this month, this year and all time**. Declare each board once; you don't need a weekly copy.

## Before it goes live

- **Your copy from a folder** (Settings > Development), or any copy not installed from the catalog, gets test boards on Tavora's service right away, under `local.` and its id without the publisher part (`wellbrained.word-guess` becomes `local.word-guess`). Only you see your own line there, so you can try the whole flow. An account keeps up to 10 of them.
- **Your catalog module** gets its boards once Tavora allows it. The boards it runs are the ones your newest listed version declares.

## Ask the user first

Nothing goes public until the user agrees. Call `show` from a button; Tavora asks in your panel, in its own words, and your page waits hidden until they answer. Signed out, Tavora offers to sign in instead.

```ts
const status = await tavora.leaderboards.status();
// { online, signedIn, available, shown, name }

joinButton.onclick = async () => {
  const next = await tavora.leaderboards.show();
  if (next.shown) render(`You're on the boards as ${next.name}`);
};
```

- `online` is false while Tavora's service can't be reached; say so and ask again later. `status` never fails for that.
- `available` is false until Tavora allows your module. Hide your leaderboard buttons then.
- `name` is the name the boards show for the user, only once `shown`. It's their Tavora name, or a neutral one such as "User · K7" when their name can't be shown.
- Offer a way off too: `hide` (from a button) takes the user off your boards, and Tavora's service deletes their results there. Ask them first in your own words.

## Send results

Give every finished game a UUID once, keep it with the game, and send games in batches of up to 50. Sending a game again is safe: the board counts it once.

```ts
const game = { id: crypto.randomUUID(), outcome: won ? "won" : "lost", at: Date.now(), day: todayLocal() };
queue.push(game);

async function upload() {
  try {
    const { accepted, rejected } = await tavora.leaderboards.submit("daily", queue.slice(0, 50));
    // A refused game never counts, so both lists leave the queue.
    const done = new Set([...accepted, ...rejected.map((item) => item.id)]);
    queue = queue.filter((game) => !done.has(game.id));
  } catch (error) {
    // PERMISSION_DENIED: signed out or not shown yet. NETWORK_ERROR: offline or busy. Keep the queue and try later.
  }
}
```

- Games played while signed out count too. Keep them in your own storage and send them once `status` says `shown`. A daily game only counts until about a day and a half after its day ends; after that it comes back as `archive`.
- `at` is when the game ended, `day` the user's local day; the SDK fills `day` in from `at` when you leave it out. A game counts only when it ended within its `day`, so replaying an old puzzle from an archive never counts; it comes back as `archive`. On a daily board, give the puzzle's day yourself.
- A daily board takes one game per day. A second one comes back as `day-taken`.
- Each game is taken or refused on its own, so one bad game never holds up the others. Try again after `NETWORK_ERROR` with a growing wait, not in a loop.

## Show a board

```ts
const { rows } = await tavora.leaderboards.top("daily", { day: todayLocal(), limit: 10 });
// [{ rank: 1, of: 340, name: "Mara", self: false, current: 12, best: 30 }, ...]
const week = await tavora.leaderboards.top("solved", { period: "week" });
// [{ rank: 1, of: 52, name: "Mara", self: false, value: 41, games: 41 }, ...]
```

`period` is `day`, `week` (Monday to Sunday), `month`, `year` or `all` (the default); `day` picks which one, so you can show last week too. `of` is how many users the board has then. Equal lines share a rank. The user's own line has `self: true` and comes last when they are further down. Pass the user's local `day` on a daily board, so a streak that ended shows as 0. Show names as plain text.

## The user's own ranks

`mine()` gives the user's standing on every board in every period in one call, for a "#12 daily, #3 fastest" line:

```ts
const { boards } = await tavora.leaderboards.mine();
// [{ id: "daily", name: "Daily streak", periods: { day: null, week: { rank: 3, of: 80, current: 5, best: 5 }, ..., all: { rank: 12, of: 340, current: 5, best: 18 } } }, ...]
```

A period is `null` where the user isn't on the board, and all of them are while signed out or not shown. Tavora also lists these ranks in the user's profile card for every catalog module they joined; the user can hide that list.

## What users can trust

Your module never learns who a user is: no account id, email or anything made from one, only their public name on your boards and which line is theirs. Results come from the user's PC, so these are casual rankings, not verified competition. See the [security model](./security.md#leaderboards).
