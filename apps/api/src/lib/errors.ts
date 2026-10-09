import type { ZodType } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Authentication required") => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "Not allowed", code = "FORBIDDEN") => new AppError(403, code, msg);
export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (msg: string, code = "CONFLICT") => new AppError(409, code, msg);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(first?.message ?? "Invalid request", r.error.issues);
  }
  return r.data;
}
