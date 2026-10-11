# SCC Presenter

Free, open-source presentation software for churches — songs, scripture, media, stage screens, phone remote and livestream output.
Created by **AOG Sandton City Church**. MIT licensed: free to use, share and improve.

**Download:** [latest release](https://github.com/aogsccmedia-dot/scc-presenter/releases/latest) — Windows (`SCC-Presenter-Setup.exe`) and Mac (`SCC-Presenter.dmg`). Laptops and desktops only.

## Features
- **Songs** — paste lyrics and get clean slides. `[Verse 1]`, `[Chorus]` labels (or none — repeats are spotted automatically). Import from FreeShow (`.show`), OpenLP / OpenLyrics (`.xml`) and text.
- **Bible** — type `John 3:16-18`, `Ps 23` or `1 Cor 13`. Public-domain translations via [bible-api.com](https://bible-api.com); passages are cached for offline use.
- **Media** — pictures, videos and audio. Drag files onto the window. Use any picture or video as a background, and a picture as the church logo.
- **Service order** — build each service, drag to reorder, add section headers. Next/Space rolls straight into the next item.
- **Screens** — output to a projector or TV, a stage screen (current + next, clock, countdown, messages) and black / clear / logo with one key.
- **Connect** — phone remote with PIN, OBS Studio / vMix browser source (full screen or transparent overlay), stage screen on any browser or smart TV.
- **Share** — save a service as a `.sccshow` file (songs and media included), or share it over the local network to another computer.
- **AI helpers** — tidy pasted lyrics, find verses for a topic, turn sermon notes into slides. Works offline with built-in rules; add your church's own Claude API key in Settings for smarter results (stored encrypted on the computer).
- **Updates** — Windows updates itself; Mac shows when a new version is ready.

## Keyboard
`→` `Space` next · `←` previous · `1–9` jump · `B` black · `C` clear words · `L` logo · `Esc` clear all · `?` all shortcuts

## Develop
```bash
npm install
npm start          # run the app
npm test           # unit tests
npm run ui         # control screen in a normal browser (stand-in data)
```
Release: bump `version` in `package.json`, commit, then tag `vX.Y.Z` and push the tag. GitHub Actions builds both installers and publishes the release.
