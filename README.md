# Lumen Fotos

Organizador de fotos para a web com IA que roda no próprio navegador. Esta é a primeira versão do MVP descrito no PRD: tudo funciona localmente, sem servidor.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes unitários (lógica, busca, edição, banco)
npm run build      # build de produção em dist/
```

Requer Node 20+. Na primeira análise de fotos o navegador baixa os modelos de IA (cerca de 150 MB, uma vez só; ficam em cache).

## O que está pronto

| Área | Requisitos do PRD |
| --- | --- |
| Importação | Arrastar fotos ou pastas inteiras, escolher arquivos ou pasta (IMP-01); duplicatas exatas ignoradas por SHA-256 e quase-duplicatas detectadas por hash perceptual (IMP-04) |
| Biblioteca | Linha do tempo por mês com rolagem virtualizada (BIB-01); visualizador com dados EXIF, câmera e local (BIB-02); favoritos e lixeira de 30 dias (BIB-04) |
| Álbuns | Criar, renomear, apagar, adicionar e remover fotos; capa automática (ALB-01) |
| Tags | Tags livres em lote, com autocompletar (TAG-01); sugestões da IA para aceitar ou recusar (TAG-03) |
| Edição | Cortar com proporções e moldura arrastável, girar, espelhar, endireitar (EDI-01); exposição, contraste, realces, sombras, saturação, temperatura, vinheta e 6 filtros (EDI-02); não destrutiva, com desfazer/refazer e "voltar ao original" (EDI-03) |
| IA | "Melhorar automaticamente" em 1 clique (IAA-01); busca em linguagem natural em português, com filtro por ano e mês (IAP-01) |
| Exportação | Foto única ou ZIP; original, editada ou reduzida (COM-01) |
| Limpeza | Grupos de fotos quase iguais, mantendo a de melhor qualidade |

Atalhos: `/` busca, `Esc` limpa seleção, `⌘A` seleciona tudo, `Shift`+clique seleciona um intervalo. No visualizador: setas, `F` favoritar, `E` editar, `I` informações, `Delete` lixeira. No editor: `⌘Z` / `⇧⌘Z`.

## Como funciona

- **Armazenamento:** IndexedDB via Dexie (`src/lib/db.ts`). Originais, miniaturas, metadados e vetores ficam no navegador; o app pede armazenamento persistente.
- **Edição:** só os parâmetros são guardados; a mesma função (`renderEdited` em `src/lib/edits.ts`) gera a pré-visualização, a miniatura e o arquivo exportado.
- **IA no dispositivo:** um Web Worker (`src/ai/worker.ts`) roda CLIP ViT-B/32 (imagem e texto) e um tradutor PT→EN (opus-mt) via Transformers.js/ONNX em WASM. Cada foto é indexada uma vez (`src/ai/indexer.ts`).
- **Busca:** a frase é traduzida e comparada às fotos pelo CLIP. Cada foto é avaliada contra a própria linha de base (z-score sobre o vocabulário de tags), porque as similaridades brutas diferem só em centésimos entre acerto e erro. Tags, nomes de álbum e arquivo também contam, sem precisar de acento.

## Ainda não feito (do MVP do PRD)

- Backend: login, sincronização entre aparelhos e backup na nuvem; enviar do celular por QR code (IMP-02) depende disso.
- Planos Grátis e Plus.
- Vídeos (só fotos por enquanto). HEIC só abre no Safari.
- Service worker para uso offline completo; WebGPU para acelerar a IA.
