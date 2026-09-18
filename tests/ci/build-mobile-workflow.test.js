import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "build-mobile.yml");
const CAPACITOR_CLI_PACKAGE_PATH = path.join(
  ROOT,
  "node_modules",
  "@capacitor",
  "cli",
  "package.json",
);

function requiredNodeMajorVersion() {
  const { engines } = JSON.parse(readFileSync(CAPACITOR_CLI_PACKAGE_PATH, "utf8"));
  const match = /(\d+)/.exec(engines.node);
  assert.ok(match, `could not parse a major version out of engines.node "${engines.node}"`);
  return Number(match[1]);
}

function setupNodeVersionsInWorkflow() {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const versions = [...yaml.matchAll(/node-version:\s*"?(\d+)"?/g)].map((m) => Number(m[1]));
  assert.ok(versions.length > 0, "no node-version entries found in build-mobile.yml");
  return versions;
}

test("build-mobile.yml requests a Node version that satisfies @capacitor/cli's engines.node", () => {
  const required = requiredNodeMajorVersion();
  const versions = setupNodeVersionsInWorkflow();

  for (const version of versions) {
    assert.ok(
      version >= required,
      `actions/setup-node is pinned to Node ${version}, but @capacitor/cli requires >=${required}. ` +
        `"npx cap sync" fails immediately on older Node with "[fatal] The Capacitor CLI requires NodeJS >=${required}.0.0"`,
    );
  }
});

function capSyncInvocationsInWorkflow() {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const invocations = [...yaml.matchAll(/npx cap sync ([^\n]+)/g)].map((m) => m[1].trim());
  assert.ok(invocations.length > 0, "no npx cap sync invocations found in build-mobile.yml");
  return invocations;
}

function capSyncSupportedFlags() {
  const help = execSync("npx cap sync --help", { cwd: ROOT, encoding: "utf8" });
  return [...help.matchAll(/--[a-zA-Z-]+/g)].map((m) => m[0]);
}

test("build-mobile.yml only passes flags that npx cap sync actually supports", () => {
  const invocations = capSyncInvocationsInWorkflow();
  const supported = capSyncSupportedFlags();

  for (const invocation of invocations) {
    const flags = [...invocation.matchAll(/--[a-zA-Z-]+/g)].map((m) => m[0]);
    for (const flag of flags) {
      assert.ok(
        supported.includes(flag),
        `"npx cap sync ${invocation}" uses ${flag}, which isn't a supported option ` +
          `(cap sync --help lists: ${supported.join(", ")}). ` +
          `It fails immediately with "error: unknown option '${flag}'"`,
      );
    }
  }
});

test("android/gradlew is tracked in git with the executable bit set", () => {
  const output = execSync("git ls-files -s android/gradlew", { cwd: ROOT, encoding: "utf8" });
  assert.ok(output.trim().length > 0, "android/gradlew is not tracked in git");

  const mode = output.split(" ")[0];
  assert.equal(
    mode,
    "100755",
    `android/gradlew has git file mode ${mode}, expected 100755 (executable). ` +
      `Ubuntu CI runners fail "./gradlew assembleDebug" with "Permission denied" (exit 126) ` +
      `when the executable bit is missing. Fix with: git update-index --chmod=+x android/gradlew`,
  );
});

function xcodebuildTargetInWorkflow() {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const workspaceMatch = /-workspace\s+(\S+)/.exec(yaml);
  const projectMatch = /-project\s+(\S+)/.exec(yaml);
  assert.ok(
    workspaceMatch || projectMatch,
    "no -workspace or -project flag found for xcodebuild in build-mobile.yml",
  );
  return workspaceMatch
    ? { flag: "-workspace", value: workspaceMatch[1] }
    : { flag: "-project", value: projectMatch[1] };
}

test("build-mobile.yml's xcodebuild target actually exists in the repo", () => {
  const { flag, value } = xcodebuildTargetInWorkflow();
  const targetPath = path.join(ROOT, "ios", "App", value);

  assert.ok(
    existsSync(targetPath),
    `xcodebuild is invoked with "${flag} ${value}", but ios/App/${value} doesn't exist in the repo. ` +
      `xcodebuild fails immediately with "unable to find utility" / "does not exist" if the target is missing.`,
  );
});

test("build-mobile.yml doesn't run pod install unless ios/App has a Podfile", () => {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const runsPodInstall = /\bpod install\b/.test(yaml);
  const hasPodfile = existsSync(path.join(ROOT, "ios", "App", "Podfile"));

  if (runsPodInstall) {
    assert.ok(
      hasPodfile,
      `build-mobile.yml runs "pod install", but there's no ios/App/Podfile in the repo. ` +
        `CocoaPods fails immediately with "[!] No 'Podfile' found in the project directory." ` +
        `This project uses Capacitor's Swift Package Manager integration instead ` +
        `(ios/App/CapApp-SPM/Package.swift) - remove the CocoaPods step and build against ` +
        `-project App.xcodeproj, whose SPM dependencies xcodebuild resolves automatically.`,
    );
  }
});
