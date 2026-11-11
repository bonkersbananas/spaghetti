# 0038. Reactions: a curated six, on ideas, builds and comments, your own included

Status: Accepted

**Decision:** Either person can react to an idea or build and to any comment, their own too, with one of six reactions: Love it, Chef's kiss, Want one, Hot, Bravo and Melting (`shared/reactions.ts`, Phosphor glyphs drawn filled in the palette's colors). Each person gives each reaction once per thing; giving it again takes it back. `reactions (target_id, item_id, comment_id, user_id, kind, created_at)` holds them, keyed by thing, person and kind; taking one back deletes the row, and they go with their item or comment when it is purged. Items and comments carry their `reactions` in the API, and a reaction is recorded in the change feed as an update of what was reacted to (`item` or `comment`), so the other person's screen refreshes without a new kind of change. Reactions are for people: an agent's token can't give them.

**Why:** a reply in two seconds, without writing, is what a tap on a phone next to the printer wants. A small, fixed set in the app's own icons keeps it warm and on-brand (no emoji keyboard, no system emoji that look different on every device), and with two people a pill needs no names: yours is tinted, the other person's plain, and "2" is both of you.

**Consequences:** no free emoji, no notifications for reactions, no reactions on attempts or photos for now. Changing the set means updating `REACTIONS` (labels can change freely; a removed kind's rows would need a migration). Revisit when someone asks to react to an attempt.
