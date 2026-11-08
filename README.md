# Sedenia

Rozšírenie VS Code, ktoré v ľavom bočnom paneli ukáže všetky bežiace sedenia Claude Code a vlákna Codexu na počítači — kto čaká na odpoveď, kto pracuje a kto skončil. Klik na riadok prepne do okna VS Code alebo do konkrétneho chatu natívnej appky Codexu.

**Stav:** implementované, lokálny balík `sedenia-0.1.2.vsix`.

## Pre koho

Pre človeka, ktorý má viac projektov naraz v samostatných oknách VS Code a v každom beží AI agent. Zabudovaný zoznam sedení vidí len svoje okno, toto rozšírenie vidí všetky.

## Používanie

- Ikona v Activity Bar otvorí zoznam sedení, v každom okne VS Code rovnaký.
- Čakajúce sedenia sú hore a odznak na ikone ukáže, koľko ich je. Žltý zvonček znamená čakanie na teba, modrá bodka prácu a sivý obrys kruhu nečinnosť. Ikony sa nehýbu.
- Pri prechode sedenia do čakania príde upozornenie.
- Zdrojom sú lokálne súbory Claude Code a Codexu, rozšírenie ich len číta a nič neposiela na sieť.

## Technológie

- TypeScript, VS Code Extension API (TreeView)
- bez runtime závislostí
- len Windows

## Spustenie

```powershell
npm install
npm test
npm run package
code --install-extension .\sedenia-0.1.2.vsix
```

V Activity Bar otvor ikonu **Sedenia**. Tlačidlo obnovy načíta stav hneď. Diagnostiku otvoríš cez menu panela alebo príkaz **Sedenia — Zobraziť diagnostiku**.

Na vývoj otvor projekt cez `code --extensionDevelopmentPath .`. Príkaz `npm run test:vscode` spustí test aktivácie a živého čítania v izolovanom VS Code, potrebuje lokálnu inštaláciu VS Code. Samostatné testy cez `npm test` používajú syntetické dáta.

## Známe obmedzenia

- Prepnutie do VS Code aktivuje okno priečinka, konkrétnu kartu chatu nevyberá.
- Chaty Codexu sa sledujú bez ohľadu na deň založenia. Aktivita sa určuje podľa udalostí v logu. Prvé čítanie načíta aj staršie logy, ďalej sa obsah obnoví len pri zmene veľkosti alebo času úpravy súboru. Komprimované archívy sa nezobrazujú.
- Cieľ prepnutia Codexu určuje klient, ktorý chat založil. Pri pokračovaní v druhom klientovi sa táto informácia nemení.
- Rozpoznanie schválenia Codexu potrebuje existujúci hook `PermissionRequest` a markery v `~/.codex/hooks/sedenia-cakanie/`. Rozšírenie hook neinštaluje ani nemení. Otázky rozpoznáva z logu aj bez hooku.
- Každé okno VS Code číta zdroje samostatne a upozorňuje na cudzie sedenia. Natívna appka Codexu je vždy cudzie sedenie.
- Interné formáty oboch nástrojov sa môžu zmeniť. Chyby nájdeš v kanáli Output → Sedenia.


Pozri aj [ROADMAP.md](ROADMAP.md).
