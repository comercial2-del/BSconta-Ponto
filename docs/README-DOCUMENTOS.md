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

## Limite do protótipo

A assinatura criptográfica não é fabricada pelo sistema. O documento só passa a `ASSINADO` após a importação do arquivo assinado de fato. Para o GOV.BR, o protótipo abre `https://assinador.iti.br/`.

A integração embutida por API exige credenciais/autorização e integração com o ecossistema de Login Único; a documentação oficial também restringe essa API a aplicações/serviços públicos integrados. A implementação de produção deve confirmar a elegibilidade ou usar um provedor de assinatura apropriado ao contexto privado da empresa.
