# Importação de colaboradores — BSconta+

Base gerada a partir de `Empregados.xls`. Foram identificados 15 empregados na relação.

## Códigos

A sequência começa em `BSconta+12` e segue sem duplicação. O próximo cadastro usa o maior código existente + 1.

## E-mails

A planilha enviada não possui coluna de e-mail. Para o protótipo funcionar imediatamente, cada cadastro recebeu um e-mail **provisório**, gerado a partir do nome. Esses valores estão marcados como `emailProvisorio: true` no JSON e devem ser substituídos pelos e-mails corporativos reais antes da produção.

## Login

O colaborador entra usando os três campos: Nome + E-mail + Código de Colaborador. Os atalhos de demonstração do protótipo continuam existindo, mas não fazem parte do login real.

## Banco de dados

A tabela `profiles` foi preparada com `codigo_colaborador text unique` para a futura migração para Supabase.
