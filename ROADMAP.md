# Roadmapa

Checklist funkcií projektu — čo je hotové a čo čaká. Bez dátumov (históriu drží git). Súbor je verejný — žiadne interné dohody. Detail rozpracovaných vecí je v CURRENT.md, zadanie v SPEC.md.

## Overenie pred kódom

- [ ] Prepnutie okna cez `vscode.openFolder` aktivuje existujúce okno s priečinkom a nenahradí aktuálne
- [ ] Záložné prepnutie cez `code` CLI bez shellu z extension hostu
- [ ] Odznak na ikone v Activity Bar a farebné ikony stavu vo VS Code 1.144

## Zoznam sedení Claude Code

- [ ] Čítanie registra `~/.claude/sessions` (len `interactive` a `bg`)
- [ ] Filter živých procesov cez tasklist s cache
- [ ] Stavy čaká, beží, nečinné a dôvod čakania
- [ ] Text riadku s trvaním a poradie podľa stavu

## Vlákna Codexu

- [ ] Čítanie rollout JSONL za dnešok a včerajšok s cache podľa veľkosti a času zmeny
- [ ] Čakanie na schválenie z markerov hooku
- [ ] Čakanie na otázku z JSONL
- [ ] Sloty na priečinok a pre desktopovú appku
- [ ] Veľké súbory bez Pythonu (začiatok a koniec súboru)

## Zobrazenie

- [ ] Ikona v Activity Bar a zoznam v ľavom paneli
- [ ] Ikony a farby stavu, trvanie v popise, cesta v tooltipe
- [ ] Hlavička s počtami a časom posledného čítania
- [ ] Odznak s počtom čakajúcich
- [ ] Značka sedení aktuálneho okna
- [ ] Správy pre chýbajúci register a neznámy formát

## Akcie

- [ ] Klik na riadok prepne do okna sedenia
- [ ] Hlásenie pri zlyhanom prepnutí

## Upozornenia

- [ ] Upozornenie pri prechode do čakania (Claude aj Codex)
- [ ] Upozornenie pri dokončení ťahu Codexu
- [ ] Bez upozornenia za sedenia vlastného okna

## Kvalita a balenie

- [ ] Testy čistých funkcií prenesené z modu
- [ ] Výstupný kanál s chybami čítania
- [ ] Balík `.vsix` a lokálna inštalácia

## Prechod z modu

- [ ] Parita s modom overená naživo
- [ ] Mod vypnutý a zálohovaný

## Neskôr

- [ ] Jedno čítanie pre všetky okná namiesto čítania v každom okne
- [ ] Vlákna Codexu staršie ako dva dni, ak stále bežia
- [ ] Inkrementálne čítanie JSONL od posledného miesta
