import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

const routes = new Set(["/api/cad/engine", "/api/cad/geometry"]);
const worker = fileURLToPath(new URL("./test-window-worker.py", import.meta.url));
const limit = 1024 * 1024;
type Reply = { status: number; body: unknown };

/** The iframe posts to its own loopback Vite origin. Never enable CORS or
 * forward these local computations to Studio's account/storage endpoints. */
export function localRequestProblem(request: Pick<IncomingMessage, "headers" | "method">): Reply | null {
  const host = request.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`) ||
      request.headers["sec-fetch-site"] === "cross-site") {
    return { status: 403, body: { error: "Local CAD requests must come from this window." } };
  }
  if (request.method !== "POST") return { status: 405, body: { error: "Use POST for CAD computation." } };
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) {
    return { status: 415, body: { error: "CAD requests require JSON." } };
  }
  return null;
}

/** Explicit development adapter. Uses exactly the product's browser runtime
 * and native engine; it does not start a Studio host or access Studio data. */
export function localCADTestRuntime(): Plugin {
  const children = new Set<ChildProcess>();
  let requests = 0;
  return {
    name: "aether-local-cad-test", apply: "serve",
    configureServer(server) {
      const stop = () => { children.forEach(child => child.kill()); };
      process.once("exit", stop);
      server.httpServer?.once("close", () => { stop(); process.removeListener("exit", stop); });
      server.middlewares.use(async (request, response, next) => {
        if (!routes.has((request.url || "").split("?")[0])) return next();
        const reply = (result: Reply) => {
          if (response.destroyed) return;
          response.writeHead(result.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify(result.body));
        };
        const problem = localRequestProblem(request);
        if (problem) return reply(problem);
        if (requests >= 4) return reply({ status: 429, body: { error: "The local CAD engine is busy. Retry the rebuild." } });
        requests++;
        try {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of request) {
            length += chunk.length;
            if (length > limit) { reply({ status: 413, body: { error: "CAD request exceeds 1 MiB." } }); return; }
            chunks.push(Buffer.from(chunk));
          }
          let data: unknown;
          try { data = JSON.parse(Buffer.concat(chunks).toString()); }
          catch { reply({ status: 400, body: { error: "The CAD request is not valid JSON." } }); return; }
          const result = await new Promise<Reply>((resolve) => {
            const child = spawn(process.env.AETHER_PYTHON || "python3", [worker], { stdio: ["pipe", "pipe", "pipe"] });
            children.add(child);
            const output: Buffer[] = [];
            let bytes = 0;
            let finished = false;
            const finish = (value: Reply) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              resolve(value);
            };
            const timer = setTimeout(() => {
              child.kill();
              finish({ status: 504, body: { error: "The local CAD rebuild timed out. Retry the rebuild." } });
            }, 65_000);
            child.stdout.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 32 * limit) {
                child.kill();
                finish({ status: 502, body: { error: "The CAD result exceeds the local preview limit." } });
              } else output.push(chunk);
            });
            child.stderr.on("data", (chunk: Buffer) => server.config.logger.warn(chunk.toString().trim()));
            child.stdin.on("error", () => {}); // Exit/error below reports a useful failure.
            child.on("error", () => finish({ status: 503, body: { error: "Cannot start the local CAD runtime. Install Python 3 or set AETHER_PYTHON, then restart npm run dev:test-window." } }));
            child.on("close", code => {
              children.delete(child);
              try {
                if (code !== 0) throw new Error();
                finish(JSON.parse(Buffer.concat(output).toString()) as Reply);
              } catch {
                finish({ status: 503, body: { error: "The local CAD runtime stopped. Check the development terminal and retry." } });
              }
            });
            child.stdin.end(JSON.stringify({ path: request.url?.split("?")[0], data }));
          });
          reply(result);
        } catch {
          reply({ status: 400, body: { error: "The CAD request was interrupted. Retry the rebuild." } });
        } finally { requests--; }
      });
    },
  };
}
