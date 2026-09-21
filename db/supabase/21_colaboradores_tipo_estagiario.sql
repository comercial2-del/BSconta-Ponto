-- =============================================================================
-- BSconta+ RH — campo "tipo" em rh.colaboradores (Colaborador x Estagiário)
-- =============================================================================
-- Pedido do cliente (21/09/2026): o cadastro de estagiário (e-mail
-- informado manualmente + senha gerada automaticamente, ver Edge Function
-- criar-estagiario-colaborador) precisa deixar visível, no sistema, que
-- aquela pessoa é um Estagiário — não só mais um Cargo/Departamento.
--
-- Este script é seguro para rodar mais de uma vez (idempotente).
-- =============================================================================

alter table rh.colaboradores
  add column if not exists tipo text not null default 'COLABORADOR';

-- Constraint em passo separado (add column not exists não permite "check"
-- direto de forma idempotente em algumas versões do Postgres).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'colaboradores_tipo_check'
  ) then
    alter table rh.colaboradores
      add constraint colaboradores_tipo_check check (tipo in ('COLABORADOR', 'ESTAGIARIO'));
  end if;
end $$;

comment on column rh.colaboradores.tipo is 'COLABORADOR (padrão, não mexe em ninguém já cadastrado — a coluna nasce com este valor) ou ESTAGIARIO (setado automaticamente pela Edge Function criar-estagiario-colaborador ao cadastrar um estagiário novo). Só controla o rótulo/badge exibido no RH — não afeta o papel de acesso (rh.perfis.role), que continua COLABORADOR/RH/RH_ADMIN.';
