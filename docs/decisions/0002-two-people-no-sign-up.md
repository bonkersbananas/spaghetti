# 0002. Two people, no public sign-up, no teams or roles

Status: Accepted

**Decision:** The app has one shared workspace for two people. People are added from the command line (`pnpm user:add`); there is no sign-up page, no teams, no roles or permissions, no sharing between workspaces.

**Why:** it is a private notebook for a couple. Everything that supports many users (invites, billing, access control) would cost design and code and give them nothing.

**Consequences:** every item, photo and attempt is visible to both people and either may edit it; rows record who made them (`createdBy`, `finishedBy`) for attribution only. Adding people in the app and passkeys are on the [roadmap](../roadmap.md), but still for these two. Agents using the service later get scoped tokens, not roles.
