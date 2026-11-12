import type { FeaturesResponse } from "@shared/api";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** What the Worker can do beyond the basics; today only whether Claude can draft ideas (it has its key). */
export const featuresQuery = queryOptions({
  queryKey: ["features"],
  queryFn: () => api<FeaturesResponse>("/features"),
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});
