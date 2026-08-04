import { Router, type IRouter, type RouterOptions } from "express";

/**
 * An Express Router that routes rejected promises to the error handler.
 *
 * Express 4 only catches *synchronous* throws. An `async` handler that rejects — which is nearly
 * every handler in this codebase — produces an unhandled promise rejection instead: `next(err)` is
 * never called, the error middleware in server.ts never runs, and nothing ever writes a response.
 * The request simply hangs until the client or Node's 5-minute requestTimeout gives up.
 *
 * That is not theoretical. With Postgres briefly unreachable, POST /api/auth/login logged
 * "[fatal] Unhandled rejection: PrismaClientInitializationError" and then held the socket open,
 * because the throw at authRoutes.ts:68 had nowhere to go. A database blip turned every request
 * into a hang rather than a fast 500 — the worst possible failure mode, since callers can't retry
 * something that never answers, and connections pile up while the outage lasts.
 *
 * Wrapping the router rather than each handler keeps the fix from depending on anyone remembering
 * it: a route added tomorrow is covered because it is registered on this router. The alternative,
 * a try/catch in ~150 handlers, is the arrangement that produced the bug.
 *
 * Express 5 does this natively, so this whole module is deletable on that upgrade.
 */

// `use` and `all` are included: middleware rejects for the same reasons handlers do, and an auth
// middleware that throws is exactly as capable of hanging a request.
const ROUTING_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all", "use"] as const;

type AnyFn = (...args: unknown[]) => unknown;

function wrapHandler(handler: unknown): unknown {
  // Paths, regexes, arrays of paths — anything that isn't a handler passes through untouched.
  if (typeof handler !== "function") return handler;

  // A mounted Router or Express app is a function too, but it carries its own dispatch machinery
  // and already forwards errors through its own stack. Wrapping one would hide its properties from
  // Express's introspection for no benefit.
  if ("stack" in handler || "handle" in handler) return handler;

  const fn = handler as AnyFn;

  // Express identifies error-handling middleware purely by arity, so the wrapper has to preserve
  // it: a 4-argument handler wrapped in a 3-argument function silently stops being an error
  // handler and starts being called for successful requests.
  if (fn.length === 4) {
    return function wrappedErrorHandler(err: unknown, req: unknown, res: unknown, next: unknown) {
      try {
        return Promise.resolve(fn(err, req, res, next)).catch(next as (e: unknown) => void);
      } catch (e) {
        return (next as (e: unknown) => void)(e);
      }
    };
  }

  return function wrappedHandler(req: unknown, res: unknown, next: unknown) {
    try {
      return Promise.resolve(fn(req, res, next)).catch(next as (e: unknown) => void);
    } catch (e) {
      return (next as (e: unknown) => void)(e);
    }
  };
}

export function asyncRouter(options?: RouterOptions): IRouter {
  const router = Router(options);

  for (const method of ROUTING_METHODS) {
    const original = router[method].bind(router) as AnyFn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (router as any)[method] = (...args: unknown[]) =>
      original(...args.map((arg) => (Array.isArray(arg) ? arg.map(wrapHandler) : wrapHandler(arg))));
  }

  return router;
}
