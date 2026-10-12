---
slug: docsage
name: docsage
summary: RAG em Python para perguntar coisas aos seus próprios documentos, com citações.
stack: [Python, BM25, Claude API, MCP]
tags: [ia, rag, cli]
repo: https://github.com/Guilherme-b-damasio/docsage
order: 1
---

## O que é

Indexa Markdown, texto e PDF, recupera os trechos mais relevantes com BM25 e pede ao
Claude uma resposta que cita as fontes. Ignora stopwords em português e inglês.

## Decisões técnicas

- Markdown é dividido pelos títulos, então um chunk nunca mistura duas seções.
- Reindexação incremental: só reprocessa arquivos cujo conteúdo mudou.
- Saída `--json` com termos casados e offsets, pronta pra outras ferramentas.
- Também roda como servidor MCP via stdio.

## O que aprendi

TODO
