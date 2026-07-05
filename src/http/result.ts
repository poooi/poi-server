export interface AppResult {
  body?: unknown
  headers?: Record<string, string>
  status: number
}

export const ok = (body?: unknown): AppResult => ({ body, status: 200 })

export const badRequest = (message: string): AppResult => ({
  body: { error: message },
  status: 400,
})

export const internalServerError = (): AppResult => ({ status: 500 })
