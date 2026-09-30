# Módulo de Documentos — BSconta+

## Fluxos

### RH
- Novo documento > Enviar para assinatura.
- Novo documento > Importar preparado.
- Seleção do colaborador, título, tipo, competência, prazo e PDF.
- Acompanhamento por status: Pendente, Aguardando importação, Assinado e Publicado.
- Visualização do PDF e download.
- Download do documento assinado quando concluído.
- Link para o validador oficial do ITI.

### Colaborador
- Lista de documentos atribuídos ao colaborador autenticado.
- Visualização em PDF antes da assinatura.
- Download do PDF.
- Botão Assinar com GOV.BR que abre o Assinador oficial.
- Importação do PDF assinado por fluxo GOV.BR ou assinatura externa.
- Registro de data e método de assinatura.
- Aba **Recebidos do RH**: holerites e arquivos publicados pelo RH, com visualizar e baixar.
- **Enviar documento ao RH** (aba *Enviados ao RH*): o colaborador envia PDF ou foto (JPG/PNG/WEBP, até 20 MB) com tipo, título, referência e mensagem. Status: *Aguardando conferência do RH* → *Conferido pelo RH* (com retorno opcional do RH). Enquanto não for conferido, o colaborador pode cancelar o envio.

### RH — documentos recebidos dos colaboradores
- Aparecem na Gestão de Documentos com o fluxo *Enviado pelo colaborador* (filtro próprio) e status *Recebido — a conferir*.
- Ações: visualizar, baixar, marcar como conferido (com retorno ao colaborador) ou voltar para "a conferir".
- Os recebidos a conferir entram no contador do menu Documentos.
- Requer a migração `db/supabase/31_documentos_enviados_colaborador.sql`.

## Limite do protótipo

A assinatura criptográfica não é fabricada pelo sistema. O documento só passa a `ASSINADO` após a importação do arquivo assinado de fato. Para o GOV.BR, o protótipo abre `https://assinador.iti.br/`.

A integração embutida por API exige credenciais/autorização e integração com o ecossistema de Login Único; a documentação oficial também restringe essa API a aplicações/serviços públicos integrados. A implementação de produção deve confirmar a elegibilidade ou usar um provedor de assinatura apropriado ao contexto privado da empresa.
