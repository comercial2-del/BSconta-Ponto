-- BSconta+ RH — colunas extras + regra de visibilidade real para Comunicados
-- =============================================================================
-- O schema original de rh.comunicados só tinha titulo/conteudo/urgente —
-- não dava pra representar de verdade o que a tela rh/comunicados.html já
-- oferecia no protótipo (status Publicado/Agendado/Arquivado, e público
-- Todos / Departamento específico / Colaborador específico). Este script
-- acrescenta essas colunas (aditivo, idempotente) e REESCREVE a política de
-- leitura de rh.comunicados para valer de verdade: um colaborador comum só
-- vai ver, via SELECT, os comunicados PUBLICADOS que forem "Todos" ou que
-- forem endereçados a ele especificamente ou ao departamento dele — não é
-- um filtro que a tela aplica (que poderia ser burlado), é uma regra do
-- próprio banco. RH/RH_ADMIN continuam vendo tudo (política "rh_staff all"
-- já existente, inalterada).

alter table rh.comunicados
  add column if not exists status text not null default 'PUBLICADO' check (status in ('PUBLICADO', 'AGENDADO', 'ARQUIVADO')),
  add column if not exists publico_tipo text not null default 'TODOS' check (publico_tipo in ('TODOS', 'DEPARTAMENTO', 'COLABORADOR')),
  add column if not exists publico_departamento text,
  add column if not exists publico_colaborador_id uuid references rh.colaboradores(id) on delete set null,
  add column if not exists data_agendada date;

drop policy if exists "logados leem - comunicados" on rh.comunicados;
create policy "logados leem - comunicados" on rh.comunicados for select using (
  status = 'PUBLICADO'
  and (
    publico_tipo = 'TODOS'
    or (publico_tipo = 'COLABORADOR' and publico_colaborador_id = rh.colaborador_atual())
    or (
      publico_tipo = 'DEPARTAMENTO'
      and exists (
        select 1 from rh.colaboradores c
        where c.id = rh.colaborador_atual() and c.departamento = rh.comunicados.publico_departamento
      )
    )
  )
);

-- Observação sobre "Agendado": esta regra de RLS já garante que um
-- comunicado AGENDADO nunca aparece pra colaborador (só PUBLICADO aparece).
-- Ela NÃO muda o status sozinha na data agendada — isso precisa do job em
-- 09_comunicados_publicar_agendados.sql (Passo 4.10 do SETUP-SUPABASE.md),
-- que depende da extensão pg_cron ser ativada manualmente no painel.
