import type { PersonColor } from "./people.ts";

/** A person as the client sees them: never includes credentials. */
export interface Person {
  id: string;
  username: string;
  name: string;
  color: PersonColor;
}

export interface SessionResponse {
  user: Person;
}

export interface PeopleResponse {
  people: Person[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
