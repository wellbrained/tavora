# README screenshots

Captured on 2026-10-17 from Tavora 0.17.6, source commit `1e1e34f`.

- `workspace.png`: Satisfactory, with fictional rich-text notes and a grouped checklist with sub-to-dos.
- `whiteboard.png`: Stardew Valley, with a saved sample farm-planning diagram.
- `appearance.png`: the built-in Appearance page with theme and light/dark controls.

These are native captures of a running Tavora window, including its WebContentsView module panels. They are not mockups or generated images. The app ran through the existing Playwright Electron harness with a fresh temporary `TAVORA_USER_DATA` profile. All notes, tasks and drawings are demo content; no real account, installed library, Steam cache or personal data was used. Online search, game-icon fetching and automatic updates were disabled, and the examples use generated game badges.

Window thumbnails were obtained through Electron's `desktopCapturer`, selected by the demo window's media-source ID. A host-page-only capture is unsuitable because it leaves out native module panels. Images are PNGs at 1600 × 1029 pixels; no image overlays or UI alterations were applied.

Refresh screenshots when the corresponding UI changes. Keep captions and alt text in the root README aligned with the actual images, and use a fresh demo profile rather than an installed or normal development profile.
