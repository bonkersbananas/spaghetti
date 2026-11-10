# 0008. Spools are called the Pantry

Status: Accepted

**Decision:** The filament library is called the Pantry (`/pantry`), and a spool is a spool.

**Why:** the pasta theme lives in names. "On the shelf" was the obvious name but already means shelved builds (a build put aside), and two different things under one word would confuse.

**Consequences:** use "Pantry" for the section and routes, and keep "on the shelf" for builds with the stage `shelved`. Code says `spools`.
