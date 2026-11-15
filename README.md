# Minha Agenda IA — versão 2.3 (app Android + PC)

Agenda pessoal no estilo TickTick / Google Agenda: **app nativo leve para Android** (APK de produção, sem frameworks pesados) e **versão para o computador** no navegador, com as **mesmas tarefas sincronizadas**, **avisos que chegam mesmo com o app fechado** (inclusive das tarefas criadas no PC), **recorrência completa** e **anexos**. Tudo em planos gratuitos.

**O passo a passo completo e detalhado está no guia "Minha Agenda IA — passo a passo de instalação"** que acompanha este arquivo. Resumo:

1. **Supabase** — criar projeto (São Paulo, Free); rodar `supabase/schema.sql` no SQL Editor; criar seu usuário (Auto Confirm); desligar novos cadastros; copiar Project URL + chave anon/publishable; criar a Edge Function `lembretes` colando `supabase/funcao-lembretes/index.ts` e **desligar Verify JWT**.
2. **Firebase** — criar projeto; adicionar app Android `com.minhaagenda.pessoal` e baixar `google-services.json`; gerar chave da conta de serviço e colar o JSON no segredo `FIREBASE_SERVICE_ACCOUNT` (Supabase → Edge Functions → Secrets).
3. **GitHub** — repositório público `minha-agenda`; enviar o conteúdo desta pasta (inclusive `.github`); variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY`; segredos `ANDROID_KEYSTORE` (linha do arquivo PRIVADO) e `GOOGLE_SERVICES_JSON`; Pages = GitHub Actions; rodar os dois workflows.
4. **Celular** — baixar o APK em `github.com/SEU-USUARIO/minha-agenda/releases/latest`, instalar, entrar, permitir notificações, **Testar pelo servidor**, bateria sem restrições.
5. **PC** — `https://SEU-USUARIO.github.io/minha-agenda/`, entrar, ativar avisos.

> Nunca envie ao GitHub como arquivo: `PRIVADO-chave-android.txt`, `google-services.json` ou o JSON da conta de serviço. Eles entram só como segredos.

## Como funcionam os avisos

- A cada minuto o Supabase (pg_cron) chama a função `lembretes`, que manda o aviso para todos os seus aparelhos: **Android via Firebase Cloud Messaging** e **PC via Web Push** (cifrado conforme RFC 8291/8292).
- O servidor sempre usa a versão mais recente das tarefas — o que você cria, conclui ou muda no PC vale no celular.
- O celular também agenda **alarmes locais** para o que ainda não subiu para a nuvem (ex.: criado sem internet) e para os "Adiar". Se o Firebase não estiver configurado, todos os avisos viram alarmes locais do celular.
- Tocar no aviso abre a tela com **Concluir**, **Adiar 10 min**, **Adiar 1 h** e **Abrir tarefa**.

## O que o app faz

- Visões: Hoje, Próximos 7 dias (com repetições e feriados), Caixa de entrada, Todas, Calendário (mês/semana), Concluídas, Listas e Etiquetas.
- Entrada rápida em português ("Pagar DAS todo dia 20 antecipando 9h #impostos !alta", "Fechar folha no 5º dia útil", "Reunião sexta 14h").
- Recorrência completa (Nº dia da semana do mês, Nº dia útil com feriados, dias do mês, último dia, a cada N horas/dias/semanas/meses/anos, término, a partir da conclusão, antecipar/adiar em feriado, pular ocorrência).
- Lembretes múltiplos, subtarefas com data própria, anexos de até 25 MB, funciona offline, backup.
- **Busca avançada** instantânea (índice invertido + árvore de prefixos): ignora acentos, acha por pedaço da palavra, tolera um erro de digitação, "frase exata", `-excluir` e operadores (`#tag`, `lista:`, `!alta`, `repete`, `tem:anexo`, `status:feitas`). Destaca as palavras encontradas.
- **Filtros combináveis** sem recarregar: situação, prazo (atrasadas, hoje, esta semana, próximo mês, 30 dias, sem data), recorrentes, prioridade, listas, etiquetas, anexos/subtarefas/lembrete/descrição. **Filtros salvos** sincronizados entre aparelhos.
- **Painel de indicadores** em tempo real: atrasadas, para hoje, taxa de conclusão do período (conta cada repetição), % no prazo, concluídas, sequência de dias, demandas críticas, concluídas por dia, carga dos próximos 7 dias (com repetições) e pendentes por lista. Tocar num indicador abre a busca já filtrada.

## Para desenvolvedores

- `app/` — app (HTML/CSS/JS puro, ~150 KB). `supabase/` — banco e função. `scripts/` — ajustes do projeto Android e ícones. `.github/workflows/` — compilação do APK e publicação do site.
- `npm test` (Node 22.18+) roda 40 testes, incluindo a cifragem conferida com o exemplo oficial da RFC 8291 e o envio pelo Firebase.
- `npm run dev` sobe um Supabase simulado (`localhost:54321`, chave `anon-test-key`, login `eu@teste.com` / `senha123`) e o app em `localhost:8080`.
