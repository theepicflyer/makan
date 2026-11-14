import { defineConfig } from "drizzle-kit";

// Bao's tables only; Warren's (warren_*) have their own migrations.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  tablesFilter: ["!warren_*"],
});
