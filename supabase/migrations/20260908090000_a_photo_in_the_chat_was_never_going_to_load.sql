-- The photo the chat uploaded and could never show.
--
-- `WOChat` uploads to the `wo-photos` bucket and then calls `getPublicUrl()` on it. That
-- bucket is PRIVATE. `getPublicUrl` does not ask the server anything — it builds a
-- `/object/public/...` string locally — so it returns a URL that always looks fine and
-- never serves a byte. Storing it is worse than failing: the dead link is persisted, and
-- the `<img>` renders broken forever.
--
-- Every other photo in this codebase already does the right thing. `useWOPhotos` keeps a
-- `storage_path` and signs it on read via `getWOPhotoUrl`; `usePartPhotos`,
-- `useQualityIssue` and the DM audio all use `createSignedUrl`. WOChat is the one place
-- that was left behind.
--
-- IT HAS ALREADY HAPPENED, once, and the evidence is still in the bucket:
--
--   storage.objects, bucket wo-photos
--     chat/5700b746-345a-43fd-a7b7-2ff10e7ef919/1774529886689_IMG_5607.jpg
--     161051 bytes · image/jpeg · uploaded 2026-03-26 12:58 by Daniel Quiló
--
--   public.wo_messages   0 rows
--
-- The file uploaded. The message never arrived. Between the two sits
--
--     } catch {
--       // silently fail
--     }
--
-- so whoever tried it watched the spinner stop and nothing appear, with no error to
-- report and nothing to act on. That orphan has been sitting there for five months.
--
-- WHY RENAME RATHER THAN ADD. `wo_messages` has zero rows, so there is no data to
-- migrate and no reader to keep working. The column is about to hold a storage path
-- rather than a URL, and a column called `image_url` holding a path is precisely the
-- shape of the next bug — someone will eventually feed it to an `<img src>` again. With
-- the table empty this costs nothing, so it is renamed to what it contains.

ALTER TABLE public.wo_messages RENAME COLUMN image_url TO image_path;

COMMENT ON COLUMN public.wo_messages.image_path IS
  'Caminho no bucket PRIVADO wo-photos (ex.: chat/<wo_id>/<ts>_<ficheiro>.jpg), NUNCA um URL. '
  'O bucket e privado, por isso getPublicUrl() devolve um link morto — assinar na leitura com '
  'getWOPhotoUrl(), como o wo_photos.storage_path faz. Ver 20260908090000.';

-- The same trap, one table over, left explicit so nobody wires it up the fast way.
--
-- `direct_messages.image_url` has no writer at all: the DM screen only records audio, and
-- that already signs. The column is unimplemented rather than broken, which is exactly
-- when somebody reaches for getPublicUrl because "the other one does it".
COMMENT ON COLUMN public.direct_messages.image_url IS
  'SEM ESCRITOR — nada carrega imagens no chat directo (so audio, em dm-audio, que e assinado). '
  'Se vier a ser usada: os buckets deste projecto sao TODOS privados, portanto guardar o caminho '
  'e assinar na leitura. Nunca getPublicUrl(). Ver 20260908090000.';
