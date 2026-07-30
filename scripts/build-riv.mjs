#!/usr/bin/env node
/**
 * Compile a scene spec into a .riv via the rive-mcp server.
 *
 * rive-mcp is an MCP stdio server, but nothing stops us driving it directly —
 * that keeps the 30 KB scene spec out of any chat context and makes rebuilds
 * a one-liner:
 *
 *   node scripts/build-riv.mjs artwork/rive/specs/shiba-canonical-v6.scene.json \
 *                              public/pet-assets/shiba/v2/shiba-canonical-v6.riv
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SERVER = process.env.RIVE_MCP_BIN ?? "rive-mcp";

function callServer(toolName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };

    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error));
    child.on("close", code => {
      finish(new Error(`rive-mcp exited (${code}) before responding\n${stderr}`));
    });

    child.stdout.on("data", chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
          );
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: { name: toolName, arguments: args },
            })}\n`,
          );
        } else if (message.id === 2) {
          if (message.error) {
            finish(new Error(JSON.stringify(message.error)));
            return;
          }
          finish(null, message.result);
        }
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "build-riv", version: "1.0" },
        },
      })}\n`,
    );
  });
}

const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) {
  console.error("usage: build-riv.mjs <scene.json> <out.riv>");
  process.exit(1);
}

const scene = JSON.parse(readFileSync(specPath, "utf8"));
const result = await callServer("riv_create", {
  outPath: path.resolve(outPath),
  scene,
});

// The result carries a preview image; only the text parts are worth printing.
const text = (result.content ?? [])
  .filter(item => item.type === "text")
  .map(item => item.text)
  .join("\n");
console.log(text || "(no text response)");
if (result.isError) process.exit(1);
