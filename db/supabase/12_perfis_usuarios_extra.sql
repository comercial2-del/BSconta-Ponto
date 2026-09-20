-- BSconta+ RH — Configurações > Usuários e permissões: colunas reais
-- =============================================================================
-- rh.perfis só tinha user_id/colaborador_id/role — o suficiente pra
-- controlar ACESSO, mas não pra listar "usuários do sistema" na tela de
-- Configurações (nome/e-mail de quem não tem cadastro em rh.colaboradores
-- — ex.: uma conta de RH pura — não existiam em lugar nenhum acessível pelo
-- cliente, já que auth.users não é consultável fora do service role).
-- Aditivo, idempotente.

alter table rh.perfis
  add column if not exists nome text,
  add column if not exists email text,
  add column if not exists ativo boolean not null default true,
  add column if not exists preferencias_notificacao jsonb not null default '{}'::jsonb;

-- Preenche nome/email pra quem já tinha colaborador vinculado (dados que já
-- existem em rh.colaboradores) — só um "melhor esforço" de migração pra não
-- deixar a lista de usuários com nomes em branco pra contas já existentes;
-- contas sem colaborador (nunca convidadas por este fluxo antes de existir a
-- coluna) continuam com nome/email nulos até serem editadas manualmente uma
-- vez em Configurações > Usuários.
update rh.perfis p
set nome = c.nome, email = c.email
from rh.colaboradores c
where p.colaborador_id = c.id and p.nome is null;

-- Quem não tem colaborador vinculado (ex.: a conta de RH_ADMIN promovida no
-- Passo 4, sem ficha de colaborador) não é coberta pelo update acima — mas
-- o e-mail dela já existe em auth.users, e quem roda este script no SQL
-- Editor tem acesso a essa tabela (é o dono do projeto). Preenche pelo
-- menos o e-mail nesse caso; o nome continua em branco até ser editado uma
-- vez em Configurações > Usuários (a Supabase não expõe "nome" de
-- auth.users por padrão — só o metadata, que nem todo login tem).
update rh.perfis p
set email = u.email
from auth.users u
where p.user_id = u.id and p.email is null;

-- O colaborador comum e o RH (não-admin) só têm SELECT na própria linha de
-- rh.perfis (política "self select"), nunca UPDATE — só RH_ADMIN pode
-- alterar papel/nome/e-mail/ativo de alguém (política "rh_admin all",
-- já existente, sem mudança). A única coisa que QUALQUER pessoa logada
-- pode alterar na própria linha, sozinha, são as preferências de
-- notificação — isto é pessoal, não é controle de acesso. Uma função
-- security definer estreita, restrita a essa coluna, exatamente no mesmo
-- padrão já usado para o Perfil do colaborador.

create or replace function rh.usuario_atualizar_preferencias_notificacao(p_prefs jsonb)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
begin
  update rh.perfis set preferencias_notificacao = p_prefs where user_id = auth.uid();
  if not found then
    raise exception 'Perfil de acesso não encontrado para este login.';
  end if;
end;
$$;
comment on function rh.usuario_atualizar_preferencias_notificacao(jsonb) is 'Qualquer usuário logado salva as PRÓPRIAS preferências de notificação — nunca papel/ativo/nome/e-mail, que continuam só com RH_ADMIN.';

grant execute on function rh.usuario_atualizar_preferencias_notificacao(jsonb) to authenticated;
