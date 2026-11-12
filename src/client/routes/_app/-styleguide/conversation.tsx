import type { Person } from "@shared/api";
import { quickEmoji, type Reaction, toggleReaction } from "@shared/reactions";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Composer } from "@/components/ui/Composer";
import {
  AddReactionButton,
  Bubble,
  MessageGroup,
  NewDivider,
  ReactionPicker,
  ReactionPills,
} from "@/components/ui/Message";
import { Label, Panel, people, Section } from "./shared";

const [alex, sam] = people as [Person, Person];

export function ConversationSection() {
  const [text, setText] = useState("");
  const [reactions, setReactions] = useState<Reaction[]>(() => [
    { kind: "❤️", userId: sam.id, at: 1 },
    { kind: "❤️", userId: alex.id, at: 2 },
    { kind: "🍝", userId: sam.id, at: 3 },
    { kind: "🫠", userId: alex.id, at: 4 },
  ]);
  const picker = {
    quick: quickEmoji(["🍝"]),
    recent: ["🔥", "🍝", "🎉"],
    given: new Set(reactions.filter((r) => r.userId === alex.id).map((r) => r.kind)),
    onPick: (kind: string) => setReactions((list) => toggleReaction(list, kind, alex.id, Date.now())),
  };
  return (
    <Section
      id="conversation"
      title="Conversation"
      note="The short thread at the foot of an idea or build. It reads like a small messaging app, not a comment list: one person's messages sit together under one name and time, yours at the end on a tomato tint, the other person's at the start on cream. A thread with nothing in it is a single quiet field."
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel className="bg-paper shadow-none">
          <Label>Messages</Label>
          <ol className="flex flex-col gap-3">
            <MessageGroup person={sam} name="Sam" time={Date.now() - 2 * 3_600_000}>
              <Bubble>Could you print this one in the blue PETG?</Bubble>
              <Bubble>The drawer bins from https://makerworld.com/en/models/drawer-bins would fit.</Bubble>
            </MessageGroup>
            <MessageGroup person={alex} name="You" mine time={Date.now() - 90 * 60_000}>
              <Bubble mine>Started it tonight, the first layer looked great.</Bubble>
              <Bubble mine edited>
                Two halves, as we said.
              </Bubble>
            </MessageGroup>
            <NewDivider />
            <MessageGroup person={sam} name="Sam" time={Date.now() - 40 * 60_000}>
              <Bubble>It floats upright!</Bubble>
            </MessageGroup>
            <MessageGroup person={alex} name="You" via="Claude for Alex" mine time={Date.now() - 5 * 60_000}>
              <Bubble mine>Logged attempt 2: it came out clean.</Bubble>
            </MessageGroup>
          </ol>
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel>
            <Label>Composer</Label>
            <Composer
              value={text}
              onChange={setText}
              onSend={() => setText("")}
              placeholder="Say something to Sam"
              label="Say something to Sam"
            />
            <p className="text-small text-ink-faint mt-3">
              Enter sends, Shift+Enter breaks the line, Escape leaves. On a phone it opens in a sheet that rides the
              keyboard, and Enter is a line break. The draft is kept per thread until it is sent.
            </p>
          </Panel>
          <Panel>
            <Label>Reactions</Label>
            <ReactionPills
              reactions={reactions}
              me={alex.id}
              nameOf={(id) => (id === sam.id ? "Sam" : "Alex")}
              onToggle={(kind) => setReactions((list) => toggleReaction(list, kind, alex.id, Date.now()))}
            >
              <AddReactionButton label="React to this idea" />
            </ReactionPills>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div className="bg-lifted shadow-float w-fit max-w-full rounded-xl p-5">
                <p className="text-caption text-ink-faint mb-3 font-semibold tracking-wider uppercase">
                  Quick row, phone sheet
                </p>
                <ReactionPicker layout="sheet" {...picker} more={false} onMore={() => {}} />
              </div>
              <div className="bg-lifted shadow-float w-fit rounded-lg p-1.5">
                <ReactionPicker layout="menu" {...picker} more={false} onMore={() => {}} />
              </div>
              <div className="bg-lifted shadow-float w-fit max-w-full rounded-xl p-3 md:col-span-2">
                <p className="text-caption text-ink-faint mb-1 px-2 font-semibold tracking-wider uppercase">
                  Full picker, desktop popover
                </p>
                <ReactionPicker layout="menu" {...picker} more onMore={() => {}} />
              </div>
            </div>
            <p className="text-small text-ink-faint mt-3">
              Any emoji, the system's colour ones (Apple's on iPhones and Macs). Yours are tinted, the other person's
              plain, and "2" means both of you; a tap on a pill gives it or takes yours back, and its tooltip says who.
              The smiley opens a quick row of the emoji the two of you use most (six defaults until there is a history)
              and "more", which swaps in the full picker: search by name or keyword, categories, recent picks, a skin
              tone. On a phone it is a sheet with the search under the grid, at thumb reach; on desktop a popover with
              the search focused, arrows to move and Enter to pick.
            </p>
          </Panel>
          <Panel>
            <Label>Unread, on a card</Label>
            <div className="w-44">
              <Card
                aspect="square"
                title="Desk tidy-up"
                note="Clips, a bin for screws, a phone stand."
                unread={2}
                meta="for Sam · 2 days ago"
              />
            </div>
            <p className="text-small text-ink-faint mt-3">
              A tomato "1 new" over the photo's corner when the other person has written something you haven't read yet;
              it goes when you open the thread.
            </p>
          </Panel>
        </div>
      </div>
    </Section>
  );
}
