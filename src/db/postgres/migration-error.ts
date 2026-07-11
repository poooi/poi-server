export const formatMigrationError = (error: unknown, redactedValues: readonly string[]): string => {
  const message = error instanceof Error ? error.message : String(error)
  return redactedValues.reduce(
    (sanitized, value) =>
      value.length === 0 ? sanitized : sanitized.split(value).join('<redacted>'),
    message,
  )
}
