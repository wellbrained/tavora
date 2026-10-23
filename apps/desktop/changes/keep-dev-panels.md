# Panels of development modules survive a rebuild

- A module from a development folder that can't load for a moment, for example while a watcher rebuilds it, keeps its panels. The panel says so and starts again with the next build, also after a restart.
