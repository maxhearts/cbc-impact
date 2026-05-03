import { defineConfig, loadEnv } from "vite";
import { chatApiPlugin } from "./server/chat-api.js";

export default defineConfig(({ mode }) => {
  // Load .env / .env.local so OPENROUTER_API_KEY is visible to the
  // server-side plugin (process.env). Vite normally only exposes
  // VITE_-prefixed vars to the client; we deliberately keep the key
  // server-only.
  const env = loadEnv(mode, process.cwd(), "");
  for (const k of Object.keys(env)) {
    if (process.env[k] === undefined) process.env[k] = env[k];
  }
  return {
    server: { port: 5180 },
    plugins: [chatApiPlugin()],
  };
});
