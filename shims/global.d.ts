export {}

declare global {
  var latestCommit: string

  interface GlobalThis {
    latestCommit: string
  }

  namespace NodeJS {
    interface Global {
      latestCommit: string
    }
  }
}
