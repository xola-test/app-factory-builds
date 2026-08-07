// Bundle integrity verification (WC-9).
//
// Recomputes the content hashes of a published bundle and checks them against
// the registry's recorded bundleSha256. This is the tamper check that bundle
// signing was meant to provide (PHASE-3 section 3.14), without a signing key.
//
// The verifier does NOT trust the per-file hashes in checksums.json: it hashes
// every file itself and uses checksums.json only for the file list and for the
// pre-stamp manifest hash. bundleSha256 comes from the registry, a different
// trust domain from the bucket. An attacker who can rewrite bucket objects can
// also rewrite checksums.json, but cannot make the recomputed hash match the
// registry's value without a sha256 preimage.
//
// Usage:
//   node verify-bundle.mjs <distDir|https://base/url> [--expect-sha <sha>] [--cookie <str>] [--no-bust]
import crypto from "crypto";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const source = args[0];
const expectSha = valueOf("--expect-sha");
const cookie = valueOf("--cookie");
const noBust = args.includes("--no-bust");

function valueOf(flag) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

const isRemote = /^https?:\/\//.test(source || "");

// A CDN edge holds several cached variants of one object, keyed on
// Accept-Encoding among other things. If a content path is ever rewritten,
// those variants refresh at different times, so a reader can get a mix of old
// and new files and see a mismatch that does not exist in the bucket. Observed
// live on 2026-08-07 after the same gitSha was rebuilt.
//
// The nonce and the no-cache headers are best effort only. They do NOT work
// against the current distribution, whose cache policy excludes query strings
// and ignores viewer Cache-Control. Treat a remote FAIL as a signal to re-check
// the origin, not as proof of tampering. The origin bucket is authoritative:
// point this script at a local copy synced from S3 for a verdict no cache can
// influence.
const nonce = process.hrtime.bigint().toString(36);

async function readFile(rel) {
    if (!isRemote) {
        return fs.readFileSync(path.join(source, rel));
    }

    const separator = rel.includes("?") ? "&" : "?";
    const url = `${source.replace(/\/$/, "")}/${rel}${noBust ? "" : `${separator}verify=${nonce}`}`;
    const response = await fetch(url, {
        headers: { ...(cookie ? { Cookie: cookie } : {}), "Cache-Control": "no-cache", Pragma: "no-cache" },
    });

    if (!response.ok) {
        throw new Error(`${rel}: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

if (!source) {
    console.error("Usage: node verify-bundle.mjs <distDir|url> [--expect-sha <sha>] [--cookie <str>]");
    process.exit(2);
}

const checksums = JSON.parse((await readFile("checksums.json")).toString("utf8"));
const failures = [];

// 1. Every listed file must hash to its recorded value.
const computed = {};
for (const rel of Object.keys(checksums.files).sort()) {
    let actual;
    try {
        actual = sha256(await readFile(rel));
    } catch (error) {
        failures.push(`${rel}: ${error.message}`);
        continue;
    }

    computed[rel] = actual;
    if (actual !== checksums.files[rel]) {
        failures.push(`${rel}: content hash ${actual} does not match checksums.json ${checksums.files[rel]}`);
    }
}

// 2. Rebuild bundleSha256 from the hashes computed above.
//
// The dist manifest is stamped with the build block after the hash is taken, so
// the served manifest hashes differently from the one the hash covered. The
// pre-stamp hash is recorded at finalize time; without it only step 1 can run.
let recomputed;
if (checksums.preStampManifestSha256) {
    const lines = Object.keys(computed)
        .filter((rel) => rel !== "checksums.json")
        .sort()
        .map((rel) =>
            rel === "xola-embedded-app.json"
                ? `${rel}:${checksums.preStampManifestSha256}`
                : `${rel}:${computed[rel]}`,
        );

    recomputed = sha256(Buffer.from(lines.join("\n")));

    if (recomputed !== checksums.bundleSha256) {
        failures.push(`recomputed bundleSha256 ${recomputed} does not match checksums.json ${checksums.bundleSha256}`);
    }
}

// 3. Anchor the result in the registry's value, the only field outside the bucket.
if (expectSha) {
    const anchor = recomputed || checksums.bundleSha256;
    if (anchor !== expectSha) {
        failures.push(`bundleSha256 ${anchor} does not match the registry's ${expectSha}`);
    }
    if (!recomputed) {
        console.warn("WARNING: bundle predates preStampManifestSha256; compared the claimed hash, not a recomputed one.");
    }
}

const fileCount = Object.keys(checksums.files).length;
if (failures.length) {
    console.error(`FAIL: ${failures.length} problem(s) across ${fileCount} file(s):`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    if (isRemote) {
        console.error("Source is a CDN. Re-check against the origin bucket before calling this tampering.");
    }
    process.exit(1);
}

console.log(`OK: ${fileCount} files verified${recomputed ? `, bundleSha256 recomputed as ${recomputed}` : ""}.`);
