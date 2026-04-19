

User wants client-side defense-in-depth role check on PDF/print actions, in addition to the server-side gating already added in the previous fix. The server gate (`generate-wo-pdf-auth` edge function) is the actual security boundary, but adding a client-side guard prevents wasted network calls and gives instant UX feedback ("You don't have permission") without a round-trip.

Let me check the current state of the two files to confirm where the guards belong.
