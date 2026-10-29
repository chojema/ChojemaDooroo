// Supply browser Storage when newer Node globals shadow jsdom's Storage.
if (typeof window !== 'undefined' && !globalThis.localStorage) {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return data.size },
      clear: () => data.clear(),
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(String(key), String(value)) },
      removeItem: (key: string) => { data.delete(key) },
      key: (index: number) => [...data.keys()][index] ?? null,
    },
  })
}
