# Operação, implantação, backup e restauração

## 1. Implantação (servidor Linux)

Recomendado: um VPS ou computador dedicado na loja com Ubuntu 22.04+/Debian 12, **Node.js 22**,
**PostgreSQL 14+**, Nginx e HTTPS (obrigatório para PWA instalável, cookies seguros e webhook do WhatsApp).

```bash
# 1. usuário e código
sudo adduser --system --group guto
sudo mkdir -p /opt/bar-do-guto && sudo chown guto: /opt/bar-do-guto
sudo -u guto git clone <repositório> /opt/bar-do-guto
cd /opt/bar-do-guto && sudo -u guto npm ci && sudo -u guto npm run build

# 2. banco
sudo -u postgres createuser guto --pwprompt
sudo -u postgres createdb -O guto guto

# 3. configuração (NUNCA versionar o .env)
sudo -u guto cp .env.example .env && sudo -u guto chmod 600 .env
#   NODE_ENV=production, DATABASE_URL, PUBLIC_BASE_URL=https://seu.dominio, SEED_ADMIN_PASSWORD forte

# 4. dados iniciais (admin). Para iniciar com o cardápio demonstrativo use sem --no-demo;
#    em produção os usuários "demo" NÃO são criados.
sudo -u guto bash -c 'set -a; source .env; set +a; node apps/server/dist/db/seed-cli.js'   # ou com --no-demo (sem cardápio demo)

# 5. serviço e proxy
sudo cp deploy/bar-do-guto.service /etc/systemd/system/ && sudo systemctl enable --now bar-do-guto
sudo cp deploy/nginx.conf /etc/nginx/sites-available/bar-do-guto   # ajuste o domínio
sudo ln -s /etc/nginx/sites-available/bar-do-guto /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d seu.dominio.com.br
```

Depois do primeiro acesso: troque a senha do `admin` (menu “Alterar senha”), crie os usuários reais em
**Ajustes → Usuários**, revise **todo o cardápio, preços, custos, bairros e taxas** (os dados são
demonstrativos), cadastre as mesas e os entregadores.

Atualização de versão: `git pull && npm ci && npm run build && sudo systemctl restart bar-do-guto`
(as migrations rodam ao iniciar). Faça um backup antes.

> O tempo real (SSE) assume **uma instância** do servidor. Não rode réplicas atrás de balanceador sem
> antes trocar o barramento de eventos (ver PENDENCIAS.md).

## 2. Rotina da loja

1. **Abrir o dia** (Caixa e dia → Abrir dia). Caixa e gerente podem abrir.
2. **Abrir o caixa** com o fundo de troco.
3. Vender pelo **PDV** (atalhos: `F2` busca, `F4` envia, código do produto + Enter).
   Mesas: tela **Mesas** → mesa livre abre comanda; ocupada mostra a comanda.
4. Pedidos do **cardápio digital** chegam em *Pedidos → Aguardando aceite*. Só vão para a cozinha e só
   avisam o cliente da confirmação depois do **aceite**.
5. **Cozinha**: Iniciar preparo → Pronto. Tickets atrasados piscam em vermelho; alterações aparecem em
   amarelo; pedidos cancelados aparecem como “NÃO PREPARAR”.
6. **Entregas**: marque os pedidos, escolha o entregador, *Atribuir*, depois *Saiu para entrega*.
   O entregador usa *Minhas entregas* no celular.
7. **Receber e finalizar** cada pedido (Pedidos → pedido → Receber / Finalizar).
8. Fim do expediente: **acerto dos entregadores** (Entregas → Acertos), **fechar o caixa**
   (contagem do dinheiro) e **fechar o dia**. O dia só fecha sem pedidos em aberto.

Se a conexão cair, aparece uma faixa vermelha “Sem conexão”: nada é salvo até voltar. O sistema **não
tem modo offline de pedidos** — anote em papel e lance depois.

## 3. Backup

`scripts/backup.sh` gera `guto-AAAAMMDD-HHMMSS.dump` (formato custom do `pg_dump`, compactado),
valida o arquivo com `pg_restore --list`, grava o `.sha256` e mantém os últimos `BACKUP_KEEP` arquivos.

```bash
DATABASE_URL=postgres://... scripts/backup.sh /var/backups/bar-do-guto
```

- Agende com `deploy/backup.cron` (a cada 6 h) e **copie para fora do servidor** (nuvem/HD externo).
  Backup no mesmo disco não protege contra perda do disco.
- As fotos de produtos ficam em `UPLOAD_DIR`; inclua essa pasta na cópia externa.
- O backup contém dados pessoais de clientes: guarde com acesso restrito.

## 4. Restauração

**Sempre teste primeiro num banco separado.**

```bash
createdb guto_restauracao
DATABASE_URL=postgres://guto:***@localhost/guto_restauracao scripts/restore.sh /var/backups/bar-do-guto/guto-....dump --confirmar
# confira: suba uma instância apontando para guto_restauracao e verifique pedidos, caixa e usuários
```

Para restaurar o banco de produção: pare o serviço (`systemctl stop bar-do-guto`), faça um backup do
estado atual, rode o `restore.sh` apontando para o banco de produção com `--confirmar`, e inicie o serviço.
O script confere o `sha256`, valida o arquivo e restaura em **uma única transação** (se falhar, nada muda).

Validação executada: o teste automatizado `15. backup e restauração` (`apps/server/test/integration/resilience.test.ts`)
gera um backup do banco de testes, restaura em `guto_restore_test`, compara contagens e somas de pedidos,
itens, pagamentos, usuários e movimentos de estoque, e sobe a aplicação sobre o banco restaurado.

## 5. Privacidade e retenção de dados

- Dados pessoais tratados: nome, telefone, endereço, histórico de pedidos e conversas do WhatsApp.
- O cardápio digital pede aceite explícito do uso dos dados para o pedido; o WhatsApp registra
  consentimento (origem e data) e aceita “PARAR” para sair das mensagens automáticas.
- **Exclusão a pedido do titular**: Clientes → cliente → *Excluir dados pessoais* (perfil Administrador).
  Remove nome, telefone, endereços e conversas; mantém valores e itens dos pedidos de forma anônima.
- Ajustes → Loja tem um campo de **retenção sugerida** (meses) para revisão periódica manual de clientes
  inativos. Não há exclusão automática.
- Os controles técnicos ajudam, mas **não garantem por si só conformidade com a LGPD**: defina com um
  profissional a base legal, o aviso de privacidade, o encarregado e os prazos de retenção.

## 6. Checklist de segurança antes de produção

- [ ] HTTPS ativo (`PUBLIC_BASE_URL` com `https://`) e `NODE_ENV=production`.
- [ ] Senha do admin trocada; usuários individuais (não compartilhar logins).
- [ ] `.env` com permissão 600 e fora do repositório; segredos do WhatsApp só no servidor.
- [ ] PostgreSQL sem acesso externo; senha forte.
- [ ] Backup automático + cópia externa + **restauração testada**.
- [ ] Firewall liberando só 80/443 (e SSH restrito).
