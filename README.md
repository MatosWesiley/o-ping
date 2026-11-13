# Ping 0.5 — Android, equipes e comunicação offline

Continuação do ZIP original em Kotlin + WebView. Login obrigatório antes da página inicial,
três perfis, equipes/elencos, avisos autorizados, tutorial inicial e notificações Android.

**Leia [GUIA.md](GUIA.md)** para instalar, preparar a API, criar contas e demonstrar Nearby.

## Estrutura

- `app/`: Android Kotlin, WebView local, Nearby Connections e Android Keystore.
- `app/src/main/assets/`: interface real em HTML/CSS/JS, logo e Leaflet.
- `server/server.py`: API Python + SQLite; autenticação original preservada e ampliada.
- `server/administration.py`: autorização, equipes, elencos e aprovação de funções.
- `server/security.py`: certificados e assinaturas ECDSA P-256.
- `server/attachments.py`: arquivos no servidor local, metadados, limites e autorização de equipe.
- `server/requirements.txt`: dependência de assinatura `cryptography`.
- `server/test_rules.py`: verificações em memória das regras e assinaturas.
- `server/test_server.py`: testes HTTP da API para execução posterior.
- `PREVIA-PING.html`: prévia visual autossuficiente; dados exemplificativos, sem contas/conexões reais.

## Inicialização

```sh
python3 -m pip install -r server/requirements.txt
python3 server/server.py --setup
```

O primeiro `--setup` cria a conta organizadora. Nesta versão de apresentação, Atleta e
Técnico entram sem aprovação. Técnicos criam sua própria equipe; atletas escolhem e entram.
Somente o perfil Organização continua dependendo de aprovação no app.
O servidor não está hospedado nem há senhas padrão embutidas.

Variáveis opcionais de operação: `EVENTO_DB`, `EVENT_CODE`, `ORG_USER`, `ORG_PASSWORD`,
`HOST`, `PORT`. Não versione banco, autoridade privada, tokens ou senhas.
O arquivo `evento.sqlite3.authority.pem` contém a autoridade privada e deve ser preservado com segurança.
Uma instalação do servidor serve um evento. Não reutilize o mesmo banco para outro código de evento.

## API

- `GET /api/ping`
- `POST /api/register`: nome, usuário, senha, perfil solicitado e chave pública do aparelho.
- `POST /api/login`: usuário, senha, chave pública.
- `POST /api/logout`: revoga token.
- `POST /api/events/CODE/sync`: sessão Bearer, registros assinados, chave pública.
- `POST /api/manage`: sessão Bearer e operação autorizada de equipe/elenco/função.
- `POST /api/attachments`: sessão Bearer, bytes PDF/JPG/PNG/WebP até 10 MB.
- `GET /api/attachments/UUID`: download autenticado, respeitando a equipe do arquivo.

Respostas de login/sync incluem certificado do aparelho e chave pública da autoridade,
sem revelar chaves privadas. Sync inclui registros visíveis, IDs confirmados, equipes
e, exclusivamente para organização, lista de usuários.

Técnicos publicam `notice`, `agenda` e `bulletin`, público `team`, da própria equipe e sem prioridade
`emergency`. Atletas não publicam. Organização publica `bulletin`, `notice`, `agenda`,
`facility`; emergências são avisos para todo o evento.

IDs de transporte são imutáveis. Edições/exclusões são registros assinados com `replaces`,
`original` (prova assinada da autoria original) e `deleted`. O técnico altera apenas
publicações de sua autoria na equipe; organização administra as demais. Público e equipe
originais não mudam. A versão com maior `(created, éRevisão, id)` vence, inclusive exclusões.
Recebimento fora de ordem não reverte uma exclusão mais recente. Não há exclusão instantânea
em aparelhos isolados. Repetição idêntica não duplica; conflito não substitui.
Anexos ficam em arquivos privados ao lado do banco, não como blobs SQLite, com hash SHA-256
nos metadados assinados. Preserve `evento.sqlite3.files` nos backups e atualizações.
Arquivos são baixados pelo servidor, não pelo Nearby. Links externos abrem fora da WebView.
Boletins/avisos têm até 48h iniciais; agenda/locais até 7 dias. Revisões preservam pelo
menos a validade anterior para impedir que versões antigas reapareçam antes dela.
Fila local até confirmação do servidor.

## Build

JDK 17, Gradle 8.11.1, AGP 8.9.2, Kotlin 2.1.20, SDK 35, Android mínimo 26.

```sh
./gradlew assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`. Versão 0.5, applicationId `br.com.eventoperto`.
Para atualizar versão já instalada, é necessária a mesma chave de assinatura.

## Limites

Esta é uma versão de demonstração, não um sistema certificado para emergências.
Nearby exige preparação online inicial, aparelhos compatíveis com Google Play Services,
Wi-Fi/Bluetooth ligados, permissões, pareamento e app aberto. Autorizações offline
podem valer por até 7 dias; revogação não é instantânea sem conexão.
Não há criptografia por equipe no transporte Nearby; não publique dados confidenciais.
Mapas-base e rotas não são garantidos offline. Não há LoRa, iOS, push instantâneo,
hospedagem ativa da API ou garantia de entrega em multidão.
WorkManager consulta novas informações online em segundo plano a partir de 15 minutos,
sujeito às restrições Android. Leia o guia e o relatório de validação antes do uso.
