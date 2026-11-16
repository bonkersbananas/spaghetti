import { namesPerson } from "@shared/people";
import { useQuery } from "@tanstack/react-query";
import { peopleQuery, sessionQuery } from "./queries";

/**
 * How a "for …" line reads to this person: "for you" when it names them, as typed otherwise ("for Mila"). Nothing
 * while nobody is named. The line is free text; only the two people's own names are understood.
 */
export function useForLine(): (forWhom: string | null | undefined) => string | undefined {
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const self = people?.find((person) => person.id === me?.id);
  return (forWhom) => {
    const named = forWhom?.trim();
    if (!named) return undefined;
    return namesPerson(named, self) ? "for you" : `for ${named}`;
  };
}

/** The other person, for the quick "For Sam" chip (nobody until the two are known). */
export function useOtherPerson() {
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  return people?.find((person) => person.id !== me?.id);
}

/** Whether a "for …" line names the person reading it, so the page's line reads "for you". */
export function useNamesMe(): (forWhom: string | null | undefined) => boolean {
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const self = people?.find((person) => person.id === me?.id);
  return (forWhom) => namesPerson(forWhom, self);
}
