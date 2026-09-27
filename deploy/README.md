# Deploying Prism Siege to treasurepast.com

The game runs on the Hostinger VPS as a small Node service at **`treasurepast.com/prism-siege/`**. The server
itself (firewall, Node, Caddy/HTTPS), the portal home page and the routing that sends `/prism-siege/` here all
belong to the separate **`treasurepast-site`** repo — set that up first by following its README.

Commands run as `root` in the Hostinger **browser terminal** (hPanel → VPS → your server → **Browser terminal**).

> Layout on the VPS
> - `/opt/prism-siege/app` — the game (a clone of this repo), owned by the `prism` system user
> - `prism-siege` — the systemd service that keeps `node server.js` running on `127.0.0.1:3010`
> - Caddy (configured by `treasurepast-site`) forwards `https://treasurepast.com/prism-siege/*` here, with the
>   `/prism-siege` prefix removed

---

## 1. Create the game's user and key

```bash
useradd --system --create-home --home-dir /opt/prism-siege --shell /usr/sbin/nologin prism
sudo -H -u prism mkdir -p -m 700 /opt/prism-siege/.ssh
sudo -H -u prism ssh-keygen -t ed25519 -N "" -C "treasurepast-vps" -f /opt/prism-siege/.ssh/id_ed25519
echo; echo "=== Copy the key below into GitHub ==="; cat /opt/prism-siege/.ssh/id_ed25519.pub
```

## 2. Let the VPS read the repo

The repo is private, so the VPS needs its own **read-only** key:

1. Open **https://github.com/blebleu/prism-siege/settings/keys** → **Add deploy key**
2. Title: `treasurepast-vps`
3. Key: the `ssh-ed25519 …` line printed at the end of step 1
4. Leave **Allow write access** **unticked** — the server only ever pulls.

## 3. Download the game and start it

```bash
sudo -H -u prism sh -c 'ssh-keyscan github.com >> ~/.ssh/known_hosts && git clone git@github.com:blebleu/prism-siege.git ~/app'
bash /opt/prism-siege/app/deploy/update.sh
systemctl enable prism-siege
```

The last lines should print `Prism Siege is up`. Then update the site (`bash /opt/treasurepast/site/update.sh`) so
Caddy routes `/prism-siege/` here and the portal shows the game, and open **https://treasurepast.com/prism-siege/**.

## Updating later

After new changes are pushed to GitHub:

```bash
bash /opt/prism-siege/app/deploy/update.sh
```

This only restarts this game; the portal and other games are untouched. The game has no online play, so a
restart never interrupts anyone.

## Checking on it

```bash
systemctl status prism-siege          # is the game running?
journalctl -u prism-siege -n 50        # the game's recent log
curl -s http://127.0.0.1:3010/healthz  # prints "ok" when the game answers
```
