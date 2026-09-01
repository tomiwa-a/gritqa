import { startMcp } from "./src/cli.js";
import { connectMcp } from "./src/mcp.js";

const root = process.argv[2] ?? "/Users/pitersonsmartpro/Downloads/hotel";
const { handle } = await startMcp(root);
handle.child.stderr?.on("data", (d: Buffer) => process.stdout.write("[gritqa] " + d.toString()));
const mcp = await connectMcp(handle);
console.log("tools:", Object.keys(mcp.tools));
const db: any = (mcp.tools as any).db;
try {
  const res = await db.execute({ sql: "SHOW TABLES" }, {});
  console.log("DB OK:", JSON.stringify(res).slice(0, 400));
} catch (e) {
  console.log("DB ERR:", e instanceof Error ? e.message : String(e));
}
await mcp.close().catch(() => {});
await handle.kill().catch(() => {});
process.exit(0);
