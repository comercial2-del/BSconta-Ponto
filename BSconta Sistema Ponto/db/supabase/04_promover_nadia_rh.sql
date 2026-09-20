-- =============================================================================
-- BSconta+ RH — promove Nádia a RH (papel 'RH', não 'RH_ADMIN')
-- =============================================================================
-- Roda DEPOIS do 01_schema_rh.sql e do 03_seed_colaboradores.sql.
--
-- ATENÇÃO: o e-mail "BSconta@27nadia.com.br" usado no protótipo (tela de
-- login, js/demo-data.js) é só um identificador de login interno do
-- protótipo — NÃO é um e-mail real/entregável. Antes de rodar este script
-- no banco de verdade, troque v_email abaixo pelo e-mail CORPORATIVO REAL
-- da Nádia, e crie o login dela primeiro em:
--   Authentication > Users > Add user  (defina o e-mail real e uma senha,
--   ou use "Invite user" para ela definir a própria senha por e-mail)
-- e só então rode este script.
--
-- Idempotente: se ela já tiver um perfil em rh.perfis, o papel dela é
-- atualizado para RH; se não tiver, um perfil novo é criado e vinculado à
-- linha correspondente em rh.colaboradores (pelo e-mail cadastrado em
-- 03_seed_colaboradores.sql).
-- =============================================================================

do $$
declare
  v_email text := 'BSconta@27nadia.com.br';  -- <<< troque pelo e-mail real da Nádia
  v_user_id uuid;
  v_colaborador_id uuid;
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    raise exception
      'Não achei nenhum usuário com o e-mail % em auth.users. Crie o login primeiro em Authentication > Users > Add user (ou Invite user), e rode este script de novo.',
      v_email;
  end if;

  select id into v_colaborador_id from rh.colaboradores where email = v_email;

  insert into rh.perfis (user_id, role, colaborador_id)
  values (v_user_id, 'RH', v_colaborador_id)
  on conflict (user_id) do update set
    role = 'RH',
    colaborador_id = coalesce(excluded.colaborador_id, rh.perfis.colaborador_id);

  raise notice 'OK: % agora é RH no schema rh.', v_email;
end $$;

-- Confirmação rápida (roda junto, só para conferir o resultado no painel):
select u.email, p.role, p.colaborador_id
from rh.perfis p
join auth.users u on u.id = p.user_id
where u.email = 'BSconta@27nadia.com.br';  -- <<< troque aqui também, se mudou acima
