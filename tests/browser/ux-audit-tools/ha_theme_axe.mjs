// Runs axe color-contrast with the Home Assistant frontend DEFAULT palette applied via
// the --primary-color etc. variables (values from home-assistant/frontend
// src/resources/theme/color/color.globals.ts, dev branch). The harness captures use the
// component fallbacks (#0678ce), which HA never uses.   usage: node tests/browser/ux-audit-tools/ha_theme_axe.mjs
import AxeBuilder from "@axe-core/playwright";
import { launch, openScenario, inject } from "./common.mjs";

const HA = {
  light: {
    "--primary-color": "#009ac7", "--text-primary-color": "#ffffff", "--primary-background-color": "#fafafa",
    "--card-background-color": "#ffffff", "--secondary-background-color": "#e5e5e5", "--primary-text-color": "#141414",
    "--secondary-text-color": "#5e5e5e", "--divider-color": "rgba(0, 0, 0, 0.12)", "--disabled-text-color": "#bdbdbd",
    "--error-color": "#db4437", "--warning-color": "#ffa600", "--success-color": "#43a047",
  },
  dark: {
    "--primary-color": "#009ac7", "--text-primary-color": "#ffffff", "--primary-background-color": "#111111",
    "--card-background-color": "#1c1c1c", "--secondary-background-color": "#282828", "--primary-text-color": "#e1e1e1",
    "--secondary-text-color": "#9b9b9b", "--divider-color": "rgba(225, 225, 225, 0.12)", "--disabled-text-color": "#6f6f6f",
    "--error-color": "#db4437", "--warning-color": "#ffa600", "--success-color": "#43a047",
  },
};
const SCENARIOS = ["ready", "rooms", "draw", "plan-saved-intelligent", "plans", "history", "cleaning", "problem", "area-review-new", "support", "full-map"];
const VIEWPORTS = [[390, 844], [1440, 900]];

const { browser, context } = await launch();
const page = await context.newPage();
const agg = new Map();
let captures = 0;
for (const scheme of ["light", "dark"]) {
  for (const [w, h] of VIEWPORTS) {
    for (const sc of SCENARIOS) {
      await openScenario(page, sc, { width: w, height: h, theme: scheme });
      await page.evaluate((vars) => { for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); }, HA[scheme]);
      await page.waitForTimeout(250);
      captures += 1;
      const { violations } = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      for (const v of violations) for (const n of v.nodes) {
        const d = n.any?.[0]?.data ?? {};
        const key = `${scheme} | ${n.target.flat().slice(-1)[0]} | fg ${d.fgColor} on bg ${d.bgColor} = ${d.contrastRatio} (need ${d.expectedContrastRatio}) fs=${d.fontSize} fw=${d.fontWeight}`;
        const e = agg.get(key) ?? { n: 0, where: new Set(), text: (n.html || "").slice(0, 70) };
        e.n += 1; e.where.add(`${sc}@${w}`); agg.set(key, e);
      }
    }
  }
}
console.log(`axe color-contrast on ${captures} captures with HA default palettes`);
const rows = [...agg].sort((a, b) => b[1].n - a[1].n);
console.log(`${rows.length} distinct failing node/colour pairs`);
for (const [k, e] of rows.slice(0, 25)) console.log(`${e.n}x  ${k}\n      ${[...e.where].slice(0, 6).join(", ")}  ${e.text}`);
await browser.close();
