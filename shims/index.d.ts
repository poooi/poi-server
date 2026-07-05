interface GlobalThis {
  latestCommit: string
}

declare const global: typeof globalThis & {
  latestCommit: string
}

declare namespace NodeJS {
  interface Global {
    latestCommit: GlobalThis['latestCommit']
  }
}

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
