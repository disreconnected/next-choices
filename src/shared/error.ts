export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return String(err);
}
