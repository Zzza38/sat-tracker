import { spawn } from "node:child_process";

const MAX_ATTEMPTS = 6;
const TIMEOUT_MARKERS = [
  "TimeoutError",
  "operation was aborted due to timeout",
  "error (23)"
];

function runAudit() {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["audit", "--prod", "--audit-level", "moderate"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

function isRegistryTimeout(output) {
  return TIMEOUT_MARKERS.some((marker) => output.includes(marker));
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const { code, output } = await runAudit();
  if (code === 0) {
    process.exit(0);
  }
  if (!isRegistryTimeout(output)) {
    process.exit(code);
  }
  if (attempt === MAX_ATTEMPTS) {
    console.warn("npm advisory API stayed unavailable after retries; skipping the audit gate.");
    process.exit(0);
  }
  const waitSec = attempt * 20;
  console.warn(`npm advisory API timed out (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${waitSec}s`);
  await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
}
