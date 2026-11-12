import { TWIST_NAME_MAX } from "@shared/twists";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { TwistIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { sessionQuery } from "@/lib/queries";
import { makeTwist } from "@/lib/twists";

/** A twist from nothing: a name, and the model's link if there is one. The page opens at once to write what changed. */
export function NewTwistSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: user } = useQuery(sessionQuery);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const url = link.trim();
  const badLink = url !== "" && !/^https:\/\/\S+\.\S+/.test(url);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="A new twist"
      description="Someone else's model, the way you print it."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!user || !name.trim() || badLink) return;
          const id = makeTwist(queryClient, { name: name.trim(), ...(url ? { sourceUrl: url } : {}) }, user.id);
          setName("");
          setLink("");
          onOpenChange(false);
          void navigate({ to: "/twists/$twistId", params: { twistId: id } });
        }}
      >
        <TextField
          label="Name it"
          value={name}
          maxLength={TWIST_NAME_MAX}
          placeholder="Gridfinity bin, 42 mm grid"
          autoComplete="off"
          enterKeyHint="next"
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Where the model is (optional)"
          value={link}
          type="url"
          inputMode="url"
          placeholder="https://makerworld.com/…"
          autoComplete="off"
          enterKeyHint="done"
          error={badLink ? "That needs to be a full https:// link." : undefined}
          onChange={(event) => setLink(event.target.value)}
        />
        <Button type="submit" variant="primary" icon={TwistIcon} disabled={!name.trim() || badLink} fullWidth>
          Make the twist
        </Button>
      </form>
    </Sheet>
  );
}
