// Bundle finalization (part of WC-6): per-file checksums, the bundle content
// hash, and the CI-stamped build block in the dist manifest.
//
// bundleSha256 is computed over the dist tree BEFORE the manifest is stamped
// and before checksums.json exists: a hash cannot cover a file that contains
// the hash. checksums.json then covers every final file, including the
// stamped manifest. The registry's copy of the manifest stays canonical
// (CONTRACT-DECISIONS M4; PHASE-3 section 3.6).
//
// Usage: node finalize-bundle.mjs <distDir> --git-sha <sha> --pipeline <url> [--out <path>]
import crypto from "crypto";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const distDir = args[0];
const gitSha = valueOf("--git-sha");
const pipeline = valueOf("--pipeline");
const outPath = valueOf("--out");

function valueOf(flag) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function listFiles(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...listFiles(full));
        } else {
            results.push(full);
        }
    }
    return results;
}

// 1. Content hash over the authored tree, sorted for determinism.
const entries = listFiles(distDir)
    .map((full) => ({ rel: path.relative(distDir, full).split(path.sep).join("/"), full }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));

const manifestLines = entries.map((entry) => `${entry.rel}:${sha256(fs.readFileSync(entry.full))}`);
const bundleSha256 = sha256(Buffer.from(manifestLines.join("\n")));

// 2. Stamp the build block into the dist manifest copy.
const manifestPath = path.join(distDir, "xola-embedded-app.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.build = {
    gitSha,
    bundleSha256,
    builtAt: new Date().toISOString(),
    pipeline,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");

// 3. checksums.json covers every final file, including the stamped manifest.
//
// preStampManifestSha256 is the manifest hash that bundleSha256 actually
// covered, before step 2 rewrote the file. Without it bundleSha256 cannot be
// recomputed from what the CDN serves, so an auditor could only compare a
// claimed hash against itself (WC-9; scripts/verify-bundle.mjs).
const checksums = {};
for (const entry of entries) {
    checksums[entry.rel] = sha256(fs.readFileSync(entry.full));
}
const preStampManifestSha256 = manifestLines
    .find((line) => line.startsWith("xola-embedded-app.json:"))
    ?.split(":")[1];
fs.writeFileSync(
    path.join(distDir, "checksums.json"),
    JSON.stringify({ bundleSha256, preStampManifestSha256, files: checksums }, null, 4),
);

if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({ bundleSha256, fileCount: entries.length }, null, 4));
}
console.log(`bundleSha256: ${bundleSha256} (${entries.length} files)`);
