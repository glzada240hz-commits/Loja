# Atendentes no celular e pedidos saindo na cozinha

Tela no sistema: **Celulares e cozinha** (menu lateral, para caixa e gerente). Dá para imprimir a página e
deixar perto do caixa.

## Atendentes no celular

1. O administrador cadastra **um usuário por atendente** em Ajustes → Usuários, perfil **Atendente**.
2. O celular entra no **Wi-Fi da loja** (o mesmo do computador do caixa).
3. Na tela *Celulares e cozinha*, o atendente aponta a câmera para o **QR** (abre `http://<ip-do-caixa>:3000/atendente`).
4. Entra com o seu usuário e senha.
5. Deixa o ícone na tela inicial: Android (Chrome) menu ⋮ → *Adicionar à tela inicial*; iPhone (Safari)
   Compartilhar → *Adicionar à Tela de Início*.
6. Na mesa: **Produtos** → escolhe → **Conferir e enviar** → **Enviar para a cozinha**.

O celular só lança e acompanha pedidos (mesas, comandas, pedir a conta); **receber é no caixa**. Se o Wi-Fi
cair, o rascunho fica guardado no celular e nada é enviado em dobro.

Se o celular não abrir o endereço: confira se está no mesmo Wi-Fi, se o Windows permitiu o programa no
Firewall (**Redes privadas**) e, se o computador tiver mais de uma rede, escolha outro endereço na tela.

## Pedidos saindo na cozinha

Tudo o que é enviado (celular, PDV, cardápio digital aceito) entra na fila da cozinha na hora. Duas formas,
podem ser usadas juntas:

1. **Impressora** — no aplicativo da loja (Windows), o **computador onde o sistema roda já vem com a impressão
   ligada**: cada pedido enviado sai direto na impressora padrão, sem configurar. Em outro computador, ou para
   desligar/testar, use a tela *Celulares e cozinha*:
   **Ligar impressão neste computador** e **Imprimir teste**. A partir daí cada envio sai em papel:
   número grande, mesa/comanda, itens, “SEM …”, adicionais, observações e atendente. Acréscimo sai como
   **ACRÉSCIMO · RODADA N** (só os itens novos); alteração como **ALTERADO**; pedido já impresso que for
   cancelado sai como **CANCELADO — NÃO FAZER**.
   - No aplicativo Bar do Guto (Windows) imprime **direto, sem perguntar**, na **impressora padrão** do
     Windows: deixe a térmica como padrão. (No navegador comum aparece o diálogo a cada pedido.)
   - O sistema precisa ficar **aberto** nesse computador. Na barra lateral aparece **Impressora cozinha**
     (verde = imprimindo; vermelho = problema).
   - Liga/desliga **por aparelho**: só esse computador imprime. Mesmo com várias janelas abertas, só uma
     imprime. O que já existia antes de ligar não é impresso de novo.
   - Se a rede oscilar, o sistema confere a fila a cada 20 s e imprime o que faltou.
   **Duas impressoras (caixa e cozinha):** deixe a do **caixa** como impressora padrão do Windows (nota do
   cliente) e, em *Celulares e cozinha → Impressora da cozinha*, escolha a da **cozinha** na lista e clique em
   **Usar esta impressora** e **Imprimir teste na cozinha**. A partir daí a via da cozinha é impressa pelo
   aplicativo Bar do Guto direto nessa impressora (fila em ; o
   resultado da última impressão aparece na tela; vias que falharem 3 vezes vão para ).
2. **Tela** — tablet ou celular na cozinha com usuário de perfil **Cozinha** (QR na mesma página):
   fila na ordem de chegada, som a cada pedido, botões *Iniciar preparo* e *Pronto* (o atendente é avisado).

## Validação feita

- E2E com três aparelhos (celular do atendente, caixa com impressão ligada, cozinha): o pedido enviado pelo
  celular sai **uma vez** na impressão do caixa com mesa, item, “SEM CEBOLA”, observação e atendente; o
  acréscimo sai como “ACRÉSCIMO · RODADA 2” só com o item novo.
- Testes unitários da regra de impressão (uma vez por envio, ordem, nada anterior, alterado, cancelado,
  bobina 58/80 mm, sem preços, texto protegido).
- Capturas: [`evidencias/celulares/`](evidencias/celulares/).
- **Não testado:** impressora térmica física e impressão direta no Windows real (o teste usa uma impressão
  capturada); celulares reais no Wi-Fi da loja.
