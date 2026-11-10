import type { AgentScope } from "../shared/agents.ts";
import type { ChangeActor } from "../shared/changes.ts";
import type { Db } from "./db/index.ts";
import type { User } from "./db/schema.ts";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    /** The person acting: who signed in, or for an agent the person it acts for. */
    user: User;
    /** Who is recorded as acting in the change feed: the person, or the agent. */
    actor: ChangeActor;
    /** The agent the request came through (its id), or null for a signed-in person. */
    via: string | null;
    /** What an agent's token allows; null for a person, who may do anything. */
    scopes: readonly AgentScope[] | null;
  };
}
