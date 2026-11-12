import type { Twist } from "@shared/api";
import { checkLinkUrl } from "@shared/link-safety";
import { modelMarkOf } from "@shared/model-mark";
import { TWIST_NAME_MAX, TWIST_NOTE_MAX } from "@shared/twists";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { BuildCard } from "@/components/builds/BuildCard";
import { Fusilli } from "@/components/illustrations/Fusilli";
import { DetailBar } from "@/components/shell/DetailBar";
import { sourceLine } from "@/components/twists/TwistCard";
import { TwistChanges } from "@/components/twists/TwistChanges";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea, TextField } from "@/components/ui/Field";
import { ArrowRightIcon, BuildsIcon, EditIcon, TrashIcon } from "@/components/ui/icons";
import { LinkCard } from "@/components/ui/LinkCard";
import { NoteField } from "@/components/ui/NoteField";
import { Photo } from "@/components/ui/Photo";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { createBuild } from "@/lib/builds";
import { useBuilds } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { sessionQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useStickyColumn } from "@/lib/sticky-column";
import { deleteTwist, twistsQuery, updateTwist } from "@/lib/twists";
import { useLiveFields } from "@/lib/use-autosave";

export const Route = createFileRoute("/_app/twists/$twistId")({
  component: TwistPage,
});

const back = { to: "/twists", label: "Twists" } as const;

/** The quiet actions under the model: one style for a button and a link. */
const quietAction =
  "focus-ring text-small text-ink-soft hover:text-ink inline-flex min-h-11 items-center gap-1.5 rounded-md font-semibold";

function TwistPage() {
  const { twistId } = Route.useParams();
  const { data: twists, isPending } = useQuery(twistsQuery);
  const twist = twists?.find((t) => t.id === twistId);
  if (twist) return <TwistBody key={twist.id} twist={twist} />;
  return (
    <>
      <h1 className="sr-only">Twist</h1>
      <DetailBar back={back} />
      {isPending ? (
        <div className="flex flex-col gap-6 md:flex-row md:gap-10 lg:gap-14" aria-hidden>
          <Skeleton className="-mx-5 aspect-4/3 w-[calc(100%+2.5rem)] rounded-none md:mx-0 md:w-auto md:flex-2 md:rounded-xl" />
          <div className="flex flex-col gap-3 md:flex-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<Fusilli />}
          title="This twist came undone"
          action={
            <Link to="/twists" className="focus-ring rounded-md">
              <Button variant="secondary" tabIndex={-1}>
                Back to twists
              </Button>
            </Link>
          }
        >
          It was deleted, or it never made it here.
        </EmptyState>
      )}
    </>
  );
}

function TwistBody({ twist }: { twist: Twist }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const stickyColumn = useStickyColumn();
  const { data: user } = useQuery(sessionQuery);
  const { items: allBuilds } = useBuilds();
  const printed = // The idea it came from counts once it has grown into a build.
    allBuilds.filter((build) => build.twistId === twist.id || build.id === twist.fromItemId);
  const [editingLink, setEditingLink] = useState(false);
  const { value, change, saveState } = useLiveFields(
    { name: twist.name, note: twist.note, sourceUrl: twist.source.url ?? "", changes: twist.changes },
    async (changes) => {
      // A name can't be blank: that change waits until there is one.
      const { name, ...rest } = changes;
      // The server keeps only https links to a real host: one that isn't (yet) stays on screen with its message and
      // is held back, so it can't make the name, note and changes typed beside it fail with it.
      if (rest.sourceUrl?.trim() && !checkLinkUrl(rest.sourceUrl)) delete rest.sourceUrl;
      const next = { ...rest, ...(name?.trim() ? { name: name.trim() } : {}) };
      if (Object.keys(next).length) await updateTwist(queryClient, twist.id, next);
    },
  );
  const photo = twist.source.photo;
  const mark = value.sourceUrl ? modelMarkOf(value.sourceUrl) : null;
  const subtitle = sourceLine(twist);

  // "Print it again": a build named for the twist, which remembers it, opens ready for its first attempt.
  function printIt() {
    if (!user || !canEdit(false)) return;
    const id = createBuild(user.id, { title: value.name.trim() || twist.name, twistId: twist.id });
    void navigate({ to: "/builds/$buildId", params: { buildId: id } });
  }

  function remove() {
    if (!canEdit(false)) return;
    deleteTwist(queryClient, twist);
    void navigate({ to: "/twists" });
  }

  return (
    <article className="pb-6">
      <h1 className="sr-only">{value.name || "Twist"}</h1>
      <DetailBar back={back}>
        <SaveStatus state={saveState} className="mr-2" />
        <IconButton icon={TrashIcon} label="Delete twist" onClick={remove} disabled={readOnly} />
      </DetailBar>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10 lg:gap-14">
        {photo && (
          <div ref={stickyColumn} className="sticky-column md:min-w-0 md:flex-2">
            <Photo
              src={photoSrc(photo.id, "large")}
              alt={`The model, from ${twist.name}`}
              color={photo.color || undefined}
              className="-mx-5 aspect-4/3 w-[calc(100%+2.5rem)] md:mx-0 md:w-full md:rounded-xl"
            />
          </div>
        )}
        <div className="max-w-content flex min-w-0 flex-col gap-6 md:flex-3 md:pt-2">
          <div className="flex flex-col gap-1">
            <TextArea
              appearance="title"
              aria-label="Name"
              placeholder="Name this twist"
              minRows={1}
              maxLength={TWIST_NAME_MAX}
              readOnly={readOnly}
              value={value.name}
              onChange={(event) => change({ name: event.target.value.replace(/\n/g, " ") })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            {subtitle && <p className="text-small text-ink-faint">{subtitle}</p>}
          </div>

          <div>
            <Button variant="primary" icon={BuildsIcon} disabled={readOnly || !user} onClick={printIt}>
              {printed.length ? "Print it again" : "Print it"}
            </Button>
          </div>

          <Section id="changes" title="What we changed">
            <TwistChanges changes={value.changes} readOnly={readOnly} onChange={(next) => change({ changes: next })} />
          </Section>

          {printed.length > 0 && (
            <Section id="printed" title="Printed" count={printed.length}>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {printed.map((build) => (
                  <BuildCard key={build.id} item={build} />
                ))}
              </ul>
            </Section>
          )}

          <NoteField
            label="Note"
            maxLength={TWIST_NOTE_MAX}
            value={value.note}
            onChange={(note) => change({ note })}
            readOnly={readOnly}
            placeholder="Why, what to watch for, what the lid wants…"
          />

          <div className="flex flex-col gap-2">
            {value.sourceUrl && mark && <LinkCard url={value.sourceUrl} model={mark} className="max-w-content" />}
            {(!value.sourceUrl || !mark || editingLink) && (
              <TextField
                aria-label="Link"
                value={value.sourceUrl}
                type="url"
                inputMode="url"
                placeholder="Where the model is: https://makerworld.com/…"
                readOnly={readOnly}
                autoComplete="off"
                error={
                  value.sourceUrl.trim() && !checkLinkUrl(value.sourceUrl)
                    ? "That needs to be a full https:// link. It isn't saved until it is."
                    : undefined
                }
                onChange={(event) => change({ sourceUrl: event.target.value })}
              />
            )}
            {/* One quiet style for the actions under the model. */}
            <div className="flex flex-wrap items-center gap-x-5">
              {value.sourceUrl && mark && !readOnly && !editingLink && (
                <button type="button" onClick={() => setEditingLink(true)} className={quietAction}>
                  <EditIcon size={16} aria-hidden />
                  Change the link
                </button>
              )}
              {twist.fromItemId && (
                <Link to="/ideas/$ideaId" params={{ ideaId: twist.fromItemId }} className={quietAction}>
                  The idea it came from
                  <ArrowRightIcon size={16} aria-hidden />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
