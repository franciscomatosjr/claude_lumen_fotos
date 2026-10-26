# Lumen Fotos

Organizador de fotos para a web com IA que roda no próprio navegador. O app funciona sem conta e sem internet; quem entra numa conta ganha backup na nuvem e sincronização entre aparelhos. As fotos nunca vão para uma IA na nuvem.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes unitários (lógica, busca, edição, banco)
npm run build      # build de produção em dist/
```

Para login e sincronização, suba também o backend (precisa do Docker Desktop aberto):

```bash
docker compose up -d          # PostgreSQL (com pgvector) na porta 5433 e armazenamento S3 (SeaweedFS) na 8333
cd server
cp .env.example .env          # só na primeira vez
npm install
npm run dev                   # API em http://localhost:8787; o Vite encaminha /api para ela
npm test                      # testes de integração (usam o banco lumen_test e o bucket lumen-photos-test)
```

Sem o backend, o app segue funcionando só no aparelho. Requer Node 20+. Na primeira análise de fotos o navegador baixa os modelos de IA (cerca de 150 MB, uma vez só; ficam em cache).

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
| Conta e nuvem | Cadastro e login com e-mail e senha; backup dos originais; álbuns, tags, favoritos, edições, lixeira e vetores da IA sincronizados entre aparelhos; cota de 15 GB por conta |

Atalhos: `/` busca, `Esc` limpa seleção, `⌘A` seleciona tudo, `Shift`+clique seleciona um intervalo. No visualizador: setas, `F` favoritar, `E` editar, `I` informações, `Delete` lixeira. No editor: `⌘Z` / `⇧⌘Z`.

## Como funciona

- **Armazenamento:** IndexedDB via Dexie (`src/lib/db.ts`). Originais, miniaturas, metadados e vetores ficam no navegador; o app pede armazenamento persistente.
- **Edição:** só os parâmetros são guardados; a mesma função (`renderEdited` em `src/lib/edits.ts`) gera a pré-visualização, a miniatura e o arquivo exportado.
- **IA no dispositivo:** um Web Worker (`src/ai/worker.ts`) roda CLIP ViT-B/32 (imagem e texto) e um tradutor PT→EN (opus-mt) via Transformers.js/ONNX em WASM. Cada foto é indexada uma vez (`src/ai/indexer.ts`).
- **Sincronização (`src/sync/engine.ts`):** ganchos do Dexie marcam cada mudança do usuário como pendente, com data. O app envia as pendências, recebe as mudanças de outros aparelhos por um cursor de revisão e depois envia os arquivos. Em conflito, vence a alteração mais recente. Exclusões viram "lápides" para chegar aos outros aparelhos. Fotos vindas de outro aparelho mostram a miniatura da nuvem e baixam o original só quando abertas.
- **Backend (`server/`):** Fastify + PostgreSQL + armazenamento compatível com S3. Senhas com scrypt; sessão em cookie httpOnly (SameSite=Lax) com checagem de origem; limite de tentativas no login. Cada envio e recebimento trava as linhas do usuário, para nenhuma revisão ser pulada. Os arquivos passam pela API, então o navegador nunca recebe credenciais do armazenamento. A mesma foto importada em dois aparelhos é reconhecida pelo hash e fica uma só.
- **Busca:** a frase é traduzida e comparada às fotos pelo CLIP. Cada foto é avaliada contra a própria linha de base (z-score sobre o vocabulário de tags), porque as similaridades brutas diferem só em centésimos entre acerto e erro. Tags, nomes de álbum e arquivo também contam, sem precisar de acento.

## Ainda não feito (do MVP do PRD)

- Enviar do celular por QR code (IMP-02); recuperação de senha por e-mail.
- Deploy em produção (HTTPS com `COOKIE_SECURE=true`, S3 de verdade, backups do banco).
- Planos Grátis e Plus.
- Vídeos (só fotos por enquanto). HEIC só abre no Safari.
- Service worker para uso offline completo; WebGPU para acelerar a IA.
