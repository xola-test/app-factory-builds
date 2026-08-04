// Size budgets per surface type (WC-4), warning and hard tiers per PHASE-3
// section 3.2. Values are the documented starting points; final numbers are
// a Phase 3 decision and belong in one place: here.
//
// Usage: node check-budgets.mjs <distDir> [--report <path>]
import fs from "fs";
import path from "path";
import zlib from "zlib";

const BUDGETS = {
    drawer: { warn: 150, hard: 300 },
    modal: { warn: 150, hard: 300 },
    fullscreen: { warn: 250, hard: 750 },
    none: { warn: 100, hard: 150 },
};

const args = process.argv.slice(2);
const distDir = args[0];
const reportIndex = args.indexOf("--report");
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;

const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "xola-embedded-app.json"), "utf8"));
const canvasType = manifest.canvas ? manifest.canvas.type : "drawer";
const budget = BUDGETS[canvasType] || BUDGETS.drawer;

const files = [];
function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
        } else {
            const raw = fs.readFileSync(full);
            files.push({
                path: path.relative(distDir, full),
                bytes: raw.length,
                gzipBytes: zlib.gzipSync(raw).length,
            });
        }
    }
}
walk(distDir);

const gzipTotal = files.reduce((sum, file) => sum + file.gzipBytes, 0);
const gzipKb = gzipTotal / 1024;

const report = {
    canvasType,
    gzipTotalBytes: gzipTotal,
    warnBudgetKb: budget.warn,
    hardBudgetKb: budget.hard,
    status: gzipKb > budget.hard ? "fail" : gzipKb > budget.warn ? "warn" : "ok",
    files: files.sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 20),
};

if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 4));
}

console.log(
    `Bundle: ${gzipKb.toFixed(1)}KB gzipped for canvas "${canvasType}" (warn ${budget.warn}KB, hard ${budget.hard}KB): ${report.status}`,
);
if (report.status === "fail") {
    console.error("FAIL: hard size budget exceeded. See the exception process in PHASE-3 section 3.2.");
    process.exit(1);
}
