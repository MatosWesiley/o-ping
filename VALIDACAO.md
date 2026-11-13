# Validação — Ping 0.5

## Verificações desta entrega

- Compilação Android debug real com Gradle, JDK 17 e SDK 35.
- Sintaxe JavaScript e módulos Python.
- Verificações unitárias em memória de autorização de equipe e validação de assinaturas (test_rules.py).
- Prévia da interface local e página de download inspecionadas no navegador.
- Integridade e assinatura Android verificadas com apksigner e manifesto lido com aapt.

## Não validado em aparelhos físicos

- Instalação e atualização sobre versão anterior (depende da assinatura anterior).
- Login e permissões no Android WebView real.
- Notificações, canais, otimização de bateria e execução WorkManager.
- Nearby Connections A → B → C, Bluetooth/Wi-Fi e alcance.
- GPS, mapas/rotas e consulta após reiniciar o aparelho sem rede.
- Condições de temporal, congestionamento e multidão.

Não foram executados testes automatizados de navegador/e2e nesta revisão.
A suíte HTTP e os testes unitários foram executados com banco temporário, incluindo cadastro
sem aprovação, criação de equipe pelo técnico, entrada/saída do atleta e atualização do certificado.
Inclui também edição/exclusão assinada de avisos, agenda e boletins; impedimento de alteração
de autoria/público; envio, download, integridade e isolamento de anexos por equipe;
recusa de publicação/envio pelo atleta e de conteúdo inválido.
A compilação não comprova que
os recursos de hardware funcionam. A prévia demonstra a interface, não a conectividade.

A API incluída não foi publicada em HTTPS. Não há medição de alcance, latência de avisos,
redução de papel ou taxa de entrega. O protótipo não substitui canais oficiais de emergência.
