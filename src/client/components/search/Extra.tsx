import type { AttemptHit, SearchResponse, Spool, Twist } from "@shared/api";
import type { SearchTerm } from "@shared/search";
import type { Ref } from "react";
import { SpoolResult } from "./SpoolResult";
import { StartAgain } from "./StartAgain";
import { TwistResult } from "./TwistResult";
import { Understood } from "./Understood";

export type ExtraProps =
  | { part: "understood"; shown: SearchResponse }
  | { part: "start"; hit: AttemptHit; onStart: () => void }
  | {
      part: "twist";
      twist: Twist;
      terms: readonly SearchTerm[];
      selected: boolean;
      onHover: () => void;
      onOpen: () => void;
      innerRef: Ref<HTMLAnchorElement>;
    }
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
  if (props.part === "start") {
    // Lined up with the text column of the result above it.
    return (
      <div className="pb-1 pl-[6.375rem] md:pl-[7.5rem]">
        <StartAgain hit={props.hit} onStart={props.onStart} />
      </div>
    );
  }
  if (props.part === "twist") {
    const { part: _part, innerRef, ...rest } = props;
    return <TwistResult ref={innerRef} {...rest} />;
  }
  const { part: _part, innerRef, ...rest } = props;
  return <SpoolResult ref={innerRef} {...rest} />;
}
