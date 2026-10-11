# Helping with SCC Presenter

SCC Presenter is free and open source. Anyone can propose a change; the main admin of AOG Sandton City Church approves every change before it's released.

## How it works
1. **Fork** this repository (the *Fork* button, top right).
2. **Make a branch** in your copy, e.g. `better-bible-search`.
3. **Run it and test it:**
   ```bash
   npm install
   npm start        # opens the app
   npm test         # unit tests
   npm run ui       # the control screen in a normal browser, for quick design work
   ```
4. **Open a pull request** into `main` and fill in the short form.
5. **Automatic checks run:** unit tests, then the Windows installer and the Mac app are built, installed and opened on real machines. If anything fails, open *Details*, fix it and push again.
6. **The main admin reviews it** and approves, asks for changes, or declines. Approved changes go out in the next release (releases are made by raising `version` in `package.json`).

## Rules
- No passwords, keys or personal information in the code.
- Keep each pull request focused on one thing.
- Keep it easy: anything new should be usable by someone who has never run a presentation before.
