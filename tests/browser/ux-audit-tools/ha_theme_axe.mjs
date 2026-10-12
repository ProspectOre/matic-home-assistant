// Runs axe color-contrast with the Home Assistant frontend DEFAULT palette applied via
// the --primary-color etc. variables (values from home-assistant/frontend
// src/resources/theme/color/color.globals.ts, dev branch). The harness captures use the
// component fallbacks (#0678ce), which HA never uses. It also measures the pairs axe
// does not (design-system.md §5): the focus ring (3:1 on the card and sunken surfaces),
// danger text (4.5:1 on the card) and each filled button's label on its hover and
// pressed fill (4.5:1).   usage: node tests/browser/ux-audit-tools/ha_theme_axe.mjs
import AxeBuilder from "@axe-core/playwright";
import { GALLERY_TAG, launch, openScenario } from "./common.mjs";

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
// plan-cadence-blocked and area-review-rebind show the workflow panel's
// problem and warning boxes.
const SCENARIOS = ["ready", "rooms", "draw", "plan-saved-intelligent", "plans", "history", "cleaning", "problem", "area-review-new", "area-review-rebind", "plan-cadence-blocked", "support", "full-map"];
// The notice slot and toast in each tone, over `ready` (design-system.md: the notice-* patches).
const CAPTURES = [
  ...SCENARIOS.map((scenario) => ({ id: scenario, scenario, patch: null })),
  ...["info", "success", "warning", "error"].map((tone) => ({
    id: `notice-${tone}`,
    scenario: "ready",
    patch: { notice: { tone, key: "v4_notice_audit_sample", fallback: "Sample notice text" } },
  })),
];
const VIEWPORTS = [[390, 844], [1440, 900]];

const luminance = (rgb) => rgb.reduce((sum, channel, index) => {
  const value = channel / 255;
  return sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
}, 0);
const ratio = (a, b) => {
  const [high, low] = [a, b].map(luminance).sort((x, y) => y - x);
  return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
};
const hex = (value) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
// A computed colour in any syntax (color-mix gives oklab or color()) as the sRGB pixel painted.
const paint = (locator, property) => locator.evaluate((element, name) => {
  const context = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { colorSpace: "srgb" });
  context.fillStyle = getComputedStyle(element)[name];
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}, property);

// The focus ring on a panel control, the Draw zone feedback (Points shows it) and
// every enabled filled button hovered and pressed. A press moves off the button
// before release, so nothing is clicked.
async function stateContrast(page, scheme, record) {
  const palette = HA[scheme];
  const [card, sunken] = [palette["--card-background-color"], palette["--secondary-background-color"]].map(hex);
  const check = (what, fg, bg, need) => {
    const value = ratio(fg, bg);
    if (value < need) record(`${scheme} | ${what} | fg rgb(${fg}) on bg rgb(${bg}) = ${value} (need ${need})`);
  };
  const gallery = page.locator(GALLERY_TAG);
  const control = gallery.locator(".sheet-body, .workflow-body").locator(".ms-btn:visible, .ms-row:visible").first();
  if (await control.count()) {
    await page.keyboard.press("Tab");
    await control.focus();
    const ring = await paint(control, "outlineColor");
    check("focus ring", ring, card, 3);
    check("focus ring", ring, sunken, 3);
  }
  const points = gallery.getByRole("button", { name: "Points", exact: true });
  if (await points.isVisible()) await points.click();
  const feedback = gallery.locator(".zone-feedback");
  if (await feedback.count()) check("danger text", await paint(feedback, "color"), card, 4.5);
  // The skip links show only while focused, so they are left out.
  for (const button of await gallery.locator('.ms-btn--primary:visible:not(.skip-link, [aria-disabled="true"], :disabled)').all()) {
    const name = (await button.textContent()).trim();
    await button.hover();
    const label = await paint(button, "color");
    check(`${name} hover`, label, await paint(button, "backgroundColor"), 4.5);
    await page.mouse.down();
    check(`${name} pressed`, label, await paint(button, "backgroundColor"), 4.5);
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
  return { focus: await control.count(), feedback: await feedback.count() };
}

const { browser, context } = await launch();
const page = await context.newPage();
const agg = new Map();
let captures = 0;
const measured = { focus: 0, feedback: 0 };
for (const scheme of ["light", "dark"]) {
  for (const [w, h] of VIEWPORTS) {
    for (const { id: sc, scenario, patch } of CAPTURES) {
      // Reduced motion, so hover and pressed fills land at once.
      await openScenario(page, scenario, { width: w, height: h, theme: scheme, patch, reduced: "reduce" });
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
      const seen = await stateContrast(page, scheme, (key) => {
        const e = agg.get(key) ?? { n: 0, where: new Set(), text: "" };
        e.n += 1; e.where.add(`${sc}@${w}`); agg.set(key, e);
      });
      measured.focus += seen.focus;
      measured.feedback += seen.feedback;
    }
  }
}
console.log(`axe color-contrast on ${captures} captures with HA default palettes; focus ring measured on ${measured.focus}, danger text on ${measured.feedback}, filled buttons hovered and pressed on all`);
const rows = [...agg].sort((a, b) => b[1].n - a[1].n);
console.log(`${rows.length} distinct failing node/colour pairs`);
for (const [k, e] of rows.slice(0, 25)) console.log(`${e.n}x  ${k}\n      ${[...e.where].slice(0, 6).join(", ")}  ${e.text}`);
await browser.close();
