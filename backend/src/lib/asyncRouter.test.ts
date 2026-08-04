import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";

import { asyncRouter } from "./asyncRouter.js";

/**
 * The bug these pin down: on Express 4, a rejected promise in an `async` handler never reaches the
 * error middleware, so nothing writes a response and the request hangs until something times out.
 */

function appWith(router: express.IRouter) {
  const app = express();
  app.use(express.json());
  app.use("/", router);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

describe("asyncRouter", () => {
  it("turns a rejected async handler into a 500 instead of a hang", async () => {
    const router = asyncRouter();
    router.get("/boom", async () => {
      throw new Error("database is unreachable");
    });

    const res = await request(appWith(router)).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  // There is deliberately no companion test asserting that a stock `Router()` leaves the same
  // request unanswered. It does — that is the entire bug — but demonstrating it means provoking a
  // real unhandled rejection, which Vitest reports as a suite-level error and which would make
  // every CI run look broken. The behaviour is documented in asyncRouter.ts instead.

  it("catches rejections from middleware, not just route handlers", async () => {
    const router = asyncRouter();
    router.use(async () => {
      throw new Error("auth lookup failed");
    });
    router.get("/anything", (_req, res) => res.json({ reached: true }));

    const res = await request(appWith(router)).get("/anything");
    expect(res.status).toBe(500);
  });

  it("leaves successful handlers alone", async () => {
    const router = asyncRouter();
    router.get("/ok", async (_req, res) => {
      res.json({ ok: true });
    });
    router.post("/echo", async (req, res) => {
      res.status(201).json(req.body);
    });

    expect((await request(appWith(router)).get("/ok")).body).toEqual({ ok: true });
    const posted = await request(appWith(router)).post("/echo").send({ hello: "world" });
    expect(posted.status).toBe(201);
    expect(posted.body).toEqual({ hello: "world" });
  });

  it("still catches synchronous throws, which stock Express already handled", async () => {
    const router = asyncRouter();
    router.get("/sync-boom", () => {
      throw new Error("bad input");
    });

    expect((await request(appWith(router)).get("/sync-boom")).status).toBe(500);
  });

  it("preserves error-handling middleware, which Express identifies only by arity", async () => {
    const router = asyncRouter();
    router.get("/boom", async () => {
      throw new Error("original failure");
    });
    // If the wrapper flattened this to 3 arguments it would stop being an error handler and would
    // instead run on every successful request.
    router.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(418).json({ handled: (err as Error).message });
    });

    const res = await request(appWith(router)).get("/boom");
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ handled: "original failure" });
  });

  it("passes mounted sub-routers through untouched", async () => {
    const child = asyncRouter();
    child.get("/leaf", async (_req, res) => {
      res.json({ from: "child" });
    });

    const parent = asyncRouter();
    parent.use("/nested", child);

    const res = await request(appWith(parent)).get("/nested/leaf");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "child" });
  });

  it("routes a rejection from a nested router to the top-level error handler", async () => {
    const child = asyncRouter();
    child.get("/leaf", async () => {
      throw new Error("deep failure");
    });

    const parent = asyncRouter();
    parent.use("/nested", child);

    expect((await request(appWith(parent)).get("/nested/leaf")).status).toBe(500);
  });
});
