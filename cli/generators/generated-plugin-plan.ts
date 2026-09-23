// Generated presets compose the normal declaration and attach planners entirely
// in memory. No control, manifest, settings, or config write precedes validation.
import { lstat, mkdir, open, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../dispatch";
import { detectProject } from "../project/detect-project";
import { readTrimMetadata } from "../project/trim-metadata";
import type { NewControlSpec } from "./control-file";
import { buildNewControlPlan, controlFilePath, MANIFEST_PATH, SETTINGS_PATH } from "./new-control-plan";
import { gatherAttachInfo, buildAttachEdit, CONFIG_PATH } from "./attach-plan";

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

export async function buildGeneratedPluginPlan(cwd: string, plugin: GeneratedPlugin): Promise<GeneratedPluginPlan> {
  if (!await readTrimMetadata(cwd)) throw new UsageError("Run `trim init` before installing a generated plugin.");
  const paths = [controlFilePath(plugin.control.id), MANIFEST_PATH, SETTINGS_PATH, CONFIG_PATH];
  const before = new Map<string, Buffer | undefined>();
  for (const file of paths) before.set(file, await snapshot(path.join(cwd, file)));
  const control = await buildNewControlPlan(cwd, plugin.control, detectProject(cwd).moduleResolution);
  const info = await gatherAttachInfo(cwd, plugin.control.id, control.controlFile.contents);
  const config = buildAttachEdit(info, { mode: "new-group", groupId: plugin.group.id, groupLabel: plugin.group.label });
  return { files: [control.controlFile, control.manifestFile, ...(control.settingsFile ? [control.settingsFile] : []),
    { path: CONFIG_PATH, contents: config }].map((file) => ({ ...file, before: before.get(file.path) })) };
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
  try {
    for (const file of plan.files) {
      const fullPath = path.join(cwd, file.path);
      const created = await mkdir(path.dirname(fullPath), { recursive: true });
      if (created) createdDirectories.push(created);
      if (file.before === undefined) {
        // Exclusive creation must not overwrite a concurrently created declaration.
        const handle = await open(fullPath, "wx");
        touched.push(file);
        try { await handle.writeFile(file.contents, "utf8"); } finally { await handle.close(); }
      } else {
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
