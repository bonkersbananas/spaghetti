# 0081. The failure coach waits for the whole answer, and looks at the photos

Status: Accepted (Carl Oscar asked on Nov 26, 2026 why an attempt answered Partly got no suggestions). Amends [0027](0027-failure-coach-suggests-what-to-try-next.md).

**Decision:** the coach's job is still made at the answer (the attempt says "Thinking about the next try…" at once), but Claude is asked only once the attempt has been quiet for 15 seconds: no new answer, note or photo (`coachTiming` in `worker/coach/run.ts`). The response's `waitUntil` sleeps 15 seconds and tries; if the person is still adding things, the cron (every 5 minutes) tries again until it is quiet. A call too slow for the little time `waitUntil` has left leaves the job waiting for the cron, with all the time it needs.

**One more look.** When the note, the tags or the photos change after the run, within an hour of the answer, the cron asks once more (`coach_runs.runs` is 1 after the first call, 2 after the second; `basis` is what the first was given). The second answer replaces the first's suggestions, and what was dismissed with them; if it fails, the first stays. Never more than two calls for an answer; the day's cap and the tries are as before, and two callers at once are told apart by the claim.

**It looks at the pictures.** The prompt now carries up to three of the attempt's pictures (the large variant), the people's close-ups ahead of the printer camera's 1920x1080 frame, besides the note. Before this it was told only the text and the photo read's one sentence.

**Why:** an answer arrives in pieces: the outcome and tags, then close-ups and a note seconds later. The coach ran on the outcome and was never asked again, so it said nothing.

**Not done:** attempts coached before this (`runs` 0) aren't looked at again by themselves.
