# BSconta+ RH — Projeto completo (Visual v2)

Pacote completo do sistema com o redesign visual aplicado, preservando a estrutura, páginas, dados de demonstração, scripts e arquivos Supabase existentes.

## Executar localmente

Como o projeto é estático, qualquer servidor HTTP local é suficiente.

### Python
```bash
python -m http.server 8000
```
Depois abra `http://localhost:8000/`.

### VS Code
Use o Live Server apontando para esta pasta.

## Entrada do protótipo
- `index.html`: redirecionamento inicial conforme sessão.
- `login.html`: tela de acesso e atalhos de demonstração.

## Perfis de demonstração
- Colaborador
- RH

## Estrutura
- `colaborador/`: telas do colaborador
- `rh/`: telas do RH
- `css/styles.css`: estilos-base existentes
- `css/theme-v2.css`: camada visual do redesign
- `js/`: dados, shell, autenticação e utilitários
- `supabase/`: scripts SQL existentes
- `assets/`: identidade visual

A camada `theme-v2.css` é carregada após `styles.css` nas páginas e altera exclusivamente a apresentação.
