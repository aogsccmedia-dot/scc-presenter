// macOS: builds aren't signed with an Apple certificate yet. Apple Silicon Macs refuse to run apps with no signature
// at all ("damaged"), so we add a free ad-hoc signature to the final universal app. Users still confirm the first
// open (Control-click → Open, or System Settings → Privacy & Security → Open Anyway).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return; // a real certificate was used
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
