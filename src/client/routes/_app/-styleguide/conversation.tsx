import type { Person } from "@shared/api";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Composer } from "@/components/ui/Composer";
import { Bubble, MessageGroup, NewDivider } from "@/components/ui/Message";
import { Label, Panel, people, Section } from "./shared";

const [alex, sam] = people as [Person, Person];

export function ConversationSection() {
  const [text, setText] = useState("");
  return (
    <Section
      id="conversation"
      title="Conversation"
      note="The short thread at the foot of an idea or build. It reads like a small messaging app, not a comment list: one person's messages sit together under one name and time, yours at the end on a tomato tint, the other person's at the start on cream. A thread with nothing in it is a single quiet field."
    >
      <div className="grid gap-6 md:grid-cols-2">
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
