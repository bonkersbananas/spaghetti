/**
 * A tiny promise wrapper around one IndexedDB object store. Used for the
 * outbox (captures stay on the device until the server has them) and for the
 * persisted query cache.
 */
export function openStore<T>(dbName: string, storeName: string, keyPath: string) {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function db(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
    return dbPromise;
  }

  async function run<R>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    all: () => run("readonly", (store) => store.getAll() as IDBRequest<T[]>),
    put: (value: T) => run("readwrite", (store) => store.put(value)).then(() => undefined),
    get: (key: string) => run("readonly", (store) => store.get(key) as IDBRequest<T | undefined>),
    delete: (key: string) => run("readwrite", (store) => store.delete(key)).then(() => undefined),
    clear: () => run("readwrite", (store) => store.clear()).then(() => undefined),
  };
}
