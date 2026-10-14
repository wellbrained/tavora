# Module isolation threat model

**Status:** draft, to be written during Milestone A.

## Assets
## Trust boundaries
## Attacker: a hostile community module
## Required guarantees (Milestone A gate)

- No module can read or write another module's storage.
- No module can reach Node, Electron or OS APIs.
- No module can choose or spoof its own identity or the current game.
- Network access is denied unless the host mediates it.
- A crashing or hanging module does not take down the host or other modules.

## Open risks
