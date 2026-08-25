import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docker = readFileSync("backend/Dockerfile", "utf8");
assert.equal(
  docker.includes("playwright/dotnet"),
  false,
  "Render runtime Playwright imajına .NET 10 bindirilmemeli (status 139)",
);
assert.match(docker, /aspnet:10\.0/);
assert.match(docker, /DOTNET_EnableDiagnostics=0/);
assert.match(docker, /SQLITE_PATH=\/app\/data\/fitmemory.db/);

const render = readFileSync("render.yaml", "utf8");
assert.match(render, /dockerfilePath: \.\/backend\/Dockerfile/);
assert.equal(render.includes("api/"), false, "Render Node api/ dizinine bakmamalı");

console.log("render runtime ok");
