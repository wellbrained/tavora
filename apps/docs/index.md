---
layout: home

hero:
  name: Tavora
  image:
    src: /tavora-emblem.svg
    alt: Tavora campfire emblem
  text: Build modules for Tavora
  tagline: Modules are small web apps that run in sandboxed panels next to a game. This is how to build one, and how the host talks to it.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: SDK reference
      link: /api/

features:
  - title: Getting started
    details: Set up a module, connect to the host and store data per game.
    link: /guide/getting-started
  - title: Module manifest
    details: Every field of tavora.module.json and what Tavora refuses.
    link: /reference/manifest
  - title: Bridge protocol
    details: The versioned wire format, errors, limits and capabilities.
    link: /reference/protocol
  - title: "@tavora/sdk API"
    details: Generated from the SDK's TypeScript sources.
    link: /api/
---
