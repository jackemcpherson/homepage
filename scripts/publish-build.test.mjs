import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactStorage,
  packageBuild,
  publishObjects,
} from "./publish-build.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(extra = {}) {
  const root = await mkdtemp(join(tmpdir(), "homepage-publisher-test-"));
  temporary.push(root);
  await mkdir(join(root, "public"));
  for (const [path, text] of Object.entries({
    "public/index.html": "<h1>Homepage</h1>\n",
    "public/_headers": "/*\n  X-Content-Type-Options: nosniff\n",
    "public/_redirects": "/old /new 301\n",
    "wrangler.jsonc": '{"assets":{"directory":"./public"}}',
    ...extra,
  }))
    await writeFile(join(root, path), text);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture",
  );
  return { root, git, revision: git("rev-parse", "HEAD") };
}

test("packages committed bytes deterministically with headers, redirects and manifest digests", async () => {
  const { root, revision } = await fixture();
  const first = await packageBuild(root, revision, join(root, "first"));
  await writeFile(join(root, "public/index.html"), "uncommitted replacement");
  const second = await packageBuild(root, revision, join(root, "second"));
  expect(second.release).toEqual(first.release);
  expect(first.manifest.files.map((file) => file.path)).toEqual([
    "public/_headers",
    "public/_redirects",
    "public/index.html",
    "wrangler.jsonc",
  ]);
  expect(digest(await readFile(join(root, "first/build.tar.gz")))).toBe(
    first.release.archive_sha256,
  );
  expect(digest(await readFile(join(root, "first/manifest.json")))).toBe(
    first.release.manifest_sha256,
  );
  const html = execFileSync("tar", [
    "-xOzf",
    join(root, "first/build.tar.gz"),
    "public/index.html",
  ]).toString();
  expect(html).toBe("<h1>Homepage</h1>\n");
});

test("includes only explicitly selected Worker modules", async () => {
  const { root, revision } = await fixture({
    "worker.js": "export default {};",
    "wrangler.jsonc": '{"assets":{"directory":"public"},"main":"worker.js"}',
  });
  await expect(
    packageBuild(root, revision, join(root, "missing")),
  ).rejects.toThrow();
  const built = await packageBuild(root, revision, join(root, "built"), [
    "worker.js",
  ]);
  expect(built.manifest.modules).toEqual(["worker.js"]);
});

for (const [name, extra] of [
  ["export-ignore", { ".gitattributes": "public/_headers export-ignore\n" }],
  [
    "export-subst",
    {
      ".gitattributes": "public/index.html export-subst\n",
      "public/index.html": "$Format:%H$\n",
    },
  ],
  [
    "build hooks",
    {
      "wrangler.jsonc":
        '{"assets":{"directory":"public"},"build":{"command":"touch unsafe"}}',
    },
  ],
  [
    "implicit modules",
    {
      "wrangler.jsonc":
        '{"assets":{"directory":"public"},"find_additional_modules":true}',
    },
  ],
])
  test(`rejects ${name} before producing a release marker`, async () => {
    const { root, revision } = await fixture(extra);
    await expect(
      packageBuild(root, revision, join(root, "build")),
    ).rejects.toThrow();
    expect(await Bun.file(join(root, "build/release.json")).exists()).toBe(
      false,
    );
  });

test("rejects links and abbreviated commits", async () => {
  const { root, git, revision } = await fixture();
  await expect(
    packageBuild(root, revision.slice(0, 8), join(root, "short")),
  ).rejects.toThrow();
  await symlink("index.html", join(root, "public/link"));
  git("add", "public/link");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "link",
  );
  await expect(
    packageBuild(root, git("rev-parse", "HEAD"), join(root, "link")),
  ).rejects.toThrow();
});

function storage(initial = new Map()) {
  const events = [];
  return {
    events,
    data: initial,
    async read(key) {
      events.push(["read", key]);
      return initial.get(key) ?? null;
    },
    async create(key, bytes) {
      events.push(["create", key]);
      if (initial.has(key)) return false;
      initial.set(key, bytes);
      return true;
    },
  };
}
async function publication() {
  const { root, revision } = await fixture();
  return packageBuild(root, revision, join(root, "build"));
}
test("publishes marker only after pair readback and makes identical retries read-only", async () => {
  const build = await publication(),
    store = storage();
  const result = await publishObjects(store, build.objects);
  expect(result.created).toHaveLength(3);
  const marker = store.events.findIndex(
    ([action, key]) => action === "create" && key.endsWith("-release.json"),
  );
  for (const key of build.objects.slice(0, 2).map((object) => object.key)) {
    expect(store.events.slice(3, marker)).toContainEqual(["read", key]);
  }
  store.events.length = 0;
  expect((await publishObjects(store, build.objects)).created).toEqual([]);
  expect(store.events.every(([action]) => action === "read")).toBe(true);
});
test("conflicting existing bytes block every write", async () => {
  const build = await publication(),
    store = storage(new Map([[build.objects[1].key, Buffer.from("conflict")]]));
  await expect(publishObjects(store, build.objects)).rejects.toThrow();
  expect(store.events.every(([action]) => action === "read")).toBe(true);
});
test("uncertain creation does not retry or publish a marker", async () => {
  const build = await publication(),
    store = storage();
  let writes = 0;
  store.create = async () => {
    writes++;
    throw new Error("PRIVATE_TRANSPORT");
  };
  await expect(publishObjects(store, build.objects)).rejects.toThrow(
    "Publication uncertain",
  );
  expect(writes).toBe(1);
  expect(store.data.has(build.objects[2].key)).toBe(false);
});
test("lost concurrent create accepts only identical readback", async () => {
  const build = await publication(),
    store = storage();
  store.create = async (key, bytes) => {
    store.data.set(key, bytes);
    return false;
  };
  expect((await publishObjects(store, build.objects)).created).toEqual([]);
  expect(store.data.size).toBe(3);
});

test("failed pair readback prevents marker creation", async () => {
  const build = await publication(),
    store = storage();
  store.create = async (key) => {
    store.data.set(key, Buffer.from("corrupt"));
    return true;
  };
  await expect(publishObjects(store, build.objects)).rejects.toThrow();
  expect(store.data.has(build.objects[2].key)).toBe(false);
});

test("native signing fixes the bucket, prefix, conditional PUT and redirect policy", async () => {
  const account = "1".repeat(32),
    key = `homepage/${"a".repeat(40)}-release.json`;
  const requests = [];
  const store = artifactStorage(
    account,
    { accessKeyId: "test-access", secretAccessKey: "test-secret" },
    async (url, options) => {
      requests.push({ url, options });
      return new Response(options.method === "GET" ? "bytes" : null);
    },
  );
  expect(await store.create(key, Buffer.from("bytes"))).toBe(true);
  expect(Buffer.from(await store.read(key)).toString()).toBe("bytes");
  expect(requests[0].url.origin).toBe(
    `https://${account}.r2.cloudflarestorage.com`,
  );
  expect(requests[0].url.pathname).toBe(`/worker-artifacts/${key}`);
  expect(requests[0].options.headers["If-None-Match"]).toBe("*");
  expect(
    requests.every((request) => request.options.redirect === "error"),
  ).toBe(true);
  await expect(
    store.create("prod/state.tfstate", Buffer.from("bytes")),
  ).rejects.toThrow();
  expect(requests).toHaveLength(2);
});

test("native storage distinguishes missing objects and conditional conflicts", async () => {
  const store = artifactStorage(
    "1".repeat(32),
    { accessKeyId: "test-access", secretAccessKey: "test-secret" },
    async (_, options) =>
      new Response(null, { status: options.method === "GET" ? 404 : 412 }),
  );
  const key = `homepage/${"a".repeat(40)}-manifest.json`;
  expect(await store.read(key)).toBe(null);
  expect(await store.create(key, Buffer.from("bytes"))).toBe(false);
});

test("native transport failures do not reveal private response or URL details", async () => {
  const store = artifactStorage(
    "1".repeat(32),
    { accessKeyId: "test-access", secretAccessKey: "test-secret" },
    async () => {
      throw new Error("PRIVATE_SIGNED_URL");
    },
  );
  try {
    await store.read(`homepage/${"a".repeat(40)}-release.json`);
    throw new Error("expected failure");
  } catch (error) {
    expect(error.message).toBe(
      "Artifact GET unavailable; completion may be uncertain",
    );
  }
});
