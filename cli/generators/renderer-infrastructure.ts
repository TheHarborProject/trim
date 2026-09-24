// Adapter-owned renderer infrastructure. The canonical plugin generators do
// not depend on this module; it is generated once per project adapter.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModuleResolutionMode } from "../project/detect-project";
import { relativeImportSpecifier, relativePathBetween } from "../project/module-resolution";
import { UsageError } from "../dispatch";
import { buildShadcnTemplatePlan, SHADCN_TEMPLATE_REGISTRY, type ShadcnTemplateEntry } from "./shadcn-registry";
import type { TemplateFilePlan } from "./template-registry";

export const RENDERERS_PATH = "trim/trim.renderers.tsx";

export type RendererInfrastructurePlan = {
  files: readonly TemplateFilePlan[];
};

const rendererSymbol: Record<ShadcnTemplateEntry["kind"], string> = {
  toggle: "ShadcnBooleanControl",
  segmented: "ShadcnSegmentedControl",
  "toggle-action": "ShadcnToggleActionControl",
};

function rendererMapContents(moduleResolution: ModuleResolutionMode): string {
  const imports = SHADCN_TEMPLATE_REGISTRY.map((entry) => {
    const specifier = relativeImportSpecifier(
      moduleResolution,
      relativePathBetween(RENDERERS_PATH.replace(/\.tsx$/, ""), entry.targetPath.replace(/\.tsx$/, "")),
    );
    return `import { ${rendererSymbol[entry.kind]} } from "${specifier}";`;
  });
  return `${imports.join("\n")}\nimport type { TrimRendererMap } from "@theharborproject/trim/react";\n\nexport const trimRenderers = {\n${SHADCN_TEMPLATE_REGISTRY.map((entry) => `  ${JSON.stringify(entry.kind)}: ${rendererSymbol[entry.kind]},`).join("\n")}\n} satisfies TrimRendererMap;\n`;
}

async function planFile(cwd: string, pathName: string, contents: string): Promise<TemplateFilePlan> {
  try {
    const existing = await readFile(path.join(cwd, pathName), "utf8");
    return { path: pathName, contents, status: existing === contents ? "matches" : "conflict" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: pathName, contents, status: "create" };
    throw error;
  }
}

export async function buildShadcnRendererInfrastructurePlan(cwd: string, moduleResolution: ModuleResolutionMode): Promise<RendererInfrastructurePlan> {
  const rendererFiles: TemplateFilePlan[] = [];
  for (const entry of SHADCN_TEMPLATE_REGISTRY) rendererFiles.push(await buildShadcnTemplatePlan(cwd, entry));
  rendererFiles.push(await planFile(cwd, RENDERERS_PATH, rendererMapContents(moduleResolution)));
  return { files: rendererFiles };
}

export function rendererForName(name: string, moduleResolution?: ModuleResolutionMode): { adapter: "vanilla" | "shadcn"; kind: ShadcnTemplateEntry["kind"]; importPath: string; symbol: string } | undefined {
  if (name === "vanilla.toggle") return { adapter: "vanilla", kind: "toggle", importPath: "@theharborproject/trim/react/controls/boolean", symbol: "DefaultBooleanControl" };
  if (name === "vanilla.segmented") return { adapter: "vanilla", kind: "segmented", importPath: "@theharborproject/trim/react/controls/segmented", symbol: "DefaultSegmentedControlOverride" };
  if (name === "vanilla.toggle-action") return { adapter: "vanilla", kind: "toggle-action", importPath: "@theharborproject/trim/react/controls/toggle-action", symbol: "DefaultToggleActionControl" };
  const entry = SHADCN_TEMPLATE_REGISTRY.find((candidate) => `shadcn.${candidate.kind}` === name);
  if (!entry) return undefined;
  const importPath = `./${entry.targetPath.replace(/^trim\//, "").replace(/\.tsx$/, "")}`;
  return { adapter: "shadcn", kind: entry.kind, importPath: moduleResolution ? relativeImportSpecifier(moduleResolution, importPath) : importPath, symbol: rendererSymbol[entry.kind] };
}

export function supportedRendererNames(): readonly string[] {
  return ["vanilla.toggle", "vanilla.segmented", "vanilla.toggle-action", ...SHADCN_TEMPLATE_REGISTRY.map((entry) => `shadcn.${entry.kind}`)];
}

export function rendererMapImportSpecifier(moduleResolution: ModuleResolutionMode): string {
  return relativeImportSpecifier(moduleResolution, "./trim.renderers");
}

export function assertRendererAdapterCompatible(name: string, configuredAdapter: string | undefined): void {
  const renderer = rendererForName(name);
  if (!renderer) throw new UsageError(`unknown renderer "${name}". Available: ${supportedRendererNames().join(", ")}.`);
  if (configuredAdapter && configuredAdapter !== renderer.adapter) {
    throw new UsageError(`renderer "${name}" requires adapter "${renderer.adapter}", but this project is configured for "${configuredAdapter}". No files were written.`);
  }
}
