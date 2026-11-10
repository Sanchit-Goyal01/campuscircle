import { defineConfig, devices } from "@playwright/test";

const authPort = 3100;
const agentPort = 3101;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "auth",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${authPort}` },
    },
    {
      // `next start` forces NODE_ENV=production, which refuses the scripted model,
      // so the agent suite runs on `next dev`. Dev output goes to .next/dev and
      // build output to .next, each with its own lock, so the two servers do not collide.
      name: "agent",
      testMatch: /agent\.spec\.ts/,
      timeout: 60_000,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${agentPort}` },
    },
    {
      // Shares the agent dev server (scripted model on). Academics specs that need the agent run here.
      name: "academics",
      testMatch: /academics-.*\.spec\.ts/,
      timeout: 60_000,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${agentPort}` },
    },
  ],
  webServer: [
    {
      command: `npm run build && npx next start -p ${authPort}`,
      url: `http://localhost:${authPort}/sign-in`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx next dev -p ${agentPort}`,
      url: `http://localhost:${agentPort}/sign-in`,
      env: { AGENT_TEST_MODEL: "1" },
      // Never reuse: a server started without AGENT_TEST_MODEL would call the real model.
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
