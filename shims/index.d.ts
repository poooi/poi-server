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
