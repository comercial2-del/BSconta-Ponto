-- =============================================================================
-- BSconta+ RH — promove o primeiro RH_ADMIN
-- =============================================================================
-- Roda DEPOIS do 01_schema_rh.sql.
--
-- Pré-requisito: a pessoa já precisa ter um usuário de login (auth.users)
-- neste projeto Supabase. Se ela já usa o CRM/Marketing, ela já tem — não
-- precisa criar de novo. Se for uma pessoa nova (ex: alguém do RH que nunca
-- logou em nada aqui), crie o login primeiro em:
--   Authentication > Users > Add user  (defina um e-mail e uma senha)
-- e só então rode este script.
--
-- Troque o e-mail abaixo pelo da pessoa que vai ser o primeiro RH_ADMIN.
-- Este script é seguro para rodar mais de uma vez (idempotente): se a
-- pessoa já tiver um perfil em rh.perfis, o papel dela é atualizado para
-- RH_ADMIN; se não tiver, um perfil novo é criado.
-- =============================================================================

do $$
declare
  v_email text := 'comercial2@bsconta.com.br';  -- <<< troque aqui se necessário
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    raise exception
      'Não achei nenhum usuário com o e-mail % em auth.users. Crie o login primeiro em Authentication > Users > Add user, e rode este script de novo.',
      v_email;
  end if;

  insert into rh.perfis (user_id, role)
  values (v_user_id, 'RH_ADMIN')
  on conflict (user_id) do update set role = 'RH_ADMIN';

  raise notice 'OK: % agora é RH_ADMIN no schema rh.', v_email;
end $$;

-- Confirmação rápida (roda junto, só para conferir o resultado no painel):
select u.email, p.role, p.colaborador_id
from rh.perfis p
join auth.users u on u.id = p.user_id
where u.email = 'comercial2@bsconta.com.br';  -- <<< troque aqui também, se mudou acima
