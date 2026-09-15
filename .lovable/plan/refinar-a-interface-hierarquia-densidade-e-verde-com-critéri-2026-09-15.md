# Refinar a interface: hierarquia, densidade e verde com critério

Concordo com a leitura. A base está boa; falta hierarquia visual e aproveitamento do espaço. Mantém-se sidebar escura, área de trabalho clara e verde FlySales — sem transformar o backoffice numa landing page.

Proponho executar por fases, pela ordem que sugeriste: cotação → tabela → sidebar → sistema visual.

## Fase 1 — Ecrã de cotação (maior impacto)

Reorganizar o detalhe da cotação em duas colunas em vez de um formulário único e longo:

- **Cabeçalho compacto**: produto + referência, cliente, destino, estado e a ação principal à direita.
- **Barra de progresso**: etapa atual e próximo passo, com o histórico completo expansível (reaproveita a linha temporal já existente).
- **Coluna principal (~70%)**: opções A/B/C e uma **tabela compacta de variantes** — uma linha por variante com custo, taxas e preço final comparáveis lado a lado.
- **Clicar numa linha abre o detalhe** dessa variante (painel/expansão) para editar câmbio, taxas e condições. Nada de informação perdida, apenas deixa de repetir o formulário gigante.
- **Coluna lateral (~30%)**: resumo da opção selecionada e conversa, em separadores.
- **Rodapé fixo**: estado das alterações, guardar e publicar (já existe; passa a fazer parte do novo layout).

## Fase 2 — Fila de cotações

- Miniatura do produto quando existe; fallback discreto quando não existe.
- Referência por baixo do nome do produto; prazo mostrado uma só vez.
- Nome do produto abre a cotação (hover discreto); remover o botão verde repetido em cada linha; ações secundárias num menu "…".
- Destaque subtil para mensagens por ler, atrasos e preços pendentes.
- Intervalos iguais mostram um único valor ($8.05 em vez de $8.05–$8.05).
- Cabeçalho de tabela fixo, valores monetários alinhados à direita e algarismos de largura uniforme.

## Fase 3 — Sidebar com grupos

Agrupar as entradas existentes, sem alterar permissões nem funcionalidades: Overview · Sourcing · Operations · Finance · Growth tools · Administration. Grupos recolhíveis, secção ativa aberta por omissão, estado guardado entre sessões, e badges apenas para pendências reais.

## Fase 4 — Verde com intenção + tipografia

- Verde sólido só na ação principal da página; verde suave para seleção ativa; neutro para ações secundárias e checkboxes por selecionar; vermelho/âmbar para o que exige intervenção.
- Escala tipográfica: títulos de página 24–28, secção 16–18, texto/tabelas 14, auxiliar 12–13 com contraste suficiente.
- Formas: inputs e botões 8 px, cards 12 px, pills reservadas a estados (deixa de haver cápsulas em todo o lado).
- Animações curtas e funcionais: hover nas linhas, transição nos separadores, abertura suave do painel, Saving → Saved, skeletons com as dimensões reais. Sem números financeiros animados nem brilhos.

## Fase 5 — Indicadores da Sourcing team

- Ajustar a grelha ao número real de indicadores (acaba a área cinzenta vazia).
- **Investigar a discrepância**: "Owed" a $0 enquanto o ledger mostra $20 e um colaborador "Unknown". Vou verificar o cálculo e a origem do registo sem nome, corrigir o que estiver errado e passar a explicar o âmbito do indicador na própria interface.

## Notas técnicas

Alterações concentradas em `src/routes/_authenticated/admin/quotes/$id.tsx` e `index.tsx`, `src/components/app-shell.tsx` (grupos de navegação) e `src/styles.css` (tokens de tipografia, raios e uso do verde). Sem alterações a regras de negócio, cálculos de preço ou permissões — exceto a correção do indicador "Owed", que é um bug de dados a confirmar.

Sugiro aprovar e começar pela Fase 1; cada fase fica revisível em separado.
