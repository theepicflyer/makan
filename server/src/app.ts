/** Bao, assembled: its tables, rules, tools and routes on Warren. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentDefinition,
  type AppOptions,
  type Config,
  createApp,
  loadConfig,
  type WarrenApp,
} from "warren/server";
import { agentContext } from "./agent/context.js";
import { SYSTEM_PROMPT } from "./agent/systemPrompt.js";
import { baoTools, describeChange, MCP_INSTRUCTIONS } from "./agent/tools.js";
import { meOut, routes } from "./api.js";
import { loadReference } from "./foods.js";
import * as reminders from "./reminders.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS = path.resolve(here, "../migrations");

export interface BaoOptions {
  config?: Config;
  /** The reference food snapshot (SG FoodID, USDA). Default: REFERENCE_DIR, else data/reference in the repo. */
  referenceDir?: string;
  /** Tests pass scripted stand-ins for Claude and the push services. */
  anthropic?: AppOptions["anthropic"];
  pushSender?: AppOptions["pushSender"];
}

/** The in-app agent, as the app and the evals both run it. */
export function baoAgent(timezone: string): AgentDefinition {
  return {
    systemPrompt: SYSTEM_PROMPT,
    tools: baoTools(timezone),
    context: agentContext(timezone),
    describeChange,
  };
}

export function createBao(options: BaoOptions = {}): WarrenApp {
  const config = options.config ?? loadConfig();
  const referenceDir =
    options.referenceDir ?? process.env.REFERENCE_DIR ?? path.resolve(here, "../../data/reference");
  const tz = config.timezone;
  const app: WarrenApp = createApp({
    name: "bao",
    config,
    migrations: MIGRATIONS,
    tools: baoTools(tz),
    agent: baoAgent(tz),
    mcpInstructions: MCP_INSTRUCTIONS,
    me: meOut,
    push: {
      onFirstDevice: (user) => reminders.settle(app.db, user, tz),
      testMessage: (user) => reminders.confirmation(app.db, user),
    },
    pushSender: options.pushSender,
    anthropic: options.anthropic,
    routes: (api, ctx) => routes(api, ctx, referenceDir),
    jobs: (ctx) => (ctx.push ? [reminders.reminderJob(ctx.db, ctx.push, tz)] : []),
    onStart: ({ db }) => {
      const loaded = loadReference(db, referenceDir);
      if (loaded) console.info(`bao: loaded ${loaded} reference foods`);
    },
  });
  return app;
}
