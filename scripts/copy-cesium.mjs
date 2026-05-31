import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

const source = path.resolve("node_modules/cesium/Build/Cesium");
const target = path.resolve(process.argv[2] ?? "dist-web/cesium");

mkdirSync(path.dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Copied Cesium assets to ${target}`);
