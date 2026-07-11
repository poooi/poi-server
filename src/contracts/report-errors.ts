export class ReportPayloadValidationError extends Error {
  constructor(
    message: string,
    readonly logged = false,
  ) {
    super(message)
  }
}
