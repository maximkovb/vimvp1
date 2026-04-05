import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// Required for Node.js runtime (Next.js Server Components / Route Handlers).
// The Neon serverless driver communicates over WebSockets; Node.js doesn't
// have a global WebSocket constructor, so we must supply one.
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const pool = new Pool({ connectionString, max: 1 });

export const db = drizzle(pool, { schema });
