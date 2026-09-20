-- BSconta+ RH — triggers de updated_at
-- =============================================================================
-- Várias tabelas têm a coluna "updated_at", mas nada no banco garantia que
-- ela fosse atualizada de verdade num UPDATE — dependia de cada função
-- JavaScript lembrar de mandar "updated_at: now()" no payload (algumas
-- mandam, outras não — ex.: nenhuma das duas RPCs de ajuste de solicitações
-- toca em updated_at). Uma função de trigger genérica resolve isso de
-- verdade, no banco, para SEMPRE, independente do que o cliente mandar.
--
-- Idempotente: "create or replace function" + "drop trigger if exists" antes
-- de recriar.
-- =============================================================================

create or replace function rh.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
comment on function rh.set_updated_at() is 'Trigger genérico: garante que updated_at reflita o momento real do UPDATE, mesmo se o cliente não mandar esse campo no payload.';

-- rh.perfis não tinha updated_at (só created_at) — precisa pra saber quando
-- o papel/nome/e-mail/ativo de alguém foi alterado pela última vez.
alter table rh.perfis add column if not exists updated_at timestamptz not null default now();

do $$
declare
  t text;
begin
  foreach t in array array['colaboradores', 'ponto_registros', 'solicitacoes', 'ferias_saldos', 'beneficios', 'documentos', 'perfis'] loop
    execute format('drop trigger if exists trg_%I_updated_at on rh.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on rh.%I for each row execute function rh.set_updated_at()',
      t, t
    );
  end loop;
end $$;
