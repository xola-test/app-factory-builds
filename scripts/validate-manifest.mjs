// Manifest validation (WC-3): JSON Schema plus the live-data rules a static
// schema cannot hold. The schema file is vendored from
// docs/contracts/xola-embedded-app.schema.json; the shared validation
// library (@xola/embedded-app-manifest, CONTRACT-DECISIONS M8 open item)
// replaces the vendored copy when it exists.
//
// Usage: node validate-manifest.mjs <path> --app-id <id> [--registry-url <elrond>]
import fs from "fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const args = process.argv.slice(2);
const manifestPath = args[0];
const appId = valueOf("--app-id");
const registryUrl = valueOf("--registry-url");

function valueOf(flag) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

let failed = false;
function fail(message) {
    console.error(`FAIL: ${message}`);
    failed = true;
}

if (!fs.existsSync(manifestPath)) {
    fail(`Manifest not found at ${manifestPath}. Every app repo must carry xola-embedded-app.json at its root.`);
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const ajv = new Ajv2020.default({ strict: false, allErrors: true });
addFormats.default(ajv);
const schema = JSON.parse(fs.readFileSync(new URL("../schema/xola-embedded-app.schema.json", import.meta.url), "utf8"));
const validate = ajv.compile(schema);

if (!validate(manifest)) {
    for (const error of validate.errors) {
        fail(`schema: ${error.instancePath || "/"} ${error.message}`);
    }
}

// CI stamps the build block into the dist copy; an authored one is always
// false information (CONTRACT-DECISIONS M4).
if (manifest.build !== undefined) {
    fail("The authored manifest must not contain a build block; CI stamps it at build time.");
}

if (appId && manifest.id !== appId) {
    fail(`Manifest id "${manifest.id}" does not match the registry app id "${appId}".`);
}

// Live registry cross-check: every declared trigger location must exist and
// support the app's trigger and canvas types.
if (registryUrl && !failed) {
    const response = await fetch(`${registryUrl.replace(/\/$/, "")}/trigger-locations`);
    if (!response.ok) {
        fail(`Trigger-location registry fetch failed: ${response.status}.`);
    } else {
        const payload = await response.json();
        const locations = new Map(
            (Array.isArray(payload) ? payload : payload.data || []).map((entry) => [entry.id, entry]),
        );
        for (const trigger of manifest.triggers || []) {
            const location = locations.get(trigger.location);
            if (!location) {
                fail(`Trigger location "${trigger.location}" does not exist in the registry.`);
                continue;
            }
            const triggerTypes = location.supportedTriggerTypes || [];
            if (triggerTypes.length && !triggerTypes.includes(trigger.type)) {
                fail(`Trigger location "${trigger.location}" does not support trigger type "${trigger.type}".`);
            }
            const canvasTypes = location.supportedCanvasTypes || [];
            if (canvasTypes.length && manifest.canvas && !canvasTypes.includes(manifest.canvas.type)) {
                fail(`Trigger location "${trigger.location}" does not support canvas type "${manifest.canvas.type}".`);
            }
        }
    }
} else if (!registryUrl) {
    console.log("NOTE: no --registry-url; trigger-location existence was not checked.");
}

if (failed) {
    process.exit(1);
}
console.log(`Manifest ok: ${manifest.id}@${manifest.version} (schema ${manifest.schemaVersion}).`);
