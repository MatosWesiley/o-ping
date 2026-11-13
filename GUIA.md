# Ping 0.5 — instalação e demonstração

## O que foi entregue

Aplicativo Android **nativo Kotlin + WebView**, continuado a partir do ZIP enviado.
Não é um site convertido em aplicativo nem um projeto Expo. Android mínimo: 8.0.

- Primeiro acesso: tutorial e tela de login antes da página inicial.
- Atleta: agenda/partidas, alojamentos/locais, avisos e boletins; favoritos e consulta offline do conteúdo recebido.
- Técnico: consulta, manutenção do próprio elenco e publicação de avisos, agenda e boletins somente para sua equipe.
- Organização: conteúdos do evento, locais, agenda, equipes, aprovação de organizadores e avisos gerais/de emergência.
- Notificações com som padrão do Android, logo do Ping e botão para solicitar permissão e testar.
- Edição e exclusão de publicações; boletins com PDF, JPG, PNG, WebP e links.
- Avisos assinados e retransmissão por Nearby Connections; fila local até confirmação do servidor.

Não há dados reais do evento incluídos. Somente a prévia do navegador contém exemplos identificados.

## 1. Instalar o APK

Baixe `Ping-0.5-debug.apk` no celular Android. Abra o arquivo e, se o Android pedir, permita a instalação por esse navegador/gerenciador de arquivos. O arquivo usa **assinatura de teste**, não uma assinatura de produção.

**Atenção ao atualizar:** o identificador continua `br.com.eventoperto`. A atualização de um Ping anterior só funciona se tiver a mesma assinatura. Esta versão preserva a chave de teste da entrega 0.3 desta sessão. Se aparecer conflito de pacote/assinatura com outra instalação, não desinstale uma versão com dados importantes: desinstalar apaga o armazenamento privado. Prefira outro aparelho para testar ou compile com a chave original.

## Atualizar um servidor já configurado no Mac

Não basta instalar o APK novo: o servidor precisa receber as novas regras.
Faça um backup seguro da pasta `server` atual. No Terminal onde está rodando, pressione **Control + C** para parar.
Do ZIP atualizado, copie `server.py`, `administration.py`, `security.py`, `attachments.py` e `requirements.txt`
para a pasta `server` que você já usa. Substitua os arquivos existentes e adicione `attachments.py`.
**Não exclua a pasta inteira, o banco `evento.sqlite3`, o arquivo `.authority.pem`, a pasta `evento.sqlite3.files` nem seus ambientes Python.**
Isso preserva contas, senha da organização, equipes, publicações e a chave confiável do servidor.

No Terminal, já dentro da pasta `server` antiga:

```sh
./.venv-ping/bin/python -m pip install -r requirements.txt
./.venv-ping/bin/python server.py --setup
```

Use o mesmo código de evento, usuário organizador e senha anteriores.
Os comandos acima usam o ambiente `.venv-ping` já configurado. Se sua instalação tiver outro ambiente válido, use o caminho correspondente ao interpretador.
Contas que já solicitaram Técnico são promovidas automaticamente ao iniciar esta versão.
Depois de instalar o novo APK, faça login ou toque em Sincronizar agora.

## 2. Preparar o servidor (necessário para o primeiro login)

O servidor está incluído no ZIP do projeto, mas **não está hospedado**. Não há usuário/senha públicos embutidos no APK.

Extraia o ZIP numa pasta nova. No Terminal, dentro da pasta `evento-perto`:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r server/requirements.txt
```

Esses comandos são para o Mac, dentro da pasta `evento-perto`, não dentro de `server`.
No Windows, use `python` para criar o ambiente e `.venv\\Scripts\\activate` para ativar.
A dependência `cryptography` valida e emite assinaturas.

Em seguida, no mesmo terminal:

```sh
python server/server.py --setup
```

Informe o código do evento, nome do usuário da organização e uma senha com pelo menos 10 caracteres. A senha é digitada no terminal e não aparece na tela. Guarde-a com segurança.

O terminal precisa continuar aberto. Computador e celulares devem estar no mesmo Wi-Fi para esse teste.
Encontre o IP local do computador:

- Mac com Wi-Fi `en0`: `ipconfig getifaddr en0` (se sua interface for outra, consulte Ajustes do Sistema → Wi-Fi → Detalhes → TCP/IP).
- Windows: `ipconfig` → Endereço IPv4 da conexão Wi-Fi.

Na tela inicial do Ping: **Configurar servidor do evento**. Informe nome, código igual ao servidor e `http://IP-DO-COMPUTADOR:8787`. Não use `localhost` no celular.

Esse endereço é apenas para Wi-Fi de teste confiável. Para redes diferentes, hospede a API com HTTPS, proteção contra abuso, backups e gestão de credenciais. Não exponha diretamente este servidor de desenvolvimento à internet.

## 3. Entrar como técnico/atleta e criar equipes

1. No primeiro celular, entre usando a conta da organização criada no terminal.
2. No celular do técnico, toque **Criar conta** e escolha Técnico. A conta fica ativa sem aprovação.
3. No técnico: **Equipe → Criar equipe**. Preencha nome e esporte. A equipe pertence automaticamente a esse técnico, sem escolher outra conta.
4. Cada técnico tem uma equipe; depois pode editar seu nome/esporte e gerenciar o próprio elenco.
5. No atleta, crie conta escolhendo Atleta. A conta fica ativa sem aprovação.
6. Abra **Equipe**, veja as equipes cadastradas e toque **Entrar**. A entrada é imediata no servidor e adiciona o atleta ao elenco.
7. Para mudar de equipe ou sair, use as ações da mesma tela e confirme. O vínculo antigo é removido, sem duplicar o atleta em vários elencos.
8. No técnico: **Equipe → Adicionar atleta** continua disponível para inscrições manuais. Informe o usuário se quiser vincular uma conta já existente.
9. No outro aparelho, sincronize para ver as mudanças. A sincronização periódica também atualiza as equipes.

Nesta versão de apresentação, a escolha Técnico no cadastro concede esse papel imediatamente.
Isso reduz controle de acesso e não é adequado para uma implantação pública sem revisão.
Solicitações de Organização continuam dependendo de uma conta organizadora já autorizada.
O organizador ainda pode administrar equipes e permissões.

Mudanças de elenco, equipes e funções exigem servidor disponível. Não são apresentadas como salvas se a requisição falhar.

## 4. Publicar informações

- Organização: publique agenda/partidas com início, fim e local/setor; cadastre alojamentos/ginásios com coordenadas e endereço; publique boletins.
- Técnico: **Avisos → Novo aviso**, **Agenda → Nova atividade** e **Boletins → Novo boletim**, direcionados automaticamente à sua equipe.
- Organização: **Avisos → Novo aviso**, para todos ou uma equipe. Em Início há **Aviso de emergência**, já selecionando prioridade Emergência e público geral.
- Use títulos objetivos, horário e local completos. Não publique endereços inventados como se fossem oficiais.
- Nos cartões de aviso, agenda e boletim, técnicos veem **Editar** e **Excluir** nas próprias publicações da equipe. A organização administra as publicações do evento. Atletas não possuem essas ações.
- A exclusão pede confirmação. Edições e exclusões são assinadas e se propagam na sincronização ou por proximidade. Um aparelho desconectado pode continuar vendo uma versão antiga até receber a alteração; não há remoção remota instantânea.
- A alteração preserva o público original. Para mudar o público, exclua a publicação e crie outra.
- O servidor confirma os IDs persistidos. A fila só é removida após essa confirmação; enviar por proximidade não significa que todos receberam.

## Boletins com arquivos e links

1. Técnico ou organizador: abra **Boletins → Novo boletim**.
2. Preencha título, local/setor e descrição. Opcionalmente informe um link HTTP/HTTPS.
3. Toque **Selecionar arquivo** para enviar um PDF ou imagem JPG, PNG ou WebP de até 10 MB.
4. Aguarde **Anexo enviado** e toque **Publicar**. Selecionar/enviar o arquivo não publica automaticamente.
5. Atletas visualizam o boletim e tocam **Abrir arquivo** ou **Abrir link externo**.
6. O primeiro download precisa do servidor. O arquivo baixado fica no armazenamento privado do app e pode ser aberto novamente offline, com um leitor de PDF/imagem instalado. Links externos podem exigir internet.

Os arquivos ficam na pasta `evento.sqlite3.files` ao lado do banco no Mac; faça backup dela junto com banco e autoridade. Limite total demonstrativo: 512 MB. Apagar um boletim oculta sua publicação; não destrói os arquivos físicos nem cópias já baixadas. Não remova essa pasta ao atualizar o servidor.
Nearby distribui texto e referência assinada dos anexos, **não os arquivos**. Para recebê-los, o participante precisa acessar o servidor. Conteúdo confidencial não deve ser publicado.

## 5. Testar comunicação sem internet

Prepare primeiro todos os aparelhos online, com a mesma configuração de servidor/evento, login, vínculo de equipe e uma sincronização. Isso provisiona a chave pública confiável e o certificado de publicação. Use a mesma versão 0.5 em todos os aparelhos; versões antigas não entendem edição/exclusão nem os novos boletins da equipe.

1. No organizador A, atleta B e participante C: mantenha Bluetooth e Wi-Fi ligados. Retire a conexão do Wi-Fi com internet e desative dados móveis; não desligue os rádios.
2. Abra **Rede → Ativar proximidade** em cada aparelho. Autorize as permissões pedidas.
3. Compare o código exibido em **ambos** os celulares e aceite apenas se corresponder.
4. A publica um aviso demonstrativo claramente identificado como **TESTE — sem emergência real**.
5. Confira o conteúdo e horário recebidos em B. A notificação depende da permissão Android.
6. Desative a proximidade em A. Depois conecte B a C e confira se C recebe o aviso retransmitido.
7. Reabra o app sem internet e confira o conteúdo salvo.
8. Quando voltar ao Wi-Fi do servidor, sincronize no aparelho que publicou e confira se a fila é confirmada.

Nearby usa recursos Android/Google Play Services e depende de compatibilidade, permissões, alcance e pareamento. O teste A → B → C precisa de aparelhos reais. A implementação não garante alcance de multidão, entrega instantânea, nem entrega se não houver encontro/conexão.

## 6. Notificações

**Rede → Ativar notificações** solicita a permissão do Android (13 ou superior). Em versões anteriores, respeita as configurações do sistema. Use **Enviar notificação de teste** para conferir a permissão.

Avisos, boletins e atividades novos recebidos do servidor ou por proximidade geram notificação, sem repetir o mesmo registro. Publicações próprias não geram notificação de recebimento.
Emergências usam um canal Android de alta importância; o aparelho, o usuário e o modo Não Perturbe podem limitar som/exibição.
Os canais de avisos e emergência usam o som padrão de notificação e vibração. A logo colorida aparece na notificação expandida; a barra de status usa uma marca monocromática, como exigido pelo Android. Silêncio, volume zerado, canais silenciados ou Não Perturbe podem impedir o som.

- App ativo: sincronização online aproximadamente a cada 30 segundos; Nearby enquanto a Activity está ativa.
- Segundo plano: WorkManager consulta o servidor a cada **15 minutos, no mínimo**, quando existe internet e sessão válida. O Android pode adiar por economia de bateria/Doze. Não é push.
- Forçar parada, negar permissão, encerrar sessão ou restrições do sistema pode impedir novas notificações. Sem internet e sem Nearby ativo não há novo recebimento.

**Não use este protótipo como único canal de segurança ou evacuação.** Confirme orientações críticas com a organização e mantenha canais redundantes.

## 7. Segurança e limites importantes

**Usar dados móveis sem o mesmo Wi-Fi:** o APK aceita um endereço HTTPS público da API.
O IP local do Mac (por exemplo, `10.x.x.x`) não é acessível de fora da rede.
É necessário hospedar a API com armazenamento persistente, HTTPS e proteção contra abuso
ou preparar um acesso remoto HTTPS de demonstração devidamente protegido.
Nada disso foi publicado automaticamente nesta entrega. A consulta offline e a troca Nearby
não transformam um servidor local em servidor acessível pela rede móvel.

As permissões são conferidas no Kotlin e no servidor, não apenas nos botões.
Cada instalação usa chave ECDSA não exportável do Android Keystore. O servidor emite um certificado assinado vinculando usuário, função, equipe, evento e chave do aparelho.
Os registros recebidos por Nearby são verificados antes de serem salvos/mostrados e retransmitidos.

A chave do servidor fica fixada após o primeiro login. Esse primeiro acesso deve usar HTTPS ou, somente no teste, uma rede local confiável. Se a chave do servidor mudar, o aplicativo rejeita a alteração. Não apague o arquivo de autoridade do servidor: faça backup seguro juntamente com o banco.

Certificados e sessões duram 7 dias. Para publicar offline após esse período, conecte-se e renove o acesso. Uma revogação feita no servidor não pode ser conhecida instantaneamente por um aparelho totalmente offline: a autorização anterior pode valer até o certificado expirar. O servidor sempre verifica a função atual.

Avisos de equipe são filtrados por equipe nas interfaces e na API; **o transporte Nearby não criptografa o conteúdo por equipe**. Não publique dados pessoais, sensíveis ou confidenciais: aparelhos participantes retransmitem os registros.

Endereços/coordenadas ficam offline, mas o fundo OpenStreetMap precisa de internet. Abrir rota depende do aplicativo de mapas instalado e dos mapas que ele tiver disponíveis.

O servidor de desenvolvimento não inclui proteção completa contra força bruta, recuperação de senha, escalabilidade, moderação ou alta disponibilidade.

## 8. Compilar novamente

Android Studio: abra a pasta `evento-perto`, sincronize e use Build → Generate APKs.
Ou, com JDK 17 + Android SDK 35:

```sh
./gradlew assembleDebug
```

Saída: `app/build/outputs/apk/debug/app-debug.apk`. O workflow `.github/workflows/android.yml` também compila quando colocado na raiz do repositório Android.

Verificações de regras em memória:

```sh
python3 -m unittest discover -s server -p 'test_rules.py' -v
```

Há também testes HTTP no `test_server.py` para execução posterior. Consulte `VALIDACAO.md` para distinguir o que foi efetivamente verificado nesta entrega dos testes ainda pendentes em celulares.

## 9. Relação com o problema do evento

Agenda, locais, boletins e avisos centralizam as informações antes dispersas em grupos e panfletos.
O cache mantém o que já foi recebido; a fila e a retransmissão por proximidade permitem propagação quando a internet falha.
O benefício esperado é reduzir papel e facilitar acesso a mudanças. **Não foram medidos** redução de desperdício, alcance de rede, tempo de entrega ou confiabilidade em temporal/multidão; isso exige um piloto com participantes e critérios de medição.
