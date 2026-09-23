import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "../dispatch";

export const DEFAULT_REGISTRY_URL = "https://trim.theharborproject.dev/registry/registry.json";
export type RegistryManifest = { examples: Record<string, { path: string; files: string[] }> };
export type ExampleFile = { path: string; contents: Uint8Array };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Registry paths are relative to the manifest, never filesystem/URL escapes. */
export function validateRegistryPath(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.split("/").some((part) => !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part))) {
    throw new UsageError(`Invalid registry path: ${JSON.stringify(value)}.`);
  }
}

export function parseRegistryManifest(source: string): RegistryManifest {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new UsageError("Invalid registry manifest: expected JSON."); }
  if (!object(value) || !object(value.examples)) throw new UsageError("Invalid registry manifest: expected an examples object.");
  const examples: RegistryManifest["examples"] = Object.create(null);
  for (const [name, entry] of Object.entries(value.examples)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name) || !object(entry)) throw new UsageError(`Invalid registry example: ${name}.`);
    validateRegistryPath(entry.path);
    if (!Array.isArray(entry.files)) throw new UsageError(`Invalid registry example "${name}": expected a files array.`);
    const files = new Set<string>();
    for (const file of entry.files) {
      validateRegistryPath(file);
      if (files.has(file)) throw new UsageError(`Duplicate registry file: ${file}.`);
      files.add(file);
    }
    for (const file of files) {
      const parts = file.split("/");
      for (let i = 1; i < parts.length; i++) {
        if (files.has(parts.slice(0, i).join("/"))) throw new UsageError(`Conflicting registry file: ${file}.`);
      }
    }
    examples[name] = { path: entry.path, files: [...files] };
  }
  return { examples };
}

export function resolveExample(manifest: RegistryManifest, name: string): { path: string; files: string[] } {
  if (!Object.prototype.hasOwnProperty.call(manifest.examples, name)) {
    throw new UsageError(`Unknown example "${name}". Available examples: ${Object.keys(manifest.examples).sort().join(", ") || "(none)"}.`);
  }
  return manifest.examples[name];
}

/** Owns transport and file discovery; command and generators never fetch. */
export class RegistryClient {
  private readonly url: URL;

  constructor(url = process.env.TRIM_REGISTRY_URL ?? DEFAULT_REGISTRY_URL) {
    try { this.url = new URL(url); } catch { throw new UsageError("TRIM_REGISTRY_URL must be an HTTP(S) or file:// manifest URL."); }
    if (!["file:", "http:", "https:"].includes(this.url.protocol)) throw new UsageError("Registry URL must use HTTP(S) or file://.");
  }

  private async read(url: URL): Promise<Buffer> {
    try {
      if (url.protocol === "file:") return await readFile(url);
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw new UsageError(`Could not read registry resource ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async manifest(): Promise<RegistryManifest> {
    return parseRegistryManifest((await this.read(this.url)).toString("utf8"));
  }

  async example(name: string): Promise<ExampleFile[]> {
    const entry = resolveExample(await this.manifest(), name);
    const base = new URL(entry.path.split("/").map(encodeURIComponent).join("/") + "/", this.url);
    const files: ExampleFile[] = [];
    for (const relative of entry.files) {
      const url = new URL(relative.split("/").map(encodeURIComponent).join("/"), base);
      if (url.protocol === "file:") {
        // Do not follow registry symlinks outside the declared tree.
        let current = fileURLToPath(new URL(".", this.url));
        const parts = [...entry.path.split("/"), ...relative.split("/")];
        for (let i = 0; i < parts.length; i++) {
          current = path.join(current, parts[i]);
          const stat = await lstat(current);
          if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
            throw new UsageError(`Unsupported registry entry: ${current}. Only regular files and directories are allowed.`);
          }
        }
      }
      files.push({ path: relative, contents: await this.read(url) });
    }
    return files;
  }
}
