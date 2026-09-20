# Integração de assinatura GOV.BR — BSconta+

## Fluxo já preparado no protótipo

1. O colaborador abre o documento no BSconta+ e visualiza o PDF.
2. Ao clicar em **Assinar com GOV.BR**, o sistema abre o Assinador oficial (`https://assinador.iti.br/`).
3. O colaborador envia o PDF no portal oficial, posiciona a assinatura, confirma e baixa o PDF assinado.
4. De volta ao BSconta+, o colaborador importa o PDF assinado.
5. O documento passa para **ASSINADO** e o RH passa a visualizar a data, método e arquivo assinado.
6. O arquivo também pode ser conferido no serviço oficial **VALIDAR** (`https://validar.iti.gov.br/`).

## Integração API futura

A API de Assinatura Eletrônica GOV.BR usa autorização OAuth e pressupõe integração com a Conta GOV.BR e credenciais autorizadas. A documentação oficial atual descreve esse fluxo e informa que o acesso à API é destinado a aplicações/serviços públicos integrados ao ecossistema GOV.BR.

Para uma empresa privada como a BSconta+, o protótipo **não simula uma assinatura criptográfica nem finge ter uma integração API autorizada**. O botão abre o serviço oficial, e a conclusão é registrada no sistema por meio da importação do arquivo efetivamente assinado.

Para uma integração direta dentro do próprio sistema, será necessário contratar/usar uma solução de assinatura compatível ou confirmar a elegibilidade e obter as credenciais necessárias para o serviço oficial, além de backend seguro para OAuth, armazenamento e atualização do status.
