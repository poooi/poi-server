declare let latestCommit: string

declare namespace NodeJS {
  interface Global {
    latestCommit: typeof latestCommit
  }
}
