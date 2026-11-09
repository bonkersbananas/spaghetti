import type { PeopleResponse, SessionResponse } from "@shared/api";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, api } from "./api";

/** The signed-in person, or null when signed out. */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    try {
      return (await api<SessionResponse>("/session")).user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 5 * 60 * 1000,
});

/** Both people in the workspace, for avatars beside what they wrote. */
export const peopleQuery = queryOptions({
  queryKey: ["people"],
  queryFn: async () => (await api<PeopleResponse>("/people")).people,
  staleTime: 60 * 60 * 1000,
});
