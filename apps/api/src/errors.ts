export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAt?: string) { super(message); }
}
export const notFound = () => new AppError(404, 'NOT_FOUND', 'That item could not be found in your workspace.');
export function ensure(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
