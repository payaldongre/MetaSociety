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
 * simulation engine tests block their worker for tens of seconds at a time
 * while they roll a full 98,923-agent trajectory, and they need no DOM at all.
 * The app tests keep the template's jsdom environment and setup file.
 *
 * The simulation project runs in a single node worker *thread*, one file at a
 * time. Under the `forks` pool the synchronous engine runs starved the child
 * process' message loop badly enough that vitest's fixed 60s RPC heartbeat
 * ("Timeout calling onTaskUpdate") fired after the suite had already finished,
 * so `vitest run` reported every assertion as passing yet still exited non-zero.
 * worker_threads delivers the parent's RPC replies on the worker's own message
 * port, which removes that spurious timeout without touching the timeouts,
 * assertions or simulation semantics themselves.
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
          pool: "threads",
          // One worker thread for every simulation file, and files run one at a
          // time. Running the full 98,923-agent trajectory in one synchronous
          // span still blocks the thread, so isolation between files (each gets
          // a fresh module registry) keeps shared state from leaking.
          poolOptions: {
            threads: { singleThread: true },
          },
          fileParallelism: false,
        },
      },
    ],
  },
});
