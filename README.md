# Sedenia

Rozšírenie VS Code, ktoré v ľavom bočnom paneli ukáže všetky bežiace sedenia Claude Code a vlákna Codexu na počítači — kto čaká na odpoveď, kto pracuje a kto skončil. Klik na riadok prepne do okna VS Code, kde sedenie beží.

**Stav:** v návrhu, bez kódu.

## Pre koho

Pre človeka, ktorý má viac projektov naraz v samostatných oknách VS Code a v každom beží AI agent. Zabudovaný zoznam sedení vidí len svoje okno, toto rozšírenie vidí všetky.

## Ako to má fungovať

- Ikona v Activity Bar otvorí zoznam sedení, v každom okne VS Code rovnaký.
- Čakajúce sedenia sú hore a odznak na ikone ukáže, koľko ich je.
- Pri prechode sedenia do čakania príde upozornenie.
- Zdrojom sú lokálne súbory Claude Code a Codexu, rozšírenie ich len číta a nič neposiela na sieť.

## Technológie (plán)

- TypeScript, VS Code Extension API (TreeView)
- bez runtime závislostí
- len Windows

## Spustenie

Doplní sa po vzniku kódu.

Pozri aj [ROADMAP.md](ROADMAP.md).
