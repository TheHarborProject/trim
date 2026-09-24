// Generated presets compose the normal declaration and attach planners entirely
// in memory. No control, manifest, settings, or config write precedes validation.
import { lstat, mkdir, open, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../dispatch";
import { detectProject } from "../project/detect-project";
import { readTrimMetadata, serializeTrimMetadata, TRIM_JSON_PATH, type TrimUIAdapterValue } from "../project/trim-metadata";
import { loadTypeScript } from "../project/resolve-typescript";
import { computeTrimUiEdit, inspectTrimConfigUi, parseTrimConfig, UnsupportedConfigShapeError } from "../project/trim-config-ast";
import type { NewControlSpec } from "./control-file";
import { buildNewControlPlan, controlFilePath, MANIFEST_PATH, SETTINGS_PATH } from "./new-control-plan";
import { gatherAttachInfo, buildAttachEdit, CONFIG_PATH } from "./attach-plan";
import { buildShadcnRendererInfrastructurePlan, rendererForName, rendererMapImportSpecifier } from "./renderer-infrastructure";

type GeneratedPlugin = {
  ref: string;
  control: NewControlSpec;
  group: { id: string; label: string };
};

export const GENERATED_PLUGINS: readonly GeneratedPlugin[] = [{
  ref: "@default/plugins/text-size",
  control: {
    id: "text-size",
    kind: "segmented",
    label: "Text size",
    allowMultiple: false,
    options: [
      { value: "small", label: "A" },
      { value: "default", label: "A" },
      { value: "large", label: "A" },
    ],
    binding: { mode: "trim-managed", defaultValue: "default" },
  },
  group: { id: "text", label: "Text" },
}];

type PlannedFile = { path: string; contents: string; before: Buffer | undefined };
export type GeneratedPluginPlan = { files: PlannedFile[] };

export type GeneratedPluginInstallOptions = {
  adapter?: TrimUIAdapterValue;
  renderer?: string;
};

async function snapshot(fullPath: string): Promise<Buffer | undefined> {
  try {
    const stat = await lstat(fullPath);
    if (!stat.isFile()) throw new UsageError(`${fullPath} must be a regular file — nothing was written.`);
    return await readFile(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function addImport(source: string, symbol: string, importPath: string): { source: string; local: string } {
  const tsc = loadTypeScript();
  const file = tsc.createSourceFile("trim.config.tsx", source, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TSX);
  const locals = new Set<string>();
  for (const statement of file.statements) {
    if (tsc.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) locals.add(clause.name.text);
      const named = clause.namedBindings && tsc.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
      for (const specifier of named) {
        locals.add(specifier.name.text);
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        if (statement.moduleSpecifier.getText(file).slice(1, -1) === importPath && imported === symbol) return { source, local: specifier.name.text };
      }
    }
    if (tsc.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (tsc.isIdentifier(declaration.name)) locals.add(declaration.name.text);
    if (tsc.isFunctionDeclaration(statement) && statement.name) locals.add(statement.name.text);
    if (tsc.isClassDeclaration(statement) && statement.name) locals.add(statement.name.text);
  }
  if (locals.has(symbol)) throw new UsageError(`cannot add ${symbol} from "${importPath}": the local identifier is already used by another declaration.`);
  const statement = `import { ${symbol} } from "${importPath}";`;
  const marker = 'import { defineTrimConfig } from "@theharborproject/trim/react";';
  const index = source.indexOf(marker);
  if (index === -1) throw new UsageError("trim.config.tsx does not contain the generated Trim config import — cannot safely update it.");
  return { source: `${source.slice(0, index + marker.length)}\n${statement}${source.slice(index + marker.length)}`, local: symbol };
}

function ensureAdapterConfig(source: string, adapter: TrimUIAdapterValue, includeRendererMap: boolean, rendererImport: string): string {
  const tsc = loadTypeScript();
  let parsed;
  try { parsed = parseTrimConfig(tsc, source, "trim.config.tsx"); } catch (error) {
    if (error instanceof UnsupportedConfigShapeError) throw new UsageError(`trim.config.tsx cannot safely edit this config (${error.message}).`);
    throw error;
  }
  const info = inspectTrimConfigUi(tsc, parsed);
  if (info.adapter !== undefined && info.adapter !== adapter) throw new UsageError(`configured adapter "${info.adapter}" conflicts with requested adapter "${adapter}". No files were written.`);
  if (!includeRendererMap) return computeTrimUiEdit(tsc, parsed, source, { adapter });
  if (info.hasRenderers) {
    if (!info.rendererLocal || !source.includes(`from "${rendererImport}"`)) {
      throw new UsageError("trim.config.tsx already defines a renderer map that is not Trim's generated shadcn map; refusing to replace host-owned renderers.");
    }
    return computeTrimUiEdit(tsc, parsed, source, { adapter });
  }
  const imported = addImport(source, "trimRenderers", rendererImport);
  const reparsed = parseTrimConfig(tsc, imported.source, "trim.config.tsx");
  return computeTrimUiEdit(tsc, reparsed, imported.source, { adapter, rendererLocal: imported.local });
}

function ensureExplicitRendererImport(source: string, renderer: { importPath: string; symbol: string }): { source: string; local: string } {
  return addImport(source, renderer.symbol, renderer.importPath);
}

export async function buildGeneratedPluginPlan(cwd: string, plugin: GeneratedPlugin, options: GeneratedPluginInstallOptions = {}): Promise<GeneratedPluginPlan> {
  const metadata = await readTrimMetadata(cwd);
  if (!metadata) throw new UsageError("Run `trim init` before installing a generated plugin.");
  const project = detectProject(cwd);
  let diskConfig: string;
  try {
    diskConfig = await readFile(path.join(cwd, CONFIG_PATH), "utf8");
  } catch {
    throw new UsageError(`could not read ${CONFIG_PATH} — run \`trim init\` first.`);
  }
  const tsc = loadTypeScript();
  let parsedConfig;
  try { parsedConfig = parseTrimConfig(tsc, diskConfig, path.join(cwd, CONFIG_PATH)); } catch (error) {
    if (error instanceof UnsupportedConfigShapeError) throw new UsageError(`trim.config.tsx cannot safely edit this config (${error.message}).`);
    throw error;
  }
  const configAdapter = inspectTrimConfigUi(tsc, parsedConfig).adapter as TrimUIAdapterValue | undefined;
  const configuredAdapter = metadata.ui?.adapter ?? configAdapter;
  if (metadata.ui?.adapter && configAdapter && metadata.ui.adapter !== configAdapter) {
    throw new UsageError(`trim.json adapter "${metadata.ui.adapter}" conflicts with trim.config.tsx adapter "${configAdapter}". No files were written.`);
  }
  if (options.adapter && configuredAdapter && options.adapter !== configuredAdapter) {
    throw new UsageError(`configured adapter "${configuredAdapter}" conflicts with --adapter "${options.adapter}". No files were written.`);
  }
  const effectiveAdapter = options.adapter ?? configuredAdapter;
  const renderer = options.renderer ? rendererForName(options.renderer, project.moduleResolution) : undefined;
  if (options.renderer) {
    if (!renderer) throw new UsageError(`unknown renderer "${options.renderer}".`);
    if (renderer.kind !== plugin.control.kind) throw new UsageError(`renderer "${options.renderer}" cannot render control kind "${plugin.control.kind}". No files were written.`);
    if (renderer.adapter === "shadcn" && effectiveAdapter !== "shadcn") throw new UsageError(`renderer "${options.renderer}" requires a project configured for adapter "shadcn". No files were written.`);
  }
  if (!renderer && effectiveAdapter === "headless") {
    throw new UsageError(`adapter "headless" has no renderer for control kind "${plugin.control.kind}". Provide --renderer, for example --renderer vanilla.${plugin.control.kind}. No files were written.`);
  }

  const rendererInfrastructure = effectiveAdapter === "shadcn"
    ? await buildShadcnRendererInfrastructurePlan(cwd, project.moduleResolution)
    : undefined;
  for (const file of rendererInfrastructure?.files ?? []) {
    if (file.status === "conflict") throw new UsageError(`${file.path} already exists with different content — adapter renderer infrastructure was not changed. No files were written.`);
  }
  let plannedConfig = diskConfig;
  if (options.adapter || effectiveAdapter === "shadcn" || effectiveAdapter === "headless") {
    plannedConfig = ensureAdapterConfig(diskConfig, effectiveAdapter ?? "vanilla", Boolean(rendererInfrastructure), rendererMapImportSpecifier(project.moduleResolution));
  }
  let rendererLocal: string | undefined;
  if (renderer) {
    const imported = ensureExplicitRendererImport(plannedConfig, renderer);
    plannedConfig = imported.source;
    rendererLocal = imported.local;
  }
  const control = await buildNewControlPlan(cwd, plugin.control, project.moduleResolution);
  const info = await gatherAttachInfo(cwd, plugin.control.id, control.controlFile.contents, plannedConfig);
  const itemText = renderer ? `{ id: ${JSON.stringify(plugin.control.id)}, component: ${rendererLocal} }` : undefined;
  const config = buildAttachEdit(info, { mode: "new-group", groupId: plugin.group.id, groupLabel: plugin.group.label, itemText });
  const files: { path: string; contents: string }[] = [control.controlFile, control.manifestFile, ...(control.settingsFile ? [control.settingsFile] : []), { path: CONFIG_PATH, contents: config }];
  if (rendererInfrastructure) files.push(...rendererInfrastructure.files.map((file) => ({ path: file.path, contents: file.contents })));
  if (options.adapter && options.adapter !== configuredAdapter) {
    files.push({ path: TRIM_JSON_PATH, contents: serializeTrimMetadata({ ...metadata, shadcn: options.adapter === "shadcn", styling: options.adapter === "vanilla" ? metadata.styling : "headless", ui: options.adapter === "headless" ? { adapter: "headless" } : { adapter: options.adapter, shell: metadata.ui?.shell ?? "popover" } }) });
  }
  const paths = [...new Set(files.map((file) => file.path))];
  const before = new Map<string, Buffer | undefined>();
  for (const file of paths) before.set(file, await snapshot(path.join(cwd, file)));
  return { files: files.map((file) => ({ ...file, before: before.get(file.path) })) };
}

/** Reject stale plans before writing; restore every touched file on an I/O failure. */
export async function applyGeneratedPluginPlan(cwd: string, plan: GeneratedPluginPlan): Promise<void> {
  for (const file of plan.files) {
    const current = await snapshot(path.join(cwd, file.path));
    if (current === undefined ? file.before !== undefined : file.before === undefined || !current.equals(file.before)) {
      throw new UsageError(`${file.path} changed during plugin planning — nothing was written. Retry the install.`);
    }
  }
  const touched: PlannedFile[] = [];
  const createdDirectories: string[] = [];
  async function ensureParentDirectory(fullPath: string): Promise<void> {
    const missing: string[] = [];
    let current = path.dirname(fullPath);
    while (true) {
      try { const stat = await lstat(current); if (!stat.isDirectory()) throw new UsageError(`${current} must be a directory — nothing was written.`); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing.push(current); const parent = path.dirname(current); if (parent === current) break; current = parent; }
    }
    for (const directory of missing.reverse()) { await mkdir(directory); createdDirectories.push(directory); }
  }
  try {
    for (const file of plan.files) {
      const fullPath = path.join(cwd, file.path);
      await ensureParentDirectory(fullPath);
      if (file.before === undefined) {
        // Exclusive creation must not overwrite a concurrently created declaration.
        const handle = await open(fullPath, "wx");
        touched.push(file);
        try { await handle.writeFile(file.contents, "utf8"); } finally { await handle.close(); }
      } else {
        if (file.before.equals(Buffer.from(file.contents, "utf8"))) continue;
        touched.push(file); // include a write that truncates and then fails
        await writeFile(fullPath, file.contents, "utf8");
      }
    }
  } catch (error) {
    const failures: string[] = [];
    for (const file of touched.reverse()) {
      try {
        if (file.before === undefined) await unlink(path.join(cwd, file.path));
        else await writeFile(path.join(cwd, file.path), file.before);
      } catch { failures.push(file.path); }
    }
    for (const directory of createdDirectories.reverse()) {
      try { await rmdir(directory); } catch { failures.push(directory); }
    }
    if (failures.length) throw new UsageError(`Plugin installation failed (${String(error)}); rollback could not restore: ${failures.join(", ")}.`);
    throw error;
  }
}
