import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const alias = { "@": path.resolve(__dirname, "./src") };

/**
 * Vitest config.
 *
 * Kept separate from `vite.config.ts` so the app's dev-server settings (which
 * Freebuff manages) are left untouched.
 *
 * Two projects, because the two test suites have opposite requirements. The
 * simulation engine tests block a worker for tens of seconds at a time while
 * they roll a full 98,923-agent trajectory, which starves vitest's worker
 * heartbeat when they share a pool with the DOM tests. They also need no DOM at
 * all. So: the app tests keep the template's jsdom environment and setup file,
 * and the engine tests get a Node environment, a long timeout, and one forked
 * worker to themselves.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "app",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/simulation/**", "node_modules/**", "dist/**"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "simulation",
          environment: "node",
          globals: true,
          include: ["src/simulation/**/*.{test,spec}.{ts,tsx}"],
          testTimeout: 300_000,
          hookTimeout: 60_000,
          pool: "forks",
          // Each test FILE gets its own forked worker, and files run one at a
          // time. The engine suite blocks its worker for tens of seconds in a
          // single synchronous span (it rolls a full 98,923-agent trajectory),
          // which can trip vitest's fixed 60s worker RPC timeout if several
          // files share one worker. Isolating the files keeps the cheap suites
          // running to completion and stops a heavy file from aborting the run.
          poolOptions: {
            forks: { singleFork: false },
          },
          fileParallelism: false,
        },
      },
    ],
  },
});
