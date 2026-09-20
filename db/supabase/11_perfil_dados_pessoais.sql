-- BSconta+ RH — Perfil do colaborador: dados pessoais + foto real
-- =============================================================================
-- rh.colaboradores não tinha colunas pra CPF/nascimento/telefone/endereço/
-- CEP/gestor (a tela de Perfil usava esses campos só ilustrativamente).
-- Aditivo, idempotente.

alter table rh.colaboradores
  add column if not exists cpf text,
  add column if not exists data_nascimento date,
  add column if not exists telefone text,
  add column if not exists endereco text,
  add column if not exists cep text,
  add column if not exists gestor_nome text;

-- O colaborador só tem SELECT em rh.colaboradores (política "self select"),
-- nunca UPDATE — só RH_STAFF pode alterar a linha (política "rh_staff
-- all"). Isso é intencional: um colaborador não deveria conseguir mudar o
-- próprio cargo, departamento, status ou e-mail direto na tabela. As duas
-- funções abaixo (security definer) dão a ele só as duas ações que a tela
-- de Perfil promete que ele pode fazer sozinho — editar os PRÓPRIOS dados
-- pessoais, e trocar a própria foto — validando por dentro que a linha é
-- dele e tocando só nessas colunas específicas.

create or replace function rh.colaborador_atualizar_dados_pessoais(
  p_cpf text, p_data_nascimento date, p_telefone text, p_endereco text, p_cep text
)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_id uuid := rh.colaborador_atual();
begin
  if v_id is null then
    raise exception 'Login não vinculado a um cadastro de colaborador.';
  end if;
  update rh.colaboradores
  set cpf = p_cpf, data_nascimento = p_data_nascimento, telefone = p_telefone, endereco = p_endereco, cep = p_cep, updated_at = now()
  where id = v_id;
end;
$$;
comment on function rh.colaborador_atualizar_dados_pessoais(text, date, text, text, text) is 'Colaborador edita os PRÓPRIOS dados pessoais (CPF, nascimento, telefone, endereço, CEP) — nunca cargo/departamento/status/e-mail, que continuam só com o RH.';

create or replace function rh.colaborador_atualizar_foto(p_foto_url text)
returns void
language plpgsql
security definer
set search_path = rh, pg_temp
as $$
declare
  v_id uuid := rh.colaborador_atual();
begin
  if v_id is null then
    raise exception 'Login não vinculado a um cadastro de colaborador.';
  end if;
  update rh.colaboradores set foto_url = p_foto_url, updated_at = now() where id = v_id;
end;
$$;
comment on function rh.colaborador_atualizar_foto(text) is 'Colaborador troca a própria foto de perfil (URL já pública, depois do upload no bucket avatares-rh).';

grant execute on function rh.colaborador_atualizar_dados_pessoais(text, date, text, text, text) to authenticated;
grant execute on function rh.colaborador_atualizar_foto(text) to authenticated;

-- Bucket público pra foto de perfil (baixa sensibilidade — igual a
-- qualquer foto de avatar de sistema corporativo; público só pra LEITURA,
-- escrita continua controlada pelas políticas abaixo).
insert into storage.buckets (id, name, public)
values ('avatares-rh', 'avatares-rh', true)
on conflict (id) do nothing;

drop policy if exists "colaborador grava propria pasta - avatares-rh" on storage.objects;
create policy "colaborador grava propria pasta - avatares-rh" on storage.objects for insert with check (
  bucket_id = 'avatares-rh' and (storage.foldername(name))[1] = rh.colaborador_atual()::text
);
drop policy if exists "colaborador atualiza propria pasta - avatares-rh" on storage.objects;
create policy "colaborador atualiza propria pasta - avatares-rh" on storage.objects for update using (
  bucket_id = 'avatares-rh' and (storage.foldername(name))[1] = rh.colaborador_atual()::text
) with check (
  bucket_id = 'avatares-rh' and (storage.foldername(name))[1] = rh.colaborador_atual()::text
);
drop policy if exists "rh_staff all - avatares-rh" on storage.objects;
create policy "rh_staff all - avatares-rh" on storage.objects for all using (bucket_id = 'avatares-rh' and rh.is_rh_staff()) with check (bucket_id = 'avatares-rh' and rh.is_rh_staff());
