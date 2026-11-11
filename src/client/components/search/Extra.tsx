import type { AttemptHit, SearchResponse, Spool } from "@shared/api";
import type { SearchTerm } from "@shared/search";
import type { Ref } from "react";
import { SpoolResult } from "./SpoolResult";
import { StartAgain } from "./StartAgain";
import { Understood } from "./Understood";

export type ExtraProps =
  | { part: "understood"; shown: SearchResponse }
  | { part: "start"; hit: AttemptHit; onStart: () => void }
  | {
      part: "spool";
      spool: Spool;
      terms: readonly SearchTerm[];
      selected: boolean;
      onHover: () => void;
      onOpen: () => void;
      innerRef: Ref<HTMLAnchorElement>;
    };

/**
 * What only some answers need, in one chunk the search screen loads when one appears: a spool found, a mended typo or
 * time ("Last week"), and "Start again" on an attempt that worked.
 */
export default function Extra(props: ExtraProps) {
  if (props.part === "understood") return <Understood shown={props.shown} />;
  if (props.part === "start") return <StartAgain hit={props.hit} onStart={props.onStart} />;
  const { part: _part, innerRef, ...rest } = props;
  return <SpoolResult ref={innerRef} {...rest} />;
}
