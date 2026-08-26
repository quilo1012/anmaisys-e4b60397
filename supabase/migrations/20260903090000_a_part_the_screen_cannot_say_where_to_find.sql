-- A part the screen cannot say where to find.
--
-- `/dashboard/stock` knows a part's name, code, line, category, price, quantity and
-- minimum. The warehouse's own list — the `anstockcontrol` app the Stock module is
-- absorbing — knows four more things about the same part, and they are the four an
-- engineer standing in front of the shelves actually needs: what it IS (description),
-- what it goes ON (machine), where it LIVES (location), and what it LOOKS like
-- (photo). Without them the 137 spare parts are a list of codes.
--
-- All four are nullable and none is back-filled here: the parts already in `products`
-- were entered without them, and inventing a location is worse than leaving it blank.
-- The Stock screen prints "—" for what it does not know.
--
-- `photo_url` holds a path in the existing storage bucket, not an image. Nothing
-- uploads to it yet — the photos live in the app being absorbed and have to be
-- carried over by hand — so it is here to be filled, not because it is full.

alter table public.products
  add column if not exists description text,
  add column if not exists machine text,
  add column if not exists location text,
  add column if not exists photo_url text;

-- The category filter reads this on every keystroke of the search box.
create index if not exists products_category_idx on public.products (category);
