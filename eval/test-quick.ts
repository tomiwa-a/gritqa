import { startMcp } from "./src/cli.js";
import { connectMcp } from "./src/mcp.js";

const { handle, startupMs } = await startMcp("/Users/pitersonsmartpro/Downloads/hotel");
console.log("startup", startupMs, "url", handle.url);
const mcp = await connectMcp(handle);
console.log("tools", Object.keys(mcp.tools));
const getIndex: any = (mcp as any).tools["get_index"];
console.log("calling get_index...");
const start = Date.now();
try {
  const res: any = await Promise.race([
    getIndex.execute({}, {}),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 60s")), 60000)),
  ]);
  console.log("ok", Date.now() - start, "ms", JSON.stringify(res).slice(0, 1500));
} catch (e) {
  console.error("failed", e);
  console.log("retry with 90s...");
  try {
    const res2: any = await Promise.race([
      getIndex.execute({}, {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 90s")), 90000)),
    ]);
    console.log("ok retry", JSON.stringify(res2).slice(0, 1000));
  } catch (e2) {
    console.error("failed retry", e2);
  }
}
await mcp.close().catch(() => {});
await handle.kill().catch(() => {});
process.exit(0);
