# Filter lists

The Browser panel blocks ads and trackers with these lists. They are compiled
into `out/filters/engine.bin` at build time (`scripts/filters.mjs`). The lists
themselves are not shipped in the app.

| File | Source | License |
| --- | --- | --- |
| `easylist.txt.gz` | EasyList, https://easylist.to | CC BY-SA 3.0 (dual licensed with GPLv3; Tavora uses CC BY-SA 3.0) |
| `easyprivacy.txt.gz` | EasyPrivacy, https://easylist.to | CC BY-SA 3.0 (dual licensed with GPLv3; Tavora uses CC BY-SA 3.0) |

Copyright The EasyList authors (https://easylist.to/). The lists are used
unchanged, compressed with gzip.

To update them, run `node scripts/update-filters.mjs` in `apps/desktop` and
commit the result. The app never downloads lists by itself.

The engine is `@ghostery/adblocker` (MPL-2.0, https://github.com/ghostery/adblocker),
bundled unchanged into the main process.
