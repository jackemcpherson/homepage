import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const execute = promisify(execFile);
const native = {
  encoding: "buffer",
  maxBuffer: 128 * 1024 * 1024,
  timeout: 30_000,
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const revisionPattern = /^[a-f0-9]{40}$/;
class BuildError extends Error {}
function requireValue(condition, message) {
  if (!condition) throw new BuildError(message);
}
function safePath(path) {
  requireValue(
    typeof path === "string" &&
      /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) &&
      path.split("/").every((part) => part !== "." && part !== ".."),
    "Unsupported build path",
  );
  return path;
}
function sourceConfiguration(bytes, modules) {
  const value = Bun.JSONC.parse(bytes.toString("utf8"));
  requireValue(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ["public", "./public", "public/", "./public/"].includes(
        value.assets?.directory,
      ),
    "Committed public assets required",
  );
  for (const key of [
    "build",
    "site",
    "legacy_assets",
    "rules",
    "find_additional_modules",
    "base_dir",
  ]) {
    requireValue(
      !(key in value),
      "Build hooks and implicit modules are unsupported",
    );
  }
  if ("main" in value)
    requireValue(
      typeof value.main === "string" &&
        modules.includes(value.main.replace(/^\.\//, "")),
      "Select the configured Worker entrypoint explicitly",
    );
}

/** Produce the versioned archive contract consumed by cloudflare-infra. */
export async function packageBuild(
  root,
  revision,
  output,
  selectedModules = [],
) {
  requireValue(
    revisionPattern.test(revision),
    "A full publisher commit is required",
  );
  const modules = [...selectedModules].map(safePath).sort();
  requireValue(
    new Set(modules).size === modules.length &&
      modules.every(
        (path) => !path.startsWith("public/") && path !== "wrangler.jsonc",
      ),
    "Invalid module selection",
  );
  const git = async (...args) =>
    (
      await execute("git", args, {
        ...native,
        cwd: root,
        env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
      })
    ).stdout;
  requireValue(
    (await git("cat-file", "-t", revision)).toString().trim() === "commit",
    "Publisher revision must identify a commit",
  );
  const paths = ["public", "wrangler.jsonc", ...modules];
  const rows = (await git("ls-tree", "-rz", revision, "--", ...paths))
    .toString()
    .split("\0")
    .filter(Boolean);
  const files = [];
  for (const row of rows) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    requireValue(match, "Links, submodules and special files are unsupported");
    const path = safePath(match[3]);
    const bytes = await git("cat-file", "blob", match[2]);
    if (path === "wrangler.jsonc") sourceConfiguration(bytes, modules);
    files.push({ path, sha256: digest(bytes), size: bytes.length });
  }
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const names = files.map((file) => file.path);
  requireValue(
    names.includes("wrangler.jsonc") &&
      names.some((name) => name.startsWith("public/")) &&
      modules.every((name) => names.includes(name)) &&
      names.every(
        (name) =>
          name.startsWith("public/") ||
          name === "wrangler.jsonc" ||
          modules.includes(name),
      ),
    "Incomplete or implicit build membership",
  );
  const manifest = {
    schema_version: 1,
    repository: "jackemcpherson/homepage",
    revision,
    assets_directory: "public",
    source_configuration: "wrangler.jsonc",
    modules,
    files,
  };
  const archive = gzipSync(
    await git("archive", "--format=tar", revision, "--", ...paths),
    { level: 9 },
  );
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const release = {
    schema_version: 1,
    version: revision,
    archive_sha256: digest(archive),
    manifest_sha256: digest(manifestBytes),
  };
  const objects = [
    { key: `homepage/${revision}-build.tar.gz`, bytes: archive },
    { key: `homepage/${revision}-manifest.json`, bytes: manifestBytes },
    {
      key: `homepage/${revision}-release.json`,
      bytes: Buffer.from(`${JSON.stringify(release, null, 2)}\n`),
    },
  ];
  await mkdir(output, { mode: 0o700 });
  try {
    const archivePath = join(output, "build.tar.gz");
    await writeFile(archivePath, archive, { mode: 0o600, flag: "wx" });
    const tar = async (...args) => (await execute("tar", args, native)).stdout;
    const members = (await tar("-tzf", archivePath))
      .toString()
      .split("\n")
      .filter(Boolean);
    requireValue(
      new Set(members).size === members.length,
      "Duplicate archive members",
    );
    for (const name of members) {
      safePath(name.endsWith("/") ? name.slice(0, -1) : name);
    }
    const details = (await tar("-tvzf", archivePath))
      .toString()
      .split("\n")
      .filter(Boolean);
    requireValue(
      details.every((line) => line[0] === "-" || line[0] === "d"),
      "Unsupported archive member type",
    );
    requireValue(
      JSON.stringify(members.filter((name) => !name.endsWith("/")).sort()) ===
        JSON.stringify(names),
      "Archive membership differs from committed files",
    );
    for (const file of files) {
      const bytes = await tar("-xOzf", archivePath, "--", file.path);
      requireValue(
        bytes.length === file.size && digest(bytes) === file.sha256,
        "Archive bytes differ from committed files",
      );
    }
    await writeFile(join(output, "manifest.json"), manifestBytes, {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(join(output, "release.json"), objects[2].bytes, {
      mode: 0o600,
      flag: "wx",
    });
    return { manifest, release, objects };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

/** Conditional creates and exact readback keep a failed publication retryable. */
export async function publishObjects(storage, input) {
  const objects = input.map((object) => ({
    key: object.key,
    bytes: Buffer.from(object.bytes),
  }));
  const revision = objects[0]?.key.slice(
    "homepage/".length,
    "homepage/".length + 40,
  );
  requireValue(
    revisionPattern.test(revision ?? "") &&
      JSON.stringify(objects.map((object) => object.key)) ===
        JSON.stringify([
          `homepage/${revision}-build.tar.gz`,
          `homepage/${revision}-manifest.json`,
          `homepage/${revision}-release.json`,
        ]),
    "One ordered publication is required",
  );
  const release = JSON.parse(objects[2].bytes.toString());
  requireValue(
    release.schema_version === 1 &&
      release.version === revision &&
      release.archive_sha256 === digest(objects[0].bytes) &&
      release.manifest_sha256 === digest(objects[1].bytes),
    "Publication digests differ",
  );
  const equal = (left, right) =>
    left !== null && Buffer.from(left).equals(right);
  const before = await Promise.all(
    objects.map((object) => storage.read(object.key)),
  );
  requireValue(
    before.every(
      (bytes, index) => bytes === null || equal(bytes, objects[index].bytes),
    ),
    "Immutable publication conflicts",
  );
  const created = [];
  for (const [index, object] of objects.entries()) {
    if (before[index] === null) {
      try {
        if (await storage.create(object.key, object.bytes))
          created.push(object.key);
      } catch {
        throw new BuildError("Publication uncertain; no write retry attempted");
      }
    }
    requireValue(
      equal(await storage.read(object.key), object.bytes),
      "Publication readback differs or is unavailable",
    );
  }
  return { created, verified: objects.map((object) => object.key) };
}

export function artifactStorage(
  account,
  credentials,
  fetch = globalThis.fetch,
) {
  requireValue(
    /^[a-f0-9]{32}$/.test(account ?? "") &&
      credentials.accessKeyId &&
      credentials.secretAccessKey,
    "Artifact account and credentials are required",
  );
  const origin = `https://${account}.r2.cloudflarestorage.com`;
  const client = new Bun.S3Client({
    ...credentials,
    bucket: "worker-artifacts",
    region: "auto",
    virtualHostedStyle: false,
    endpoint: origin,
  });
  async function request(key, method, bytes) {
    requireValue(
      /^homepage\/[a-f0-9]{40}-(?:build\.tar\.gz|manifest\.json|release\.json)$/.test(
        key,
      ),
      "Invalid homepage object key",
    );
    try {
      const url = new URL(client.presign(key, { method, expiresIn: 60 }));
      requireValue(
        url.origin === origin &&
          url.pathname === `/worker-artifacts/${key}` &&
          !url.username &&
          !url.password,
        "Artifact scope mismatch",
      );
      const response = await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        ...(bytes
          ? {
              body: bytes,
              headers: {
                "If-None-Match": "*",
                "Content-Type": key.endsWith(".json")
                  ? "application/json"
                  : "application/gzip",
              },
            }
          : {}),
      });
      if (method === "GET" && response.status === 404) return null;
      if (method === "PUT" && response.status === 412) return false;
      requireValue(
        response.ok,
        `Artifact ${method} failed (${response.status})`,
      );
      return method === "GET"
        ? new Uint8Array(await response.arrayBuffer())
        : true;
    } catch {
      throw new BuildError(
        `Artifact ${method} unavailable; completion may be uncertain`,
      );
    }
  }
  return {
    read: (key) => request(key, "GET"),
    create: (key, bytes) => request(key, "PUT", bytes),
  };
}

if (import.meta.main) {
  try {
    const [command, revision, output, ...modules] = process.argv.slice(2);
    requireValue(
      ["package", "publish"].includes(command) && output,
      "Usage: bun scripts/publish-build.mjs package|publish FULL_COMMIT OUTPUT [MODULE...]",
    );
    const build = await packageBuild(
      process.cwd(),
      revision,
      resolve(output),
      modules,
    );
    if (command === "publish") {
      const result = await publishObjects(
        artifactStorage(process.env.CLOUDFLARE_ACCOUNT_ID, {
          accessKeyId: process.env.R2_ARTIFACTS_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_ARTIFACTS_SECRET_ACCESS_KEY,
        }),
        build.objects,
      );
      await writeFile(
        join(output, "publication.json"),
        `${JSON.stringify({ release: build.release, ...result }, null, 2)}\n`,
        { mode: 0o600, flag: "wx" },
      );
    }
    console.log(
      `${command === "publish" ? "Published" : "Packaged"} immutable homepage build ${build.release.version}`,
    );
  } catch (error) {
    console.error(
      error instanceof BuildError
        ? error.message
        : "Native build command or source configuration failed",
    );
    console.error(
      "Publication may be incomplete. Inspect source or access, then retry the same revision.",
    );
    process.exitCode = 1;
  }
}
