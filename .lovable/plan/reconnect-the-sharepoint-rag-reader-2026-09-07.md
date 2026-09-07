# Reconnect the SharePoint RAG reader

The new address answers (it replied "not authorised" without a key, which means the service is up). Two things need updating: the saved address and the access key.

## What I will do

1. Save the new service address `https://mit-previews-brunswick-dui.trycloudflare.com` as the SharePoint RAG service address used by the Weekly RAG sync.
2. Replace the stored access key on the server with the new one you sent. It stays server-side and is never shown in the app.
3. Run the connection test and, if it answers, pull one week to confirm data comes back.

## A note on the key

You pasted the key in chat, so it is in the message history. If that matters to you, generate a new one on the reader afterwards and send it again — I will store the replacement the same way.

## Technical details

- Update `system_settings.rag_api_base_url` (single settings row) to the new base URL, trailing slash trimmed.
- Replace the `RAG_API_KEY` secret used by the `rag-sharepoint-sync` edge function.
- Verify with `rag-sharepoint-sync` in `health` mode, then a `week` pull for the current week.
- No code changes; no publish.
