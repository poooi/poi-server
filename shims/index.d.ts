declare module 'dotenv' {
  export interface DotenvConfigOptions {
    path?: string
    encoding?: string
    debug?: boolean
  }

  export interface DotenvConfigOutput {
    error?: Error
    parsed?: Record<string, string>
  }

  export function config(options?: DotenvConfigOptions): DotenvConfigOutput
}
