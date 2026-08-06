// Security scanning (WC-5): static analysis plus dependency advisories,
// normalized into the one machine-readable scanReport that the elrond Build
// record stores, the reviewer UI renders, and Phase 4 agents consume.
//
// Blocking policy (PHASE-3 section 3.2 requires CI to fail on a scan failure):
//   - any ERROR-severity static finding blocks
//   - high or critical advisories in PRODUCTION dependencies block, because
//     those ship inside the bundle
//   - dev-dependency advisories are reported as warnings: they do not ship,
//     but a compromised build-time package is still worth surfacing
//
// Usage: node scripts/scan.mjs <sourceDir> --out scan-report.json [--rules <file>]
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const sourceDir = args[0];
const outPath = valueOf("--out") || "scan-report.json";
const rulesPath = valueOf("--rules") || new URL("../semgrep/xola-embedded-app.yml", import.meta.url).pathname;

function valueOf(flag) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

// Cap what we store: a pathological run should not push a huge document into
// the registry. The counts stay accurate even when the list is truncated.
const MAX_FINDINGS = 100;

const findings = [];
const scanners = [];

function record(scanner, status, findingCount, detail) {
    scanners.push({ name: scanner, status, findingCount, detail });
}

function run(command, commandArgs, options = {}) {
    return execFileSync(command, commandArgs, {
        cwd: options.cwd || process.cwd(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
}

// execFileSync throws on a non-zero exit, but both scanners exit non-zero
// precisely when they have something to report, so the output still matters.
function runAllowingFailure(command, commandArgs, options = {}) {
    try {
        return { ok: true, stdout: run(command, commandArgs, options) };
    } catch (error) {
        if (error.stdout) {
            return { ok: true, stdout: error.stdout };
        }
        return { ok: false, error };
    }
}

function scanStatic() {
    const probe = runAllowingFailure("semgrep", ["--version"]);
    if (!probe.ok) {
        // Not fatal on a developer machine; CI installs semgrep, so a skip
        // there would be visible in the report rather than silently passing.
        record("semgrep", "skipped", 0, "semgrep is not installed");
        return;
    }

    const result = runAllowingFailure("semgrep", [
        "scan",
        "--json",
        "--quiet",
        "--no-git-ignore",
        "--exclude=node_modules",
        "--exclude=dist",
        `--config=${rulesPath}`,
        "--config=p/javascript",
        "--config=p/typescript",
        sourceDir,
    ]);

    if (!result.ok) {
        record("semgrep", "error", 0, String(result.error.message || result.error).slice(0, 300));
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(result.stdout);
    } catch (error) {
        record("semgrep", "error", 0, "semgrep output was not valid JSON");
        return;
    }

    for (const result of parsed.results || []) {
        findings.push({
            scanner: "semgrep",
            ruleId: result.check_id,
            severity: (result.extra?.severity || "WARNING").toLowerCase() === "error" ? "error" : "warning",
            path: path.relative(sourceDir, result.path) || result.path,
            line: result.start?.line,
            message: (result.extra?.message || "").trim().replace(/\s+/g, " ").slice(0, 400),
        });
    }
    record("semgrep", "ok", (parsed.results || []).length, undefined);
}

function auditFindings(scope) {
    const commandArgs = ["audit", "--json"];
    if (scope === "production") {
        commandArgs.push("--omit=dev");
    }
    const result = runAllowingFailure("npm", commandArgs, { cwd: sourceDir });
    if (!result.ok) {
        return { status: "error", detail: "npm audit could not run", entries: [] };
    }

    let parsed;
    try {
        parsed = JSON.parse(result.stdout);
    } catch (error) {
        return { status: "error", detail: "npm audit output was not valid JSON", entries: [] };
    }

    const entries = Object.entries(parsed.vulnerabilities || {}).map(([name, vulnerability]) => ({
        name,
        severity: vulnerability.severity,
        via: (vulnerability.via || [])
            .map((entry) => (typeof entry === "string" ? entry : entry.title))
            .filter(Boolean)
            .join("; "),
    }));

    return { status: "ok", entries };
}

function scanDependencies() {
    if (!fs.existsSync(path.join(sourceDir, "package.json"))) {
        record("npm-audit", "skipped", 0, "no package.json");
        return;
    }

    const production = auditFindings("production");
    const everything = auditFindings("all");

    if (production.status === "error") {
        record("npm-audit", "error", 0, production.detail);
        return;
    }

    const productionNames = new Set(production.entries.map((entry) => entry.name));

    for (const entry of everything.entries) {
        const shipsInBundle = productionNames.has(entry.name);
        const blocking = shipsInBundle && ["high", "critical"].includes(entry.severity);
        findings.push({
            scanner: "npm-audit",
            ruleId: `advisory/${entry.name}`,
            severity: blocking ? "error" : "warning",
            path: "package.json",
            message:
                `${entry.severity} severity in ${shipsInBundle ? "a production dependency" : "a build-only dependency"}` +
                `: ${entry.name}${entry.via ? ` (${entry.via})` : ""}`.slice(0, 400),
        });
    }

    record("npm-audit", "ok", everything.entries.length, undefined);
}

// Socket.dev needs an account, so it activates only where a token is
// configured and reports itself as skipped everywhere else.
function scanSupplyChain() {
    if (!process.env.SOCKET_SECURITY_API_KEY) {
        record("socket", "skipped", 0, "SOCKET_SECURITY_API_KEY is not set");
        return;
    }

    const result = runAllowingFailure("npx", ["--yes", "@socketsecurity/cli", "scan", "create", "--json", sourceDir], {
        cwd: sourceDir,
    });
    if (!result.ok) {
        record("socket", "error", 0, "socket scan could not run");
        return;
    }
    record("socket", "ok", 0, "scan submitted; findings are reviewed in the Socket dashboard");
}

scanStatic();
scanDependencies();
scanSupplyChain();

const counts = findings.reduce(
    (totals, finding) => ({ ...totals, [finding.severity]: (totals[finding.severity] || 0) + 1 }),
    { error: 0, warning: 0 },
);
const scannerFailed = scanners.some((scanner) => scanner.status === "error");
const status = counts.error > 0 || scannerFailed ? "fail" : counts.warning > 0 ? "warn" : "ok";

const report = {
    status,
    generatedAt: new Date().toISOString(),
    scanners,
    counts,
    truncated: findings.length > MAX_FINDINGS,
    findings: findings.slice(0, MAX_FINDINGS),
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 4));

console.log(
    `Scan ${status}: ${counts.error} blocking, ${counts.warning} advisory ` +
        `(${scanners.map((scanner) => `${scanner.name}=${scanner.status}`).join(", ")})`,
);
for (const finding of report.findings.filter((entry) => entry.severity === "error")) {
    console.error(`  BLOCKING ${finding.ruleId} ${finding.path}${finding.line ? ":" + finding.line : ""}`);
}

if (status === "fail") {
    process.exit(1);
}
