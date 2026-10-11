# Reproducible build & test environment for SCC Presenter (same tools every time, on any machine).
#   docker build -t scc-presenter-build .
#   docker run --rm -v "$PWD/dist:/project/dist" scc-presenter-build            # tests + Windows installer
# Mac .dmg files can only be built on a Mac (Apple's rule), so those come from the GitHub Actions macOS runner.
FROM electronuserland/builder:20-wine
WORKDIR /project
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN node --test test/*.test.js
CMD ["sh", "-c", "npx electron-builder --win --publish never"]
