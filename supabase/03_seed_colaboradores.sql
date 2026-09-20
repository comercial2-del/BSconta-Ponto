-- =============================================================================
-- BSconta+ RH — seed dos 15 colaboradores cadastrados em Empregados.xls
-- =============================================================================
-- Roda DEPOIS do 01_schema_rh.sql (precisa do schema/tabela rh.colaboradores).
--
-- Fonte: Empregados.xls, enviado pelo usuário em 18/09/2026. A planilha não
-- tem coluna de e-mail — os e-mails abaixo seguem o padrão definido pelo
-- usuário no chat: "BSconta@" + número do código + primeiro nome + ".com.br"
-- (ex.: BSconta+13 = Arthur → BSconta@13arthur.com.br). Não são endereços de
-- e-mail reais/entregáveis — servem só como identificador de login único no
-- protótipo. Trocar pelos e-mails corporativos reais quando existirem.
--
-- "codigo" aqui é o mesmo "Código de Colaborador" (BSconta+NN) já usado na
-- tela de login do protótipo — não é o "Cód. Func." da planilha (esse é só
-- a matrícula interna, mantido como referência no protótipo em
-- js/employee-registry.js, campo "codigoFuncionario").
--
-- De propósito, esta tabela NÃO guarda senha nenhuma: login/senha é
-- responsabilidade do Supabase Auth (auth.users), nunca da tabela de perfil
-- do colaborador — nunca se deve guardar senha em texto puro numa tabela de
-- dados. Criar o LOGIN de cada uma dessas 15 pessoas (e-mail + senha real,
-- em auth.users) é um passo separado, feito no painel do Supabase em
-- Authentication > Users (ou convite por e-mail) — ver SETUP-SUPABASE.md.
--
-- Idempotente: se o "codigo" já existir, atualiza os dados em vez de duplicar.
-- =============================================================================

insert into rh.colaboradores (codigo, nome, email, cargo, departamento, admissao, status)
values
  ('BSconta+12', 'Angella dos Santos Gomes', 'BSconta@12angella.com.br', 'Assistente Fiscal/Contabil', 'Fiscal/Contábil', '2025-03-10', 'ATIVO'),
  ('BSconta+13', 'ARTHUR PONTIL SCALA', 'BSconta@13arthur.com.br', 'Analista de Departamento Pessoal', 'Departamento Pessoal', '2026-03-02', 'ATIVO'),
  ('BSconta+14', 'FERNANDO SOARES BAETA', 'BSconta@14fernando.com.br', 'Analista Contabil I', 'Contábil', '2026-07-27', 'ATIVO'),
  ('BSconta+15', 'Iara Cristina Silva Andrade', 'BSconta@15iara.com.br', 'Assistente Fiscal/Contabil', 'Fiscal/Contábil', '2024-11-25', 'ATIVO'),
  ('BSconta+16', 'JOAO PEDRO FERNANDES DE JESUS', 'BSconta@16joao.com.br', 'Assistente Fiscal/Contabil I', 'Fiscal/Contábil', '2026-01-02', 'ATIVO'),
  ('BSconta+17', 'LAYSLA MARIA BESSA FERNANDES SILVA', 'BSconta@17laysla.com.br', 'Auxiliar de Contabilidade', 'Contábil', '2026-04-13', 'ATIVO'),
  ('BSconta+18', 'Livia Cristina Freitas de Paula Soares', 'BSconta@18livia.com.br', 'Analista de Departamento Pessoal I', 'Departamento Pessoal', '2024-12-09', 'ATIVO'),
  ('BSconta+19', 'LORENA VIEIRA DE SELES', 'BSconta@19lorena.com.br', 'Assistente de Departamento Pessoal', 'Departamento Pessoal', '2026-05-20', 'ATIVO'),
  ('BSconta+20', 'Ludilene dos Santos Lima', 'BSconta@20ludilene.com.br', 'Analista Fiscal I', 'Fiscal', '2022-08-01', 'ATIVO'),
  ('BSconta+21', 'MARLON GOMES DA SILVA', 'BSconta@21marlon.com.br', 'Auxiliar de Contabilidade', 'Contábil', '2026-04-13', 'ATIVO'),
  ('BSconta+22', 'MIGUEL BRANDAO DE MELLO LEMOS', 'BSconta@22miguel.com.br', 'Auxiliar Financeiro', 'Financeiro', '2026-04-20', 'ATIVO'),
  ('BSconta+23', 'OTAVIO ABRAHAO RODRIGUES DA SILVA MEDEIROS', 'BSconta@23otavio.com.br', 'Auxiliar Contabil', 'Contábil', '2026-06-08', 'ATIVO'),
  ('BSconta+24', 'RAFAEL ITALO DE SOUZA FERNANDES', 'BSconta@24rafael.com.br', 'Assistente Fiscal/Contábil III', 'Fiscal/Contábil', '2026-03-13', 'ATIVO'),
  ('BSconta+25', 'ROSIANE DANIELLE DE ANDRADE FARIA', 'BSconta@25rosiane.com.br', 'Auxiliar Fiscal/Contabil I', 'Fiscal/Contábil', '2026-07-01', 'ATIVO'),
  ('BSconta+26', 'SHEILLA DANIELLE DE ANDRADE SILVA', 'BSconta@26sheilla.com.br', 'Analista Fiscal', 'Fiscal', '2025-09-16', 'ATIVO')
on conflict (codigo) do update set
  nome = excluded.nome,
  email = excluded.email,
  cargo = excluded.cargo,
  departamento = excluded.departamento,
  admissao = excluded.admissao,
  status = excluded.status,
  updated_at = now();

-- Confirmação rápida (roda junto, só para conferir o resultado no painel):
select codigo, nome, email, cargo, departamento, admissao, status
from rh.colaboradores
order by codigo;
