export function parseErrorMsg(
  error: unknown,
  defaultMessage: string = "Unknown error"
): string {
  if (error instanceof Error) {
    return error.message || defaultMessage;
  } else if (typeof error === "string") {
    return error || defaultMessage;
  } else {
    return defaultMessage;
  }
}
