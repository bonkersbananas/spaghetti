import { displayName } from "@shared/people";
import { useQuery } from "@tanstack/react-query";
import { sessionQuery } from "./queries";

/** How a person is named in a line about what they did: "You" for the signed-in person, their name for the other. */
export function useWho(): (person: { id: string; name: string } | null | undefined) => string | undefined {
  const { data: me } = useQuery(sessionQuery);
  return (person) => (person ? (person.id === me?.id ? "You" : displayName(person)) : undefined);
}
