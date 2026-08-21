<div align="center">
  <img src="public/logo.png" alt="SupaPanel Logo" width="120" />
  <h1>SupaPanel</h1>
  <p><strong>Painel open-source para gerenciar instâncias self-hosted do Supabase</strong><br/>
  <strong>Open-source management panel for self-hosted Supabase instances</strong></p>
</div>

> **Sobre este fork / About this fork**
> Fork de [alanfrigo/SupaPanel](https://github.com/alanfrigo/SupaPanel) (que por sua vez deriva de [sharonpraju/SupaConsole](https://github.com/sharonpraju/SupaConsole)), mantido por [@flavioduque](https://github.com/flavioduque) com correções e melhorias:
>
> 1. **Subdomínio automático por projeto** (`PANEL_BASE_DOMAIN`) — cada projeto novo ganha URLs HTTPS próprias automaticamente, sem configurar domínio manualmente.
> 2. **Compatibilidade com o gateway Envoy** — o template oficial do Supabase trocou Kong por Envoy como gateway padrão; este fork funciona com os dois.
> 3. **Correção do healthcheck do Traefik** — o Envoy retorna 401 em `/health` sem autenticação, o que fazia o Traefik marcar a API como fora do ar ("no available server"). Corrigido.
>
> This fork of [alanfrigo/SupaPanel](https://github.com/alanfrigo/SupaPanel) adds: automatic per-project subdomains (`PANEL_BASE_DOMAIN`), compatibility with the new Envoy API gateway (newer Supabase templates replaced Kong), and a fix for the Traefik healthcheck that broke API routing on Envoy-based projects.

---

## 🇧🇷 Português

### O que é

O SupaPanel é um painel web que simplifica o deploy e o gerenciamento de múltiplos projetos Supabase self-hosted no seu próprio servidor Linux. Ele cuida do Docker Compose, do Traefik (proxy reverso) e dos certificados SSL automaticamente.

### Requisitos

- Servidor Linux (Ubuntu 22.04+ ou Debian 11+) com IP público — VPS, dedicado ou container LXC (Proxmox) com pelo menos **4 GB de RAM**
- Portas **80** e **443** liberadas (necessárias para o Let's Encrypt emitir os certificados)
- Um domínio seu, gerenciado na **Cloudflare** (ou outro provedor de DNS)

### Passo 1 — Instalar o painel no servidor

```bash
curl -sSL https://raw.githubusercontent.com/flavioduque/SupaPanel/main/install.sh | sh
```

O script instala o Docker (se não existir), sobe o Traefik, o PostgreSQL e o painel. Ao final, acesse `http://IP_DO_SERVIDOR:3000` e crie sua conta de administrador (somente o primeiro usuário consegue se registrar).

### Passo 2 — Configurar o DNS na Cloudflare

Este é o passo que habilita os subdomínios automáticos. Exemplo usando o domínio `exemplo.com` e a base `supa.exemplo.com`:

1. Entre no painel da Cloudflare e selecione seu domínio.
2. Vá em **DNS → Records → Add record** e crie **dois registros**:

| Tipo | Nome (Name) | Conteúdo (IPv4) | Proxy status |
|------|-------------|-----------------|--------------|
| A | `supa` | `IP_DO_SERVIDOR` | **DNS only** (nuvem cinza) |
| A | `*.supa` | `IP_DO_SERVIDOR` | **DNS only** (nuvem cinza) |

> ⚠️ **Importante:** deixe o proxy da Cloudflare **desligado** (nuvem cinza, "DNS only") nesses registros. O Traefik emite os certificados SSL direto com o Let's Encrypt via desafio HTTP, e o proxy laranja da Cloudflare interfere nesse processo. O HTTPS continua funcionando normalmente — quem cuida dele é o Traefik no seu servidor.

3. O registro `*.supa` (wildcard/curinga) é o que faz **qualquer** subdomínio — `meuprojeto.supa.exemplo.com`, `api-meuprojeto.supa.exemplo.com` etc. — apontar para o seu servidor sem você precisar criar registros novos a cada projeto.

### Passo 3 — Ativar o subdomínio automático no painel

No servidor, edite o `.env` do painel (em instalações padrão fica em `/etc/supapanel/.env`) e adicione:

```bash
PANEL_BASE_DOMAIN="supa.exemplo.com"
```

Depois reinicie o painel:

```bash
cd /etc/supapanel && docker compose up -d panel
```

### Passo 4 — Criar um projeto

1. No dashboard, clique em **New Project**, dê um nome e crie.
2. Clique em **Deploy**. O painel sobe todos os containers do Supabase e configura o Traefik sozinho.
3. Pronto — o projeto já nasce com as URLs:

| Serviço | URL |
|---------|-----|
| Supabase Studio | `https://meuprojeto-123.supa.exemplo.com` |
| API (REST/Auth/Storage/Realtime) | `https://api-meuprojeto-123.supa.exemplo.com` |

O certificado SSL é emitido automaticamente no primeiro acesso (pode levar ~1 minuto).

> 💡 A API responde `401 Unauthorized` quando acessada sem chave — isso é o comportamento correto de uma API protegida, não é erro. Use a `anon key` do projeto nas suas requisições.

### Já tenho o SupaPanel instalado — como atualizo para este fork?

```bash
git clone https://github.com/flavioduque/SupaPanel.git /root/SupaPanel-src
cd /root/SupaPanel-src
docker build -t supapanel-panel:fixed .
# aponte o docker-compose do painel para a imagem supapanel-panel:fixed e:
cd /etc/supapanel && docker compose up -d panel
```

Projetos criados **antes** da atualização continuam funcionando; as correções de gateway/healthcheck valem para projetos novos. Para aplicar em um projeto antigo, basta apagá-lo e recriá-lo pelo painel (ou ajustar manualmente o `docker-compose.yml` do projeto e o arquivo em `/etc/supapanel/traefik/dynamic/`).

### Solução de problemas

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| `Bad Gateway` na URL do projeto | Projeto criado mas nunca deployado | Clique em **Deploy** no painel |
| `no available server` na URL da API | Versão antiga (healthcheck contra o Envoy) | Atualize para este fork e redeploye o projeto |
| Certificado SSL não emite | Proxy da Cloudflare ligado (nuvem laranja) ou portas 80/443 fechadas | Mude para **DNS only** e libere as portas |
| "Check System" falha com erro de prerequisites | Sessão de login expirada (dura 24h) | Saia e entre de novo no painel |

---

## 🇺🇸 English

### What is it

SupaPanel is a web control panel that simplifies deploying and managing multiple self-hosted Supabase projects on your own Linux server. It handles Docker Compose, Traefik (reverse proxy) and SSL certificates automatically.

### Requirements

- Linux server (Ubuntu 22.04+ or Debian 11+) with a public IP — VPS, bare metal, or LXC container (Proxmox) with at least **4 GB RAM**
- Ports **80** and **443** open (required for Let's Encrypt certificate issuance)
- A domain you own, managed on **Cloudflare** (or any DNS provider)

### Step 1 — Install the panel on your server

```bash
curl -sSL https://raw.githubusercontent.com/flavioduque/SupaPanel/main/install.sh | sh
```

The script installs Docker (if missing), then brings up Traefik, PostgreSQL and the panel. When it finishes, open `http://YOUR_SERVER_IP:3000` and create your admin account (only the first user can register).

### Step 2 — Configure DNS on Cloudflare

This is the step that enables automatic subdomains. Example using the domain `example.com` with the base `supa.example.com`:

1. Open the Cloudflare dashboard and select your domain.
2. Go to **DNS → Records → Add record** and create **two records**:

| Type | Name | IPv4 address | Proxy status |
|------|------|--------------|--------------|
| A | `supa` | `YOUR_SERVER_IP` | **DNS only** (grey cloud) |
| A | `*.supa` | `YOUR_SERVER_IP` | **DNS only** (grey cloud) |

> ⚠️ **Important:** keep the Cloudflare proxy **off** (grey cloud, "DNS only") on these records. Traefik issues SSL certificates directly with Let's Encrypt via HTTP challenge, and Cloudflare's orange-cloud proxy interferes with that process. HTTPS still works normally — Traefik on your server handles it.

3. The `*.supa` wildcard record is what makes **any** subdomain — `myproject.supa.example.com`, `api-myproject.supa.example.com`, etc. — resolve to your server without creating a new record per project.

### Step 3 — Enable automatic subdomains in the panel

On the server, edit the panel's `.env` (default installs keep it at `/etc/supapanel/.env`) and add:

```bash
PANEL_BASE_DOMAIN="supa.example.com"
```

Then restart the panel:

```bash
cd /etc/supapanel && docker compose up -d panel
```

### Step 4 — Create a project

1. On the dashboard, click **New Project**, name it, create it.
2. Click **Deploy**. The panel brings up all Supabase containers and configures Traefik by itself.
3. Done — the project is born with its URLs:

| Service | URL |
|---------|-----|
| Supabase Studio | `https://myproject-123.supa.example.com` |
| API (REST/Auth/Storage/Realtime) | `https://api-myproject-123.supa.example.com` |

The SSL certificate is issued automatically on first access (may take ~1 minute).

> 💡 The API answers `401 Unauthorized` when accessed without a key — that's the correct behavior for a protected API, not an error. Use the project's `anon key` in your requests.

### Already running SupaPanel — how do I upgrade to this fork?

```bash
git clone https://github.com/flavioduque/SupaPanel.git /root/SupaPanel-src
cd /root/SupaPanel-src
docker build -t supapanel-panel:fixed .
# point the panel's docker-compose at the supapanel-panel:fixed image, then:
cd /etc/supapanel && docker compose up -d panel
```

Projects created **before** the upgrade keep working; the gateway/healthcheck fixes apply to new projects. To apply them to an old project, delete and recreate it through the panel (or manually adjust the project's `docker-compose.yml` and its file under `/etc/supapanel/traefik/dynamic/`).

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Bad Gateway` on the project URL | Project created but never deployed | Click **Deploy** in the panel |
| `no available server` on the API URL | Old version (healthcheck against Envoy) | Upgrade to this fork and redeploy the project |
| SSL certificate never issues | Cloudflare proxy on (orange cloud) or ports 80/443 blocked | Switch to **DNS only** and open the ports |
| "Check System" fails with prerequisites error | Login session expired (24h TTL) | Log out and log back in |

---

## Technical changes in this fork / Mudanças técnicas deste fork

| File | Change |
|------|--------|
| `src/lib/project.ts` | Auto-assigns `{slug}.<PANEL_BASE_DOMAIN>` and `api-{slug}.<PANEL_BASE_DOMAIN>` on project creation; wires project containers to the Traefik network; renames both `supabase-kong` **and** `supabase-envoy` containers to a canonical `{slug}-gateway` (newer Supabase templates ship Envoy instead of Kong) |
| `src/lib/traefik.ts` | Targets the canonical `{slug}-gateway` container; uses the fixed internal ports (8000/3000) instead of host-published ones; removes the `/health` healthCheck (Envoy returns 401 on it, which made Traefik permanently mark the backend unhealthy) |
| `src/app/dashboard/page.tsx` | Shows the auto-assigned HTTPS URLs on the dashboard |
| `.env.example` | Documents `PANEL_BASE_DOMAIN` |

---

## License

MIT — same as the original project. Credits to [@alanfrigo](https://github.com/alanfrigo) (SupaPanel) and [@sharonpraju](https://github.com/sharonpraju) (SupaConsole).
