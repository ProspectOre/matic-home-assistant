import { parse } from "@babel/parser";
import * as materialIcons from "@mdi/js";
import { fileURLToPath } from "node:url";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

// MDI publishes every path in one module. Give each named string export a
// module so a deferred view owns its glyphs without retaining the whole catalog.
const dataModule = import.meta.resolve("@mdi/js");
const metadata = import.meta.resolve("@mdi/js/package.json");
const license = fileURLToPath(new URL("./LICENSE", metadata));
export const MATERIAL_ICON_INPUTS = [
  fileURLToPath(dataModule),
  fileURLToPath(metadata),
  license,
];
export const MATERIAL_ICON_LICENSE_FILE = "material-icons.LICENSE.txt";
export const writeMaterialIconLicense = (directory) => copyFile(license, resolve(directory, MATERIAL_ICON_LICENSE_FILE));
export const MATERIAL_ICON_NOTICE = "/*! Material Design Icons geometry: Apache-2.0. */";
const namespace = "matic-material-icon";
const prefix = "matic-icon:";

const iconGeometry = (name) => {
  if (!Object.hasOwn(materialIcons, name) || typeof materialIcons[name] !== "string") {
    throw new Error(`Unknown Material Design icon: ${name}`);
  }
  return materialIcons[name];
};

// Only these controlled virtual inputs have no file to hash. Their canonical
// data module, resolver metadata, license and this helper are stamp inputs.
export const isMaterialIconInput = (path) => path.startsWith(`${namespace}:`);

export const materialIconModules = {
  name: "material-icon-modules",
  setup(compiler) {
    compiler.onResolve({ filter: /^matic-icon:/ }, ({ path }) => ({ path: path.slice(prefix.length), namespace }));
    compiler.onLoad({ filter: /.*/, namespace }, ({ path }) => ({
      contents: `${MATERIAL_ICON_NOTICE}\nexport default ${JSON.stringify(iconGeometry(path))};`,
      loader: "js",
    }));
  },
};

export function materialIconImports(source) {
  const file = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const edits = [];
  for (const node of file.program.body) {
    if (node.type !== "ImportDeclaration" || node.source.value !== "@mdi/js") continue;
    if (node.importKind === "type" || !node.specifiers.length
      || node.specifiers.some((specifier) => specifier.type !== "ImportSpecifier" || specifier.importKind === "type")
      || node.attributes?.length) {
      throw new Error("Material Design icons require named value imports");
    }
    const imports = node.specifiers.map((specifier) => {
      const name = specifier.imported.name ?? specifier.imported.value;
      iconGeometry(name);
      return `import ${specifier.local.name} from ${JSON.stringify(`${prefix}${name}`)};`;
    });
    edits.push({ start: node.start, end: node.end, text: imports.join("\n") });
  }
  for (const { start, end, text } of edits.reverse()) {
    source = source.slice(0, start) + text + source.slice(end);
  }
  return source;
}
