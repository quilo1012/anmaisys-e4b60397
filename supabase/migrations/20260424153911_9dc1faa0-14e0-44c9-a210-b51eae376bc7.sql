-- RPC pública (para qualquer authenticated) que devolve apenas id + name de engineers
-- ativos. Usada para resolver nomes em painéis (Top Engineers, Control Center).
-- Não expõe pin_hash nem outros campos sensíveis.
CREATE OR REPLACE FUNCTION public.list_engineer_names()
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id, e.name
  FROM public.engineers e
  WHERE e.is_active = true
  ORDER BY e.name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_engineer_names() TO authenticated;