import { execFileSync, spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  throw new Error("This preview command builds a macOS application.");
}
if (process.argv.slice(2).includes("--debug")) {
  throw new Error("Preview packages require Release optimisation.");
}

// Rust or Node may run under Rosetta. Select the actual Mac's architecture,
// rather than inheriting the architecture of the installed Rust toolchain.
let appleSilicon = execFileSync("uname", ["-m"], { encoding: "utf8" }).trim() === "arm64";
try {
  appleSilicon ||= execFileSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim() === "1";
} catch {
  // Restricted build environments may block sysctl; uname remains available.
}
const target = appleSilicon ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
console.log(`PicLite preview: Release / ${target}`);
const result = spawnSync("tauri", [
  "build", "--bundles", "app", "--target", target,
  "--config", "src-tauri/tauri.preview.conf.json", ...process.argv.slice(2),
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
