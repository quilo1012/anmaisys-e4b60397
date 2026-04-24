-- RPC para listar perfis ativos (id + name) acessível a qualquer utilizador autenticado.
-- Necessário para popular dropdown "Requested By" no formulário de criação de Work Orders,
-- já que a RLS de profiles restringe SELECT ao próprio utilizador.
CREATE OR REPLACE FUNCTION public.list_active_profile_names()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name
  FROM public.profiles p
  WHERE p.active = true
  ORDER BY p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.list_active_profile_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_profile_names() TO authenticated;