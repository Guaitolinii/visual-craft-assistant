# MVP do reprodutor IPTV

## Objetivo
Construir a primeira experiência utilizável do reprodutor em português, seguindo fielmente o visual preto, branco quente e bronze das referências. A tela inicial será o próprio produto, não uma página promocional.

## O que será construído
- Navegação lateral e navegação móvel para Início, Favoritos, Filmes, Esportes, TV aberta, Notícias, Todos os canais e Recentes.
- Catálogo demonstrativo com busca instantânea, filtros, estados de disponibilidade e favoritos funcionais durante a sessão.
- Área principal de reprodução com seleção de canal, play/pausa, volume, mudo, qualidade, modo Original/Preencher/Esticar e tela cheia.
- Estado inicial seguro sem uma fonte real, além de mensagens claras para indisponibilidade e reconexão.
- Layout adaptado para computador e celular, mantendo a linguagem visual das imagens: superfícies quentes, bronze único para ações, cantos contidos e ícones de traço.

## Segurança e escopo
- Nenhuma credencial ou URL de lista será incluída no navegador ou no código.
- A interface usará dados demonstrativos até que uma lista M3U autorizada e a infraestrutura protegida sejam conectadas.
- Gateway, transcodificação, login, persistência e monitoramento real ficam fora desta primeira entrega porque exigem Lovable Cloud e uma fonte autorizada para teste.

## Detalhes técnicos
- Implementação na tela inicial existente com React e TanStack Start.
- Tokens visuais centralizados, com tipografia Outfit e paleta bronze fornecida nas referências.
- Controles acessíveis, foco visível, animações rápidas sem salto e preferência de movimento reduzido respeitada.
- Metadados próprios do produto e validação visual em tamanhos desktop e móvel.
