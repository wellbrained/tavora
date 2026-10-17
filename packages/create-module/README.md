# @tavora/create-module

Makes a new [Tavora](https://mytavora.app) module project.

```sh
npm create @tavora/module
# or
pnpm create @tavora/module
```

It asks where the project goes (the empty folder you are in, or a new folder in it), the module's name, its id (`publisher.module-name`) and a template: **vanilla** TypeScript, **vue** or **react**, picked with the arrow keys. Give them up front to skip the questions:

```sh
npm create @tavora/module raid-timer -- --template vue --id example.raid-timer --name "Raid Timer"
pnpm create @tavora/module raid-timer --template vue --id example.raid-timer --name "Raid Timer"
```

`--yes` takes the suggestions for anything not given.

The project builds with Vite, has a `dev` script that rebuilds on every change (add the folder in Tavora under **Settings > Development > Add a development folder…**; a folder with several projects in it works too), and a `zip` script that packs and signs it with `@tavora/pack`. Its manifest sets `minTavora` to the oldest Tavora that has everything the SDK it starts with offers. The project's README says the rest.

More in the [developer docs](https://docs.mytavora.app/guide/getting-started).
