import type { Db } from "./db/index.ts";
import type { User } from "./db/schema.ts";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    user: User;
  };
}
